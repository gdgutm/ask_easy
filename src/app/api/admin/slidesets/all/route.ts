import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, adminGuardResponse } from "@/lib/adminAuth";
import { deleteFile } from "@/lib/storage";

export async function DELETE() {
  try {
    const user = await requireAdmin();
    const guard = adminGuardResponse(user);
    if (guard) return guard;

    const slideSets = await prisma.slideSet.findMany({ select: { storageKey: true } });

    // Delete all physical files
    for (const s of slideSets) {
      try {
        await deleteFile(s.storageKey);
      } catch (e) {
        console.error("Failed to delete file:", s.storageKey, e);
      }
    }

    await prisma.slideSet.deleteMany();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Admin SlideSets] Failed to delete all slidesets:", error);
    return NextResponse.json({ error: "Failed to delete all slidesets." }, { status: 500 });
  }
}
