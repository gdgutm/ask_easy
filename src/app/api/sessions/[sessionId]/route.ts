import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAndAutoEnd, getSessionMembership, performSessionEnd } from "@/lib/sessionService";

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

/**
 * GET /api/sessions/[sessionId]
 *
 * Returns the status of a session. Used by clients to poll for ended sessions.
 */
export async function GET(_req: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true, status: true, courseId: true },
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    // Enrollment check — non-professors may only query sessions for courses they belong to.
    // Return 404 (not 403) to avoid leaking the existence of sessions.
    if (user.role !== "PROFESSOR") {
      const enrollment = await prisma.courseEnrollment.findUnique({
        where: { userId_courseId: { userId: user.userId, courseId: session.courseId } },
        select: { role: true },
      });
      if (!enrollment) {
        return NextResponse.json({ error: "Session not found." }, { status: 404 });
      }
    }

    // Auto-end the session if it has been inactive for too long, then re-read
    // status so the response reflects the updated state.
    if (session.status === "ACTIVE") {
      const wasEnded = await checkAndAutoEnd(sessionId);
      if (wasEnded) {
        return NextResponse.json({ status: "ENDED" });
      }
    }

    return NextResponse.json({ status: session.status, courseId: session.courseId });
  } catch (error) {
    console.error("[Sessions API] Failed to fetch session status:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}

/**
 * PATCH /api/sessions/[sessionId]
 *
 * Ends an active session. Only the professor of the course can end it.
 * Broadcasts `session:ended` via Socket.IO so all connected clients redirect.
 */
export async function PATCH(_req: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const membership = await getSessionMembership(sessionId, user.userId);
    if (!membership.valid || membership.role !== "PROFESSOR") {
      return NextResponse.json(
        { error: "Only the professor can end this session." },
        { status: 403 }
      );
    }

    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }
    if (session.status === "ENDED") {
      return NextResponse.json({ error: "Session is already ended." }, { status: 409 });
    }

    await performSessionEnd(sessionId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Sessions API] Failed to end session:", error);
    return NextResponse.json(
      { error: "An error occurred while ending the session." },
      { status: 500 }
    );
  }
}
