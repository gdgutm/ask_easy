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

    const where: Prisma.CourseWhereInput = {};

    if (search) {
      where.OR = [
        { code: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
        { professor: { name: { contains: search, mode: "insensitive" } } },
        { professor: { utorid: { contains: search, mode: "insensitive" } } },
      ];
    }

    // Rows are rooms, and every room on a class carries the same code — without
    // the professor there is no way to tell one row from another.
    const rooms = await prisma.course.findMany({
      where,
      include: {
        createdBy: { select: { name: true, utorid: true } },
        professor: { select: { name: true, utorid: true } },
        classlist: { select: { id: true, code: true } },
        _count: { select: { enrollments: true, sessions: true } },
      },
      orderBy: [{ code: "asc" }, { professor: { name: "asc" } }],
    });

    return NextResponse.json({ courses: rooms });
  } catch (error) {
    console.error("[Admin Courses] Failed to fetch courses:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
