"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { Ghost, User, Send, Presentation } from "lucide-react";
import { useSlideContext } from "../RoomContext";
import { QUESTION_MAX_LENGTH, QUESTION_MIN_LENGTH } from "@/utils/contentLimits";

interface ChatInputProps {
  onSubmit: (content: string, isAnonymous: boolean, includeSlideContext: boolean) => void;
  disabled?: boolean;
  serverError?: string | null;
  onClearError?: () => void;
  isAnonymous: boolean;
  onAnonymousChange: (val: boolean) => void;
  includeSlideContext: boolean;
  onIncludeSlideContextChange: (val: boolean) => void;
}

export default function ChatInput({
  onSubmit,
  disabled = false,
  serverError,
  onClearError,
  isAnonymous,
  onAnonymousChange,
  includeSlideContext,
  onIncludeSlideContextChange,
}: ChatInputProps) {
  const slideContext = useSlideContext();
  const [content, setContent] = useState("");

  const slideContextAvailable =
    slideContext.slidePageIndex !== null && slideContext.slideSetId !== null;

  const trimmed = content.trim();
  const canClick = !disabled && trimmed.length > 0;

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    if (serverError) onClearError?.();
  };

  const handleSubmit = () => {
    if (!canClick) return;
    if (trimmed.length < QUESTION_MIN_LENGTH) {
      toast.error(`Question must be at least ${QUESTION_MIN_LENGTH} characters.`);
      return;
    }
    if (trimmed.length > QUESTION_MAX_LENGTH) {
      toast.error(`Question must be at most ${QUESTION_MAX_LENGTH} characters.`);
      return;
    }
    onSubmit(trimmed, isAnonymous, includeSlideContext && slideContextAvailable);
    setContent("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 z-5 pointer-events-none">
      <div className="absolute inset-0 bg-background backdrop-blur-xl [mask-image:linear-gradient(to_top,black,transparent)]" />
      <div className="max-w-4xl mx-auto px-4 pt-20 pb-4 relative">
        <div className="flex flex-col gap-2 pointer-events-auto w-full">
          <>
            <Textarea
              placeholder={`Ask a question!\n(Shift+Enter for new line)`}
              value={content}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              disabled={disabled}
              rows={3}
              className={`resize-none min-h-[70px] focus-visible:ring-0 focus-visible:border-stone-400 ${
                serverError ? "border-red-400 bg-red-50" : ""
              }`}
            />
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onAnonymousChange(!isAnonymous)}
                  className={`flex items-center gap-1.5 h-9 px-3 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                    isAnonymous
                      ? "bg-stone-800 hover:bg-stone-700 text-stone-50"
                      : "bg-stone-200 hover:bg-stone-300 text-stone-700"
                  }`}
                >
                  {isAnonymous ? (
                    <>
                      <Ghost className="w-4 h-4" />
                      Anonymous
                    </>
                  ) : (
                    <>
                      <User className="w-4 h-4" />
                      Public
                    </>
                  )}
                </button>
                {slideContextAvailable && (
                  <button
                    type="button"
                    onClick={() => onIncludeSlideContextChange(!includeSlideContext)}
                    className={`flex shrink-0 items-center gap-1.5 h-9 px-3 rounded-md text-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
                      includeSlideContext
                        ? "bg-stone-800 hover:bg-stone-700 text-stone-50"
                        : "bg-stone-200 hover:bg-stone-300 text-stone-700"
                    }`}
                    title={
                      includeSlideContext
                        ? "Include current slide with question"
                        : "Don't include slide context"
                    }
                  >
                    <Presentation className="w-4 h-4" />
                    {includeSlideContext ? `Slide ${slideContext.slidePageIndex! + 1}` : "No slide"}
                  </button>
                )}
                {serverError && <p className="text-xs text-red-500">{serverError}</p>}
              </div>
              <button
                onClick={handleSubmit}
                disabled={!canClick}
                className="flex items-center justify-center gap-1.5 h-9 px-4 bg-stone-900 hover:bg-stone-800 text-stone-50 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Post
                <Send className="w-4 h-4" />
              </button>
            </div>
          </>
        </div>
      </div>
    </div>
  );
}
