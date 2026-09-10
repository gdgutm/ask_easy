"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle,
  Clock,
  GraduationCap,
  Monitor,
  Play,
  Radio,
  Square,
} from "lucide-react";

import { roomTitle, type ClasslistSummary, type RoomSummary } from "./classTypes";

interface RoomGridProps {
  classlist: ClasslistSummary;
  onBack: () => void;
  /** Re-fetches the classlists so a started or ended session shows up. */
  onRefresh: () => void;
}

export default function RoomGrid({ classlist, onBack, onRefresh }: RoomGridProps) {
  const router = useRouter();
  const [busyRoomId, setBusyRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function enterRoom(room: RoomSummary) {
    if (!room.activeSession) return;
    const title = encodeURIComponent(roomTitle(classlist.code, room.label));
    router.push(`/room?sessionId=${room.activeSession.id}&title=${title}`);
  }

  async function startSession(room: RoomSummary) {
    setBusyRoomId(room.id);
    setError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: room.id,
          title: roomTitle(classlist.code, room.label),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to start the session.");
        return;
      }
      const title = encodeURIComponent(roomTitle(classlist.code, room.label));
      router.push(`/room?sessionId=${data.session.id}&title=${title}`);
    } catch {
      setError("Failed to start the session. Please try again.");
    } finally {
      setBusyRoomId(null);
    }
  }

  async function endSession(room: RoomSummary) {
    if (!room.activeSession) return;
    setBusyRoomId(room.id);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${room.activeSession.id}`, { method: "PATCH" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to end the session.");
        return;
      }
      onRefresh();
    } catch {
      setError("Failed to end the session. Please try again.");
    } finally {
      setBusyRoomId(null);
    }
  }

  return (
    <div className="flex-1 w-full text-left">
      <div className="max-w-6xl mx-auto w-full mb-8">
        <button
          onClick={onBack}
          className="flex items-center gap-2 py-2 px-3 -ml-3 text-stone-500 hover:text-stone-900 hover:bg-stone-200/60 rounded-md transition-colors font-medium text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          All classes
        </button>

        <div className="mt-4 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-4xl font-bold text-stone-900 tracking-tight mb-2">
              {classlist.code}
            </h2>
            <p className="text-lg text-stone-500">
              {classlist.rooms.length === 1
                ? "One room on this class."
                : `${classlist.rooms.length} rooms on this class, one per professor.`}
            </p>
          </div>
          <span className="text-sm font-medium text-stone-400">{classlist.semester}</span>
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
        {error && (
          <div className="col-span-full mb-2 bg-red-50 text-red-600 p-4 rounded-md border border-red-100 flex items-center gap-3 font-medium">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        {classlist.rooms.map((room) => {
          const isLive = !!room.activeSession;
          const isBusy = busyRoomId === room.id;
          const canEnter = isLive && !isBusy;

          return (
            <div
              key={room.id}
              onClick={() => canEnter && enterRoom(room)}
              className={`
                group relative overflow-hidden flex flex-col
                p-6 sm:p-8 rounded-md transition-all duration-300
                bg-white border-2 shadow-sm min-h-[16rem]
                ${
                  isLive
                    ? "border-green-400 hover:shadow-xl cursor-pointer"
                    : "border-stone-100 hover:border-stone-200 cursor-default"
                }
                ${isBusy ? "opacity-60 pointer-events-none" : ""}
              `}
            >
              <div className="flex items-start justify-between w-full mb-6 relative z-10">
                <div
                  className={`w-12 h-12 rounded-md flex items-center justify-center transition-all shrink-0 ${
                    isLive
                      ? "bg-green-50 text-green-500 group-hover:scale-110"
                      : "bg-stone-50 text-stone-600"
                  }`}
                >
                  {isLive ? <Monitor className="w-6 h-6" /> : <BookOpen className="w-6 h-6" />}
                </div>

                {isLive && (
                  <span className="flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 text-xs font-bold rounded-md border border-green-200 shadow-sm animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    LIVE
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1 mt-auto relative z-10">
                <h3
                  className={`font-bold text-3xl tracking-tight line-clamp-2 transition-colors ${
                    isLive ? "text-stone-900 group-hover:text-green-600" : "text-stone-900"
                  }`}
                >
                  {room.label}
                </h3>
                {room.professor && !room.professor.hasLoggedIn && (
                  <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                    <Clock className="w-3 h-3" />
                    Temporary name — {room.professor.utorid} hasn&rsquo;t signed in yet
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 mt-4 pt-4 border-t border-stone-100 w-full text-sm font-medium text-stone-400 relative z-10">
                <GraduationCap className="w-4 h-4" />
                {room.isMine
                  ? "Your room"
                  : room.role === "TA"
                    ? "You're a TA here"
                    : (room.professor?.name ?? "Professor")}
              </div>

              <div className="flex flex-col gap-2 relative z-10 w-full mt-4">
                {room.role === "PROFESSOR" ? (
                  isLive ? (
                    <div className="flex gap-2 w-full">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          enterRoom(room);
                        }}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-green-500 text-white rounded-md hover:bg-green-600 font-semibold shadow-sm transition-colors text-sm"
                      >
                        <Play className="w-4 h-4" />
                        Rejoin
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void endSession(room);
                        }}
                        disabled={isBusy}
                        className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-red-100 text-red-600 rounded-md hover:bg-red-200 font-semibold shadow-sm transition-colors disabled:opacity-60 text-sm"
                      >
                        <Square className="w-4 h-4" />
                        {isBusy ? "Ending…" : "End"}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void startSession(room);
                      }}
                      disabled={isBusy}
                      className="w-full flex items-center justify-center gap-2 py-2.5 bg-stone-900 text-white rounded-md font-semibold shadow-sm transition-colors disabled:opacity-60 text-sm hover:!bg-green-600"
                    >
                      <Radio className={`w-4 h-4 ${isBusy ? "animate-pulse" : ""}`} />
                      {isBusy ? "Starting…" : "Start Live Session"}
                    </button>
                  )
                ) : isLive ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      enterRoom(room);
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-green-500 text-white rounded-md hover:bg-green-600 font-semibold shadow-sm transition-colors text-sm"
                  >
                    Join
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </button>
                ) : (
                  <div className="w-full flex items-center justify-center gap-2 py-2.5 bg-stone-50 text-stone-400 rounded-md font-medium text-sm">
                    <CheckCircle className="w-4 h-4" />
                    Not live right now
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
