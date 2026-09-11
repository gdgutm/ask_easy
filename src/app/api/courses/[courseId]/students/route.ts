import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Room-level roster
//
// This is what a professor uses on their own room — chiefly assigning TAs from
// inside a live session. Changes here affect one room only.
//
// Professors are not managed here. A room has exactly one, enforced by a
// partial unique index, and adding one means creating a room: that is
// /api/classlists/[classlistId]/professors, and it is an admin action.
// ---------------------------------------------------------------------------

interface RouteParams {
  params: Promise<{ courseId: string }>;
}

// ---------------------------------------------------------------------------
// GET /api/courses/[courseId]/students
// ---------------------------------------------------------------------------

/**
 * Returns this room's students, TAs and its one professor.
 *
 * Returns: { students, tas, professors } each [{name, utorid}]
 *
 * Only this room's professor may call it.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { courseId } = await params;

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const enrollment = await prisma.courseEnrollment.findUnique({
      where: { userId_courseId: { userId: user.userId, courseId } },
      select: { role: true },
    });
    if (!enrollment || enrollment.role !== "PROFESSOR") {
      return NextResponse.json(
        { error: "Only this room’s professor can view its roster." },
        { status: 403 }
      );
    }

    const enrollments = await prisma.courseEnrollment.findMany({
      where: { courseId, role: { in: ["STUDENT", "TA", "PROFESSOR"] } },
      include: { user: { select: { name: true, utorid: true } } },
      orderBy: { user: { name: "asc" } },
    });

    const mapEntry = (e: (typeof enrollments)[number]) => ({
      name: e.user.name,
      utorid: e.user.utorid,
    });

    return NextResponse.json({
      students: enrollments.filter((e) => e.role === "STUDENT").map(mapEntry),
      tas: enrollments.filter((e) => e.role === "TA").map(mapEntry),
      professors: enrollments.filter((e) => e.role === "PROFESSOR").map(mapEntry),
    });
  } catch (error) {
    console.error("[Courses API] Failed to fetch roster:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/courses/[courseId]/students
// ---------------------------------------------------------------------------

/**
 * Adds one or more students or TAs to this room by UTORid.
 *
 * Request body: { utorids: string[]; role?: "STUDENT" | "TA" }
 *
 * For each UTORid:
 *   - Upserts the User (creates with default name = utorid if new)
 *   - Creates the enrollment (updates the role if one already exists)
 *
 * Returns per-UTORid results: { added: string[], alreadyEnrolled: string[], invalid: string[] }
 *
 * Only this room's professor may call it.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { courseId } = await params;

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    // Verify professor role in this course
    const enrollment = await prisma.courseEnrollment.findUnique({
      where: { userId_courseId: { userId: user.userId, courseId } },
      select: { role: true },
    });
    if (!enrollment || enrollment.role !== "PROFESSOR") {
      return NextResponse.json(
        { error: "Only this room’s professor can add people to it." },
        { status: 403 }
      );
    }

    // Validate course exists
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true },
    });
    if (!course) {
      return NextResponse.json({ error: "Course not found." }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const { utorids, role: roleParam } = (body as Record<string, unknown>) ?? {};

    if (!Array.isArray(utorids) || utorids.length === 0) {
      return NextResponse.json({ error: "utorids must be a non-empty array." }, { status: 400 });
    }

    if (roleParam === "PROFESSOR") {
      return NextResponse.json(
        {
          error:
            "A room has one professor. Ask an admin to add another professor to the class — it creates them a room of their own.",
        },
        { status: 400 }
      );
    }

    const enrollmentRole: "STUDENT" | "TA" = roleParam === "TA" ? "TA" : "STUDENT";

    const added: string[] = [];
    const alreadyEnrolled: string[] = [];
    const invalid: string[] = [];

    for (const raw of utorids) {
      const utorid = typeof raw === "string" ? raw.trim().toLowerCase() : "";
      if (!utorid || utorid.length === 0) {
        invalid.push(String(raw));
        continue;
      }

      // User.role is NOT changed — it is always STUDENT. Roles are per room.
      const enrolledUser = await prisma.user.upsert({
        where: { utorid },
        update: {},
        create: {
          utorid,
          name: utorid,
          email: `${utorid}@mail.utoronto.ca`,
          role: "STUDENT",
        },
      });

      const existing = await prisma.courseEnrollment.findUnique({
        where: { userId_courseId: { userId: enrolledUser.id, courseId } },
      });

      if (existing) {
        // If the enrollment already exists with a different role, update it
        if (existing.role !== enrollmentRole) {
          await prisma.courseEnrollment.update({
            where: { userId_courseId: { userId: enrolledUser.id, courseId } },
            data: { role: enrollmentRole },
          });
          added.push(utorid);
        } else {
          alreadyEnrolled.push(utorid);
        }
      } else {
        await prisma.courseEnrollment.create({
          data: { userId: enrolledUser.id, courseId, role: enrollmentRole },
        });
        added.push(utorid);
      }
    }

    return NextResponse.json({ added, alreadyEnrolled, invalid });
  } catch (error) {
    console.error("[Courses API] Failed to add students:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/courses/[courseId]/students
// ---------------------------------------------------------------------------

/**
 * Syncs the full student roster from a CSV upload.
 *
 * Request body: { utorids: string[] } — the complete new student list.
 *
 * - Students in the new list but not enrolled → added as STUDENT
 * - Students currently enrolled as STUDENT but not in the new list → removed
 * - TAs and the professor are never touched.
 *
 * Returns: { added: string[], removed: string[], unchanged: number }
 *
 * Only this room's professor may call it.
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { courseId } = await params;

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const enrollment = await prisma.courseEnrollment.findUnique({
      where: { userId_courseId: { userId: user.userId, courseId } },
      select: { role: true },
    });
    if (!enrollment || enrollment.role !== "PROFESSOR") {
      return NextResponse.json(
        { error: "Only this room’s professor can sync its roster." },
        { status: 403 }
      );
    }

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true },
    });
    if (!course) {
      return NextResponse.json({ error: "Course not found." }, { status: 404 });
    }

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

    const newUtoridSet = new Set(
      (utorids as unknown[])
        .filter((u) => typeof u === "string" && u.trim().length > 0)
        .map((u) => (u as string).trim().toLowerCase())
    );

    // Fetch current STUDENT enrollments only
    const currentEnrollments = await prisma.courseEnrollment.findMany({
      where: { courseId, role: "STUDENT" },
      include: { user: { select: { id: true, utorid: true } } },
    });

    const currentUtoridToUserId = new Map(
      currentEnrollments.map((e) => [e.user.utorid, e.user.id])
    );
    const currentUtoridSet = new Set(currentUtoridToUserId.keys());

    const toAdd = [...newUtoridSet].filter((u) => !currentUtoridSet.has(u));
    const toRemove = [...currentUtoridSet].filter((u) => !newUtoridSet.has(u));
    const unchanged = [...currentUtoridSet].filter((u) => newUtoridSet.has(u)).length;

    const added: string[] = [];
    const removed: string[] = [];

    // Add new students
    for (const utorid of toAdd) {
      const enrolledUser = await prisma.user.upsert({
        where: { utorid },
        update: {},
        create: {
          utorid,
          name: utorid,
          email: `${utorid}@mail.utoronto.ca`,
          role: "STUDENT",
        },
      });

      // Never overwrite an existing PROFESSOR or TA enrollment — only create
      // new STUDENT enrollments or leave an already-STUDENT enrollment alone.
      // The professor appearing on a student CSV must stay the professor.
      const existingEnrollment = await prisma.courseEnrollment.findUnique({
        where: { userId_courseId: { userId: enrolledUser.id, courseId } },
        select: { role: true },
      });
      if (existingEnrollment && existingEnrollment.role !== "STUDENT") {
        // User is a PROFESSOR or TA in this course — skip silently.
        continue;
      }

      await prisma.courseEnrollment.upsert({
        where: { userId_courseId: { userId: enrolledUser.id, courseId } },
        update: {},
        create: { userId: enrolledUser.id, courseId, role: "STUDENT" },
      });
      added.push(utorid);
    }

    // Remove dropped students
    for (const utorid of toRemove) {
      const userId = currentUtoridToUserId.get(utorid);
      if (!userId) continue;
      await prisma.courseEnrollment.delete({
        where: { userId_courseId: { userId, courseId } },
      });
      removed.push(utorid);
    }

    return NextResponse.json({ added, removed, unchanged });
  } catch (error) {
    console.error("[Courses API] Failed to sync roster:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/courses/[courseId]/students
// ---------------------------------------------------------------------------

/**
 * Demotes a TA to STUDENT in this room. Demoting a student is a no-op.
 *
 * The row is demoted rather than deleted so the person stays reachable in a
 * live session instead of being kicked mid-lecture.
 *
 * Request body: { utorid: string }
 *
 * Only this room's professor may call it, and the professor themselves cannot
 * be demoted — see the guard below.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { courseId } = await params;

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const enrollment = await prisma.courseEnrollment.findUnique({
      where: { userId_courseId: { userId: user.userId, courseId } },
      select: { role: true },
    });
    if (!enrollment || enrollment.role !== "PROFESSOR") {
      return NextResponse.json(
        { error: "Only this room’s professor can remove people from it." },
        { status: 403 }
      );
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

    const normalizedUtorid = utorid.trim().toLowerCase();
    const target = await prisma.user.findUnique({
      where: { utorid: normalizedUtorid },
      select: { id: true },
    });
    if (!target) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const targetEnrollment = await prisma.courseEnrollment.findUnique({
      where: { userId_courseId: { userId: target.id, courseId } },
    });
    if (!targetEnrollment) {
      return NextResponse.json({ error: "User is not enrolled in this course." }, { status: 404 });
    }

    // The room's professor is the room. Demoting them would leave it with
    // nobody able to start a session and no label to show.
    if (targetEnrollment.role === "PROFESSOR") {
      return NextResponse.json(
        {
          error:
            "This room's professor cannot be removed here. An admin removes a professor from the class, which deletes their room.",
        },
        { status: 403 }
      );
    }

    // Demote to STUDENT rather than deleting the row — keeps them in live sessions.
    await prisma.courseEnrollment.update({
      where: { userId_courseId: { userId: target.id, courseId } },
      data: { role: "STUDENT" },
    });

    return NextResponse.json({ removed: normalizedUtorid });
  } catch (error) {
    console.error("[Courses API] Failed to remove student:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
