"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Ghost, User, Send } from "lucide-react";

const MIN_LENGTH = 5;

interface ChatInputProps {
  onSubmit: (content: string, isAnonymous: boolean) => void;
  disabled?: boolean;
  serverError?: string | null;
  onClearError?: () => void;
  isAnonymous: boolean;
  onAnonymousChange: (val: boolean) => void;
}

export default function ChatInput({
  onSubmit,
  disabled = false,
  serverError,
  onClearError,
  isAnonymous,
  onAnonymousChange,
}: ChatInputProps) {
  const [content, setContent] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const error = serverError ?? localError;

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    if (localError) setLocalError(null);
    if (serverError) onClearError?.();
  };

  const handleSubmit = () => {
    const trimmed = content.trim();
    if (disabled) return;
    if (!trimmed) return;
    if (trimmed.length < MIN_LENGTH) {
      setLocalError(`Question must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    setLocalError(null);
    onSubmit(trimmed, isAnonymous);
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
                error ? "border-red-400 bg-red-50" : ""
              }`}
            />
            <div className="flex items-center justify-between">
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
                {error && <p className="text-xs text-red-500">{error}</p>}
              </div>
              <button
                onClick={handleSubmit}
                disabled={disabled || !content.trim()}
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
