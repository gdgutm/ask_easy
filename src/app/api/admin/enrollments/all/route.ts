import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminGuardResponse } from "@/lib/adminAuth";

export async function DELETE() {
  try {
    const user = await requireAdmin();
    const guard = adminGuardResponse(user);
    if (guard) return guard;

    await prisma.courseEnrollment.deleteMany();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Admin Enrollments] Failed to delete all enrollments:", error);
    return NextResponse.json({ error: "Failed to delete all enrollments." }, { status: 500 });
  }
}
