"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { CircleHelp, LayoutDashboard } from "lucide-react";

import { User, getInitials, isLikelyAvatarImageUrl } from "@/utils/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { STUDENT_ONBOARDING_STEPS, PROF_ONBOARDING_STEPS } from "@/constants/onboarding";
import ClassBrowser from "./components/ClassBrowser";
import OnboardingCarousel from "./components/OnboardingCarousel";
import footer from "./components/footer";

export default function LandingPage() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isInstructor, setIsInstructor] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Identity and enrollments are resolved together: which walkthrough to show
    // depends on whether this person teaches anything, and that lives on their
    // enrollments — the global role is always STUDENT now. Deciding before the
    // enrollments land would show a professor the student walkthrough.
    async function load() {
      const [me, courses] = await Promise.all([
        fetch("/api/auth/me")
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null),
        fetch("/api/courses")
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null),
      ]);

      if (me?.userId) {
        setUser({
          id: me.userId,
          username: me.name ?? me.utorid,
          pfp: me.name?.[0]?.toUpperCase() ?? me.utorid?.[0]?.toUpperCase() ?? "?",
          role: me.role as User["role"],
        });
        setIsAdmin(!!me.isAdmin);
      }

      const enrolled = (courses?.courses ?? []) as { role: string }[];
      const instructor = !!me?.isAdmin || enrolled.some((c) => c.role === "PROFESSOR");
      setIsInstructor(instructor);

      try {
        const seenToken = `hasSeenOnboarding_${instructor ? "INSTRUCTOR" : "STUDENT"}`;
        if (me?.userId && !localStorage.getItem(seenToken)) setShowOnboarding(true);
      } catch {
        /* storage blocked — just skip the walkthrough */
      }

      setReady(true);
    }

    void load();
  }, []);

  const handleOnboardingComplete = () => {
    try {
      localStorage.setItem(`hasSeenOnboarding_${isInstructor ? "INSTRUCTOR" : "STUDENT"}`, "true");
    } catch {
      /* storage blocked — the walkthrough reappears next visit */
    }
    setShowOnboarding(false);
  };

  if (!ready || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-stone-400 text-sm">Loading…</span>
      </div>
    );
  }

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
            <ClassBrowser isAdmin={isAdmin} />
          </div>
        </div>
        {footer()}
      </div>

      {showOnboarding && (
        <OnboardingCarousel
          steps={isInstructor ? PROF_ONBOARDING_STEPS : STUDENT_ONBOARDING_STEPS}
          onComplete={handleOnboardingComplete}
          requireAgreement={!isInstructor}
        />
      )}
    </div>
  );
}
