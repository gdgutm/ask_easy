"use client";

import { Input } from "@/components/ui/input";
import { useContext, useState } from "react";
import {
  PanelRightClose,
  Users,
  GraduationCap,
  Search,
  X,
  UserPlus,
  Undo2,
  VolumeOff,
  Volume2,
  BellRing,
} from "lucide-react";
import ManageTAsModal from "./ManageTAsModal";
import { useMediaQuery } from "@/hooks/use-media-query";
import { SlideUpdateContext } from "../SlideUpdateContext";
import { useRoom } from "../RoomContext";
import type { Role } from "@/utils/types";

/** Course names are cut to this many characters so the header controls keep their room. */
const TITLE_MAX_CHARS = 6;

interface ChatHeaderProps {
  role: Role;
  answerMode: "all" | "instructors_only";
  notificationMode: "off" | "sound" | "browser";
  onToggleNotificationMode: () => void;
  onToggleAnswerMode: () => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
}

function SlideToggle() {
  const { isSlidesVisible, rerender } = useContext(SlideUpdateContext);
  const isMDsize = useMediaQuery("(min-width: 1024px)");

  if (!isMDsize) {
    return (
      <button
        className="w-9 h-9 flex items-center justify-center text-stone-400 hover:text-stone-900 hover:bg-stone-200/60 rounded-md transition-colors"
        onClick={() => rerender()}
      >
        {isSlidesVisible ? (
          <PanelRightClose className="w-5 h-5 rotate-270" />
        ) : (
          <PanelRightClose className="w-5 h-5 rotate-90" />
        )}
      </button>
    );
  }
  return (
    <button
      className="w-9 h-9 flex items-center justify-center text-stone-400 hover:text-stone-900 hover:bg-stone-200/60 rounded-md transition-colors"
      onClick={() => rerender()}
    >
      {isSlidesVisible ? (
        <PanelRightClose className="w-5 h-5 rotate-180" />
      ) : (
        <PanelRightClose className="w-5 h-5" />
      )}
    </button>
  );
}

export default function ChatHeader({
  role,
  answerMode,
  notificationMode,
  onToggleNotificationMode,
  onToggleAnswerMode,
  searchQuery,
  onSearchChange,
}: ChatHeaderProps) {
  const { sessionTitle, slideReturnTarget, goBackToPreviousSlide } = useRoom();
  const { isSlidesVisible } = useContext(SlideUpdateContext);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [showTAModal, setShowTAModal] = useState(false);
  const notificationButton =
    notificationMode === "off"
      ? {
          Icon: VolumeOff,
          title: "Notifications off",
          className: "bg-red-100 text-red-700 hover:bg-red-200",
        }
      : notificationMode === "sound"
        ? {
            Icon: Volume2,
            title: "Beep notifications on",
            className: "bg-stone-200 text-stone-600 hover:bg-stone-300",
          }
        : {
            Icon: BellRing,
            title: "Browser and beep notifications on",
            className: "bg-amber-100 text-amber-700 hover:bg-amber-200",
          };

  return (
    <>
      <div className="flex flex-col border-b bg-stone-50 sticky top-0 z-10">
        <header className="pl-2 pr-4 py-2 flex items-center justify-between gap-2 min-h-[56px]">
          {isSearchExpanded ? (
            <div className="flex-1 flex items-center gap-2 w-full animate-in fade-in zoom-in-95 duration-200">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400 pointer-events-none" />
                <Input
                  autoFocus
                  className="h-9 pl-8 pr-7 bg-stone-200 focus-visible:ring-0 focus-visible:border-stone-400 text-sm text-stone-500 placeholder:text-stone-500 w-full"
                  placeholder="Search questions & answers…"
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  onBlur={() => {
                    if (!searchQuery) setIsSearchExpanded(false);
                  }}
                />
                {searchQuery && (
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onSearchChange("");
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 transition-colors"
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <button
                onClick={() => {
                  onSearchChange("");
                  setIsSearchExpanded(false);
                }}
                className="text-sm font-medium text-stone-500 hover:text-stone-900 px-2 shrink-0 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 shrink-0 animate-in fade-in duration-200">
                <SlideToggle />
                {slideReturnTarget?.slidePageIndex != null && !isSlidesVisible && (
                  <button
                    onClick={goBackToPreviousSlide}
                    className="flex items-center gap-1.5 h-9 px-3 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-md text-sm font-medium transition-colors shrink-0"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    Back to slide {slideReturnTarget.slidePageIndex + 1}
                  </button>
                )}
                {sessionTitle && (
                  <h1 className="text-xl font-bold shrink-0" title={sessionTitle}>
                    {sessionTitle.slice(0, TITLE_MAX_CHARS)}
                  </h1>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0 animate-in fade-in duration-200">
                <button
                  onClick={onToggleNotificationMode}
                  title={`${notificationButton.title} - click to cycle`}
                  className={`w-9 h-9 flex items-center justify-center rounded-md transition-colors ${notificationButton.className}`}
                  aria-label={notificationButton.title}
                >
                  <notificationButton.Icon className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setIsSearchExpanded(true)}
                  title="Search questions and answers"
                  className={`w-9 h-9 flex items-center justify-center rounded-md transition-colors ${
                    searchQuery
                      ? "bg-stone-800 text-stone-50 hover:bg-stone-700"
                      : "bg-stone-200 text-stone-600 hover:bg-stone-300"
                  }`}
                  aria-label="Search"
                >
                  <Search className="w-4 h-4" />
                  {searchQuery && (
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-green-500" />
                  )}
                </button>

                {/* Answer mode toggle — professors only */}
                {role === "PROFESSOR" && (
                  <button
                    onClick={onToggleAnswerMode}
                    title={
                      answerMode === "all"
                        ? "Anyone can answer - click to restrict to TAs/Professors"
                        : "TAs/Professors only - click to allow everyone"
                    }
                    className={`flex items-center gap-1.5 h-9 px-3 rounded-md text-sm font-medium transition-colors shrink-0 cursor-pointer ${
                      answerMode === "all"
                        ? "bg-green-100 text-green-700 hover:bg-green-200"
                        : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                    }`}
                  >
                    {answerMode === "all" ? (
                      <>
                        <Users className="w-3.5 h-3.5" />
                        Anyone
                      </>
                    ) : (
                      <>
                        <GraduationCap className="w-3.5 h-3.5" />
                        TAs only
                      </>
                    )}
                  </button>
                )}
                {role === "PROFESSOR" && (
                  <button
                    onClick={() => setShowTAModal(true)}
                    title="Manage TAs"
                    className="w-9 h-9 flex items-center justify-center rounded-md text-stone-600 bg-stone-200 hover:bg-stone-300 transition-colors shrink-0"
                    aria-label="Manage TAs"
                  >
                    <UserPlus className="w-4 h-4" />
                  </button>
                )}
              </div>
            </>
          )}
        </header>
      </div>

      {showTAModal && <ManageTAsModal onClose={() => setShowTAModal(false)} />}
    </>
  );
}
