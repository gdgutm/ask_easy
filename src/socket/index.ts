import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";

import { prisma } from "@/lib/prisma";
import { authMiddleware } from "./middleware/auth";
import {
  handleQuestionCreate,
  handleQuestionUpvote,
  handleQuestionResolve,
  handleQuestionUnresolve,
  handleQuestionDelete,
} from "./handlers/questionHandlers";
import {
  handleAnswerCreate,
  handleAnswerUpvote,
  handleAnswerDelete,
} from "./handlers/answerHandlers";
import { handleSlideChange, handleSlideSync, handleSlidesUploaded } from "./handlers/slideHandlers";
import { handleAnswerModeChange, handleAnswerModeSync } from "./handlers/sessionHandlers";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from "./types";

// ---------------------------------------------------------------------------
// Module-level singleton
// ---------------------------------------------------------------------------

let io: SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
> | null = null;

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Create and attach a Socket.IO server to the given HTTP server.
 *
 * - Configures the Redis adapter for horizontal scaling.
 * - Registers the authentication middleware.
 * - Wires up connection / disconnection logging and event handlers.
 *
 * Returns the fully initialised `io` instance.
 */
export async function initSocketIO(
  httpServer: HttpServer
): Promise<
  SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>
> {
  const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

  io = new SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    cors: {
      origin: process.env.NODE_ENV === "production" ? false : "*",
    },
    connectionStateRecovery: {},
  });

  // -----------------------------------------------------------------------
  // Redis adapter — two dedicated clients (pub + sub). Optional in dev.
  // -----------------------------------------------------------------------

  const useRedisAdapter = process.env.SOCKET_IO_USE_REDIS !== "false";
  let pubClient: Redis | null = null;
  let subClient: Redis | null = null;

  if (useRedisAdapter) {
    try {
      pubClient = new Redis(REDIS_URL);
      subClient = new Redis(REDIS_URL);

      await Promise.all([
        new Promise<void>((resolve, reject) => {
          pubClient!.on("ready", resolve);
          pubClient!.on("error", reject);
        }),
        new Promise<void>((resolve, reject) => {
          subClient!.on("ready", resolve);
          subClient!.on("error", reject);
        }),
      ]);

      io.adapter(createAdapter(pubClient!, subClient!));
      console.log("[Socket.IO] Redis adapter connected");

      pubClient.on("error", (err) =>
        console.error("[Socket.IO] Redis pub client error:", err.message)
      );
      subClient.on("error", (err) =>
        console.error("[Socket.IO] Redis sub client error:", err.message)
      );
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          "[Socket.IO] Redis unavailable, running without adapter (single-instance only):",
          err instanceof Error ? err.message : err
        );
        pubClient?.quit().catch(() => {});
        subClient?.quit().catch(() => {});
        pubClient = null;
        subClient = null;
      } else {
        throw err;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Authentication middleware
  // -----------------------------------------------------------------------

  io.use(authMiddleware);

  // -----------------------------------------------------------------------
  // Connection handler
  // -----------------------------------------------------------------------

  /**
   * The professor running the room is not one of its viewers. Roles are per
   * course, so this reads the enrollment role recorded at session:join —
   * the global cookie role is always STUDENT and would count everyone.
   */
  async function countViewers(sessionId: string): Promise<number> {
    const sockets = await io!.in(`session:${sessionId}`).fetchSockets();
    return sockets.filter((s) => s.data.currentSessionRole !== "PROFESSOR").length;
  }

  async function broadcastViewerCount(sessionId: string) {
    io!.to(`session:${sessionId}`).emit("viewer:count", { count: await countViewers(sessionId) });
  }

  io.on("connection", (socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id} (user: ${socket.data.userId})`);

    // Session room management
    socket.on("session:join", async (payload, ack) => {
      if (payload?.sessionId && typeof payload.sessionId === "string") {
        const userId = socket.data.userId;

        // Verify the session exists and the user is enrolled in the course.
        const sessionRecord = await prisma.session.findUnique({
          where: { id: payload.sessionId },
          select: { courseId: true },
        });

        if (!sessionRecord) {
          socket.emit("question:error", { message: "Session not found." });
          if (typeof ack === "function") ack("Session not found.");
          return;
        }

        let enrollment: { role: string } | null = null;
        if (userId) {
          enrollment = await prisma.courseEnrollment.findUnique({
            where: {
              userId_courseId: {
                userId,
                courseId: sessionRecord.courseId,
              },
            },
            select: { role: true },
          });
        }

        if (!enrollment) {
          console.warn("[Security]", {
            userId,
            sessionId: payload.sessionId,
            action: "session:join",
            reason: "not enrolled",
          });
          socket.emit("question:error", { message: "You are not enrolled in this session." });
          if (typeof ack === "function") ack("Not enrolled.");
          return;
        }

        if (socket.data.currentSessionId && socket.data.currentSessionId !== payload.sessionId) {
          const previous = socket.data.currentSessionId;
          socket.leave(`session:${previous}`);
          // The instructor room has to go too: a professor switching to a room
          // where they are a student would otherwise keep receiving the old
          // room's INSTRUCTOR_ONLY questions.
          socket.leave(`session:${previous}:instructors`);
          await broadcastViewerCount(previous);
        }

        socket.join(`session:${payload.sessionId}`);
        socket.data.currentSessionId = payload.sessionId;
        socket.data.currentSessionRole = enrollment.role as SocketData["currentSessionRole"];
        console.log(`[Socket.IO] ${socket.id} joined session:${payload.sessionId}`);

        // Join the instructor room if the user is a TA or PROFESSOR in this course,
        // so that INSTRUCTOR_ONLY questions are delivered to them in real-time.
        if (enrollment.role === "PROFESSOR" || enrollment.role === "TA") {
          socket.join(`session:${payload.sessionId}:instructors`);
        }

        await broadcastViewerCount(payload.sessionId);
        if (typeof ack === "function") ack();
      }
    });

    socket.on("viewer:sync", async (payload) => {
      if (payload?.sessionId && typeof payload.sessionId === "string") {
        const userId = socket.data.userId;
        if (!userId) return;

        // Enrollment check — must be enrolled in the session's course
        const syncSession = await prisma.session.findUnique({
          where: { id: payload.sessionId },
          select: { courseId: true },
        });
        if (!syncSession) return;

        const syncEnrollment = await prisma.courseEnrollment.findUnique({
          where: { userId_courseId: { userId, courseId: syncSession.courseId } },
          select: { role: true },
        });
        if (!syncEnrollment) return;

        socket.emit("viewer:count", { count: await countViewers(payload.sessionId) });
      }
    });

    socket.on("session:leave", async (payload) => {
      if (payload?.sessionId && typeof payload.sessionId === "string") {
        socket.leave(`session:${payload.sessionId}`);
        socket.leave(`session:${payload.sessionId}:instructors`);
        if (socket.data.currentSessionId === payload.sessionId) {
          socket.data.currentSessionId = undefined;
          socket.data.currentSessionRole = undefined;
        }
        console.log(`[Socket.IO] ${socket.id} left session:${payload.sessionId}`);

        await broadcastViewerCount(payload.sessionId);
      }
    });

    // Register per-socket event handlers
    handleQuestionCreate(socket, io!);
    handleQuestionUpvote(socket, io!);
    handleQuestionResolve(socket, io!);
    handleQuestionUnresolve(socket, io!);
    handleQuestionDelete(socket, io!);
    handleAnswerCreate(socket, io!);
    handleAnswerUpvote(socket, io!);
    handleAnswerDelete(socket, io!);
    handleSlideChange(socket, io!);
    handleSlideSync(socket);
    handleSlidesUploaded(socket, io!);
    handleAnswerModeChange(socket, io!);
    handleAnswerModeSync(socket);

    socket.on("disconnect", async (reason) => {
      console.log(`[Socket.IO] Client disconnected: ${socket.id} (reason: ${reason})`);
      const sessionId = socket.data.currentSessionId;
      if (sessionId) {
        await broadcastViewerCount(sessionId);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Graceful shutdown — close adapter Redis clients
  // -----------------------------------------------------------------------

  const shutdown = async () => {
    if (pubClient || subClient) {
      console.log("[Socket.IO] Shutting down Redis adapter clients…");
      await Promise.all([pubClient?.quit().catch(() => {}), subClient?.quit().catch(() => {})]);
    }
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return io;
}

// ---------------------------------------------------------------------------
// Accessor
// ---------------------------------------------------------------------------

/**
 * Return the Socket.IO server singleton.
 *
 * Throws if called before `initSocketIO()`.
 */
export function getIO(): SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
> {
  if (!io) {
    throw new Error("Socket.IO has not been initialised. Call initSocketIO() first.");
  }
  return io;
}
