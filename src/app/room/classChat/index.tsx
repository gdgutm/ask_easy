"use client";

import { useEffect, useRef, useState } from "react";
import type React from "react";

import { useRoom } from "../RoomContext";
import PostItem from "./post";
import ChatHeader from "./ChatHeader";
import ChatInput from "./ChatInput";
import FilterTabs from "./FilterTabs";
import type { Question, Comment, Role } from "@/utils/types";
import { showRateLimitToast } from "@/components/RateLimitToast";

// ---------------------------------------------------------------------------
// API response types (what the REST endpoints return)
// ---------------------------------------------------------------------------

interface RateLimitAwareError {
  message: string;
  code?: string;
  retryAfterSeconds?: number;
}

interface APIQuestion {
  id: string;
  content: string;
  visibility: "PUBLIC" | "INSTRUCTOR_ONLY";
  status: "OPEN" | "ANSWERED" | "RESOLVED";
  isAnonymous: boolean;
  upvoteCount: number;
  hasUpvoted?: boolean;
  answerCount: number;
  createdAt: string;
  slidePageIndex?: number | null;
  slideSetId?: string | null;
  author: { id: string; utorid: string; name: string; role: Role } | null;
  /** True for the viewer's own question, even when it was posted anonymously. */
  isMine?: boolean;
}

interface APIAnswer {
  id: string;
  questionId: string;
  content: string;
  isAnonymous: boolean;
  /** Nested author object returned by the answers service */
  author: { id: string; utorid: string; name: string; role: Role } | null;
  /** Top-level role mirror returned alongside author — used for role checks */
  authorRole: Role;
  isAccepted: boolean;
  upvoteCount: number;
  hasUpvoted?: boolean;
  createdAt: string;
  /** True for the viewer's own answer, even when it was posted anonymously. */
  isMine?: boolean;
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

function fmt(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function apiAnswerToPost(a: APIAnswer): Comment {
  const user = !a.author
    ? null
    : {
        id: a.author.id,
        utorid: a.author.utorid,
        username: a.author.name,
        pfp: "",
        role: a.author.role,
      };

  return {
    id: a.id,
    type: "comment",
    user,
    timestamp: fmt(a.createdAt),
    content: a.content,
    upvotes: a.upvoteCount ?? 0,
    isAnonymous: a.isAnonymous,
    isMine: a.isMine,
    hasUpvoted: a.hasUpvoted,
  };
}

function apiQuestionToPost(q: APIQuestion, answers: APIAnswer[]): Question {
  const user = !q.author
    ? null
    : {
        id: q.author.id,
        utorid: q.author.utorid,
        username: q.author.name,
        pfp: "",
        role: q.author.role,
      };

  return {
    id: q.id,
    type: "question",
    user,
    timestamp: fmt(q.createdAt),
    content: q.content,
    upvotes: q.upvoteCount,
    hasUpvoted: q.hasUpvoted,
    isResolved: q.status === "RESOLVED",
    isAnonymous: q.isAnonymous,
    isMine: q.isMine,
    replies: answers.map((a) => apiAnswerToPost(a)),
    visibility: q.visibility,
    slidePageIndex: q.slidePageIndex ?? null,
    slideSetId: q.slideSetId ?? null,
  };
}

// ---------------------------------------------------------------------------
// ClassChat
// ---------------------------------------------------------------------------

interface ClassChatProps {
  /** Receives the full chat history (including deleted messages) for session export. */
  chatHistoryRef?: React.MutableRefObject<Question[]>;
}

export default function ClassChat({ chatHistoryRef }: ClassChatProps) {
  const { socket, sessionId, userId, role, slideContextRef, sessionTitle } = useRoom();

  const [commentView, setCommentView] = useState<"all" | "unresolved" | "resolved">("all");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answerMode, setAnswerMode] = useState<"all" | "instructors_only">("instructors_only");
  const [notificationMode, setNotificationMode] = useState<"off" | "sound" | "browser">("off");
  const [globalIsAnonymous, setGlobalIsAnonymous] = useState(false);
  const [includeSlideContext, setIncludeSlideContext] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  /** Id of a question the viewer just asked, pending a scroll to its card. */
  const [scrollTargetId, setScrollTargetId] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  // Separate history that keeps deleted messages (marked as [deleted]) for the
  // session export. Never removes items — deletions are marked in-place.
  const historyRef = useRef<Question[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);

  const playQuestionBeep = (mode = notificationMode) => {
    if (mode === "off" || typeof window === "undefined") return;

    const audioContext = audioContextRef.current ?? new window.AudioContext();
    audioContextRef.current = audioContext;
    if (audioContext.state === "suspended") {
      void audioContext.resume().catch(() => {});
    }

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    const now = audioContext.currentTime;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, now);
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(0.14, now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.18);
  };

  const requestBrowserNotificationPermission = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;

    try {
      return (await Notification.requestPermission()) === "granted";
    } catch {
      return false;
    }
  };

  const showBrowserNotification = (
    title: string,
    body: string,
    tag: string,
    mode = notificationMode
  ) => {
    if (mode !== "browser" || typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    if (document.visibilityState === "visible" && document.hasFocus()) return;

    const notification = new Notification(title, { body, tag });

    setTimeout(() => notification.close(), 5000);
  };

  // -------------------------------------------------------------------------
  // Initial data fetch
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!sessionId || sessionId === "placeholder-session") {
      setIsLoading(false);
      return;
    }

    async function loadQuestions() {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/sessions/${sessionId}/questions`);
        if (!res.ok) return;
        const data = await res.json();
        const rawQuestions: APIQuestion[] = data.questions ?? [];

        // Fetch answers in parallel for questions that have any
        const answersMap: Record<string, APIAnswer[]> = {};
        await Promise.all(
          rawQuestions
            .filter((q) => q.answerCount > 0)
            .map(async (q) => {
              const aRes = await fetch(`/api/questions/${q.id}/answers`);
              if (aRes.ok) {
                const aData = await aRes.json();
                answersMap[q.id] = aData.answers ?? [];
              }
            })
        );

        // Reverse so oldest questions appear at top, newest at bottom
        const ordered = [...rawQuestions].reverse();
        const mapped = ordered.map((q) => apiQuestionToPost(q, answersMap[q.id] ?? []));
        setQuestions(mapped);
        historyRef.current = mapped.map((q) => ({ ...q, replies: [...q.replies] }));
      } finally {
        setIsLoading(false);
      }
    }

    loadQuestions();
  }, [sessionId, userId]);

  // -------------------------------------------------------------------------
  // Socket event listeners
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!socket) return;

    const syncAnswerMode = () => socket.emit("answer-mode:sync", { sessionId });
    if (socket.connected) syncAnswerMode();
    socket.on("connect", syncAnswerMode);

    const onQuestionCreated = (payload: {
      id: string;
      content: string;
      visibility: string;
      isAnonymous: boolean;
      createdAt: Date;
      authorId?: string | null;
      authorName?: string | null;
      authorUtorid?: string | null;
      authorRole?: Role;
      slidePageIndex?: number | null;
      slideSetId?: string | null;
      isMine?: boolean;
    }) => {
      const user =
        payload.isAnonymous || !payload.authorName
          ? null
          : {
              id: payload.authorId ?? undefined,
              utorid: payload.authorUtorid ?? undefined,
              username: payload.authorName,
              pfp: "",
              role: payload.authorRole ?? ("STUDENT" as Role),
            };

      const newQuestion: Question = {
        id: payload.id,
        type: "question",
        user,
        timestamp: fmt(new Date(payload.createdAt).toISOString()),
        content: payload.content,
        upvotes: 0,
        isResolved: false,
        isAnonymous: payload.isAnonymous,
        isMine: payload.isMine,
        replies: [],
        visibility: payload.visibility as "PUBLIC" | "INSTRUCTOR_ONLY",
        slidePageIndex: payload.slidePageIndex ?? null,
        slideSetId: payload.slideSetId ?? null,
      };

      setQuestions((prev) => [...prev, newQuestion]);
      historyRef.current = [...historyRef.current, { ...newQuestion, replies: [] }];
      if (!payload.isMine) {
        const author =
          newQuestion.isAnonymous || !newQuestion.user?.username
            ? "Anonymous"
            : newQuestion.user.username;
        playQuestionBeep();
        showBrowserNotification(
          sessionTitle || "New question",
          `${author}: ${newQuestion.content}`,
          `question-${newQuestion.id}`
        );
      }
      if (payload.isMine) setScrollTargetId(payload.id);
    };

    const onQuestionUpdated = (payload: { id: string; upvoteCount: number }) => {
      setQuestions((prev) =>
        prev.map((q) => (q.id === payload.id ? { ...q, upvotes: payload.upvoteCount } : q))
      );
    };

    const onQuestionResolved = (payload: { id: string }) => {
      setQuestions((prev) =>
        prev.map((q) => (q.id === payload.id ? { ...q, isResolved: true } : q))
      );
    };

    const onQuestionUnresolved = (payload: { id: string }) => {
      setQuestions((prev) =>
        prev.map((q) => (q.id === payload.id ? { ...q, isResolved: false } : q))
      );
    };

    const onAnswerCreated = (payload: {
      id: string;
      questionId: string;
      content: string;
      isAnonymous: boolean;
      authorId?: string;
      authorName?: string;
      authorUtorid?: string;
      authorRole: Role;
      isAccepted: boolean;
      createdAt: Date;
      isMine?: boolean;
    }) => {
      const apiAnswer: APIAnswer = {
        id: payload.id,
        questionId: payload.questionId,
        content: payload.content,
        isAnonymous: payload.isAnonymous,
        author:
          payload.isAnonymous || !payload.authorName
            ? null
            : {
                id: payload.authorId ?? "",
                utorid: payload.authorUtorid ?? "",
                name: payload.authorName,
                role: payload.authorRole,
              },
        authorRole: payload.authorRole,
        isAccepted: payload.isAccepted,
        upvoteCount: 0,
        createdAt: new Date(payload.createdAt).toISOString(),
        isMine: payload.isMine,
      };
      const newReply = apiAnswerToPost(apiAnswer);
      const question = historyRef.current.find((q) => q.id === payload.questionId);
      const isFollowUpOnMyThread =
        !payload.isMine &&
        (question?.isMine === true || question?.replies.some((reply) => isOwnPost(reply)) === true);
      const replyAuthor =
        newReply.isAnonymous || !newReply.user?.username ? "Anonymous" : newReply.user.username;

      setQuestions((prev) =>
        prev.map((q) =>
          q.id === payload.questionId ? { ...q, replies: [...q.replies, newReply] } : q
        )
      );
      historyRef.current = historyRef.current.map((q) =>
        q.id === payload.questionId ? { ...q, replies: [...q.replies, { ...newReply }] } : q
      );
      if (isFollowUpOnMyThread) {
        playQuestionBeep();
        showBrowserNotification(
          sessionTitle || "New reply",
          `${replyAuthor} replied: ${newReply.content}`,
          `answer-${newReply.id}`
        );
      }
    };

    const onAnswerUpdated = (payload: { id: string; questionId: string; upvoteCount: number }) => {
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === payload.questionId
            ? {
                ...q,
                replies: q.replies.map((r) =>
                  r.id === payload.id ? { ...r, upvotes: payload.upvoteCount } : r
                ),
              }
            : q
        )
      );
    };

    const onAnswerModeChanged = (payload: { mode: "all" | "instructors_only" }) => {
      setAnswerMode(payload.mode);
    };

    const onQuestionAuthorRevealed = (payload: {
      id: string;
      authorId: string;
      authorName: string | null;
      authorUtorid: string | null;
      authorRole: Role;
    }) => {
      if (!payload.authorName) return;
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === payload.id
            ? {
                ...q,
                user: {
                  id: payload.authorId,
                  utorid: payload.authorUtorid ?? undefined,
                  username: payload.authorName!,
                  pfp: "",
                  role: payload.authorRole,
                },
              }
            : q
        )
      );
    };

    const onAnswerAuthorRevealed = (payload: {
      id: string;
      questionId: string;
      authorId: string;
      authorName: string | null;
      authorUtorid: string | null;
      authorRole: Role;
    }) => {
      if (!payload.authorName) return;
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === payload.questionId
            ? {
                ...q,
                replies: q.replies.map((r) =>
                  r.id === payload.id
                    ? {
                        ...r,
                        user: {
                          id: payload.authorId,
                          utorid: payload.authorUtorid ?? undefined,
                          username: payload.authorName!,
                          pfp: "",
                          role: payload.authorRole,
                        },
                      }
                    : r
                ),
              }
            : q
        )
      );
    };

    // Rate-limit refusals arrive already phrased for the user, and they are not
    // about what is in the composer — they get a toast instead of inline text.
    const onQuestionError = (payload: RateLimitAwareError) => {
      if (payload.code === "RATE_LIMITED") {
        showRateLimitToast(payload.message, payload.retryAfterSeconds);
        return;
      }
      setQuestionError(payload.message);
    };

    const onAnswerError = (payload: RateLimitAwareError) => {
      if (payload.code === "RATE_LIMITED") {
        showRateLimitToast(payload.message, payload.retryAfterSeconds);
      }
    };

    const onQuestionDeleted = (payload: { questionId: string }) => {
      setQuestions((prev) => prev.filter((q) => q.id !== payload.questionId));
      // Keep in history but mark content as deleted
      historyRef.current = historyRef.current.map((q) =>
        q.id === payload.questionId ? { ...q, content: `${q.content} [deleted]` } : q
      );
      if (chatHistoryRef) chatHistoryRef.current = historyRef.current;
    };

    const onAnswerDeleted = (payload: { answerId: string; questionId: string }) => {
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === payload.questionId
            ? { ...q, replies: q.replies.filter((r) => r.id !== payload.answerId) }
            : q
        )
      );
      // Keep in history but mark content as deleted
      historyRef.current = historyRef.current.map((q) =>
        q.id === payload.questionId
          ? {
              ...q,
              replies: q.replies.map((r) =>
                r.id === payload.answerId ? { ...r, content: `${r.content} [deleted]` } : r
              ),
            }
          : q
      );
      if (chatHistoryRef) chatHistoryRef.current = historyRef.current;
    };

    socket.on("question:created", onQuestionCreated);
    socket.on("question:updated", onQuestionUpdated);
    socket.on("question:resolved", onQuestionResolved);
    socket.on("question:unresolved", onQuestionUnresolved);
    socket.on("question:deleted", onQuestionDeleted);
    socket.on("answer:created", onAnswerCreated);
    socket.on("answer:updated", onAnswerUpdated);
    socket.on("answer:deleted", onAnswerDeleted);
    socket.on("answer-mode:changed", onAnswerModeChanged);
    socket.on("question:error", onQuestionError);
    socket.on("answer:error", onAnswerError);
    socket.on("question:author:revealed", onQuestionAuthorRevealed);
    socket.on("answer:author:revealed", onAnswerAuthorRevealed);

    return () => {
      socket.off("connect", syncAnswerMode);
      socket.off("question:created", onQuestionCreated);
      socket.off("question:updated", onQuestionUpdated);
      socket.off("question:resolved", onQuestionResolved);
      socket.off("question:unresolved", onQuestionUnresolved);
      socket.off("question:deleted", onQuestionDeleted);
      socket.off("answer:created", onAnswerCreated);
      socket.off("answer:updated", onAnswerUpdated);
      socket.off("answer:deleted", onAnswerDeleted);
      socket.off("answer-mode:changed", onAnswerModeChanged);
      socket.off("question:error", onQuestionError);
      socket.off("answer:error", onAnswerError);
      socket.off("question:author:revealed", onQuestionAuthorRevealed);
      socket.off("answer:author:revealed", onAnswerAuthorRevealed);
    };
  }, [socket, sessionId, chatHistoryRef, role, userId, notificationMode]);

  // Keep chatHistoryRef in sync whenever historyRef is updated via data load
  // or new questions/answers arriving (deletions update it inline above).
  useEffect(() => {
    if (chatHistoryRef) chatHistoryRef.current = historyRef.current;
    // historyRef is a ref so its identity is stable; we only need to re-run
    // when the questions state changes (which always follows a history update).
  }, [questions, chatHistoryRef]);

  // Land on the newest questions once the initial history has loaded
  useEffect(() => {
    if (isLoading) return;
    bottomRef.current?.scrollIntoView();
  }, [isLoading]);

  // The list is sorted by resolved state then upvotes, so a question the viewer
  // just asked can land anywhere — scroll to its card rather than to the bottom.
  // Nothing to scroll to when the current filter or search excludes it.
  useEffect(() => {
    if (!scrollTargetId) return;
    document
      .getElementById(`question-${scrollTargetId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    setScrollTargetId(null);
  }, [scrollTargetId]);

  // -------------------------------------------------------------------------
  // Action handlers
  // -------------------------------------------------------------------------

  const canAnswerGlobal = role === "TA" || role === "PROFESSOR" || answerMode === "all";
  const isInstructor = role === "TA" || role === "PROFESSOR";

  const handleSubmitQuestion = (
    content: string,
    isAnonymous: boolean,
    attachSlideContext: boolean
  ) => {
    if (!socket) return;
    setQuestionError(null);

    const { slidePageIndex, slideSetId } = slideContextRef.current;
    const payload: {
      sessionId: string;
      content: string;
      isAnonymous: boolean;
      slidePageIndex?: number;
      slideSetId?: string;
    } = { sessionId, content, isAnonymous };

    if (attachSlideContext && slidePageIndex !== null && slideSetId !== null) {
      payload.slidePageIndex = slidePageIndex;
      payload.slideSetId = slideSetId;
    }

    socket.emit("question:create", payload);
  };

  const handleUpvote = (questionId: string) => {
    if (!socket) return;
    socket.emit("question:upvote", { questionId });
  };

  const handleAnswerUpvote = (answerId: string) => {
    if (!socket) return;
    socket.emit("answer:upvote", { answerId });
  };

  const handleResolve = (questionId: string) => {
    if (!socket) return;
    socket.emit("question:resolve", { questionId });
  };

  const handleUnresolve = (questionId: string) => {
    if (!socket) return;
    socket.emit("question:unresolve", { questionId });
  };

  const handleSubmitAnswer = (questionId: string, content: string) => {
    if (!socket) return;
    socket.emit("answer:create", { questionId, content, isAnonymous: globalIsAnonymous });
  };

  const handleToggleAnswerMode = () => {
    if (!socket || role !== "PROFESSOR") return;
    const newMode = answerMode === "all" ? "instructors_only" : "all";
    socket.emit("answer-mode:change", { sessionId, mode: newMode });
    setAnswerMode(newMode); // Optimistic update
  };

  const handleToggleNotificationMode = () => {
    const nextMode =
      notificationMode === "off" ? "sound" : notificationMode === "sound" ? "browser" : "off";
    setNotificationMode(nextMode);
    if (nextMode !== "off") playQuestionBeep(nextMode);
    if (nextMode === "browser") {
      void requestBrowserNotificationPermission();
    }
  };

  const handleDeleteQuestion = (questionId: string) => {
    if (!socket) return;
    socket.emit("question:delete", { questionId, sessionId });
  };

  const handleDeleteAnswer = (answerId: string) => {
    if (!socket) return;
    socket.emit("answer:delete", { answerId, sessionId });
  };

  /**
   * True when the post belongs to the current user. `isMine` is what makes
   * this work for posts the viewer made anonymously — those come back with the
   * author stripped, so the id comparison alone would say no.
   */
  function isOwnPost(post: { user: { id?: string } | null; isMine?: boolean }): boolean {
    if (post.isMine) return true;
    return post.user?.id !== undefined && post.user.id === userId;
  }

  /**
   * Returns true when the current user may delete the given post.
   * Mirrors the server rules in question/answer `delete` handlers:
   * - Own post: always, whatever the viewer's role. `isMine` covers posts the
   *   viewer made anonymously, where the author is stripped from the payload.
   * - PROFESSOR: any post, including anonymous ones.
   * - TA: any STUDENT-authored post. Anonymous posts by someone else are
   *   excluded when the author is hidden, since the role can't be checked.
   * - STUDENT: nothing beyond their own.
   */
  function canDelete(post: {
    user: { id?: string; role: Role } | null;
    isMine?: boolean;
  }): boolean {
    if (isOwnPost(post)) return true;
    if (role === "PROFESSOR") return true;
    if (role === "TA") return post.user?.role === "STUDENT";
    return false;
  }

  // -------------------------------------------------------------------------
  // Search filter
  // -------------------------------------------------------------------------

  const filteredQuestions = (() => {
    let list = questions;

    // Search filter
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      const tokens = q.split(/\s+/).filter(Boolean);
      list = list.filter((question) => {
        const haystack = [
          question.content,
          question.user?.username ?? "",
          ...question.replies.map((r) => r.content),
          ...question.replies.map((r) => r.user?.username ?? ""),
        ]
          .join(" ")
          .toLowerCase();
        return tokens.every((token) => haystack.includes(token));
      });
    }

    // Priority sort: resolved sink to bottom (on "All" tab), then by upvotes
    // desc, then oldest first as tiebreaker (index in original array = time order)
    return [...list].sort((a, b) => {
      // Resolved questions sink to bottom on the "All" tab
      if (commentView === "all") {
        if (a.isResolved !== b.isResolved) return a.isResolved ? 1 : -1;
      }
      // Higher upvotes first
      if (b.upvotes !== a.upvotes) return b.upvotes - a.upvotes;
      // Oldest first (earlier index in the original array = posted earlier)
      return list.indexOf(a) - list.indexOf(b);
    });
  })();

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full bg-background text-foreground relative">
      <ChatHeader
        role={role}
        answerMode={answerMode}
        notificationMode={notificationMode}
        onToggleNotificationMode={handleToggleNotificationMode}
        onToggleAnswerMode={handleToggleAnswerMode}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      <div className="flex-1 relative min-h-0">
        <div className="absolute top-0 left-0 right-0 z-[5] h-24 pointer-events-none backdrop-blur-xl bg-background [mask-image:linear-gradient(to_bottom,black,transparent)]" />
        <div className="absolute top-0 w-full z-10 flex justify-center py-2 pointer-events-none">
          <div className="w-full max-w-sm px-4 pointer-events-auto">
            <FilterTabs commentView={commentView} setCommentView={setCommentView} />
          </div>
        </div>

        <div className="absolute inset-0 overflow-y-auto px-4 pt-16">
          <div className="max-w-4xl mx-auto space-y-4 pb-36">
            {isLoading ? (
              <div className="text-center text-stone-500 py-8 text-sm">Loading questions...</div>
            ) : questions.length === 0 ? (
              <div className="text-center text-stone-500 py-8 text-sm">
                No questions yet. Be the first to ask!
              </div>
            ) : (
              <>
                {searchQuery.trim() && (
                  <p className="text-xs text-stone-400 pb-1">
                    {filteredQuestions.length === 0
                      ? "No results"
                      : `${filteredQuestions.length} result${filteredQuestions.length === 1 ? "" : "s"}`}
                  </p>
                )}
                <div className="space-y-4">
                  {filteredQuestions.map((q) => (
                    <PostItem
                      key={q.id}
                      post={q}
                      commentView={commentView}
                      onUpvote={() => handleUpvote(q.id)}
                      onResolve={
                        isInstructor || isOwnPost(q) ? () => handleResolve(q.id) : undefined
                      }
                      onUnresolve={isInstructor ? () => handleUnresolve(q.id) : undefined}
                      canAnswer={canAnswerGlobal || (isOwnPost(q) && !q.isAnonymous)}
                      onSubmitAnswer={(content) => handleSubmitAnswer(q.id, content)}
                      onAnswerUpvote={handleAnswerUpvote}
                      onDeleteQuestion={canDelete(q) ? () => handleDeleteQuestion(q.id) : undefined}
                      onDeleteAnswer={(reply) =>
                        canDelete(reply) ? () => handleDeleteAnswer(reply.id) : undefined
                      }
                    />
                  ))}
                </div>
              </>
            )}
            <div ref={bottomRef} />
          </div>
        </div>
      </div>

      <ChatInput
        onSubmit={handleSubmitQuestion}
        disabled={!socket}
        serverError={questionError}
        onClearError={() => setQuestionError(null)}
        isAnonymous={globalIsAnonymous}
        onAnonymousChange={setGlobalIsAnonymous}
        includeSlideContext={includeSlideContext}
        onIncludeSlideContextChange={setIncludeSlideContext}
      />
    </div>
  );
}
