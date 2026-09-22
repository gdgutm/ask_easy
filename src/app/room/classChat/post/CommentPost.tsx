"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Comment } from "@/utils/types";
import {
  canRevealAuthor,
  renderAvatar,
  renderUsername,
  RevealAuthorButton,
  UpvoteButton,
} from "./PostUtils";

interface CommentPostProps {
  post: Comment;
  onUpvote?: () => void;
  onDelete?: () => void;
}

export default function CommentPost({ post, onUpvote, onDelete }: CommentPostProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [revealed, setRevealed] = useState(false);

  // While an anonymous author stays hidden the answer looks exactly as it does
  // for students — placeholder avatar, no name, and no instructor tint.
  const showAuthor = !post.isAnonymous || revealed;
  const isInstructor = showAuthor && (post.user?.role === "TA" || post.user?.role === "PROFESSOR");

  return (
    <div className="flex gap-2 sm:gap-3 mt-4">
      <div className="flex flex-col items-center gap-1">
        {renderAvatar(post, revealed)}
        <div className="h-full w-px bg-stone-200/60 my-2" />
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-900/50">
          {renderUsername(post.user, post.isAnonymous, revealed)}
          <span>{post.timestamp}</span>
        </div>

        <div
          className={`text-sm break-words whitespace-pre-wrap p-3 rounded-md ${
            isInstructor
              ? "bg-amber-50 border border-amber-200"
              : "bg-stone-50 border border-stone-200"
          }`}
        >
          {post.content}
        </div>

        <div className="flex items-center gap-4 text-muted-foreground">
          {!confirmingDelete && (
            <UpvoteButton
              initialVotes={post.upvotes}
              controlledVotes={post.upvotes}
              initialUpvoted={post.hasUpvoted}
              onUpvote={onUpvote}
            />
          )}

          {!confirmingDelete && canRevealAuthor(post) && (
            <RevealAuthorButton revealed={revealed} onToggle={() => setRevealed((v) => !v)} />
          )}

          {onDelete &&
            (confirmingDelete ? (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-xs text-stone-500">Delete this answer?</span>
                <button
                  onClick={() => {
                    onDelete();
                    setConfirmingDelete(false);
                  }}
                  className="px-2 py-0.5 text-xs bg-red-100 hover:bg-red-200 text-red-700 rounded-md font-medium transition-colors"
                >
                  Delete
                </button>
                <button
                  onClick={() => setConfirmingDelete(false)}
                  className="px-2 py-0.5 text-xs bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-md font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmingDelete(true)}
                title="Delete answer"
                className="h-7 px-2 gap-1 text-xs text-stone-400 hover:text-red-700 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ))}
        </div>
      </div>
    </div>
  );
}
