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
import { CircleHelp, LayoutDashboard } from "lucide-react";
import Link from "next/link";

export default function LandingPage() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

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
  }, []);

  const handleOnboardingComplete = () => {
    if (user) {
      localStorage.setItem(`hasSeenOnboarding_${user.role}`, "true");
    }
    setShowOnboarding(false);
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-stone-400 text-sm">Loading…</span>
      </div>
    );
  }

  const getStepsForRole = () => {
    switch (user.role) {
      case "PROFESSOR":
        return PROF_ONBOARDING_STEPS;
      case "STUDENT":
      default:
        return STUDENT_ONBOARDING_STEPS;
    }
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
            {user.role === "PROFESSOR" ? <ProfCourseViewer /> : <CourseViewer />}
          </div>
        </div>
        {footer()}
      </div>

      {showOnboarding && (
        <OnboardingCarousel
          steps={getStepsForRole()}
          onComplete={handleOnboardingComplete}
          requireAgreement={user.role !== "PROFESSOR"}
        />
      )}
    </div>
  );
}
