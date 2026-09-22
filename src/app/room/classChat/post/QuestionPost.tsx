"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  MessageCircle,
  CheckCircle2,
  Undo2,
  Trash2,
  ChevronDown,
  ChevronUp,
  Presentation,
} from "lucide-react";
import { Question, Post } from "@/utils/types";
import { UpvoteButton, canRevealAuthor, renderUsername, RevealAuthorButton } from "./PostUtils";
import { useRoom } from "../../RoomContext";
import { ANSWER_MAX_LENGTH, ANSWER_MIN_LENGTH } from "@/utils/contentLimits";

// ---------------------------------------------------------------------------
// Reply composer
// ---------------------------------------------------------------------------

interface ReplySectionProps {
  canAnswer: boolean;
  onSubmit: (content: string) => void;
  onCancel: () => void;
}

function ReplySection({ canAnswer, onSubmit, onCancel }: ReplySectionProps) {
  const [text, setText] = useState("");

  if (!canAnswer) {
    return (
      <div className="py-2 text-xs text-stone-400 italic">
        Only TAs and professors can answer right now.
      </div>
    );
  }

  // Same rule as the question composer: an out-of-bounds reply greys out Post
  // rather than erroring. The server enforces the same bounds — see
  // validateAnswerContent.
  const trimmed = text.trim();
  const canPost = trimmed.length >= ANSWER_MIN_LENGTH && trimmed.length <= ANSWER_MAX_LENGTH;

  const handleSubmit = () => {
    if (!canPost) return;
    onSubmit(trimmed);
    setText("");
    onCancel();
  };

  return (
    <div className="pt-1 pb-2">
      <Textarea
        autoFocus
        placeholder={`Write an answer...\n(Ctrl+Enter to post)`}
        className="min-h-[72px] mb-2 focus-visible:ring-0 focus-visible:border-stone-400"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.ctrlKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
      />
      <div className="flex items-center justify-end">
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!canPost}
            className="dark:!bg-dark-accent dark:hover:!bg-dark-accent/80"
          >
            Post reply
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thread toggle button (+/-)
// ---------------------------------------------------------------------------

function ThreadToggle({
  label,
  expanded,
  onClick,
}: {
  label: string;
  expanded: boolean;
  onClick: () => void;
}) {
  const Icon = expanded ? ChevronUp : ChevronDown;
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="h-7 px-2 text-xs gap-1 text-stone-400 hover:text-stone-900 hover:bg-stone-200/60"
    >
      <Icon className="h-4 w-4" />
      {label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// QuestionPost
// ---------------------------------------------------------------------------

/**
 * Thread states:
 *  "default"  — best answers (professor) visible, other replies hidden
 *  "expanded" — all replies visible
 *  "collapsed"— no replies visible
 */
type ThreadState = "default" | "expanded" | "collapsed";

export default function QuestionPost({
  post,
  commentView,
  replies,
  renderReply,
  canAnswer = true,
  onUpvote,
  onResolve,
  onUnresolve,
  onDelete,
  onSubmitAnswer,
  children,
}: {
  post: Question;
  commentView?: string;
  replies?: Post[];
  renderReply?: (reply: Post) => React.ReactNode;
  canAnswer?: boolean;
  onUpvote?: () => void;
  onResolve?: () => void;
  onUnresolve?: () => void;
  onDelete?: () => void;
  onSubmitAnswer?: (content: string) => void;
  children?: React.ReactNode;
}) {
  const [isReplying, setIsReplying] = useState(false);
  const [threadState, setThreadState] = useState<ThreadState>("default");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const { navigateToQuestionSlide } = useRoom();

  /** Parent (socket/API) is the source of truth; optimistic updates flow through `post`. */
  const resolved = post.isResolved;

  if (commentView === "unresolved" && resolved) return null;
  if (commentView === "resolved" && !resolved) return null;

  const replyList = replies ?? [];
  const hasAnyReplies = replyList.length > 0 || !!children || isReplying;

  const isExpanded = threadState !== "collapsed";

  const handleToggle = () => {
    if (threadState === "collapsed") {
      setThreadState("expanded");
    } else {
      setThreadState("collapsed");
    }
  };

  const handleResolve = () => {
    onResolve?.();
  };

  // Which replies to render in the thread
  const visibleReplies = threadState === "collapsed" ? [] : replyList;

  const showThread = threadState !== "collapsed" && (visibleReplies.length > 0 || isReplying);

  return (
    <div
      id={`question-${post.id}`}
      className={`flex flex-col gap-2 rounded-md p-4 border transition-colors duration-200 ease-out ${resolved ? "bg-green-50/60 border-green-400" : "bg-stone-075 border-amber-400"}`}
    >
      {/* Question body */}
      <div className="font-semibold break-words whitespace-pre-wrap text-stone-900">
        {post.content}
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 gap-x-1 text-xs text-stone-500">
        {/* Left: username + time + toggle */}
        <div className="flex flex-wrap items-center gap-2">
          {renderUsername(post.user, post.isAnonymous, revealed)}
          <span>{post.timestamp}</span>

          {post.slidePageIndex != null && post.slideSetId && (
            <button
              type="button"
              onClick={() =>
                navigateToQuestionSlide({
                  slidePageIndex: post.slidePageIndex!,
                  slideSetId: post.slideSetId!,
                })
              }
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 font-medium hover:bg-stone-200 hover:text-stone-800 dark:!bg-dark-accent dark:hover:!bg-dark-accent/80 transition-colors cursor-pointer"
              title="Go to this slide"
            >
              <Presentation className="h-3 w-3" />
              Slide {post.slidePageIndex + 1}
            </button>
          )}

          {hasAnyReplies && (
            <ThreadToggle
              expanded={isExpanded}
              label={
                isExpanded
                  ? "Hide replies"
                  : replyList.length > 0
                    ? `${replyList.length} Repl${replyList.length === 1 ? "y" : "ies"}`
                    : "Replies"
              }
              onClick={handleToggle}
            />
          )}
        </div>

        {/* Right: upvote + reply + resolve  —or—  inline delete confirmation */}
        <div className="flex flex-wrap items-center gap-1">
          {confirmingDelete ? (
            <>
              <span className="text-xs text-stone-500 mr-1">Delete question and all replies?</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs bg-red-100 hover:bg-red-200 text-red-700 hover:text-red-700"
                onClick={() => {
                  onDelete!();
                  setConfirmingDelete(false);
                }}
              >
                Delete
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-stone-600 hover:bg-stone-200"
                onClick={() => setConfirmingDelete(false)}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <UpvoteButton
                initialVotes={post.upvotes}
                controlledVotes={post.upvotes}
                initialUpvoted={post.hasUpvoted}
                onUpvote={onUpvote}
              />

              {canAnswer && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1 text-stone-400 hover:text-stone-900 hover:bg-stone-200/60"
                  onClick={() => {
                    setIsReplying((v) => !v);
                    if (threadState === "collapsed") setThreadState("expanded");
                  }}
                >
                  <MessageCircle className="h-4 w-4" />
                  Reply
                </Button>
              )}

              {onResolve && !resolved && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1 text-stone-400 hover:text-green-600 hover:bg-green-50"
                  onClick={handleResolve}
                  title="Mark as resolved"
                >
                  <CheckCircle2 className="h-4 w-4" />
                </Button>
              )}

              {onUnresolve && resolved && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="group/unresolve h-7 px-2 text-xs gap-1 text-green-600 hover:text-amber-600 hover:bg-amber-50"
                  onClick={() => onUnresolve()}
                  title="Unresolve"
                >
                  <CheckCircle2 className="h-4 w-4 group-hover/unresolve:hidden" />
                  <Undo2 className="h-4 w-4 hidden group-hover/unresolve:block" />
                </Button>
              )}

              {canRevealAuthor(post) && (
                <RevealAuthorButton revealed={revealed} onToggle={() => setRevealed((v) => !v)} />
              )}

              {onDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1 text-stone-400 hover:text-red-700 hover:bg-red-50"
                  onClick={() => setConfirmingDelete(true)}
                  title="Delete question"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Thread */}
      {showThread && (
        <div className="mt-1 pl-2 sm:pl-4 border-l border-stone-200/60 space-y-1">
          {isReplying && (
            <ReplySection
              canAnswer={canAnswer}
              onSubmit={(content) => onSubmitAnswer?.(content)}
              onCancel={() => setIsReplying(false)}
            />
          )}

          {replies && renderReply
            ? visibleReplies.map((reply) => <div key={reply.id}>{renderReply(reply)}</div>)
            : children}
        </div>
      )}
    </div>
  );
}
