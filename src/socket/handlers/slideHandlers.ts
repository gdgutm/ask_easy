import { type Server, type Socket } from "socket.io";

import { prisma } from "@/lib/prisma";
import { redisCache } from "@/lib/redis";
import { slideState } from "@/lib/redisKeys";
import { resolveSlideController, takeSlideControl } from "@/lib/slideControl";
import {
  requireSocketEnrollment,
  requireSocketProfessor,
  requireSocketProfessorOrTA,
  NotEnrolledError,
  NotInstructorError,
  SessionNotFoundError,
} from "@/lib/sessionService";
import type { SlideControlTakePayload, SlidesUploadedPayload } from "../types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SLIDE_STATE_TTL_SECONDS = 86400; // 24 hours

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SlideChangePayload {
  sessionId: string;
  pageIndex: number;
}

interface SlideSyncPayload {
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * Registers the `slide:change` event listener on the given socket.
 *
 * The professor and the TAs of the room share one deck and may all drive it.
 * Uploading it stays the professor's alone — see handleSlidesUploaded.
 *
 * Guard order (cheap-before-expensive):
 *   1. Auth          — socket.data.userId must exist
 *   2. Payload shape — sessionId must be a string, pageIndex a non-negative integer
 *   3. Enrollment    — user must be PROFESSOR or TA in the session's course
 *   4. Control       — and must be the one currently holding the deck
 *   5. Persist       — current page index written to Redis (24 h TTL)
 *   6. Broadcast     — emit slide:changed to session:{sessionId} (all participants)
 */
export function handleSlideChange(socket: Socket, io: Server): void {
  socket.on("slide:change", async (payload: SlideChangePayload) => {
    try {
      // 1. Auth guard
      const userId: string | undefined = socket.data?.userId;
      if (!userId) {
        socket.emit("slide:error", { message: "Authentication required." });
        return;
      }

      // 2. Payload shape guard
      if (!payload || typeof payload !== "object") {
        socket.emit("slide:error", { message: "Invalid request." });
        return;
      }

      const { sessionId, pageIndex } = payload;

      if (!sessionId || typeof sessionId !== "string") {
        socket.emit("slide:error", { message: "Session ID is required." });
        return;
      }

      if (typeof pageIndex !== "number" || !Number.isInteger(pageIndex) || pageIndex < 0) {
        socket.emit("slide:error", {
          message: "pageIndex must be a non-negative integer.",
        });
        return;
      }

      // 3. Enrollment + role check — the room's professor or one of its TAs
      const { courseId } = await requireSocketProfessorOrTA(userId, sessionId);

      // 4. Control check — being staff is not enough; someone else may be
      // driving, and their deck must not jump under them.
      const controllerId = await resolveSlideController(sessionId, courseId);
      if (controllerId !== userId) {
        socket.emit("slide:error", {
          message: "Someone else is controlling the slides. Take control to move them.",
        });
        return;
      }

      // 5. Persist current page to Redis with a 24-hour TTL
      await redisCache.set(slideState(sessionId), pageIndex, "EX", SLIDE_STATE_TTL_SECONDS);

      // 6. Broadcast to all participants in the session room
      io.to(`session:${sessionId}`).emit("slide:changed", { pageIndex });
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        socket.emit("slide:error", { message: "Session not found." });
      } else if (error instanceof NotEnrolledError) {
        console.warn("[Security]", {
          userId: socket.data?.userId,
          sessionId: payload?.sessionId,
          action: "slide:change",
          reason: "not enrolled",
        });
        socket.emit("slide:error", { message: "You are not enrolled in this session." });
      } else if (error instanceof NotInstructorError) {
        console.warn("[Security]", {
          userId: socket.data?.userId,
          sessionId: payload?.sessionId,
          action: "slide:change",
          reason: "not professor or TA",
        });
        socket.emit("slide:error", {
          message: "Only the professor and TAs can move the shared slides.",
        });
      } else {
        console.error("[SlideHandler] Failed to process slide:change:", error);
        socket.emit("slide:error", {
          message: "An error occurred while updating the slide position.",
        });
      }
    }
  });
}

/**
 * Registers the `slide:control:take` event listener on the given socket.
 *
 * Hands the deck to the caller, displacing whoever held it. The previous
 * holder's client drops to the following toolbar when the broadcast lands, and
 * keeps its own Control Slides button, so control can pass back and forth
 * without anyone having to release it first.
 *
 * Guard order:
 *   1. Auth          — socket.data.userId must exist
 *   2. Payload shape — sessionId must be a string
 *   3. Enrollment    — user must be PROFESSOR or TA in the session's course
 *   4. Claim         — write the holder to Redis (24 h TTL)
 *   5. Move          — pull the room to the new holder's page, if they sent one
 *   6. Broadcast     — emit slide:control:changed to the whole session room
 */
export function handleSlideControlTake(socket: Socket, io: Server): void {
  socket.on("slide:control:take", async (payload: SlideControlTakePayload) => {
    try {
      // 1. Auth guard
      const userId: string | undefined = socket.data?.userId;
      if (!userId) {
        socket.emit("slide:error", { message: "Authentication required." });
        return;
      }

      // 2. Payload shape guard
      if (!payload || typeof payload !== "object") {
        socket.emit("slide:error", { message: "Invalid request." });
        return;
      }

      const { sessionId, pageIndex } = payload;

      if (!sessionId || typeof sessionId !== "string") {
        socket.emit("slide:error", { message: "Session ID is required." });
        return;
      }

      // 3. Enrollment + role check — students never get the deck
      await requireSocketProfessorOrTA(userId, sessionId);

      // 4. Claim it
      await takeSlideControl(sessionId, userId);

      // 5. A takeover lands where the new holder was already looking, so the
      //    room follows them rather than stranding them on someone else's page.
      if (typeof pageIndex === "number" && Number.isInteger(pageIndex) && pageIndex >= 0) {
        await redisCache.set(slideState(sessionId), pageIndex, "EX", SLIDE_STATE_TTL_SECONDS);
        io.to(`session:${sessionId}`).emit("slide:changed", { pageIndex });
      }

      // 6. Tell the room who is driving — this is what moves the previous
      //    holder's toolbar back to the following view.
      const person = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });

      io.to(`session:${sessionId}`).emit("slide:control:changed", {
        controllerId: userId,
        controllerName: person?.name ?? "",
      });
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        socket.emit("slide:error", { message: "Session not found." });
      } else if (error instanceof NotEnrolledError) {
        console.warn("[Security]", {
          userId: socket.data?.userId,
          sessionId: payload?.sessionId,
          action: "slide:control:take",
          reason: "not enrolled",
        });
        socket.emit("slide:error", { message: "You are not enrolled in this session." });
      } else if (error instanceof NotInstructorError) {
        console.warn("[Security]", {
          userId: socket.data?.userId,
          sessionId: payload?.sessionId,
          action: "slide:control:take",
          reason: "not professor or TA",
        });
        socket.emit("slide:error", {
          message: "Only the professor and TAs can control the slides.",
        });
      } else {
        console.error("[SlideHandler] Failed to process slide:control:take:", error);
        socket.emit("slide:error", {
          message: "An error occurred while taking control of the slides.",
        });
      }
    }
  });
}

/**
 * Registers the `slides:uploaded` event listener on the given socket.
 *
 * Called by the professor's client after a successful PDF upload so that
 * all participants in the session room are notified and can load the new slides.
 *
 * Guard order:
 *   1. Auth          — socket.data.userId must exist
 *   2. Payload shape — sessionId and slideSetId must be strings
 *   3. Enrollment    — user must be the PROFESSOR of the session's room
 *   4. Broadcast     — emit slides:available to session:{sessionId}
 */
export function handleSlidesUploaded(socket: Socket, io: Server): void {
  socket.on("slides:uploaded", async (payload: SlidesUploadedPayload) => {
    try {
      // 1. Auth guard
      const userId: string | undefined = socket.data?.userId;
      if (!userId) {
        socket.emit("slide:error", { message: "Authentication required." });
        return;
      }

      // 2. Payload shape guard
      if (!payload || typeof payload !== "object") {
        socket.emit("slide:error", { message: "Invalid request." });
        return;
      }

      const { sessionId, slideSetId } = payload;

      if (!sessionId || typeof sessionId !== "string") {
        socket.emit("slide:error", { message: "Session ID is required." });
        return;
      }

      if (!slideSetId || typeof slideSetId !== "string") {
        socket.emit("slide:error", { message: "Slide set ID is required." });
        return;
      }

      // 3. Enrollment + role check — uploading is the professor's alone
      await requireSocketProfessor(userId, sessionId);

      // 4. Broadcast to all participants in the session room
      io.to(`session:${sessionId}`).emit("slides:available", { slideSetId });
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        socket.emit("slide:error", { message: "Session not found." });
      } else if (error instanceof NotEnrolledError) {
        console.warn("[Security]", {
          userId: socket.data?.userId,
          sessionId: payload?.sessionId,
          action: "slides:uploaded",
          reason: "not enrolled",
        });
        socket.emit("slide:error", { message: "You are not enrolled in this session." });
      } else if (error instanceof NotInstructorError) {
        console.warn("[Security]", {
          userId: socket.data?.userId,
          sessionId: payload?.sessionId,
          action: "slides:uploaded",
          reason: "not professor",
        });
        socket.emit("slide:error", { message: "Only professors can broadcast slide updates." });
      } else {
        console.error("[SlideHandler] Failed to process slides:uploaded:", error);
        socket.emit("slide:error", {
          message: "An error occurred while broadcasting slide availability.",
        });
      }
    }
  });
}

/**
 * Registers the `slide:sync` event listener on the given socket.
 *
 * Returns the room's last known page index — set by whichever of the
 * professor or TAs last moved the deck — so that late joiners and reconnecting
 * clients land on the page everyone else is on.
 *
 * Guard order:
 *   1. Auth          — socket.data.userId must exist
 *   2. Payload shape — sessionId must be a string
 *   3. Enrollment    — user must be enrolled in the session's course
 *   4. Redis lookup  — read persisted page index (defaults to 0 if not set)
 *   5. Reply         — emit slide:sync back to the requesting socket only
 */
export function handleSlideSync(socket: Socket): void {
  socket.on("slide:sync", async (payload: SlideSyncPayload) => {
    try {
      // 1. Auth guard
      const userId: string | undefined = socket.data?.userId;
      if (!userId) {
        socket.emit("slide:error", { message: "Authentication required." });
        return;
      }

      // 2. Payload shape guard
      if (!payload || typeof payload !== "object") {
        socket.emit("slide:error", { message: "Invalid request." });
        return;
      }

      const { sessionId } = payload;

      if (!sessionId || typeof sessionId !== "string") {
        socket.emit("slide:error", { message: "Session ID is required." });
        return;
      }

      // 3. Enrollment check — must be enrolled in the session's course
      const { courseId } = await requireSocketEnrollment(userId, sessionId);

      // 4. Read current page index from Redis
      const stored = await redisCache.get(slideState(sessionId));
      const pageIndex = stored !== null ? parseInt(stored, 10) : 0;

      // 5. Reply only to the requesting socket, with who is driving so the
      //    toolbar renders correctly on a late join or a reconnect.
      const controllerId = await resolveSlideController(sessionId, courseId);
      socket.emit("slide:sync", { pageIndex, controllerId });
    } catch (error) {
      if (error instanceof NotEnrolledError || error instanceof SessionNotFoundError) {
        socket.emit("slide:error", { message: "You are not enrolled in this session." });
      } else {
        console.error("[SlideHandler] Failed to process slide:sync:", error);
        socket.emit("slide:error", {
          message: "An error occurred while syncing the slide position.",
        });
      }
    }
  });
}
