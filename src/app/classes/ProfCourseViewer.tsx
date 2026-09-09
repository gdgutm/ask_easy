"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Settings,
  BookOpen,
  Calendar,
  PlusCircle,
  Radio,
  Users,
  CheckCircle,
  Monitor,
  Play,
  Square,
  AlertCircle,
} from "lucide-react";

import ManageClassModal, { type CourseForModal } from "./ManageClassModal";

interface Course {
  id: string;
  code: string;
  name: string;
  semester: string;
  role: string;
}

interface ActiveSession {
  id: string;
  joinCode: string;
  courseId: string;
}

interface ProfCourseButtonsProps {
  /** Global professors may create courses; course-only co-professors may not. */
  canCreateClass?: boolean;
}

export default function ProfCourseButtons({ canCreateClass = true }: ProfCourseButtonsProps) {
  const router = useRouter();
  const [courses, setCourses] = useState<Course[]>([]);
  const [activeSessions, setActiveSessions] = useState<Map<string, ActiveSession>>(new Map());
  const [goingLive, setGoingLive] = useState<string | null>(null);
  const [liveInfo, setLiveInfo] = useState<{ sessionId: string; joinCode: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [endingSession, setEndingSession] = useState<string | null>(null);
  const [managingCourse, setManagingCourse] = useState<CourseForModal | null>(null);

  useEffect(() => {
    fetch("/api/courses")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.courses) {
          setCourses(data.courses.filter((c: Course) => c.role === "PROFESSOR"));
        }
      })
      .catch(() => null);

    fetch("/api/sessions")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.sessions) {
          const map = new Map<string, ActiveSession>();
          for (const s of data.sessions) {
            map.set(s.courseId, { id: s.id, joinCode: s.joinCode, courseId: s.courseId });
          }
          setActiveSessions(map);
        }
      })
      .catch(() => null);
  }, []);

  function handleCourseClick() {
    setError(null);
  }

  function handleRejoin(courseId: string, courseName: string) {
    const session = activeSessions.get(courseId);
    if (session) {
      router.push(`/room?sessionId=${session.id}&title=${encodeURIComponent(courseName)}`);
    }
  }

  async function handleGoLive(courseId: string, courseName: string) {
    setGoingLive(courseId);
    setError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, title: `${courseName} Live Session` }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to start session.");
        return;
      }
      const { session } = data;
      setLiveInfo({ sessionId: session.id, joinCode: session.joinCode });
      setTimeout(() => {
        router.push(`/room?sessionId=${session.id}&title=${encodeURIComponent(courseName)}`);
      }, 1500);
    } catch {
      setError("Failed to start session. Please try again.");
    } finally {
      setGoingLive(null);
    }
  }

  async function handleEndSession(courseId: string, sessionId: string) {
    setEndingSession(courseId);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to end session.");
        return;
      }
      setActiveSessions((prev) => {
        const newMap = new Map(prev);
        newMap.delete(courseId);
        return newMap;
      });
      setLiveInfo(null);
    } catch {
      setError("Failed to end session. Please try again.");
    } finally {
      setEndingSession(null);
    }
  }

  function handleOpenManage(e: React.MouseEvent, course: Course) {
    e.stopPropagation();
    setManagingCourse({
      id: course.id,
      code: course.code,
      name: course.name,
      semester: course.semester,
    });
  }

  function handleRenamed(courseId: string, code: string, semester: string) {
    setCourses((prev) =>
      prev.map((c) => (c.id === courseId ? { ...c, code, name: code, semester } : c))
    );
    setManagingCourse((prev) =>
      prev?.id === courseId ? { ...prev, code, name: code, semester } : prev
    );
  }

  function handleDeleted(courseId: string) {
    setCourses((prev) => prev.filter((c) => c.id !== courseId));
  }

  if (courses.length > 0) {
    return (
      <>
        <div className="flex-1 w-full text-left">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto relative">
            {error && (
              <div className="col-span-full md:col-span-2 lg:col-span-3 mb-2 bg-red-50 text-red-600 p-4 rounded-md border border-red-100 flex items-center gap-3 font-medium">
                <AlertCircle className="w-5 h-5" />
                {error}
              </div>
            )}
            {courses.map((course) => {
              const session = activeSessions.get(course.id);
              const isActive = !!session;
              const isStarting = goingLive === course.id;
              const isEnding = endingSession === course.id;

              return (
                <div
                  key={course.id}
                  onClick={() => {
                    handleCourseClick();
                    if (isActive && !isEnding) {
                      handleRejoin(course.id, course.name);
                    }
                  }}
                  className={`
                    group relative overflow-hidden flex flex-col
                    p-6 sm:p-8 rounded-md transition-all duration-300
                    bg-white border-2 shadow-sm min-h-[16rem]
                    ${
                      isActive
                        ? "border-green-400 hover:shadow-xl cursor-pointer"
                        : "border-stone-100 hover:border-stone-200 cursor-default"
                    }
                  `}
                >
                  <div className="flex items-start justify-between w-full mb-6 relative z-10">
                    <div
                      className={`w-12 h-12 rounded-md flex items-center justify-center transition-all shrink-0 ${isActive ? "bg-green-50 text-green-500 group-hover:scale-110" : "bg-stone-50 text-stone-600"}`}
                    >
                      {isActive ? (
                        <Monitor className="w-6 h-6" />
                      ) : (
                        <BookOpen className="w-6 h-6" />
                      )}
                    </div>

                    {isActive && (
                      <span className="flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 text-xs font-bold rounded-md border border-green-200 shadow-sm animate-pulse">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                        LIVE
                      </span>
                    )}
                  </div>

                  <div className="flex flex-col gap-1 mt-auto relative z-10">
                    <h3
                      className={`font-bold tracking-tight transition-colors line-clamp-2 ${isActive ? "text-3xl text-stone-900 group-hover:text-green-600" : "text-3xl text-stone-900"}`}
                    >
                      {course.name}
                    </h3>
                  </div>

                  <div className="flex items-center gap-2 mt-4 pt-4 border-t border-stone-100 w-full text-sm font-medium text-stone-400 relative z-10 mb-4">
                    <Calendar className="w-4 h-4" />
                    {course.semester}
                  </div>

                  <div className="flex flex-col gap-2 relative z-10 w-full mt-auto">
                    {liveInfo && liveInfo.sessionId === session?.id ? (
                      <div className="bg-green-50 rounded-md py-3 px-4 border border-green-100 flex items-center justify-center gap-2">
                        <CheckCircle className="w-5 h-5 text-green-500" />
                        <p className="text-sm font-bold text-green-800">Redirecting…</p>
                      </div>
                    ) : isActive ? (
                      <div className="flex gap-2 w-full mt-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRejoin(course.id, course.name);
                          }}
                          className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-green-500 text-white rounded-md hover:bg-green-600 font-semibold shadow-sm transition-colors text-sm"
                        >
                          <Play className="w-4 h-4" />
                          Rejoin
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEndSession(course.id, session!.id);
                          }}
                          disabled={isEnding}
                          className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-red-100 text-red-600 rounded-md hover:bg-red-200 font-semibold shadow-sm transition-colors disabled:opacity-60 text-sm"
                        >
                          <Square className="w-4 h-4" />
                          {isEnding ? "Ending..." : "End"}
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2 w-full mt-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleGoLive(course.id, course.name);
                          }}
                          disabled={isStarting}
                          className="w-full flex items-center justify-center gap-2 py-2.5 bg-stone-900 text-white rounded-md hover:bg-green-600 font-semibold shadow-sm transition-colors disabled:opacity-60 text-sm hover:!bg-green-600 hover:text-white"
                        >
                          <Radio className={`w-4 h-4 ${isStarting ? "animate-pulse" : ""}`} />
                          {isStarting ? "Starting..." : "Start Live Session"}
                        </button>

                        <button
                          onClick={(e) => handleOpenManage(e, course)}
                          className="w-full flex items-center justify-center gap-2 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-md transition-colors font-medium text-sm"
                        >
                          <Settings className="w-4 h-4" />
                          Manage Lecture
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {managingCourse && (
          <ManageClassModal
            course={managingCourse}
            onClose={() => setManagingCourse(null)}
            onRenamed={handleRenamed}
            onDeleted={handleDeleted}
          />
        )}
      </>
    );
  }

  return (
    <div className="w-full flex-1 flex flex-col items-center justify-center min-h-[60vh]">
      <div className="w-20 h-20 rounded-full bg-green-50 flex items-center justify-center text-green-500 mb-6">
        <Users className="w-10 h-10" />
      </div>
      <h1 className="font-bold text-3xl text-stone-900 tracking-tight mb-2">No Lectures Yet</h1>
      <p className="text-stone-500 text-lg max-w-md text-center mb-8">
        {canCreateClass
          ? "You haven't created any lectures. Create your first lecture to get started with AskEasy."
          : "You aren't assigned as a professor on any lectures yet."}
      </p>

      {canCreateClass && (
        <Link
          href="/create-class"
          className="flex items-center gap-2 px-8 py-4 bg-green-500 hover:bg-green-600 text-white font-bold rounded-md transition-all shadow-md hover:shadow-lg hover:-translate-y-1 text-lg"
        >
          <PlusCircle className="w-6 h-6" />
          Create a Lecture
        </Link>
      )}
    </div>
  );
}
