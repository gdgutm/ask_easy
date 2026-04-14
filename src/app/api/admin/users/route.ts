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

    const where: Prisma.UserWhereInput = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { utorid: { contains: search, mode: "insensitive" } },
      ];
    }

    if (role && ["STUDENT", "TA", "PROFESSOR"].includes(role)) {
      where.role = role as "STUDENT" | "TA" | "PROFESSOR";
    }

    const users = await prisma.user.findMany({
      where,
      select: { id: true, utorid: true, email: true, name: true, role: true },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ users });
  } catch (error) {
    console.error("[Admin Users] Failed to fetch users:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
