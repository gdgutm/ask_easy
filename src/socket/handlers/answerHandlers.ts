import { type Server, type Socket } from "socket.io";

import { prisma } from "@/lib/prisma";
import { redisCache } from "@/lib/redis";
import { answerMode as answerModeKey } from "@/lib/redisKeys";
import {
  validateAnswerContent,
  checkAnswerRateLimit,
  answerRetryAfter,
  validateQuestionForAnswers,
} from "@/lib/answerValidation";
import { checkUpvoteRateLimit, upvoteRetryAfter } from "@/lib/questionValidation";
import type { AnswerCreatedPayload } from "@/socket/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AnswerCreatePayload {
  questionId: string;
  content: string;
  isAnonymous?: boolean;
}

interface AnswerUpvotePayload {
  answerId: string;
}

interface AnswerDeletePayload {
  answerId: string;
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Broadcasts a newly created answer to the session room.
 *
 * Answers are always broadcast to all users in the session (no visibility filtering).
 *
 * When `authorSocket` is in the room it receives a copy flagged `isMine`
 * instead of the shared payload, so the author can still act on an anonymous
 * answer whose identity was stripped from the broadcast.
 */
export function broadcastAnswer(
  io: Server,
  sessionId: string,
  answer: AnswerCreatedPayload,
  authorSocket?: Socket
): void {
  const room = `session:${sessionId}`;

  if (authorSocket?.rooms.has(room)) {
    authorSocket.to(room).emit("answer:created", answer);
    authorSocket.emit("answer:created", { ...answer, isMine: true });
    return;
  }

  io.to(room).emit("answer:created", answer);
}

/**
 * Registers the `answer:create` event listener on the given socket.
 *
 * Guard order:
 *   1. Auth          — socket.data.userId must exist (set by auth middleware)
 *   2. Payload shape — must be a non-null object
 *   3. Question      — must exist in the DB and belong to an active session
 *   4. Content       — length bounds via validateAnswerContent
 *   5. Rate limit    — 5 answers / 10 s per user, enforced in Redis
 *   6. Persist       — answer written to the database
 *   7. Broadcast     — emitted to the session room
 *
 * Note: Question validation before rate limit prevents exhausting rate limit
 * quota on invalid requests (e.g., non-existent questions).
 */
export function handleAnswerCreate(socket: Socket, io: Server): void {
  socket.on("answer:create", async (payload: AnswerCreatePayload) => {
    try {
      // 1. Auth guard — userId is attached by socket auth middleware
      const userId: string | undefined = socket.data?.userId;
      if (!userId) {
        socket.emit("answer:error", { message: "Authentication required." });
        return;
      }

      // 2. Payload shape guard — socket events can arrive with any shape
      if (!payload || typeof payload !== "object") {
        socket.emit("answer:error", { message: "Invalid request." });
        return;
      }

      // 3. Question validation — check early to avoid exhausting rate limit on invalid questions
      const questionValidation = await validateQuestionForAnswers(payload.questionId);
      if (!questionValidation.valid) {
        socket.emit("answer:error", { message: questionValidation.error });
        return;
      }

      // 3a. Enrollment check — verify the user is enrolled in the session's course
      const sessionId = questionValidation.question!.sessionId;
      const sessionRecord = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { courseId: true },
      });
      const answerEnrollment = sessionRecord
        ? await prisma.courseEnrollment.findUnique({
            where: { userId_courseId: { userId, courseId: sessionRecord.courseId } },
            select: { role: true },
          })
        : null;
      if (!answerEnrollment) {
        socket.emit("answer:error", { message: "You are not enrolled in this session." });
        return;
      }

      // 4. Answer mode check — if restricted, only TAs, professors, and the
      //    question's own author may answer (so a student can follow up in their
      //    thread, including when the question was anonymous — keep the anon
      //    toggle on to stay anonymous). Role is resolved via CourseEnrollment
      //    so TAs are correctly detected (User.role is always STUDENT for TAs).
      const mode = await redisCache.get(answerModeKey(sessionId));
      if (mode === "instructors_only") {
        const isQuestionAuthor = questionValidation.question!.authorId === userId;
        if (!isQuestionAuthor) {
          const effectiveRole = answerEnrollment?.role ?? "STUDENT";
          if (effectiveRole === "STUDENT") {
            socket.emit("answer:error", {
              message: "The professor has restricted answers to TAs and professors only.",
            });
            return;
          }
        }
      }

      // 5. Content validation (renumbered)
      const contentValidation = validateAnswerContent(payload.content);
      if (!contentValidation.valid) {
        socket.emit("answer:error", { message: contentValidation.error });
        return;
      }

      // 6. Rate limit — only increment after validating question exists
      const isRateLimited = await checkAnswerRateLimit(userId);
      if (isRateLimited) {
        socket.emit("answer:error", {
          message: "Too many answers.",
          code: "RATE_LIMITED",
          retryAfterSeconds: await answerRetryAfter(userId),
        });
        return;
      }

      // 7. Persist to database
      const answer = await prisma.answer.create({
        data: {
          questionId: payload.questionId,
          authorId: userId,
          content: payload.content.trim(),
          isAnonymous: payload.isAnonymous ?? false,
        },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              utorid: true,
              role: true,
            },
          },
        },
      });

      // 8. Build broadcast payload and emit to the session room.
      // Use answerEnrollment.role (CourseEnrollment) rather than answer.author.role
      // (User.role) because User.role is always "STUDENT" for TAs — the per-course
      // enrollment is the source of truth for role-based UI (e.g. instructor badge).
      const broadcastPayload: AnswerCreatedPayload = {
        id: answer.id,
        questionId: answer.questionId,
        content: answer.content,
        isAnonymous: answer.isAnonymous,
        ...(answer.isAnonymous
          ? {}
          : {
              authorId: answer.author.id,
              authorName: answer.author.name,
              authorUtorid: answer.author.utorid,
            }),
        authorRole: answerEnrollment!.role as AnswerCreatedPayload["authorRole"],
        isAccepted: answer.isAccepted,
        createdAt: answer.createdAt,
      };

      broadcastAnswer(io, questionValidation.question!.sessionId, broadcastPayload, socket);

      // For anonymous answers, reveal the author to instructors via a separate event.
      if (answer.isAnonymous) {
        io.to(`session:${questionValidation.question!.sessionId}:instructors`).emit(
          "answer:author:revealed",
          {
            id: answer.id,
            questionId: answer.questionId,
            authorId: answer.author.id,
            authorName: answer.author.name,
            authorUtorid: answer.author.utorid,
            authorRole: answerEnrollment!.role as "STUDENT" | "TA" | "PROFESSOR",
          }
        );
      }
    } catch (error) {
      console.error("[AnswerHandler] Failed to create answer:", error);
      socket.emit("answer:error", {
        message: "An error occurred while creating your answer.",
      });
    }
  });
}

/**
 * Registers the `answer:upvote` event listener on the given socket.
 *
 * Guard order:
 *   1. Auth          — socket.data.userId must exist
 *   2. Payload shape — must be a non-null object with answerId
 *   3. Rate limit    — shared upvote rate limit (10 / 10 s per user)
 *   4. Toggle        — create or delete AnswerUpvote, adjust upvoteCount
 *   5. Broadcast     — emitted to the session room as answer:updated
 */
export function handleAnswerUpvote(socket: Socket, io: Server): void {
  socket.on("answer:upvote", async (payload: AnswerUpvotePayload) => {
    try {
      // 1. Auth guard
      const userId: string | undefined = socket.data?.userId;
      if (!userId) {
        socket.emit("answer:error", { message: "Authentication required." });
        return;
      }

      // 2. Payload shape guard
      if (!payload || typeof payload !== "object") {
        socket.emit("answer:error", { message: "Invalid request." });
        return;
      }

      const { answerId } = payload;
      if (!answerId || typeof answerId !== "string") {
        socket.emit("answer:error", { message: "Answer ID is required." });
        return;
      }

      // 3. Rate limit — shared across question and answer upvotes
      const isRateLimited = await checkUpvoteRateLimit(userId);
      if (isRateLimited) {
        socket.emit("answer:error", {
          message: "Too many upvotes.",
          code: "RATE_LIMITED",
          retryAfterSeconds: await upvoteRetryAfter(userId),
        });
        return;
      }

      // 4. Fetch answer with question + session context (including courseId for enrollment check)
      const answer = await prisma.answer.findUnique({
        where: { id: answerId },
        select: {
          id: true,
          questionId: true,
          upvoteCount: true,
          question: {
            select: {
              sessionId: true,
              session: { select: { courseId: true } },
            },
          },
        },
      });

      if (!answer) {
        socket.emit("answer:error", { message: "Answer not found." });
        return;
      }

      // 4a. Enrollment check
      const upvoteEnrollment = await prisma.courseEnrollment.findUnique({
        where: {
          userId_courseId: { userId, courseId: answer.question.session.courseId },
        },
        select: { role: true },
      });
      if (!upvoteEnrollment) {
        socket.emit("answer:error", { message: "You are not enrolled in this session." });
        return;
      }

      // 5. Toggle upvote in a transaction
      const existingUpvote = await prisma.answerUpvote.findUnique({
        where: { answerId_userId: { answerId, userId } },
      });

      let updatedAnswer;

      if (existingUpvote) {
        [, updatedAnswer] = await prisma.$transaction([
          prisma.answerUpvote.delete({ where: { id: existingUpvote.id } }),
          prisma.answer.update({
            where: { id: answerId },
            data: { upvoteCount: { decrement: 1 } },
            select: { id: true, questionId: true, upvoteCount: true },
          }),
        ]);
      } else {
        [, updatedAnswer] = await prisma.$transaction([
          prisma.answerUpvote.create({ data: { answerId, userId } }),
          prisma.answer.update({
            where: { id: answerId },
            data: { upvoteCount: { increment: 1 } },
            select: { id: true, questionId: true, upvoteCount: true },
          }),
        ]);
      }

      // 6. Broadcast to the session room
      io.to(`session:${answer.question.sessionId}`).emit("answer:updated", {
        id: updatedAnswer.id,
        questionId: updatedAnswer.questionId,
        upvoteCount: updatedAnswer.upvoteCount,
      });
    } catch (error) {
      console.error("[AnswerHandler] Failed to toggle upvote:", error);
      socket.emit("answer:error", {
        message: "An error occurred while processing your upvote.",
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Deleting
// ---------------------------------------------------------------------------

/**
 * Registers the `answer:delete` event listener on the given socket.
 *
 * Permission rules (same as question delete):
 *   - Anyone    → may delete their own answer, whatever their role
 *   - PROFESSOR → may delete any answer
 *   - TA        → may additionally delete any STUDENT's answer
 *   - STUDENT   → nothing beyond their own
 */
export function handleAnswerDelete(socket: Socket, io: Server): void {
  socket.on("answer:delete", async (payload: AnswerDeletePayload) => {
    try {
      // 1. Auth guard
      const userId: string | undefined = socket.data?.userId;
      if (!userId) {
        socket.emit("answer:error", { message: "Authentication required." });
        return;
      }

      // 2. Payload shape guard
      if (
        !payload ||
        typeof payload !== "object" ||
        typeof payload.answerId !== "string" ||
        typeof payload.sessionId !== "string"
      ) {
        socket.emit("answer:error", { message: "Invalid request." });
        return;
      }

      const { answerId, sessionId } = payload;

      // 3. Fetch answer + question + session (for courseId and questionId)
      const answer = await prisma.answer.findUnique({
        where: { id: answerId },
        select: {
          id: true,
          authorId: true,
          questionId: true,
          question: {
            select: {
              sessionId: true,
              session: { select: { courseId: true } },
            },
          },
        },
      });

      if (!answer || answer.question.sessionId !== sessionId) {
        socket.emit("answer:error", { message: "Answer not found." });
        return;
      }

      const courseId = answer.question.session.courseId;

      // 4. Resolve the requester's per-course role
      const requesterEnrollment = await prisma.courseEnrollment.findUnique({
        where: { userId_courseId: { userId, courseId } },
        select: { role: true },
      });

      const requesterRole = requesterEnrollment?.role ?? "STUDENT";

      // 5. Permission check — authors may always delete their own answer
      const isOwn = answer.authorId === userId;
      if (!isOwn) {
        if (requesterRole === "STUDENT") {
          socket.emit("answer:error", {
            message: "You do not have permission to delete this answer.",
          });
          return;
        }

        if (requesterRole === "TA") {
          const authorEnrollment = await prisma.courseEnrollment.findUnique({
            where: { userId_courseId: { userId: answer.authorId, courseId } },
            select: { role: true },
          });
          const authorRole = authorEnrollment?.role ?? "STUDENT";
          if (authorRole !== "STUDENT") {
            socket.emit("answer:error", {
              message: "You do not have permission to delete this answer.",
            });
            return;
          }
        }
      }

      // 6. Delete (upvotes cascade via schema)
      await prisma.answer.delete({ where: { id: answerId } });

      // 7. Broadcast to the session room
      io.to(`session:${sessionId}`).emit("answer:deleted", {
        answerId,
        questionId: answer.questionId,
      });
    } catch (error) {
      console.error("[AnswerHandler] Failed to delete answer:", error);
      socket.emit("answer:error", {
        message: "An error occurred while deleting the answer.",
      });
    }
  });
}
