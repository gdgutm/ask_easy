import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminGuardResponse } from "@/lib/adminAuth";
import { deleteFile } from "@/lib/storage";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slideSetId: string }> }
) {
  try {
    const user = await requireAdmin();
    const guard = adminGuardResponse(user);
    if (guard) return guard;

    const { slideSetId } = await params;

    const slideSet = await prisma.slideSet.findUnique({ where: { id: slideSetId } });
    if (!slideSet) {
      return NextResponse.json({ error: "SlideSet not found." }, { status: 404 });
    }

    // Delete associated physical file
    await deleteFile(slideSet.storageKey);

    await prisma.slideSet.delete({ where: { id: slideSetId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Admin SlideSets] Failed to delete slideset:", error);
    return NextResponse.json({ error: "Failed to delete slideset." }, { status: 500 });
  }
}
