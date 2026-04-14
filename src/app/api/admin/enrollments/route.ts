import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAdmin, adminGuardResponse } from "@/lib/adminAuth";
import type { Prisma } from "@/generated/prisma";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAdmin();
    const guard = adminGuardResponse(user);
    if (guard) return guard;

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") ?? "";
    const role = searchParams.get("role") ?? "";
    const courseId = searchParams.get("courseId") ?? "";
    const cursorParam = searchParams.get("cursor") ?? "";
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 1), 100);

    const where: Prisma.CourseEnrollmentWhereInput = {};

    if (search) {
      where.OR = [
        { user: { name: { contains: search, mode: "insensitive" } } },
        { user: { utorid: { contains: search, mode: "insensitive" } } },
        { course: { code: { contains: search, mode: "insensitive" } } },
      ];
    }
    if (role && ["STUDENT", "TA", "PROFESSOR"].includes(role)) {
      where.role = role as "STUDENT" | "TA" | "PROFESSOR";
    }
    if (courseId) {
      where.courseId = courseId;
    }

    const enrollments = await prisma.courseEnrollment.findMany({
      where,
      include: {
        user: { select: { name: true, utorid: true } },
        course: { select: { code: true, name: true } },
      },
      orderBy: { id: "asc" },
      take: limit + 1,
      ...(cursorParam ? { cursor: { id: cursorParam }, skip: 1 } : {}),
    });

    const hasMore = enrollments.length > limit;
    if (hasMore) enrollments.pop();

    const nextCursor = hasMore ? enrollments[enrollments.length - 1]?.id : null;

    return NextResponse.json({ enrollments, nextCursor });
  } catch (error) {
    console.error("[Admin Enrollments] Failed to fetch enrollments:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
