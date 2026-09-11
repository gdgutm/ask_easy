import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/adminWhitelist";
import { surnameOf } from "@/lib/nameUtils";
import {
  buildEnrollmentRows,
  fullNameOf,
  getCurrentSemester,
  normalizeProfessorInputs,
  normalizeStudentInputs,
  normalizeUtorids,
  upsertPersonByUtorid,
  type RoomEnrollmentPlan,
} from "@/lib/classlistService";

// A large roster is a lot of upserts. The default 5s interactive-transaction
// budget is not enough for a 1,000-student classlist.
const CREATE_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 120_000 } as const;

// ---------------------------------------------------------------------------
// GET /api/classlists
// ---------------------------------------------------------------------------

/**
 * Returns the classlists the caller can reach, each with only the rooms they
 * are actually enrolled in.
 *
 * This is the home page's data source. A student sees every room on their
 * classlist; a professor sees one — their own; the admin who created the
 * classlist sees all of them (their own as PROFESSOR, the rest as TA).
 *
 * Response: { classlists: [{ id, code, semester, isCreator, rooms: [...] }] }
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const enrollments = await prisma.courseEnrollment.findMany({
      where: { userId: user.userId },
      select: {
        role: true,
        course: {
          select: {
            id: true,
            code: true,
            name: true,
            semester: true,
            classlistId: true,
            professorId: true,
            professor: { select: { id: true, name: true, utorid: true } },
            classlist: {
              select: { id: true, code: true, semester: true, createdById: true },
            },
            sessions: {
              where: { status: "ACTIVE" },
              select: { id: true, joinCode: true },
              orderBy: { startTime: "desc" },
              take: 1,
            },
          },
        },
      },
    });

    // A room from before classlists existed has no parent. Group it under its
    // own id so it still appears rather than vanishing from the home page.
    const groups = new Map<
      string,
      {
        id: string;
        code: string;
        semester: string;
        createdById: string | null;
        rooms: (typeof enrollments)[number][];
      }
    >();

    for (const enrollment of enrollments) {
      const { course } = enrollment;
      const key = course.classlistId ?? `room:${course.id}`;
      const group = groups.get(key);
      if (group) {
        group.rooms.push(enrollment);
      } else {
        groups.set(key, {
          id: course.classlist?.id ?? key,
          code: course.classlist?.code ?? course.code,
          semester: course.classlist?.semester ?? course.semester,
          createdById: course.classlist?.createdById ?? null,
          rooms: [enrollment],
        });
      }
    }

    const classlists = [...groups.values()].map((group) => {
      const rooms = group.rooms
        .map((enrollment) => {
          const { course } = enrollment;
          const session = course.sessions[0] ?? null;
          return {
            id: course.id,
            // Course.name is the room's own label, set by an admin.
            label: course.name,
            code: course.code,
            role: enrollment.role,
            professor: course.professor
              ? { name: course.professor.name, utorid: course.professor.utorid }
              : null,
            isMine: course.professorId === user.userId,
            activeSession: session ? { id: session.id, joinCode: session.joinCode } : null,
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label));

      return {
        id: group.id,
        code: group.code,
        semester: group.semester,
        isCreator: group.createdById === user.userId,
        liveRoomCount: rooms.filter((r) => r.activeSession).length,
        rooms,
      };
    });

    classlists.sort((a, b) => a.code.localeCompare(b.code));

    return NextResponse.json({ classlists });
  } catch (error) {
    console.error("[Classlists API] Failed to fetch classlists:", error);
    return NextResponse.json(
      { error: "An error occurred while fetching your classes." },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/classlists
// ---------------------------------------------------------------------------

/**
 * Creates a classlist and one room per professor.
 *
 * The creating admin always gets a room of their own, plus TA access to every
 * other room so they can see what is happening in them. Every other professor
 * gets exactly one room and no access at all to the others.
 *
 * Request body:
 *   {
 *     code:        string
 *     students:    Array<{ utorid, givenName, surname }>
 *     professors?: Array<{ utorid, displayName? }> | string[]
 *     tas?:        string[]    // TA on every room of this classlist
 *   }
 *
 * Only admins (ADMIN_WHITELIST) may call this endpoint.
 *
 * Response: { classlist: { id, code, semester, rooms: [{ id, label, utorid }] } }
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    if (!isAdmin(user.utorid)) {
      return NextResponse.json({ error: "Only admins can create classes." }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Request body is required." }, { status: 400 });
    }

    const { code, students, professors, tas } = body as Record<string, unknown>;

    if (!code || typeof code !== "string" || code.trim().length === 0) {
      return NextResponse.json({ error: "Course code is required." }, { status: 400 });
    }

    if (!Array.isArray(students)) {
      return NextResponse.json({ error: "Students list is required." }, { status: 400 });
    }

    const classCode = code.trim();
    const semester = getCurrentSemester();
    const creatorUtorid = user.utorid.toLowerCase();

    const studentInputs = normalizeStudentInputs(students);
    const taUtorids = normalizeUtorids(tas).filter((u) => u !== creatorUtorid);
    // The creator always gets their own room, so listing them again is a no-op.
    const professorInputs = normalizeProfessorInputs(professors).filter(
      (p) => p.utorid !== creatorUtorid
    );

    const created = await prisma.$transaction(async (tx) => {
      // Resolve the creator by UTORid, not by the id in their session cookie.
      // The cookie outlives the database: after a wipe the row is recreated
      // with a fresh id, and a cookie still carrying the old one would either
      // collide on the unique UTORid here or write foreign keys pointing at a
      // user who no longer exists. UTORid is the stable identity.
      const creator = await tx.user.upsert({
        where: { utorid: user.utorid },
        update: {},
        create: {
          utorid: user.utorid,
          email: user.email,
          name: user.name,
          role: "STUDENT",
        },
        select: { id: true, name: true },
      });
      const creatorId = creator.id;

      const classlist = await tx.classlist.create({
        data: { code: classCode, semester, createdById: creatorId },
      });

      // Professors, creator first — their room is the one they run.
      // The creator's own room falls back to their surname; they never typed a
      // name for it.
      const professorUsers = [
        {
          id: creatorId,
          utorid: creatorUtorid,
          roomName: surnameOf(creator.name) || creatorUtorid,
        },
      ];
      for (const input of professorInputs) {
        const person = await upsertPersonByUtorid(tx, input.utorid);
        professorUsers.push({
          id: person.id,
          utorid: person.utorid,
          roomName: input.roomName || person.utorid,
        });
      }
      const professorIds = new Set(professorUsers.map((p) => p.id));

      const taIds: string[] = [];
      for (const utorid of taUtorids) {
        const person = await upsertPersonByUtorid(tx, utorid);
        taIds.push(person.id);
      }

      const studentIds: string[] = [];
      for (const student of studentInputs) {
        const person = await tx.user.upsert({
          where: { utorid: student.utorid },
          update: { name: fullNameOf(student) },
          create: {
            utorid: student.utorid,
            name: fullNameOf(student),
            email: `${student.utorid}@mail.utoronto.ca`,
            role: "STUDENT",
          },
          select: { id: true },
        });
        // A professor who also appears on the roster must not get student
        // access to everyone else's rooms — that is exactly what this whole
        // split exists to prevent.
        if (!professorIds.has(person.id)) studentIds.push(person.id);
      }

      const plans: RoomEnrollmentPlan[] = [];
      const rooms: { id: string; professorId: string; utorid: string; name: string }[] = [];

      for (const professor of professorUsers) {
        const room = await tx.course.create({
          data: {
            code: classCode,
            name: professor.roomName,
            semester,
            createdById: creatorId,
            classlistId: classlist.id,
            professorId: professor.id,
          },
          select: { id: true },
        });

        rooms.push({
          id: room.id,
          professorId: professor.id,
          utorid: professor.utorid,
          name: professor.roomName,
        });
        plans.push({
          roomId: room.id,
          professorId: professor.id,
          // The admin who made the classlist watches every room they do not run.
          taIds: [...(professor.id === creatorId ? [] : [creatorId]), ...taIds],
          studentIds,
        });
      }

      await tx.courseEnrollment.createMany({ data: buildEnrollmentRows(plans) });

      return {
        id: classlist.id,
        code: classlist.code,
        semester: classlist.semester,
        rooms: rooms.map((room) => ({ id: room.id, utorid: room.utorid, label: room.name })),
      };
    }, CREATE_TRANSACTION_OPTIONS);

    return NextResponse.json({ classlist: created }, { status: 201 });
  } catch (error) {
    console.error("[Classlists API] Failed to create classlist:", error);
    return NextResponse.json(
      { error: "An error occurred while creating the class." },
      { status: 500 }
    );
  }
}
