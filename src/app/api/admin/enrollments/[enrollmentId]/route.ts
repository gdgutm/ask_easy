import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAdmin, adminGuardResponse } from "@/lib/adminAuth";

interface RouteParams {
  params: Promise<{ enrollmentId: string }>;
}

/**
 * DELETE /api/admin/enrollments/[enrollmentId]
 *
 * Removes a single course enrollment.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAdmin();
    const guard = adminGuardResponse(user);
    if (guard) return guard;

    const { enrollmentId } = await params;

    await prisma.courseEnrollment.delete({ where: { id: enrollmentId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Admin Enrollments] Failed to delete enrollment:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
