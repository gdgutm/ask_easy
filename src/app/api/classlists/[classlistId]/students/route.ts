import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireClasslistAdmin } from "@/lib/classlistAccess";
import { normalizeUtorids, upsertPersonByUtorid } from "@/lib/classlistService";

interface RouteParams {
  params: Promise<{ classlistId: string }>;
}

// ---------------------------------------------------------------------------
// Roster management
//
// Every room on a classlist carries the same roster, so each of these fans the
// change out across all of them. Reads take the union — a person counts as a
// TA on the class if they are a TA in any of its rooms.
//
// Professors are never touched here; they are room owners, and
// /api/classlists/[id]/professors is where they are added and removed.
// ---------------------------------------------------------------------------

/** Enrolls people in every room at once, skipping any room where they own it. */
async function enrollAcrossRooms(
  roomIds: string[],
  userIds: string[],
  role: "STUDENT" | "TA"
): Promise<void> {
  if (roomIds.length === 0 || userIds.length === 0) return;

  const rooms = await prisma.course.findMany({
    where: { id: { in: roomIds } },
    select: { id: true, professorId: true },
  });

  await prisma.$transaction(
    async (tx) => {
      for (const room of rooms) {
        for (const userId of userIds) {
          // The room's professor keeps their PROFESSOR row — the partial
          // unique index would not stop this, since it only guards against a
          // *second* professor, but demoting the owner would orphan the room.
          if (room.professorId === userId) continue;

          await tx.courseEnrollment.upsert({
            where: { userId_courseId: { userId, courseId: room.id } },
            update: { role },
            create: { userId, courseId: room.id, role },
          });
        }
      }
    },
    { maxWait: 10_000, timeout: 120_000 }
  );
}

// ---------------------------------------------------------------------------
// GET /api/classlists/[classlistId]/students
// ---------------------------------------------------------------------------

/**
 * The class roster, pooled across rooms.
 *
 * Response: { students, tas, professors } — each [{ name, utorid }]
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { classlistId } = await params;
    const access = await requireClasslistAdmin(classlistId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { roomIds } = access.context;
    if (roomIds.length === 0) {
      return NextResponse.json({ students: [], tas: [], professors: [] });
    }

    const enrollments = await prisma.courseEnrollment.findMany({
      where: { courseId: { in: roomIds } },
      select: {
        role: true,
        user: { select: { id: true, name: true, utorid: true } },
      },
      orderBy: { user: { name: "asc" } },
    });

    // Strongest role wins: someone who is a TA in one room and a student in
    // another is a TA on the class.
    const rank = { STUDENT: 0, TA: 1, PROFESSOR: 2 } as const;
    const best = new Map<string, { name: string; utorid: string; role: keyof typeof rank }>();

    for (const enrollment of enrollments) {
      const current = best.get(enrollment.user.id);
      if (!current || rank[enrollment.role] > rank[current.role]) {
        best.set(enrollment.user.id, {
          name: enrollment.user.name,
          utorid: enrollment.user.utorid,
          role: enrollment.role,
        });
      }
    }

    const people = [...best.values()].sort((a, b) => a.name.localeCompare(b.name));
    const entry = (p: (typeof people)[number]) => ({ name: p.name, utorid: p.utorid });

    return NextResponse.json({
      students: people.filter((p) => p.role === "STUDENT").map(entry),
      tas: people.filter((p) => p.role === "TA").map(entry),
      professors: people.filter((p) => p.role === "PROFESSOR").map(entry),
    });
  } catch (error) {
    console.error("[Classlists API] Failed to fetch roster:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/classlists/[classlistId]/students
// ---------------------------------------------------------------------------

/**
 * Adds people to every room on the class.
 *
 * Request body: { utorids: string[]; role?: "STUDENT" | "TA" }
 * Response: { added: string[] }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
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

    const { utorids, role } = (body as Record<string, unknown>) ?? {};
    const normalized = normalizeUtorids(utorids);

    if (normalized.length === 0) {
      return NextResponse.json({ error: "utorids must be a non-empty array." }, { status: 400 });
    }

    if (role === "PROFESSOR") {
      return NextResponse.json(
        { error: "Add a professor through the professors endpoint — it creates their room." },
        { status: 400 }
      );
    }

    const enrollmentRole: "STUDENT" | "TA" = role === "TA" ? "TA" : "STUDENT";

    const userIds: string[] = [];
    await prisma.$transaction(async (tx) => {
      for (const utorid of normalized) {
        const person = await upsertPersonByUtorid(tx, utorid);
        userIds.push(person.id);
      }
    });

    await enrollAcrossRooms(access.context.roomIds, userIds, enrollmentRole);

    return NextResponse.json({ added: normalized });
  } catch (error) {
    console.error("[Classlists API] Failed to add people:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/classlists/[classlistId]/students
// ---------------------------------------------------------------------------

/**
 * Replaces the student roster from a fresh CSV upload.
 *
 * Students in the new list are added to every room; students no longer on it
 * are removed from every room. TAs and professors are left alone — dropping
 * the instructional team because they are not on a student roster would be a
 * nasty surprise.
 *
 * Request body: { utorids: string[] }
 * Response: { added, removed, unchanged }
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { classlistId } = await params;
    const access = await requireClasslistAdmin(classlistId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { roomIds } = access.context;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const { utorids } = (body as Record<string, unknown>) ?? {};
    if (!Array.isArray(utorids)) {
      return NextResponse.json({ error: "utorids must be an array." }, { status: 400 });
    }

    const wanted = new Set(normalizeUtorids(utorids));

    const current = await prisma.courseEnrollment.findMany({
      where: { courseId: { in: roomIds }, role: "STUDENT" },
      select: { user: { select: { id: true, utorid: true } } },
    });
    const currentByUtorid = new Map(current.map((e) => [e.user.utorid, e.user.id]));

    const toAdd = [...wanted].filter((u) => !currentByUtorid.has(u));
    const toRemove = [...currentByUtorid.keys()].filter((u) => !wanted.has(u));
    const unchanged = [...currentByUtorid.keys()].filter((u) => wanted.has(u)).length;

    const addedIds: string[] = [];
    if (toAdd.length > 0) {
      await prisma.$transaction(
        async (tx) => {
          for (const utorid of toAdd) {
            const person = await upsertPersonByUtorid(tx, utorid);
            addedIds.push(person.id);
          }
        },
        { maxWait: 10_000, timeout: 120_000 }
      );
    }

    // Only ever create STUDENT rows here: someone already a TA or professor in
    // a room must keep that role even if they are on the student CSV.
    if (addedIds.length > 0) {
      const rooms = await prisma.course.findMany({
        where: { id: { in: roomIds } },
        select: { id: true },
      });
      await prisma.courseEnrollment.createMany({
        data: rooms.flatMap((room) =>
          addedIds.map((userId) => ({ userId, courseId: room.id, role: "STUDENT" as const }))
        ),
        skipDuplicates: true,
      });
    }

    if (toRemove.length > 0) {
      const removeIds = toRemove
        .map((u) => currentByUtorid.get(u))
        .filter((id): id is string => !!id);
      await prisma.courseEnrollment.deleteMany({
        where: { courseId: { in: roomIds }, userId: { in: removeIds }, role: "STUDENT" },
      });
    }

    return NextResponse.json({ added: toAdd, removed: toRemove, unchanged });
  } catch (error) {
    console.error("[Classlists API] Failed to sync roster:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/classlists/[classlistId]/students
// ---------------------------------------------------------------------------

/**
 * Removes one person from every room on the class.
 *
 * A TA is demoted to student rather than dropped, matching what the room-level
 * screen does — they stay reachable in a live session instead of being kicked
 * mid-lecture. A student is removed outright.
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

    const { roomIds } = access.context;

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
    const target = await prisma.user.findUnique({
      where: { utorid: normalized },
      select: { id: true },
    });
    if (!target) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const ownsARoom = await prisma.course.findFirst({
      where: { classlistId, professorId: target.id },
      select: { id: true },
    });
    if (ownsARoom) {
      return NextResponse.json(
        { error: "That person runs a room. Remove them from the professors list instead." },
        { status: 409 }
      );
    }

    // Demote or drop, never both — running the demotion first and then
    // deleting students would delete the person we just demoted.
    const taRooms = await prisma.courseEnrollment.count({
      where: { courseId: { in: roomIds }, userId: target.id, role: "TA" },
    });

    if (taRooms > 0) {
      await prisma.courseEnrollment.updateMany({
        where: { courseId: { in: roomIds }, userId: target.id, role: "TA" },
        data: { role: "STUDENT" },
      });
      return NextResponse.json({ removed: normalized, demotedTo: "STUDENT" });
    }

    await prisma.courseEnrollment.deleteMany({
      where: { courseId: { in: roomIds }, userId: target.id, role: "STUDENT" },
    });

    return NextResponse.json({ removed: normalized, demotedTo: null });
  } catch (error) {
    console.error("[Classlists API] Failed to remove person:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
