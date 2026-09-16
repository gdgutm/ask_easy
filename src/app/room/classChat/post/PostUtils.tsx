"use client";

import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ArrowBigUp, Eye, EyeOff, Ghost, GraduationCap } from "lucide-react";
import { Post, User, getInitials, isLikelyAvatarImageUrl } from "@/utils/types";

export function renderAvatar(post: Post, revealed?: boolean) {
  if (post?.user && !(post.isAnonymous && !revealed)) {
    return (
      <Avatar className="h-10 w-10">
        {isLikelyAvatarImageUrl(post.user.pfp) && (
          <AvatarImage src={post.user.pfp} alt={post.user.username} />
        )}
        <AvatarFallback className="text-sm font-medium tracking-tighter text-stone-600">
          {getInitials(post.user.username)}
        </AvatarFallback>
      </Avatar>
    );
  }
  return (
    <Avatar className="h-10 w-10">
      <AvatarFallback className="text-stone-400 bg-stone-100">
        <Ghost className="h-4 w-4" />
      </AvatarFallback>
    </Avatar>
  );
}

interface UpvoteButtonProps {
  initialVotes: number;
  /** When provided, clicking emits an upvote and displays the server-controlled count. */
  controlledVotes?: number;
  /** Whether the viewer had already upvoted when the post was loaded. */
  initialUpvoted?: boolean;
  onUpvote?: () => void;
}

export function UpvoteButton({
  initialVotes,
  controlledVotes,
  initialUpvoted = false,
  onUpvote,
}: UpvoteButtonProps) {
  const [localVotes, setLocalVotes] = useState(initialVotes);
  const [isUpvoted, setIsUpvoted] = useState(initialUpvoted);

  const displayedVotes = controlledVotes !== undefined ? controlledVotes : localVotes;

  const handleUpvote = () => {
    if (onUpvote) {
      onUpvote();
      setIsUpvoted((prev) => !prev);
    } else {
      if (isUpvoted) {
        setLocalVotes((v) => v - 1);
      } else {
        setLocalVotes((v) => v + 1);
      }
      setIsUpvoted((prev) => !prev);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className={`h-7 px-2 text-xs gap-1 ${
        isUpvoted
          ? "text-green-500 hover:text-green-500 hover:bg-green-50"
          : "text-stone-400 hover:text-stone-900 hover:bg-stone-200/60"
      }`}
      onClick={handleUpvote}
    >
      <ArrowBigUp className={`h-4 w-4 ${isUpvoted ? "fill-current" : ""}`} />
      <span>{Math.max(0, displayedVotes)}</span>
    </Button>
  );
}

export function renderRoleIcon(user: User) {
  if (user.role === "PROFESSOR") {
    return <GraduationCap className="h-4 w-4 text-stone-900 fill-current" />;
  }
  if (user.role === "TA") {
    return <GraduationCap className="h-4 w-4 text-stone-900" />;
  }
  return null;
}

export function renderUsername(user: User | null, isAnonymous?: boolean, revealed?: boolean) {
  // Anonymous posts read as "Anonymous" for everyone. TAs and professors are
  // sent the author anyway, so revealing is a local toggle — see RevealAuthorButton.
  if (!user || (isAnonymous && !revealed)) {
    return <span className="font-semibold text-foreground italic text-stone-400">Anonymous</span>;
  }
  return (
    <span className="font-semibold flex flex-row items-center gap-1 text-foreground">
      {renderRoleIcon(user)}
      <span className="line-clamp-2">{user.username}</span>
      {isAnonymous && <span className="italic text-stone-400 font-normal">(anonymous)</span>}
    </span>
  );
}

/**
 * True when an anonymous post arrived with its author attached — which only
 * happens for TAs and professors, the roles allowed to unmask it.
 */
export function canRevealAuthor(post: Post): boolean {
  return !!post.isAnonymous && !!post.user;
}

interface RevealAuthorButtonProps {
  revealed: boolean;
  onToggle: () => void;
}

export function RevealAuthorButton({ revealed, onToggle }: RevealAuthorButtonProps) {
  const Icon = revealed ? EyeOff : Eye;

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs gap-1 text-stone-400 hover:text-stone-900 hover:bg-stone-200/60 transition-colors"
      onClick={onToggle}
      title={revealed ? "Hide author" : "Reveal author"}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}

export const bestToTop = (replies: Post[] | undefined) => {
  return replies ?? [];
};
