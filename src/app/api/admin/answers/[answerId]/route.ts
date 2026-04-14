import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAdmin, adminGuardResponse } from "@/lib/adminAuth";

interface RouteParams {
  params: Promise<{ answerId: string }>;
}

/**
 * DELETE /api/admin/answers/[answerId]
 *
 * Deletes an answer. AnswerUpvote cascades automatically
 * via onDelete: Cascade in the Prisma schema.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAdmin();
    const guard = adminGuardResponse(user);
    if (guard) return guard;

    const { answerId } = await params;

    await prisma.answer.delete({ where: { id: answerId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Admin Answers] Failed to delete answer:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
