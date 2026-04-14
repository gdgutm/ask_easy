import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminGuardResponse } from "@/lib/adminAuth";

export async function DELETE() {
  try {
    const user = await requireAdmin();
    const guard = adminGuardResponse(user);
    if (guard) return guard;

    await prisma.$transaction([
      prisma.answerUpvote.deleteMany(),
      prisma.questionUpvote.deleteMany(),
      prisma.answer.deleteMany(),
      prisma.question.deleteMany(),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Admin Questions] Failed to delete all questions:", error);
    return NextResponse.json({ error: "Failed to delete all questions." }, { status: 500 });
  }
}
