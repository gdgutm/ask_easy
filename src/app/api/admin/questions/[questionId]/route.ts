import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAdmin, adminGuardResponse } from "@/lib/adminAuth";

interface RouteParams {
  params: Promise<{ questionId: string }>;
}

/**
 * DELETE /api/admin/questions/[questionId]
 *
 * Deletes a question. Answers and upvotes cascade automatically
 * via onDelete: Cascade in the Prisma schema.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAdmin();
    const guard = adminGuardResponse(user);
    if (guard) return guard;

    const { questionId } = await params;

    // QuestionUpvote uses onDelete: Cascade on the question relation
    // Answer uses onDelete: Cascade on the question relation
    // AnswerUpvote uses onDelete: Cascade on the answer relation
    await prisma.question.delete({ where: { id: questionId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Admin Questions] Failed to delete question:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
