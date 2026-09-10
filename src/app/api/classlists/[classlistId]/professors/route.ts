import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireClasslistAdmin } from "@/lib/classlistAccess";
import {
  buildEnrollmentRows,
  deleteRooms,
  liveRoomIds,
  normalizeProfessorInputs,
  upsertPersonByUtorid,
} from "@/lib/classlistService";
import { roomLabelsFor } from "@/lib/roomLabel";

interface RouteParams {
  params: Promise<{ classlistId: string }>;
}

// ---------------------------------------------------------------------------
// Professors on a classlist
//
// A professor *is* a room here — adding one builds a room, removing one tears
// theirs down. There is no way to have a professor without a room or a room
// without a professor.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// POST /api/classlists/[classlistId]/professors
// ---------------------------------------------------------------------------

/**
 * Adds a professor and creates their room, seeded with the class's existing
 * roster and TAs plus the classlist creator as a TA.
 *
 * Request body: { utorid: string; displayName?: string }
 * Response: { room: { id, label, utorid } }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { classlistId } = await params;
    const access = await requireClasslistAdmin(classlistId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { classlist, roomIds } = access.context;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const [input] = normalizeProfessorInputs([body]);
    if (!input) {
      return NextResponse.json({ error: "A UTORid is required." }, { status: 400 });
    }

    const existingRoom = await prisma.course.findFirst({
      where: { classlistId, professor: { utorid: input.utorid } },
      select: { id: true },
    });
    if (existingRoom) {
      return NextResponse.json(
        { error: `${input.utorid} already runs a room on this class.` },
        { status: 409 }
      );
    }

    // Seed the new room from what the class already has. Reading one existing
    // room is enough — they all carry the same roster.
    const template = roomIds[0];
    const seed = template
      ? await prisma.courseEnrollment.findMany({
          where: { courseId: template, role: { in: ["STUDENT", "TA"] } },
          select: { userId: true, role: true },
        })
      : [];

    const created = await prisma.$transaction(
      async (tx) => {
        const professor = await upsertPersonByUtorid(tx, input.utorid, input.displayName);

        const room = await tx.course.create({
          data: {
            code: classlist.code,
            name: classlist.code,
            semester: classlist.semester,
            createdById: classlist.createdById,
            classlistId,
            professorId: professor.id,
          },
          select: { id: true },
        });

        const taIds = new Set(seed.filter((e) => e.role === "TA").map((e) => e.userId));
        // The creating admin watches every room but their own.
        if (professor.id !== classlist.createdById) taIds.add(classlist.createdById);

        // A professor never gets a student row in their own room, and the
        // template room's professor is a stranger here — they stay out.
        const otherProfessorIds = new Set(
          (
            await tx.course.findMany({
              where: { classlistId, professorId: { not: null } },
              select: { professorId: true },
            })
          )
            .map((r) => r.professorId)
            .filter((id): id is string => !!id && id !== professor.id)
        );

        const studentIds = seed
          .filter((e) => e.role === "STUDENT")
          .map((e) => e.userId)
          .filter((id) => id !== professor.id && !otherProfessorIds.has(id));

        await tx.courseEnrollment.createMany({
          data: buildEnrollmentRows([
            {
              roomId: room.id,
              professorId: professor.id,
              taIds: [...taIds].filter((id) => !otherProfessorIds.has(id)),
              studentIds,
            },
          ]),
        });

        return { roomId: room.id, professorId: professor.id, utorid: professor.utorid };
      },
      { maxWait: 10_000, timeout: 120_000 }
    );

    // Label against the whole class so a new Smith gets an initial and so does
    // the Smith who was already there.
    const professors = await prisma.course.findMany({
      where: { classlistId, professorId: { not: null } },
      select: { professor: { select: { id: true, name: true, utorid: true } } },
    });
    const labels = roomLabelsFor(
      professors.map((p) => p.professor!).filter((p): p is NonNullable<typeof p> => !!p)
    );

    return NextResponse.json(
      {
        room: {
          id: created.roomId,
          utorid: created.utorid,
          label: labels.get(created.professorId) ?? created.utorid,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[Classlists API] Failed to add professor:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/classlists/[classlistId]/professors
// ---------------------------------------------------------------------------

/**
 * Removes a professor by deleting their room and everything in it.
 *
 * Refuses while that room is live, and refuses to remove the last professor —
 * a class with no rooms is not something the UI can get back out of.
 *
 * Request body: { utorid: string }
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
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

    const { utorid } = (body as Record<string, unknown>) ?? {};
    if (!utorid || typeof utorid !== "string" || !utorid.trim()) {
      return NextResponse.json({ error: "utorid is required." }, { status: 400 });
    }
    const normalized = utorid.trim().toLowerCase();

    const room = await prisma.course.findFirst({
      where: { classlistId, professor: { utorid: normalized } },
      select: { id: true },
    });
    if (!room) {
      return NextResponse.json(
        { error: "That person does not run a room on this class." },
        { status: 404 }
      );
    }

    const roomCount = await prisma.course.count({ where: { classlistId } });
    if (roomCount <= 1) {
      return NextResponse.json(
        { error: "Cannot remove the last professor — delete the class instead." },
        { status: 409 }
      );
    }

    const live = await liveRoomIds([room.id]);
    if (live.length > 0) {
      return NextResponse.json(
        { error: "That room is live. End the session before removing its professor." },
        { status: 409 }
      );
    }

    await deleteRooms([room.id]);

    return NextResponse.json({ removed: normalized });
  } catch (error) {
    console.error("[Classlists API] Failed to remove professor:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
