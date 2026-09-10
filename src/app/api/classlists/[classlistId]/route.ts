import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireClasslistAdmin } from "@/lib/classlistAccess";
import { deleteRooms, liveRoomIds } from "@/lib/classlistService";
import { roomLabelsFor } from "@/lib/roomLabel";

interface RouteParams {
  params: Promise<{ classlistId: string }>;
}

// ---------------------------------------------------------------------------
// GET /api/classlists/[classlistId]
// ---------------------------------------------------------------------------

/**
 * Everything the manage screen needs: the class itself and its rooms, each
 * with its professor and whether it is currently live.
 *
 * Response: { classlist: { id, code, semester, rooms: [...] } }
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { classlistId } = await params;
    const access = await requireClasslistAdmin(classlistId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { classlist, roomIds } = access.context;

    const rooms = await prisma.course.findMany({
      where: { classlistId },
      select: {
        id: true,
        professorId: true,
        professor: { select: { id: true, name: true, utorid: true, hasLoggedIn: true } },
        _count: { select: { enrollments: true } },
      },
    });

    const live = new Set(await liveRoomIds(roomIds));
    const labels = roomLabelsFor(
      rooms
        .map((r) => r.professor)
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => ({ id: p.id, name: p.name, utorid: p.utorid }))
    );

    return NextResponse.json({
      classlist: {
        id: classlist.id,
        code: classlist.code,
        semester: classlist.semester,
        createdById: classlist.createdById,
        rooms: rooms
          .map((room) => ({
            id: room.id,
            label: room.professorId ? (labels.get(room.professorId) ?? "") : "",
            professor: room.professor
              ? {
                  name: room.professor.name,
                  utorid: room.professor.utorid,
                  hasLoggedIn: room.professor.hasLoggedIn,
                }
              : null,
            memberCount: room._count.enrollments,
            isLive: live.has(room.id),
            isCreatorRoom: room.professorId === classlist.createdById,
          }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      },
    });
  } catch (error) {
    console.error("[Classlists API] Failed to fetch classlist:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/classlists/[classlistId]
// ---------------------------------------------------------------------------

/**
 * Renames the class code and/or semester.
 *
 * Every room carries a copy of both for display, so the change fans out to all
 * of them — leaving one room labelled with the old code would be worse than
 * not renaming at all.
 *
 * Request body: { code?: string; semester?: string }
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

    const { code, semester } = (body as Record<string, unknown>) ?? {};

    if (code !== undefined && (typeof code !== "string" || code.trim().length === 0)) {
      return NextResponse.json({ error: "Course code cannot be empty." }, { status: 400 });
    }
    if (semester !== undefined && (typeof semester !== "string" || semester.trim().length === 0)) {
      return NextResponse.json({ error: "Semester cannot be empty." }, { status: 400 });
    }

    const updates: { code?: string; semester?: string } = {};
    if (typeof code === "string") updates.code = code.trim();
    if (typeof semester === "string") updates.semester = semester.trim();

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const classlist = await tx.classlist.update({
        where: { id: classlistId },
        data: updates,
        select: { id: true, code: true, semester: true },
      });

      await tx.course.updateMany({
        where: { classlistId },
        data: {
          ...(updates.code ? { code: updates.code, name: updates.code } : {}),
          ...(updates.semester ? { semester: updates.semester } : {}),
        },
      });

      return classlist;
    });

    return NextResponse.json({ classlist: updated });
  } catch (error) {
    console.error("[Classlists API] Failed to rename classlist:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/classlists/[classlistId]
// ---------------------------------------------------------------------------

/**
 * Deletes the class, every room on it, and all of their Q&A and slides.
 *
 * Refuses while any room is live — ending someone else's lecture out from
 * under them is not something to do by accident.
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { classlistId } = await params;
    const access = await requireClasslistAdmin(classlistId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { roomIds } = access.context;

    const live = await liveRoomIds(roomIds);
    if (live.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete a class while ${live.length === 1 ? "a room is" : `${live.length} rooms are`} live. End the session first.`,
        },
        { status: 409 }
      );
    }

    await deleteRooms(roomIds);
    await prisma.classlist.delete({ where: { id: classlistId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Classlists API] Failed to delete classlist:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
