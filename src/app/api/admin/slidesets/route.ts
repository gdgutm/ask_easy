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
    const limit = parseInt(searchParams.get("limit") ?? "50", 10);
    const cursor = searchParams.get("cursor");

    const where: Prisma.SlideSetWhereInput = {};
    if (search) {
      where.OR = [{ filename: { contains: search, mode: "insensitive" } }];
    }

    const slideSets = await prisma.slideSet.findMany({
      where,
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      include: {
        session: { select: { title: true, course: { select: { code: true } } } },
        uploader: { select: { name: true, utorid: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    let nextCursor: string | null = null;
    if (slideSets.length > limit) {
      const nextItem = slideSets.pop();
      nextCursor = nextItem?.id ?? null;
    }

    return NextResponse.json({ slideSets, nextCursor });
  } catch (error) {
    console.error("[Admin SlideSets] Failed to fetch slidesets:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
