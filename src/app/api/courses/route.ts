import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

// ---------------------------------------------------------------------------
// GET /api/courses
// ---------------------------------------------------------------------------

/**
 * Returns every room the authenticated user is enrolled in, with their role in
 * it. Classes are created through POST /api/classlists, which makes the rooms.
 *
 * Response: { courses: [{ id, code, name, semester, role, createdById, classlistId }] }
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const enrollments = await prisma.courseEnrollment.findMany({
      where: { userId: user.userId },
      include: {
        course: {
          select: {
            id: true,
            code: true,
            name: true,
            semester: true,
            createdById: true,
            classlistId: true,
          },
        },
      },
    });

    const courses = enrollments.map((e) => ({
      ...e.course,
      role: e.role,
    }));

    return NextResponse.json({ courses });
  } catch (error) {
    console.error("[Courses API] Failed to fetch courses:", error);
    return NextResponse.json(
      { error: "An error occurred while fetching courses." },
      { status: 500 }
    );
  }
}
