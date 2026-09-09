import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { validateSessionTitle } from "@/lib/sessionValidation";
import { createSession } from "@/lib/sessionService";
import { getCurrentUser } from "@/lib/auth";

/**
 * GET /api/sessions
 *
 * Returns active sessions for courses the user is enrolled in.
 * (Enrollment — not course.createdById — so co-professors see the same live session.)
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const sessions = await prisma.session.findMany({
      where: {
        status: "ACTIVE",
        course: { enrollments: { some: { userId: user.userId } } },
      },
      select: {
        id: true,
        title: true,
        joinCode: true,
        status: true,
        courseId: true,
        course: { select: { code: true, name: true } },
      },
      orderBy: { startTime: "desc" },
    });

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("[Sessions API] Failed to fetch sessions:", error);
    return NextResponse.json(
      { error: "An error occurred while fetching sessions." },
      { status: 500 }
    );
  }
}

/**
 * POST /api/sessions
 *
 * Creates a new session for a course.
 * Only professors enrolled in the course can create sessions.
 *
 * Request body:
 * - courseId: string (required) - The course to create the session for
 * - title: string (required) - Session title (3-100 characters)
 *
 * Returns:
 * - 201: Session created successfully
 * - 400: Invalid request body or validation error
 * - 401: Not authenticated
 * - 403: User is not a professor in the course
 * - 404: Course not found
 * - 500: Server error
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate from session cookie
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    // Parse request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Request body is required." }, { status: 400 });
    }

    const { courseId, title } = body as Record<string, unknown>;

    if (!courseId || typeof courseId !== "string") {
      return NextResponse.json({ error: "Course ID is required." }, { status: 400 });
    }

    const titleValidation = validateSessionTitle(title);
    if (!titleValidation.valid) {
      return NextResponse.json({ error: titleValidation.error }, { status: 400 });
    }

    const userId = user.userId;

    // Create session (includes professor role validation)
    const result = await createSession({ courseId, title: (title as string).trim(), userId });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.statusCode || 500 });
    }

    return NextResponse.json({ session: result.session }, { status: 201 });
  } catch (error) {
    console.error("[Sessions API] Failed to create session:", error);
    return NextResponse.json(
      { error: "An error occurred while creating the session." },
      { status: 500 }
    );
  }
}
