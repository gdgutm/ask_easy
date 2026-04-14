import { NextRequest, NextResponse } from "next/server";

import { requireAdmin, adminGuardResponse } from "@/lib/adminAuth";
import { prisma } from "@/lib/prisma";
import { deleteFile } from "@/lib/storage";

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAdmin();
    const guard = adminGuardResponse(user);
    if (guard) return guard;

    const { sessionId } = await params;

    await prisma.$transaction(async (tx) => {
      // Collect slide storage keys before deleting
      const slideSets = await tx.slideSet.findMany({
        where: { sessionId },
        select: { storageKey: true },
      });

      // Delete slide files from disk
      await Promise.allSettled(
        slideSets.map((ss) =>
          deleteFile(ss.storageKey).catch((err) =>
            console.error("[Admin Sessions API] Failed to delete slide file:", ss.storageKey, err)
          )
        )
      );

      // Get question IDs to remove upvotes and answers
      const questions = await tx.question.findMany({
        where: { sessionId },
        select: { id: true },
      });
      const questionIds = questions.map((q) => q.id);

      if (questionIds.length > 0) {
        await tx.questionUpvote.deleteMany({ where: { questionId: { in: questionIds } } });
        await tx.answer.deleteMany({ where: { questionId: { in: questionIds } } });
        await tx.question.deleteMany({ where: { id: { in: questionIds } } });
      }

      // SlideSet
      await tx.slideSet.deleteMany({ where: { sessionId } });

      // Session
      await tx.session.delete({ where: { id: sessionId } });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Admin Sessions] Failed to delete session:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
