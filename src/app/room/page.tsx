"use client";

import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import { Download, Square, X } from "lucide-react";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useMediaQuery } from "@/hooks/use-media-query";
import ClassChat from "./classChat";
import SlideViewer from "./slideViewer";
import type { ClientToServerEvents, ServerToClientEvents } from "@/socket/types";
import type { Question, Role } from "@/utils/types";
import {
  RoomContext,
  publishSlideContext,
  type SlideContextSnapshot,
  type SlideNavigationTarget,
} from "./RoomContext";
import { SlideUpdateContext } from "./SlideUpdateContext";

function passedSlideReturnTarget(
  returnTarget: SlideContextSnapshot,
  jumpTarget: SlideContextSnapshot,
  current: SlideContextSnapshot
): boolean {
  const ret = returnTarget.slidePageIndex;
  const jump = jumpTarget.slidePageIndex;
  const cur = current.slidePageIndex;
  if (ret == null || jump == null || cur == null) return false;
  if (returnTarget.slideSetId !== current.slideSetId) return false;

  if (jump > ret) return cur <= ret;
  if (jump < ret) return cur >= ret;
  return true;
}

// ---------------------------------------------------------------------------
// Chat history export
// ---------------------------------------------------------------------------

function generateAndDownloadTxt(questions: Question[], sessionTitle: string): void {
  const sep = "─".repeat(44);
  const lines: string[] = [`=== ${sessionTitle} ===`, new Date().toLocaleString(), ""];

  function label(user: { username: string; utorid?: string } | null): string {
    if (!user) return "Anonymous";
    return user.utorid ? `${user.username} - ${user.utorid}` : user.username;
  }

  if (questions.length === 0) {
    lines.push("No questions were asked during this session.");
  } else {
    for (const q of questions) {
      lines.push(sep);
      lines.push(`${q.timestamp} — ${label(q.user)}`);
      lines.push(`Q: ${q.content}`);
      if (q.replies.length > 0) {
        lines.push("");
        for (const r of q.replies) {
          lines.push(`  ${r.timestamp} — ${label(r.user)}`);
          lines.push(`  A: ${r.content}`);
        }
      }
      lines.push("");
    }
    lines.push(sep);
  }

  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sessionTitle.replace(/[^a-z0-9]/gi, "_")}_chat.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// End-session modal
// ---------------------------------------------------------------------------

interface EndSessionModalProps {
  sessionTitle: string;
  ending: boolean;
  onDownloadAndEnd: () => void;
  onEndWithout: () => void;
  onCancel: () => void;
}

function EndSessionModal({
  sessionTitle,
  ending,
  onDownloadAndEnd,
  onEndWithout,
  onCancel,
}: EndSessionModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-md shadow-xl border border-stone-200 w-full max-w-sm mx-4 overflow-hidden">
        <div className="px-6 py-5 border-b border-stone-100">
          <h2 className="text-lg font-bold text-stone-900">End Session</h2>
          <p className="text-sm text-stone-500 mt-1">
            Would you like to download the chat history for{" "}
            <span className="font-medium text-stone-700">{sessionTitle}</span> before ending?
          </p>
        </div>
        <div className="px-6 py-4 flex flex-col gap-2">
          <button
            onClick={onDownloadAndEnd}
            disabled={ending}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-green-100 hover:bg-green-200 text-green-700 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {ending ? "Ending…" : "Download chat history & end"}
          </button>
          <button
            onClick={onEndWithout}
            disabled={ending}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
          >
            <Square className="w-4 h-4 fill-current" />
            End without downloading
          </button>
          <button
            onClick={onCancel}
            disabled={ending}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inner room — uses useSearchParams, must be wrapped in Suspense
// ---------------------------------------------------------------------------

function RoomInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionId = searchParams.get("sessionId") ?? "";
  const titleParam = searchParams.get("title") ?? "";

  const isMdSize = useMediaQuery("(min-width: 1024px)");
  const [isSlidesVisible, setIsSlidesVisible] = useState(true);
  const [resizableWidth, setResizableWidth] = useState(32);

  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<Role>("STUDENT");
  const sessionTitle = decodeURIComponent(titleParam);
  const [authReady, setAuthReady] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const [endingSession, setEndingSession] = useState(false);
  const chatHistoryRef = useRef<Question[]>([]);
  const slideContextRef = useRef<SlideContextSnapshot>({
    slidePageIndex: null,
    slideSetId: null,
  });
  const slideJumpTargetRef = useRef<SlideContextSnapshot | null>(null);

  const [slideReturnTarget, setSlideReturnTarget] = useState<SlideContextSnapshot | null>(null);
  const [slideNavTarget, setSlideNavTarget] = useState<SlideContextSnapshot | null>(null);

  const handleSlideContextChange = useCallback((ctx: SlideContextSnapshot) => {
    slideContextRef.current = ctx;
    publishSlideContext(ctx);

    setSlideReturnTarget((prev) => {
      if (!prev?.slidePageIndex || !prev.slideSetId) return prev;
      const jump = slideJumpTargetRef.current;
      if (!jump) {
        return ctx.slidePageIndex === prev.slidePageIndex && ctx.slideSetId === prev.slideSetId
          ? null
          : prev;
      }
      if (!passedSlideReturnTarget(prev, jump, ctx)) return prev;
      slideJumpTargetRef.current = null;
      return null;
    });
  }, []);

  const navigateToQuestionSlide = useCallback(
    (target: SlideNavigationTarget) => {
      const current = slideContextRef.current;
      const isDifferent =
        current.slidePageIndex !== target.slidePageIndex ||
        current.slideSetId !== target.slideSetId;

      if (
        isDifferent &&
        current.slidePageIndex !== null &&
        current.slideSetId !== null &&
        slideReturnTarget === null
      ) {
        setSlideReturnTarget({ ...current });
        slideJumpTargetRef.current = {
          slidePageIndex: target.slidePageIndex,
          slideSetId: target.slideSetId,
        };
      }

      setIsSlidesVisible(true);
      setSlideNavTarget({
        slidePageIndex: target.slidePageIndex,
        slideSetId: target.slideSetId,
      });
    },
    [slideReturnTarget]
  );

  const goBackToPreviousSlide = useCallback(() => {
    if (slideReturnTarget?.slidePageIndex == null || !slideReturnTarget?.slideSetId) return;
    setSlideNavTarget({ ...slideReturnTarget });
    slideJumpTargetRef.current = null;
    setSlideReturnTarget(null);
  }, [slideReturnTarget]);

  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(
    null
  );
  const sessionIdRef = useRef(sessionId);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Redirect as soon as sessionEnded is set — by socket event or polling
  useEffect(() => {
    if (sessionEnded) {
      router.push("/");
    }
  }, [sessionEnded, router]);

  // Poll session status every 8 seconds as a fallback for missed socket events
  useEffect(() => {
    if (!sessionId || !authReady) return;

    const check = async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === "ENDED") setSessionEnded(true);
        }
      } catch {
        /* network error — ignore, will retry */
      }
    };

    const interval = setInterval(check, 8000);
    return () => clearInterval(interval);
  }, [sessionId, authReady]);

  // Fetch the authenticated user then resolve effective role for TAs
  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then(async (data) => {
        if (data?.userId) {
          setUserId(data.userId);

          // Always resolve role via the session-specific endpoint to ensure
          // per-course authorization (CourseEnrollment). Never trust the global
          // cookie role for session-scoped access.
          if (sessionId) {
            try {
              const roleRes = await fetch(`/api/sessions/${sessionId}/my-role`);
              if (roleRes.ok) {
                const roleData = await roleRes.json();
                setRole((roleData.role as Role) ?? "STUDENT");
              } else if (roleRes.status === 403 || roleRes.status === 404) {
                router.replace("/");
                return;
              } else {
                setRole("STUDENT");
              }
            } catch {
              setRole("STUDENT");
            }
          } else {
            setRole("STUDENT");
          }
        }
        setAuthReady(true);
      })
      .catch(() => setAuthReady(true));
  }, [sessionId, router]);

  // Connect to Socket.IO once auth is ready.
  // withCredentials: true sends the iron-session cookie so the server-side
  // auth middleware can verify the session without a separate token.
  useEffect(() => {
    if (!authReady || !userId) return;

    const s: Socket<ServerToClientEvents, ClientToServerEvents> = io({
      withCredentials: true,
    });

    s.on("connect", () => {
      if (sessionIdRef.current) {
        s.emit("session:join", { sessionId: sessionIdRef.current }, (error?: string) => {
          if (!error) setSocket(s);
        });
      } else {
        setSocket(s);
      }
    });

    s.on("session:ended", () => {
      setSessionEnded(true);
    });

    return () => {
      if (sessionIdRef.current) {
        s.emit("session:leave", { sessionId: sessionIdRef.current });
      }
      s.disconnect();
      setSocket(null);
    };
  }, [authReady, userId]);

  if (!authReady) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background">
        <span className="text-stone-400 text-sm">Authenticating…</span>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background">
        <span className="text-stone-400 text-sm">No session specified.</span>
      </div>
    );
  }

  if (sessionEnded) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center gap-3 bg-background">
        <span className="text-xl font-semibold text-foreground">Lecture has ended</span>
        <span className="text-sm text-stone-400">Redirecting you back…</span>
      </div>
    );
  }

  const handleEndSession = async () => {
    setEndingSession(true);
    try {
      await fetch(`/api/sessions/${sessionId}`, { method: "PATCH" });
      router.push("/");
    } catch {
      setEndingSession(false);
      setShowEndModal(false);
    }
  };

  const handleDownloadAndEnd = () => {
    generateAndDownloadTxt(chatHistoryRef.current, sessionTitle);
    handleEndSession();
  };

  const handleEndWithout = () => {
    handleEndSession();
  };

  function rerender() {
    setIsSlidesVisible((prev) => !prev);
  }

  const isProfessor = role === "PROFESSOR";

  return (
    <RoomContext.Provider
      value={{
        socket,
        sessionId,
        userId,
        role,
        sessionTitle,
        slideContextRef,
        slideReturnTarget,
        navigateToQuestionSlide,
        goBackToPreviousSlide,
      }}
    >
      <div className="relative h-screen w-full bg-background font-sans">
        <SlideUpdateContext.Provider value={{ isSlidesVisible, rerender }}>
          {isSlidesVisible ? (
            <div className="h-screen w-full bg-background font-sans">
              <ResizablePanelGroup direction={isMdSize ? "horizontal" : "vertical"}>
                <ResizablePanel
                  defaultSize={100 - resizableWidth}
                  minSize={0}
                  onResize={(panelWidth) => setResizableWidth(panelWidth)}
                >
                  <SlideViewer
                    isProfessor={isProfessor}
                    onEndLecture={isProfessor ? () => setShowEndModal(true) : undefined}
                    onSlideContextChange={handleSlideContextChange}
                    slideNavTarget={slideNavTarget}
                  />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={resizableWidth} minSize={32}>
                  <ClassChat chatHistoryRef={chatHistoryRef} />
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
          ) : (
            <div className="h-screen w-full bg-background font-sans">
              <ResizablePanelGroup direction={isMdSize ? "horizontal" : "vertical"}>
                <ResizablePanel minSize={30}>
                  <ClassChat chatHistoryRef={chatHistoryRef} />
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
          )}
        </SlideUpdateContext.Provider>
      </div>

      {showEndModal && (
        <EndSessionModal
          sessionTitle={sessionTitle}
          ending={endingSession}
          onDownloadAndEnd={handleDownloadAndEnd}
          onEndWithout={handleEndWithout}
          onCancel={() => setShowEndModal(false)}
        />
      )}
    </RoomContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Room — exported page component, wraps RoomInner in Suspense
// ---------------------------------------------------------------------------

export default function Room() {
  return (
    <Suspense
      fallback={
        <div className="h-screen w-full flex items-center justify-center bg-background">
          <span className="text-stone-400 text-sm">Loading…</span>
        </div>
      }
    >
      <RoomInner />
    </Suspense>
  );
}
