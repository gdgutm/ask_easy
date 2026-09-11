import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireClasslistAdmin } from "@/lib/classlistAccess";

interface RouteParams {
  params: Promise<{ classlistId: string }>;
}

// ---------------------------------------------------------------------------
// PATCH /api/classlists/[classlistId]/rooms
// ---------------------------------------------------------------------------

/**
 * Renames one room.
 *
 * A room's name is the admin's to set — it is not derived from its professor's
 * account, so nothing else ever changes it. Admin-only, like everything else
 * that touches a class as a whole.
 *
 * Request body: { roomId: string; name: string }
 * Response: { room: { id, label } }
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { classlistId } = await params;
    const access = await requireClasslistAdmin(classlistId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const { roomId, name } = (body as Record<string, unknown>) ?? {};

    if (!roomId || typeof roomId !== "string") {
      return NextResponse.json({ error: "roomId is required." }, { status: 400 });
    }
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "A room name is required." }, { status: 400 });
    }

    // Scope the update to this classlist so a roomId from elsewhere cannot be
    // renamed through a class the caller happens to administer.
    if (!access.context.roomIds.includes(roomId)) {
      return NextResponse.json({ error: "That room is not on this class." }, { status: 404 });
    }

    const room = await prisma.course.update({
      where: { id: roomId },
      data: { name: name.trim() },
      select: { id: true, name: true },
    });

    return NextResponse.json({ room: { id: room.id, label: room.name } });
  } catch (error) {
    console.error("[Classlists API] Failed to rename room:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
