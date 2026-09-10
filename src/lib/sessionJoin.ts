import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionLookupResult {
  success: boolean;
  error?: string;
  statusCode?: number;
  session?: {
    id: string;
    title: string;
    status: string;
    courseId: string;
    course: {
      id: string;
      code: string;
      name: string;
    };
  };
}

export interface SessionJoinResult {
  success: boolean;
  error?: string;
  statusCode?: number;
  enrollment?: {
    id: string;
    userId: string;
    courseId: string;
    role: string;
  };
  session?: {
    id: string;
    title: string;
    status: string;
  };
}

// ---------------------------------------------------------------------------
// Service Functions
// ---------------------------------------------------------------------------

/**
 * Looks up a session by join code (case-insensitive).
 *
 * @param code - The join code to look up
 * @returns Session info or error
 */
export async function lookupSessionByCode(code: string): Promise<SessionLookupResult> {
  const session = await prisma.session.findFirst({
    where: {
      joinCode: {
        equals: code,
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      title: true,
      status: true,
      courseId: true,
      course: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
    },
  });

  if (!session) {
    return {
      success: false,
      error: "Session not found.",
      statusCode: 404,
    };
  }

  return {
    success: true,
    session,
  };
}

/**
 * Joins a user to a session by creating a CourseEnrollment.
 *
 * @param code - The join code of the session
 * @param userId - The user ID to enroll
 * @returns Enrollment info or error
 */
export async function joinSession(code: string, userId: string): Promise<SessionJoinResult> {
  // Look up session by code (case-insensitive)
  const session = await prisma.session.findFirst({
    where: {
      joinCode: {
        equals: code,
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      title: true,
      status: true,
      courseId: true,
    },
  });

  if (!session) {
    return {
      success: false,
      error: "Session not found.",
      statusCode: 404,
    };
  }

  // Check if session has ended
  if (session.status === "ENDED") {
    return {
      success: false,
      error: "This session has ended.",
      statusCode: 410,
    };
  }

  // Check if user is already enrolled in the course
  const existingEnrollment = await prisma.courseEnrollment.findUnique({
    where: {
      userId_courseId: {
        userId,
        courseId: session.courseId,
      },
    },
  });

  if (existingEnrollment) {
    return {
      success: false,
      error: "You are already enrolled in this course.",
      statusCode: 409,
    };
  }

  // A professor runs one room and cannot see the others on the same class.
  // A join code would otherwise walk straight around that, enrolling them in a
  // colleague's room as a student.
  const room = await prisma.course.findUnique({
    where: { id: session.courseId },
    select: { classlistId: true },
  });

  if (room?.classlistId) {
    const ownsAnotherRoom = await prisma.course.findFirst({
      where: {
        classlistId: room.classlistId,
        professorId: userId,
        id: { not: session.courseId },
      },
      select: { id: true },
    });

    if (ownsAnotherRoom) {
      return {
        success: false,
        error: "You run your own room on this class, so you cannot join another one.",
        statusCode: 403,
      };
    }
  }

  // Create enrollment as STUDENT
  const enrollment = await prisma.courseEnrollment.create({
    data: {
      userId,
      courseId: session.courseId,
      role: "STUDENT",
    },
    select: {
      id: true,
      userId: true,
      courseId: true,
      role: true,
    },
  });

  return {
    success: true,
    enrollment,
    session: {
      id: session.id,
      title: session.title,
      status: session.status,
    },
  };
}
