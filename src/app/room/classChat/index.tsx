"use client";

import { useEffect, useRef, useState } from "react";
import type React from "react";

import { useRoom } from "../RoomContext";
import PostItem from "./post";
import ChatHeader from "./ChatHeader";
import ChatInput from "./ChatInput";
import FilterTabs from "./FilterTabs";
import type { Question, Comment, Role } from "@/utils/types";

// ---------------------------------------------------------------------------
// API response types (what the REST endpoints return)
// ---------------------------------------------------------------------------

interface APIQuestion {
  id: string;
  content: string;
  visibility: "PUBLIC" | "INSTRUCTOR_ONLY";
  status: "OPEN" | "ANSWERED" | "RESOLVED";
  isAnonymous: boolean;
  upvoteCount: number;
  answerCount: number;
  createdAt: string;
  author: { id: string; utorid: string; name: string; role: Role } | null;
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
  createdAt: string;
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
    isResolved: q.status === "RESOLVED",
    isAnonymous: q.isAnonymous,
    replies: answers.map((a) => apiAnswerToPost(a)),
    visibility: q.visibility,
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
  const { socket, sessionId, userId, role } = useRoom();

  const [commentView, setCommentView] = useState<"all" | "unresolved" | "resolved">("all");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answerMode, setAnswerMode] = useState<"all" | "instructors_only">("instructors_only");
  const [globalIsAnonymous, setGlobalIsAnonymous] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);
  // Separate history that keeps deleted messages (marked as [deleted]) for the
  // session export. Never removes items — deletions are marked in-place.
  const historyRef = useRef<Question[]>([]);

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
    }) => {
      const user =
        payload.isAnonymous || !payload.authorName
          ? null
          : {
              id: payload.authorId ?? undefined,
              utorid: payload.authorUtorid ?? undefined,
              username: payload.authorName,
              pfp: "",
              role: "STUDENT" as Role,
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
        replies: [],
        visibility: payload.visibility as "PUBLIC" | "INSTRUCTOR_ONLY",
      };

      setQuestions((prev) => [...prev, newQuestion]);
      historyRef.current = [...historyRef.current, { ...newQuestion, replies: [] }];
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
      };
      const newReply = apiAnswerToPost(apiAnswer);

      setQuestions((prev) =>
        prev.map((q) =>
          q.id === payload.questionId ? { ...q, replies: [...q.replies, newReply] } : q
        )
      );
      historyRef.current = historyRef.current.map((q) =>
        q.id === payload.questionId ? { ...q, replies: [...q.replies, { ...newReply }] } : q
      );
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

    const onQuestionError = (payload: { message: string }) => {
      setQuestionError(payload.message);
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
      socket.off("question:author:revealed", onQuestionAuthorRevealed);
      socket.off("answer:author:revealed", onAnswerAuthorRevealed);
    };
  }, [socket, sessionId, chatHistoryRef, role, userId]);

  // Keep chatHistoryRef in sync whenever historyRef is updated via data load
  // or new questions/answers arriving (deletions update it inline above).
  useEffect(() => {
    if (chatHistoryRef) chatHistoryRef.current = historyRef.current;
    // historyRef is a ref so its identity is stable; we only need to re-run
    // when the questions state changes (which always follows a history update).
  }, [questions, chatHistoryRef]);

  // Scroll to bottom whenever new questions arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [questions.length]);

  // -------------------------------------------------------------------------
  // Action handlers
  // -------------------------------------------------------------------------

  const canAnswerGlobal = role === "TA" || role === "PROFESSOR" || answerMode === "all";
  const isInstructor = role === "TA" || role === "PROFESSOR";

  const handleSubmitQuestion = (content: string, isAnonymous: boolean) => {
    if (!socket) return;
    setQuestionError(null);
    socket.emit("question:create", { sessionId, content, isAnonymous });
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
    // Optimistic update
    setQuestions((prev) => prev.map((q) => (q.id === questionId ? { ...q, isResolved: true } : q)));
  };

  const handleUnresolve = (questionId: string) => {
    if (!socket) return;
    socket.emit("question:unresolve", { questionId });
    // Optimistic update
    setQuestions((prev) =>
      prev.map((q) => (q.id === questionId ? { ...q, isResolved: false } : q))
    );
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

  const handleDeleteQuestion = (questionId: string) => {
    if (!socket) return;
    socket.emit("question:delete", { questionId, sessionId });
  };

  const handleDeleteAnswer = (answerId: string) => {
    if (!socket) return;
    socket.emit("answer:delete", { answerId, sessionId });
  };

  /**
   * Returns true when the current user may delete the given post.
   * - PROFESSOR: always (including anonymous posts)
   * - TA: only named STUDENT posts, or their own named posts.
   *       Anonymous posts are excluded because the client cannot verify the
   *       author's role, and the author could be a professor or another TA.
   * - STUDENT: never
   */
  function canDelete(post: { user: { id?: string; role: Role } | null }): boolean {
    if (role === "PROFESSOR") return true;
    if (role === "TA") {
      if (!post.user) return false; // anonymous — author role unknown, hide button
      return post.user.role === "STUDENT" || post.user.id === userId;
    }
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
                        isInstructor || q.user?.id === userId
                          ? () => handleResolve(q.id)
                          : undefined
                      }
                      onUnresolve={isInstructor ? () => handleUnresolve(q.id) : undefined}
                      canAnswer={canAnswerGlobal || q.user?.id === userId}
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
      />
    </div>
  );
}
