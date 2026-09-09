"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Calendar, ArrowRight, Monitor, LayoutGrid } from "lucide-react";

interface Course {
  id: string;
  code: string;
  name: string;
  semester: string;
  role: string;
}

interface ActiveSession {
  id: string;
  title: string;
  joinCode: string;
  status: string;
  course: { code: string; name: string };
}

export default function CourseViewer() {
  const router = useRouter();
  const [courses, setCourses] = useState<Course[]>([]);
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [joining, setJoining] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const fetchSessions = () => {
    fetch("/api/sessions")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.sessions) setActiveSessions(data.sessions);
      })
      .catch(() => null);
  };

  useEffect(() => {
    fetch("/api/courses")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.courses) {
          setCourses(data.courses.filter((c: Course) => c.role === "STUDENT" || c.role === "TA"));
        }
      })
      .catch(() => null);

    fetchSessions();

    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, []);

  async function handleJoin(session: ActiveSession) {
    setJoining(session.id);
    setJoinError(null);
    try {
      const res = await fetch(`/api/sessions/join/${session.joinCode}`, {
        method: "POST",
      });
      if (res.ok || res.status === 409) {
        router.push(
          `/room?sessionId=${session.id}&title=${encodeURIComponent(session.course.name)}`
        );
        return;
      }
      const data = await res.json();
      setJoinError(data.error ?? "Failed to join session.");
    } catch {
      setJoinError("Failed to join. Please try again.");
    } finally {
      setJoining(null);
    }
  }

  if (courses.length > 0) {
    return (
      <div className="flex-1 w-full text-left">
        {joinError && (
          <div className="max-w-6xl mx-auto mb-6 bg-red-50 text-red-600 p-4 rounded-md border border-red-100 flex items-center gap-3 font-medium">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            {joinError}
          </div>
        )}

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {courses.map((course) => {
            const activeSession = activeSessions.find((s) => s.course.name === course.name);
            const isActive = !!activeSession;
            const isJoining = joining === activeSession?.id;

            return (
              <div
                key={course.id}
                onClick={() => {
                  if (isActive && !isJoining && activeSession) {
                    handleJoin(activeSession);
                  }
                }}
                className={`
                  group relative overflow-hidden flex flex-col
                  p-6 sm:p-8 rounded-md transition-all duration-300
                  bg-white border-2 h-[16rem]
                  ${
                    isActive
                      ? "border-green-400 shadow-sm hover:shadow-xl cursor-pointer"
                      : "border-stone-100 cursor-default"
                  }
                  ${isJoining ? "opacity-60 pointer-events-none" : ""}
                `}
              >
                <div className="flex items-start justify-between w-full mb-6">
                  <div
                    className={`w-12 h-12 rounded-md flex items-center justify-center shrink-0 transition-all ${isActive ? "bg-green-50 text-green-500 group-hover:scale-110" : "bg-stone-50 text-stone-600"}`}
                  >
                    {isActive ? <Monitor className="w-6 h-6" /> : <BookOpen className="w-6 h-6" />}
                  </div>

                  {isActive && (
                    <span className="flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 text-xs font-bold rounded-md border border-green-200 shadow-sm animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      LIVE
                    </span>
                  )}
                </div>

                <div className="flex flex-col gap-1 mt-auto">
                  <h3
                    className={`font-bold text-3xl tracking-tight line-clamp-2 transition-colors ${isActive ? "text-stone-900 group-hover:text-green-600" : "text-stone-900"}`}
                  >
                    {course.name}
                  </h3>
                </div>

                <div className="flex items-center gap-2 mt-6 pt-6 border-t border-stone-100 w-full text-sm font-medium text-stone-400">
                  <Calendar className="w-4 h-4" />
                  {course.semester}

                  {isActive ? (
                    <div className="ml-auto flex items-center gap-1.5 text-sm font-medium text-green-500 group-hover:text-green-600 transition-colors">
                      {isJoining ? "Joining..." : "Join"}
                      <ArrowRight className="w-4 h-4 text-green-400 group-hover:text-green-500 group-hover:translate-x-1 transition-all" />
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full flex-1 flex flex-col items-center justify-center min-h-[60vh]">
      <div className="w-20 h-20 rounded-full bg-stone-100 flex items-center justify-center text-stone-400 mb-6">
        <LayoutGrid className="w-10 h-10" />
      </div>
      <h1 className="font-bold text-3xl text-stone-900 tracking-tight mb-2">No Lectures Found</h1>
      <p className="text-stone-500 text-lg max-w-md text-center">
        You are not enrolled in any lectures yet.
      </p>
    </div>
  );
}
