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
      ];
    }

    const courses = await prisma.course.findMany({
      where,
      include: {
        createdBy: { select: { name: true, utorid: true } },
        _count: { select: { enrollments: true, sessions: true } },
      },
      orderBy: { code: "asc" },
    });

    return NextResponse.json({ courses });
  } catch (error) {
    console.error("[Admin Courses] Failed to fetch courses:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
