import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAdmin, adminGuardResponse } from "@/lib/adminAuth";

export async function GET() {
  try {
    const user = await requireAdmin();
    const guard = adminGuardResponse(user);
    if (guard) return guard;

    const [users, courses, sessions, activeSessions, questions, answers, enrollments] =
      await Promise.all([
        prisma.user.count(),
        prisma.course.count(),
        prisma.session.count(),
        prisma.session.count({ where: { status: "ACTIVE" } }),
        prisma.question.count(),
        prisma.answer.count(),
        prisma.courseEnrollment.count(),
      ]);

    return NextResponse.json({
      users,
      courses,
      sessions,
      activeSessions,
      questions,
      answers,
      enrollments,
    });
  } catch (error) {
    console.error("[Admin Stats] Failed to fetch stats:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
