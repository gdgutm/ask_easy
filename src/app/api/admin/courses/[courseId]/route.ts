import { NextRequest, NextResponse } from "next/server";

import { requireAdmin, adminGuardResponse } from "@/lib/adminAuth";
import { prisma } from "@/lib/prisma";
import { deleteFile } from "@/lib/storage";

interface RouteParams {
  params: Promise<{ courseId: string }>;
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAdmin();
    const guard = adminGuardResponse(user);
    if (guard) return guard;

    const { courseId } = await params;

    // Deleting the last room on a classlist would leave the classlist behind
    // with nothing in it — invisible on the home page and unmanageable.
    const room = await prisma.course.findUnique({
      where: { id: courseId },
      select: { classlistId: true },
    });

    // Gather all session IDs for this course
    const sessions = await prisma.session.findMany({
      where: { courseId },
      select: { id: true },
    });
    const sessionIds = sessions.map((s) => s.id);

    await prisma.$transaction(async (tx) => {
      if (sessionIds.length > 0) {
        // Collect slide storage keys before deleting
        const slideSets = await tx.slideSet.findMany({
          where: { sessionId: { in: sessionIds } },
          select: { storageKey: true },
        });

        // Delete slide files from disk
        await Promise.allSettled(
          slideSets.map((ss) =>
            deleteFile(ss.storageKey).catch((err) =>
              console.error("[Admin Courses API] Failed to delete slide file:", ss.storageKey, err)
            )
          )
        );

        // Get question IDs to remove upvotes and answers
        const questions = await tx.question.findMany({
          where: { sessionId: { in: sessionIds } },
          select: { id: true },
        });
        const questionIds = questions.map((q) => q.id);

        if (questionIds.length > 0) {
          await tx.questionUpvote.deleteMany({ where: { questionId: { in: questionIds } } });
          await tx.answer.deleteMany({ where: { questionId: { in: questionIds } } });
          await tx.question.deleteMany({ where: { id: { in: questionIds } } });
        }

        // SlideSet
        await tx.slideSet.deleteMany({ where: { sessionId: { in: sessionIds } } });

        await tx.session.deleteMany({ where: { courseId } });
      }

      await tx.courseEnrollment.deleteMany({ where: { courseId } });
      await tx.course.delete({ where: { id: courseId } });

      if (room?.classlistId) {
        const remaining = await tx.course.count({ where: { classlistId: room.classlistId } });
        if (remaining === 0) {
          await tx.classlist.delete({ where: { id: room.classlistId } });
        }
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Admin Courses] Failed to delete course:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
