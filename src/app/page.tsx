"use client";

import React, { useEffect, useState } from "react";
import { User } from "@/utils/types";
import CourseViewer from "./components/CourseViewer";
import footer from "./components/footer";
import ProfCourseViewer from "./classes/ProfCourseViewer";
import OnboardingCarousel from "./components/OnboardingCarousel";
import { STUDENT_ONBOARDING_STEPS, PROF_ONBOARDING_STEPS } from "@/constants/onboarding";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getInitials, isLikelyAvatarImageUrl } from "@/utils/types";
import { CircleHelp, LayoutDashboard, PlusCircle } from "lucide-react";
import Link from "next/link";

export default function LandingPage() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [hasProfessorCourses, setHasProfessorCourses] = useState(false);
  const [hasStudentCourses, setHasStudentCourses] = useState(false);
  const [coursesReady, setCoursesReady] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.userId) {
          const role = data.role as User["role"];
          setUser({
            id: data.userId,
            username: data.name ?? data.utorid,
            pfp: data.name?.[0]?.toUpperCase() ?? data.utorid?.[0]?.toUpperCase() ?? "?",
            role,
          });
          setIsAdmin(!!data.isAdmin);

          // Check for onboarding
          const seenToken = `hasSeenOnboarding_${role}`;
          if (!localStorage.getItem(seenToken)) {
            setShowOnboarding(true);
          }
        }
      })
      .catch(() => null);

    // Home UI is driven by CourseEnrollment, not only global User.role — co-professors
    // are usually global STUDENTs who still need the professor lecture panel.
    fetch("/api/courses")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const courses = (data?.courses ?? []) as { role: string }[];
        setHasProfessorCourses(courses.some((c) => c.role === "PROFESSOR"));
        setHasStudentCourses(courses.some((c) => c.role === "STUDENT" || c.role === "TA"));
      })
      .catch(() => null)
      .finally(() => setCoursesReady(true));
  }, []);

  const handleOnboardingComplete = () => {
    if (user) {
      localStorage.setItem(`hasSeenOnboarding_${user.role}`, "true");
    }
    setShowOnboarding(false);
  };

  if (!user || !coursesReady) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-stone-400 text-sm">Loading…</span>
      </div>
    );
  }

  // Only admins create classes. Professors are assigned to one, so their panel
  // is driven by CourseEnrollment rather than any global role.
  const showProfViewer = isAdmin || hasProfessorCourses;
  // Don't mount the student viewer empty-state under a professor who only has
  // professor courses.
  const showStudentViewer = hasStudentCourses || !showProfViewer;
  // An admin with nothing yet still needs the header — that is where the
  // Create button lives.
  const showLecturesHeader = isAdmin || hasProfessorCourses || hasStudentCourses;

  const lecturesSubtitle = showProfViewer
    ? showStudentViewer
      ? "Manage your lectures, start live sessions, or join when a class goes live."
      : "Manage your lectures and start live sessions."
    : "Select a live lecture to join its session. If the lecture is not live, just wait!";

  const getStepsForRole = () => {
    if (showProfViewer) return PROF_ONBOARDING_STEPS;
    return STUDENT_ONBOARDING_STEPS;
  };

  return (
    <div className="min-h-screen flex flex-col dot-grid relative">
      <div className="absolute top-6 right-7 z-10 flex items-center gap-3">
        {isAdmin && (
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 px-3 h-10 text-sm font-medium text-stone-600 hover:text-stone-900 hover:bg-stone-200/60 rounded-md transition-colors"
          >
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </Link>
        )}
        <button
          className="w-10 h-10 flex items-center justify-center text-stone-400 hover:text-stone-900 hover:bg-stone-200/60 rounded-md transition-colors"
          onClick={() => setShowOnboarding(true)}
        >
          <CircleHelp className="w-5 h-5" />
        </button>
        <Avatar className="h-10 w-10 shadow-sm border-2 border-stone-100">
          {isLikelyAvatarImageUrl(user.pfp) && <AvatarImage src={user.pfp} alt={user.username} />}
          <AvatarFallback className="bg-white font-medium text-lg text-stone-900 tracking-tighter">
            {getInitials(user.username)}
          </AvatarFallback>
        </Avatar>
      </div>

      <div className="overflow-y-auto flex-1 flex flex-col">
        <div className="flex-1 p-5 pt-16 pb-10 flex flex-col items-center">
          <div className="w-full max-w-7xl mx-auto flex-1 flex flex-col">
            {showLecturesHeader && (
              <div className="max-w-6xl mx-auto w-full mb-10 flex items-center justify-between">
                <div>
                  <h2 className="text-4xl font-bold text-stone-900 tracking-tight mb-2">
                    My Lectures
                  </h2>
                  <p className="text-lg text-stone-500">{lecturesSubtitle}</p>
                </div>
                {isAdmin && (
                  <Link
                    href="/create-class"
                    className="hidden sm:flex items-center gap-2 px-6 py-3 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-md transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5"
                  >
                    <PlusCircle className="w-5 h-5" />
                    Create Lecture
                  </Link>
                )}
              </div>
            )}

            <div className="flex flex-col gap-10">
              {showProfViewer && <ProfCourseViewer canCreateClass={isAdmin} />}
              {showStudentViewer && <CourseViewer />}
            </div>

            {isAdmin && showLecturesHeader && (
              <div className="max-w-6xl mx-auto w-full mt-8 sm:hidden">
                <Link
                  href="/create-class"
                  className="flex items-center justify-center gap-2 w-full py-4 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-md transition-all shadow-sm"
                >
                  <PlusCircle className="w-5 h-5" />
                  Create New Lecture
                </Link>
              </div>
            )}
          </div>
        </div>
        {footer()}
      </div>

      {showOnboarding && (
        <OnboardingCarousel
          steps={getStepsForRole()}
          onComplete={handleOnboardingComplete}
          requireAgreement={!showProfViewer}
        />
      )}
    </div>
  );
}
