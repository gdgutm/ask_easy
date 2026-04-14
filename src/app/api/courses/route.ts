import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCurrentSemester(): string {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-indexed
  const year = now.getFullYear();
  if (month <= 4) return `Winter ${year}`;
  if (month <= 8) return `Summer ${year}`;
  return `Fall ${year}`;
}

// ---------------------------------------------------------------------------
// GET /api/courses
// ---------------------------------------------------------------------------

/**
 * Returns all courses the authenticated user is enrolled in (any role).
 *
 * Response: { courses: [{ id, code, name, semester, role, createdById }] }
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const enrollments = await prisma.courseEnrollment.findMany({
      where: { userId: user.userId },
      include: {
        course: {
          select: {
            id: true,
            code: true,
            name: true,
            semester: true,
            createdById: true,
          },
        },
      },
    });

    const courses = enrollments.map((e) => ({
      ...e.course,
      role: e.role,
    }));

    return NextResponse.json({ courses });
  } catch (error) {
    console.error("[Courses API] Failed to fetch courses:", error);
    return NextResponse.json(
      { error: "An error occurred while fetching courses." },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/courses
// ---------------------------------------------------------------------------

/**
 * Creates a new course and enrolls the professor + all students from the
 * parsed U of T classlist CSV.
 *
 * Request body:
 *   {
 *     code:     string                              // e.g. "CSC398H5"
 *     students: Array<{                             // from parseAndProcessCSV
 *       utorid:    string,
 *       givenName: string,
 *       surname:   string,
 *       Email?:    string,
 *       [key]:     string                           // other CSV columns
 *     }>
 *   }
 *
 * Only PROFESSOR-role users may call this endpoint.
 *
 * Response: { course: { id, code, name, semester } }
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    if (user.role !== "PROFESSOR") {
      return NextResponse.json({ error: "Only professors can create courses." }, { status: 403 });
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

    const { code, section, students, tas } = body as Record<string, unknown>;

    if (!code || typeof code !== "string" || code.trim().length === 0) {
      return NextResponse.json({ error: "Course code is required." }, { status: 400 });
    }

    if (!Array.isArray(students)) {
      return NextResponse.json({ error: "Students list is required." }, { status: 400 });
    }

    const tasArray: string[] = Array.isArray(tas)
      ? (tas as unknown[])
          .map((t) => (typeof t === "string" ? t.trim().toLowerCase() : ""))
          .filter(Boolean)
      : [];

    const semester = getCurrentSemester();
    const courseCode = code.trim();
    const courseName =
      typeof section === "string" && section.trim()
        ? `${courseCode} ${section.trim()}`
        : courseCode;

    // Create the course and enroll the professor in one transaction
    const course = await prisma.$transaction(async (tx) => {
      // Ensure the professor exists in the DB (in case of a system wipe)
      await tx.user.upsert({
        where: { id: user.userId },
        update: {},
        create: {
          id: user.userId,
          utorid: user.utorid,
          email: user.email,
          name: user.name,
          role: "PROFESSOR",
        },
      });

      const newCourse = await tx.course.create({
        data: {
          code: courseCode,
          name: courseName,
          semester,
          createdById: user.userId,
        },
      });

      // Enroll the professor
      await tx.courseEnrollment.create({
        data: {
          userId: user.userId,
          courseId: newCourse.id,
          role: "PROFESSOR",
        },
      });

      // Batch-upsert each student and enroll them
      for (const student of students) {
        const s = student as Record<string, string>;
        const utorid = s.utorid?.trim();
        if (!utorid || utorid === "Missing UTORid" || utorid === "ERROR") continue;

        const name = `${s.givenName ?? ""} ${s.surname ?? ""}`.trim() || utorid;

        const studentUser = await tx.user.upsert({
          where: { utorid },
          update: { name },
          create: { utorid, name, email: `${utorid}@mail.utoronto.ca`, role: "STUDENT" },
        });

        // Skip if already enrolled (e.g. student in multiple sections)
        await tx.courseEnrollment.upsert({
          where: {
            userId_courseId: { userId: studentUser.id, courseId: newCourse.id },
          },
          update: {},
          create: {
            userId: studentUser.id,
            courseId: newCourse.id,
            role: "STUDENT",
          },
        });
      }

      // Enroll TAs (CourseEnrollment.role = "TA"; User.role is NOT changed)
      for (const utorid of tasArray) {
        const taUser = await tx.user.upsert({
          where: { utorid },
          update: {},
          create: {
            utorid,
            name: utorid,
            email: `${utorid}@mail.utoronto.ca`,
            role: "STUDENT",
          },
        });

        await tx.courseEnrollment.upsert({
          where: {
            userId_courseId: { userId: taUser.id, courseId: newCourse.id },
          },
          update: { role: "TA" },
          create: {
            userId: taUser.id,
            courseId: newCourse.id,
            role: "TA",
          },
        });
      }

      return newCourse;
    });

    return NextResponse.json(
      {
        course: { id: course.id, code: course.code, name: course.name, semester: course.semester },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[Courses API] Failed to create course:", error);
    return NextResponse.json(
      { error: "An error occurred while creating the course." },
      { status: 500 }
    );
  }
}
