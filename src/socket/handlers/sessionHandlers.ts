import { type Server, type Socket } from "socket.io";

import { redisCache } from "@/lib/redis";
import { answerMode as answerModeKey } from "@/lib/redisKeys";
import {
  requireSocketEnrollment,
  requireSocketProfessor,
  NotEnrolledError,
  NotInstructorError,
  SessionNotFoundError,
} from "@/lib/sessionService";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANSWER_MODE_TTL_SECONDS = 86400; // 24 hours

type AnswerMode = "all" | "instructors_only";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AnswerModeChangePayload {
  sessionId: string;
  mode: AnswerMode;
}

interface AnswerModeSyncPayload {
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * Registers the `answer-mode:change` event listener on the given socket.
 *
 * Only professors (per-course CourseEnrollment) may change the answer mode.
 *
 * Guard order:
 *   1. Auth          — socket.data.userId must exist
 *   2. Payload shape — sessionId string, mode must be "all" or "instructors_only"
 *   3. Enrollment    — user must be a PROFESSOR in the session's course (CourseEnrollment)
 *   4. Persist       — mode written to Redis (24 h TTL)
 *   5. Broadcast     — emit answer-mode:changed to session:{sessionId}
 */
export function handleAnswerModeChange(socket: Socket, io: Server): void {
  socket.on("answer-mode:change", async (payload: AnswerModeChangePayload) => {
    try {
      // 1. Auth guard
      const userId: string | undefined = socket.data?.userId;
      if (!userId) {
        return;
      }

      // 2. Payload shape guard
      if (!payload || typeof payload !== "object") return;

      const { sessionId, mode } = payload;

      if (!sessionId || typeof sessionId !== "string") return;
      if (mode !== "all" && mode !== "instructors_only") return;

      // 3. Enrollment + role check — only this room's professor
      await requireSocketProfessor(userId, sessionId);

      // 4. Persist to Redis
      await redisCache.set(answerModeKey(sessionId), mode, "EX", ANSWER_MODE_TTL_SECONDS);

      // 5. Broadcast to all participants
      io.to(`session:${sessionId}`).emit("answer-mode:changed", { mode });
    } catch (error) {
      if (error instanceof NotEnrolledError || error instanceof NotInstructorError) {
        console.warn("[Security]", {
          userId: socket.data?.userId,
          sessionId: payload?.sessionId,
          action: "answer-mode:change",
          reason: error.name,
        });
      } else if (!(error instanceof SessionNotFoundError)) {
        console.error("[SessionHandler] Failed to process answer-mode:change:", error);
      }
    }
  });
}

/**
 * Registers the `answer-mode:sync` event listener on the given socket.
 *
 * Returns the current answer mode for the session so late joiners
 * get the correct state immediately.
 *
 * Guard order:
 *   1. Auth          — socket.data.userId must exist
 *   2. Payload shape — sessionId string
 *   3. Enrollment    — user must be enrolled in the session's course
 *   4. Redis lookup  — read persisted mode (defaults to "instructors_only" if not set)
 *   5. Reply         — emit answer-mode:changed back to the requesting socket only
 */
export function handleAnswerModeSync(socket: Socket): void {
  socket.on("answer-mode:sync", async (payload: AnswerModeSyncPayload) => {
    try {
      // 1. Auth guard
      const userId: string | undefined = socket.data?.userId;
      if (!userId) return;

      // 2. Payload shape guard
      if (!payload || typeof payload !== "object") return;

      const { sessionId } = payload;
      if (!sessionId || typeof sessionId !== "string") return;

      // 3. Enrollment check — must be enrolled in the session's course
      await requireSocketEnrollment(userId, sessionId);

      // 4. Read current mode from Redis (default to "instructors_only")
      const stored = await redisCache.get(answerModeKey(sessionId));
      const mode: AnswerMode =
        stored === "all" || stored === "instructors_only" ? stored : "instructors_only";

      // 5. Reply to requesting socket only
      socket.emit("answer-mode:changed", { mode });
    } catch (error) {
      if (!(error instanceof NotEnrolledError) && !(error instanceof SessionNotFoundError)) {
        console.error("[SessionHandler] Failed to process answer-mode:sync:", error);
      }
    }
  });
}
