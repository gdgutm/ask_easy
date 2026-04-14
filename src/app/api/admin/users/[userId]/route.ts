import { NextRequest, NextResponse } from "next/server";

import { requireAdmin, adminGuardResponse } from "@/lib/adminAuth";
import { prisma } from "@/lib/prisma";
import { deleteFile } from "@/lib/storage";

interface RouteParams {
  params: Promise<{ userId: string }>;
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAdmin();
    const guard = adminGuardResponse(user);
    if (guard) return guard;

    const { userId } = await params;

    await prisma.$transaction(async (tx) => {
      // 1. Gather all courses created by this user
      const courses = await tx.course.findMany({
        where: { createdById: userId },
        select: { id: true },
      });
      const courseIds = courses.map((c) => c.id);

      // 2. Gather all sessions created by this user OR belonging to their courses
      const sessions = await tx.session.findMany({
        where: {
          OR: [{ createdById: userId }, { courseId: { in: courseIds } }],
        },
        select: { id: true },
      });
      const sessionIds = sessions.map((s) => s.id);

      // 3. Handle SlideSets (uploaded by user OR in dying sessions)
      const slideSets = await tx.slideSet.findMany({
        where: {
          OR: [{ uploadedBy: userId }, { sessionId: { in: sessionIds } }],
        },
        select: { id: true, storageKey: true },
      });
      if (slideSets.length > 0) {
        await Promise.allSettled(
          slideSets.map((ss) =>
            deleteFile(ss.storageKey).catch((err) =>
              console.error("[Admin Users API] Failed to delete slide file:", ss.storageKey, err)
            )
          )
        );
        const slideSetIds = slideSets.map((ss) => ss.id);
        await tx.slideSet.deleteMany({ where: { id: { in: slideSetIds } } });
      }

      // 4. Gather all questions to delete (authored by user OR in dying sessions)
      const questionsToDel = await tx.question.findMany({
        where: {
          OR: [{ authorId: userId }, { sessionId: { in: sessionIds } }],
        },
        select: { id: true },
      });
      const questionIds = questionsToDel.map((q) => q.id);

      // 5. Gather all answers to delete (authored by user OR in dying questions)
      const answersToDel = await tx.answer.findMany({
        where: {
          OR: [{ authorId: userId }, { questionId: { in: questionIds } }],
        },
        select: { id: true },
      });
      const answerIds = answersToDel.map((a) => a.id);

      // 6. Delete Upvotes (made by user OR on dying questions/answers)
      await tx.questionUpvote.deleteMany({
        where: {
          OR: [{ userId }, { questionId: { in: questionIds } }],
        },
      });

      await tx.answerUpvote.deleteMany({
        where: {
          OR: [{ userId }, { answerId: { in: answerIds } }],
        },
      });

      // 7. Delete Answers and Questions
      if (answerIds.length > 0) {
        await tx.answer.deleteMany({ where: { id: { in: answerIds } } });
      }
      if (questionIds.length > 0) {
        await tx.question.deleteMany({ where: { id: { in: questionIds } } });
      }

      // 8. Delete Sessions
      if (sessionIds.length > 0) {
        await tx.session.deleteMany({ where: { id: { in: sessionIds } } });
      }

      // 9. Delete Enrollments (where user is enrolled, OR in dying courses)
      await tx.courseEnrollment.deleteMany({
        where: {
          OR: [{ userId }, { courseId: { in: courseIds } }],
        },
      });

      // 10. Delete Courses
      if (courseIds.length > 0) {
        await tx.course.deleteMany({ where: { id: { in: courseIds } } });
      }

      // 11. Finally, delete the User
      await tx.user.delete({ where: { id: userId } });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Admin Users] Failed to delete user:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
