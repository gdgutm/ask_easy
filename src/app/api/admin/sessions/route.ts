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
    const status = searchParams.get("status") ?? "";

    const where: Prisma.SessionWhereInput = {};

    if (search) {
      where.title = { contains: search, mode: "insensitive" };
    }

    if (status && ["ACTIVE", "SCHEDULED", "ENDED"].includes(status)) {
      where.status = status as "ACTIVE" | "SCHEDULED" | "ENDED";
    }

    const sessions = await prisma.session.findMany({
      where,
      include: {
        course: { select: { code: true, name: true } },
        createdBy: { select: { name: true, utorid: true } },
        _count: { select: { questions: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("[Admin Sessions] Failed to fetch sessions:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
