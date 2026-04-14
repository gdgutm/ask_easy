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
    const sessionId = searchParams.get("sessionId") ?? "";
    const cursorParam = searchParams.get("cursor") ?? "";
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 1), 100);

    const where: Prisma.QuestionWhereInput = {};

    if (search) {
      where.content = { contains: search, mode: "insensitive" };
    }
    if (status && ["OPEN", "ANSWERED", "RESOLVED"].includes(status)) {
      where.status = status as "OPEN" | "ANSWERED" | "RESOLVED";
    }
    if (sessionId) {
      where.sessionId = sessionId;
    }

    const questions = await prisma.question.findMany({
      where,
      include: {
        author: { select: { name: true, utorid: true } },
        session: {
          select: { title: true, course: { select: { code: true } } },
        },
        _count: { select: { answers: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursorParam ? { cursor: { id: cursorParam }, skip: 1 } : {}),
    });

    const hasMore = questions.length > limit;
    if (hasMore) questions.pop();

    const nextCursor = hasMore ? questions[questions.length - 1]?.id : null;

    return NextResponse.json({ questions, nextCursor });
  } catch (error) {
    console.error("[Admin Questions] Failed to fetch questions:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
