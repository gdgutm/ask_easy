import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminGuardResponse } from "@/lib/adminAuth";
import { getAdminUtorids } from "@/lib/adminWhitelist";

export async function DELETE() {
  try {
    const user = await requireAdmin();
    const guard = adminGuardResponse(user);
    if (guard) return guard;

    const adminUtorids = getAdminUtorids();
    const protectedUsers = await prisma.user.findMany({
      where: { OR: [{ utorid: { in: adminUtorids } }, { role: "PROFESSOR" }] },
      select: { id: true },
    });
    const protectedIds = protectedUsers.map((u) => u.id);

    await prisma.$transaction([
      prisma.answerUpvote.deleteMany(),
      prisma.questionUpvote.deleteMany(),
      prisma.answer.deleteMany(),
      prisma.question.deleteMany(),
      prisma.slideSet.deleteMany(),
      prisma.session.deleteMany(),
      prisma.courseEnrollment.deleteMany(),
      prisma.course.deleteMany(),
      prisma.user.deleteMany(
        protectedIds.length > 0 ? { where: { id: { notIn: protectedIds } } } : undefined
      ),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Admin Users] Failed to delete all users:", error);
    return NextResponse.json({ error: "Failed to delete all users." }, { status: 500 });
  }
}
