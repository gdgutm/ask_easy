import type { Prisma, Role } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { deleteFile } from "@/lib/storage";

// ---------------------------------------------------------------------------
// Shared classlist helpers
//
// A classlist owns one room (Course) per professor. Everything in here is
// about keeping those rooms consistent with each other: the same roster, the
// same TAs, exactly one professor each.
// ---------------------------------------------------------------------------

export interface ProfessorInput {
  utorid: string;
  /** The name for this professor's room. Permanent; only an admin changes it. */
  roomName?: string;
}

export interface StudentInput {
  utorid: string;
  givenName?: string;
  surname?: string;
}

/** Placeholder UTORids the CSV parser emits for rows it could not read. */
const INVALID_UTORIDS = new Set(["missing utorid", "error"]);

export function getCurrentSemester(now: Date = new Date()): string {
  const month = now.getMonth() + 1; // 1-indexed
  const year = now.getFullYear();
  if (month <= 4) return `Winter ${year}`;
  if (month <= 8) return `Summer ${year}`;
  return `Fall ${year}`;
}

/** Lower-cases, trims and de-duplicates a list of UTORids, dropping junk. */
export function normalizeUtorids(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const utorid = entry.trim().toLowerCase();
    if (utorid && !INVALID_UTORIDS.has(utorid)) out.add(utorid);
  }
  return [...out];
}

/**
 * Accepts either `["smithj"]` or `[{ utorid, roomName }]` and normalizes to the
 * latter. The plain-string form exists because not every caller has a room name
 * to offer; those rooms fall back to the professor's surname.
 */
export function normalizeProfessorInputs(raw: unknown): ProfessorInput[] {
  if (!Array.isArray(raw)) return [];
  const byUtorid = new Map<string, ProfessorInput>();

  for (const entry of raw) {
    let utorid = "";
    let roomName: string | undefined;

    if (typeof entry === "string") {
      utorid = entry.trim().toLowerCase();
    } else if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      utorid = typeof record.utorid === "string" ? record.utorid.trim().toLowerCase() : "";
      // `displayName` is still accepted for older callers.
      const raw2 = record.roomName ?? record.displayName;
      const name = typeof raw2 === "string" ? raw2.trim() : "";
      if (name) roomName = name;
    }

    if (!utorid || INVALID_UTORIDS.has(utorid)) continue;

    // Later entries win only when they carry a name the earlier one lacked.
    const existing = byUtorid.get(utorid);
    if (!existing) byUtorid.set(utorid, { utorid, roomName });
    else if (!existing.roomName && roomName) existing.roomName = roomName;
  }

  return [...byUtorid.values()];
}

export function normalizeStudentInputs(raw: unknown): StudentInput[] {
  if (!Array.isArray(raw)) return [];
  const byUtorid = new Map<string, StudentInput>();

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const utorid = typeof record.utorid === "string" ? record.utorid.trim().toLowerCase() : "";
    if (!utorid || INVALID_UTORIDS.has(utorid)) continue;

    byUtorid.set(utorid, {
      utorid,
      givenName: typeof record.givenName === "string" ? record.givenName.trim() : undefined,
      surname: typeof record.surname === "string" ? record.surname.trim() : undefined,
    });
  }

  return [...byUtorid.values()];
}

export function fullNameOf(student: StudentInput): string {
  return `${student.givenName ?? ""} ${student.surname ?? ""}`.trim() || student.utorid;
}

type Tx = Prisma.TransactionClient;

/**
 * Finds or creates the User for a UTORid.
 *
 * A new row is named after the UTORid until that person signs in and
 * Shibboleth gives us their real name. Nothing here writes a name an admin
 * typed: that name belongs to a room, not to a person.
 */
export async function upsertPersonByUtorid(
  tx: Tx,
  utorid: string
): Promise<{ id: string; utorid: string; name: string }> {
  const existing = await tx.user.findUnique({
    where: { utorid },
    select: { id: true, utorid: true, name: true },
  });

  if (existing) return existing;

  return tx.user.create({
    data: {
      utorid,
      name: utorid,
      email: `${utorid}@mail.utoronto.ca`,
      role: "STUDENT",
    },
    select: { id: true, utorid: true, name: true },
  });
}

export interface RoomEnrollmentPlan {
  roomId: string;
  /** The room's one professor. */
  professorId: string;
  /** Everyone who gets TA access to this room (admin creator, classlist TAs). */
  taIds: string[];
  studentIds: string[];
}

/**
 * Flattens per-room membership into CourseEnrollment rows, keeping the
 * strongest role when someone appears in more than one list.
 *
 * The de-duplication matters: a classlist TA who is also on the student roster
 * must not get two rows — the table has a unique (userId, courseId) — and must
 * end up a TA, not a student.
 */
export function buildEnrollmentRows(
  plans: RoomEnrollmentPlan[]
): { userId: string; courseId: string; role: Role }[] {
  const rows: { userId: string; courseId: string; role: Role }[] = [];

  for (const plan of plans) {
    const assigned = new Set<string>();
    const add = (userId: string, role: Role) => {
      if (assigned.has(userId)) return;
      assigned.add(userId);
      rows.push({ userId, courseId: plan.roomId, role });
    };

    add(plan.professorId, "PROFESSOR");
    for (const id of plan.taIds) add(id, "TA");
    for (const id of plan.studentIds) add(id, "STUDENT");
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Room teardown
// ---------------------------------------------------------------------------

/**
 * Permanently removes rooms and everything hanging off them.
 *
 * Course has no cascades, so the order is manual:
 *   QuestionUpvote → Answer → Question → slide files → SlideSet → Session
 *   → CourseEnrollment → Course
 *
 * Slide files live on disk and are deleted first — a failure there is logged
 * rather than thrown, since an orphaned file is a smaller problem than a
 * half-deleted room.
 */
export async function deleteRooms(roomIds: string[]): Promise<void> {
  if (roomIds.length === 0) return;

  const sessions = await prisma.session.findMany({
    where: { courseId: { in: roomIds } },
    select: { id: true },
  });
  const sessionIds = sessions.map((s) => s.id);

  if (sessionIds.length > 0) {
    const slideSets = await prisma.slideSet.findMany({
      where: { sessionId: { in: sessionIds } },
      select: { storageKey: true },
    });

    await Promise.allSettled(
      slideSets.map((slideSet) =>
        deleteFile(slideSet.storageKey).catch((err) =>
          console.error("[Classlist] Failed to delete slide file:", slideSet.storageKey, err)
        )
      )
    );
  }

  await prisma.$transaction(
    async (tx) => {
      if (sessionIds.length > 0) {
        const questions = await tx.question.findMany({
          where: { sessionId: { in: sessionIds } },
          select: { id: true },
        });
        const questionIds = questions.map((q) => q.id);

        if (questionIds.length > 0) {
          await tx.questionUpvote.deleteMany({ where: { questionId: { in: questionIds } } });
          await tx.answer.deleteMany({ where: { questionId: { in: questionIds } } });
          await tx.question.deleteMany({ where: { id: { in: questionIds } } });
        }

        await tx.slideSet.deleteMany({ where: { sessionId: { in: sessionIds } } });
        await tx.session.deleteMany({ where: { id: { in: sessionIds } } });
      }

      await tx.courseEnrollment.deleteMany({ where: { courseId: { in: roomIds } } });
      await tx.course.deleteMany({ where: { id: { in: roomIds } } });
    },
    { maxWait: 10_000, timeout: 120_000 }
  );
}

/** Room ids of a classlist that currently have a live session. */
export async function liveRoomIds(roomIds: string[]): Promise<string[]> {
  if (roomIds.length === 0) return [];
  const live = await prisma.session.findMany({
    where: { courseId: { in: roomIds }, status: "ACTIVE" },
    select: { courseId: true },
    distinct: ["courseId"],
  });
  return live.map((s) => s.courseId);
}
