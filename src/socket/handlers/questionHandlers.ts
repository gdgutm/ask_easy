import { type Server, type Socket } from "socket.io";

import { prisma } from "@/lib/prisma";
import {
  validateQuestionContent,
  validateVisibility,
  checkUpvoteRateLimit,
  checkResolveRateLimit,
  validateSessionForQuestions,
} from "@/lib/questionValidation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuestionCreatePayload {
  content: string;
  sessionId: string;
  visibility?: "PUBLIC" | "INSTRUCTOR_ONLY";
  isAnonymous?: boolean;
}

interface QuestionBroadcastPayload {
  id: string;
  content: string;
  visibility: string;
  isAnonymous: boolean;
  createdAt: Date;
  authorId?: string | null;
  authorName?: string | null;
  authorUtorid?: string | null;
}

interface QuestionUpvotePayload {
  questionId: string;
}

interface QuestionResolvePayload {
  questionId: string;
}

interface QuestionDeletePayload {
  questionId: string;
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Broadcasts a newly created question to the appropriate session room.
 *
 * Room conventions (populated when users join a session):
 *   session:{sessionId}            — every participant
 *   session:{sessionId}:instructors — TAs and professors only
 *
 * PUBLIC questions go to the first room; INSTRUCTOR_ONLY questions go to the second.
 */
export function broadcastQuestion(
  io: Server,
  sessionId: string,
  question: QuestionBroadcastPayload
): void {
  const targetRoom =
    question.visibility === "INSTRUCTOR_ONLY"
      ? `session:${sessionId}:instructors`
      : `session:${sessionId}`;

  io.to(targetRoom).emit("question:created", question);
}

/**
 * Registers the `question:create` event listener on the given socket.
 *
 * Guard order (cheap-before-expensive):
 *   1. Auth          — socket.data.userId must exist (set by auth middleware)
 *   2. Payload shape — must be a non-null object
 *   3. Content       — length bounds via validateQuestionContent
 *   4. Visibility    — must be a recognised Visibility value if provided
 *   5. Rate limit    — 10 questions / 60 s per user, enforced in Redis
 *   6. Session       — must exist in the DB and have isSubmissionsEnabled === true
 *   7. Persist       — question written to the database (authorId always stored)
 *   8. Broadcast     — emitted to the correct room; authorId stripped when anonymous
 */
export function handleQuestionCreate(socket: Socket, io: Server): void {
  socket.on("question:create", async (payload: QuestionCreatePayload) => {
    console.log("[QuestionHandler] question:create received", JSON.stringify(payload));
    try {
      // 1. Auth guard — userId is attached by socket auth middleware
      const userId: string | undefined = socket.data?.userId;
      if (!userId) {
        console.log("[QuestionHandler] Rejected: no userId");
        socket.emit("question:error", { message: "Authentication required." });
        return;
      }

      // 2. Payload shape guard — socket events can arrive with any shape
      if (!payload || typeof payload !== "object") {
        console.log("[QuestionHandler] Rejected: invalid payload shape");
        socket.emit("question:error", { message: "Invalid request." });
        return;
      }

      // 3. Content validation
      const contentValidation = validateQuestionContent(payload.content);
      if (!contentValidation.valid) {
        console.log("[QuestionHandler] Rejected: content validation -", contentValidation.error);
        socket.emit("question:error", { message: contentValidation.error });
        return;
      }

      // 4. Visibility validation
      const visibilityValidation = validateVisibility(payload.visibility);
      if (!visibilityValidation.valid) {
        console.log(
          "[QuestionHandler] Rejected: visibility validation -",
          visibilityValidation.error
        );
        socket.emit("question:error", { message: visibilityValidation.error });
        return;
      }

      // 5. Session validation
      const sessionValidation = await validateSessionForQuestions(payload.sessionId);
      if (!sessionValidation.valid) {
        console.log("[QuestionHandler] Rejected: session validation -", sessionValidation.error);
        socket.emit("question:error", { message: sessionValidation.error });
        return;
      }

      // 5a. Enrollment check — any non-PROFESSOR must be enrolled in the session's course
      const sessionForEnrollment = await prisma.session.findUnique({
        where: { id: payload.sessionId },
        select: { courseId: true },
      });
      let authorEnrollmentRole: string = "STUDENT";
      if (sessionForEnrollment) {
        const enrollment = await prisma.courseEnrollment.findUnique({
          where: { userId_courseId: { userId, courseId: sessionForEnrollment.courseId } },
          select: { role: true },
        });
        if (!enrollment) {
          socket.emit("question:error", { message: "You are not enrolled in this session." });
          return;
        }
        authorEnrollmentRole = enrollment.role;
      }

      // 6. Persist to database (include author for display name in broadcast)
      //    authorId is always stored for audit purposes, but stripped
      //    from the broadcast payload in step 8 when isAnonymous is true.
      const question = await prisma.question.create({
        data: {
          sessionId: payload.sessionId,
          authorId: userId,
          content: payload.content.trim(),
          visibility: payload.visibility ?? "PUBLIC",
          isAnonymous: payload.isAnonymous ?? false,
        },
        include: {
          author: { select: { id: true, name: true, utorid: true } },
        },
      });

      // 8. Build broadcast payload and emit to the session room
      const broadcastPayload: QuestionBroadcastPayload = {
        id: question.id,
        content: question.content,
        visibility: question.visibility,
        isAnonymous: question.isAnonymous,
        createdAt: question.createdAt,
        ...(question.isAnonymous
          ? {}
          : {
              authorId: question.authorId,
              authorName: question.author?.name ?? null,
              authorUtorid: question.author?.utorid ?? null,
            }),
      };

      broadcastQuestion(io, question.sessionId, broadcastPayload);

      // For anonymous questions, reveal the author to instructors via a separate event
      // so that TAs and Professors can see who posted while students remain unaware.
      if (question.isAnonymous) {
        io.to(`session:${question.sessionId}:instructors`).emit("question:author:revealed", {
          id: question.id,
          authorId: question.authorId,
          authorName: question.author?.name ?? null,
          authorUtorid: question.author?.utorid ?? null,
          authorRole: authorEnrollmentRole as "STUDENT" | "TA" | "PROFESSOR",
        });
      }
    } catch (error) {
      console.error("[QuestionHandler] Failed to create question:", error);
      socket.emit("question:error", {
        message: "An error occurred while creating your question.",
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Upvoting
// ---------------------------------------------------------------------------

/**
 * Registers the `question:upvote` event listener on the given socket.
 *
 * Guard order (cheap-before-expensive):
 *   1. Auth          — socket.data.userId must exist
 *   2. Payload shape — must be a non-null object with a string questionId
 *   3. Rate limit    — 30 upvotes / 60 s per user, enforced in Redis
 *   4. Toggle        — create or delete upvote + update count in a transaction
 *   5. Broadcast     — emit updated count to the session room
 */
export function handleQuestionUpvote(socket: Socket, io: Server): void {
  socket.on("question:upvote", async (payload: QuestionUpvotePayload) => {
    try {
      // 1. Auth guard
      const userId: string | undefined = socket.data?.userId;
      if (!userId) {
        socket.emit("question:error", { message: "Authentication required." });
        return;
      }

      // 2. Payload shape guard
      if (!payload || typeof payload !== "object") {
        socket.emit("question:error", { message: "Invalid request." });
        return;
      }

      const { questionId } = payload;
      if (!questionId || typeof questionId !== "string") {
        socket.emit("question:error", { message: "Question ID is required." });
        return;
      }

      // 3. Rate limit
      const isRateLimited = await checkUpvoteRateLimit(userId);
      if (isRateLimited) {
        socket.emit("question:error", {
          message: "You are upvoting too quickly. Please wait before trying again.",
        });
        return;
      }

      // 4. Enrollment check — fetch question with session/courseId and verify membership
      const questionForEnrollment = await prisma.question.findUnique({
        where: { id: questionId },
        select: { session: { select: { courseId: true } } },
      });
      if (questionForEnrollment) {
        const enrollment = await prisma.courseEnrollment.findUnique({
          where: {
            userId_courseId: { userId, courseId: questionForEnrollment.session.courseId },
          },
          select: { role: true },
        });
        if (!enrollment) {
          socket.emit("question:error", { message: "You are not enrolled in this session." });
          return;
        }
      }

      // 5. Toggle upvote in a transaction
      const existingUpvote = await prisma.questionUpvote.findUnique({
        where: { questionId_userId: { questionId, userId } },
      });

      let updatedQuestion;

      if (existingUpvote) {
        // Remove upvote
        [, updatedQuestion] = await prisma.$transaction([
          prisma.questionUpvote.delete({ where: { id: existingUpvote.id } }),
          prisma.question.update({
            where: { id: questionId },
            data: { upvoteCount: { decrement: 1 } },
            select: { id: true, upvoteCount: true, sessionId: true, visibility: true },
          }),
        ]);
      } else {
        // Add upvote
        [, updatedQuestion] = await prisma.$transaction([
          prisma.questionUpvote.create({ data: { questionId, userId } }),
          prisma.question.update({
            where: { id: questionId },
            data: { upvoteCount: { increment: 1 } },
            select: { id: true, upvoteCount: true, sessionId: true, visibility: true },
          }),
        ]);
      }

      // 5. Broadcast to the appropriate room
      const targetRoom =
        updatedQuestion.visibility === "INSTRUCTOR_ONLY"
          ? `session:${updatedQuestion.sessionId}:instructors`
          : `session:${updatedQuestion.sessionId}`;

      io.to(targetRoom).emit("question:updated", {
        id: updatedQuestion.id,
        upvoteCount: updatedQuestion.upvoteCount,
      });
    } catch (error) {
      console.error("[QuestionHandler] Failed to toggle upvote:", error);
      socket.emit("question:error", {
        message: "An error occurred while processing your upvote.",
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Resolving
// ---------------------------------------------------------------------------

/**
 * Checks whether a user has permission to resolve a question.
 *
 * - TA / PROFESSOR (per-course CourseEnrollment role) can resolve any question.
 * - STUDENT can only resolve their own question.
 */
function checkResolvePermission(
  userId: string,
  questionAuthorId: string | null,
  enrollmentRole: "STUDENT" | "TA" | "PROFESSOR"
): boolean {
  if (enrollmentRole === "TA" || enrollmentRole === "PROFESSOR") return true;
  return questionAuthorId === userId;
}

/**
 * Registers the `question:resolve` event listener on the given socket.
 *
 * Guard order (cheap-before-expensive):
 *   1. Auth          — socket.data.userId must exist
 *   2. Payload shape — must be a non-null object with a string questionId
 *   3. Rate limit    — 20 resolves / 60 s per user, enforced in Redis
 *   4. Question      — must exist in the DB and not already be resolved
 *   5. Permission    — TA/PROFESSOR can resolve any; STUDENT only their own
 *   6. Persist       — question status updated to RESOLVED
 *   7. Broadcast     — emit resolved status to the session room
 */
export function handleQuestionResolve(socket: Socket, io: Server): void {
  socket.on("question:resolve", async (payload: QuestionResolvePayload) => {
    try {
      // 1. Auth guard
      const userId: string | undefined = socket.data?.userId;
      if (!userId) {
        socket.emit("question:error", { message: "Authentication required." });
        return;
      }

      // 2. Payload shape guard
      if (!payload || typeof payload !== "object") {
        socket.emit("question:error", { message: "Invalid request." });
        return;
      }

      const { questionId } = payload;
      if (!questionId || typeof questionId !== "string") {
        socket.emit("question:error", { message: "Question ID is required." });
        return;
      }

      // 3. Rate limit
      const isRateLimited = await checkResolveRateLimit(userId);
      if (isRateLimited) {
        socket.emit("question:error", {
          message: "You are resolving too quickly. Please wait before trying again.",
        });
        return;
      }

      // 4. Fetch question with its course (for enrollment lookup)
      const question = await prisma.question.findUnique({
        where: { id: questionId },
        select: {
          id: true,
          sessionId: true,
          authorId: true,
          status: true,
          visibility: true,
          session: { select: { courseId: true } },
        },
      });

      if (!question) {
        socket.emit("question:error", { message: "Question not found." });
        return;
      }

      if (question.status === "RESOLVED") {
        socket.emit("question:error", { message: "Question is already resolved." });
        return;
      }

      // 5. Permission check — resolve role via CourseEnrollment so TA status is
      //    correctly detected (User.role is always STUDENT for TAs).
      const enrollment = await prisma.courseEnrollment.findUnique({
        where: {
          userId_courseId: { userId, courseId: question.session.courseId },
        },
        select: { role: true },
      });

      const requesterRole = enrollment?.role ?? "STUDENT";

      if (!checkResolvePermission(userId, question.authorId, requesterRole)) {
        socket.emit("question:error", {
          message: "You do not have permission to resolve this question.",
        });
        return;
      }

      // 6. Update status
      await prisma.question.update({
        where: { id: questionId },
        data: { status: "RESOLVED" },
      });

      // 7. Broadcast to the appropriate room
      const targetRoom =
        question.visibility === "INSTRUCTOR_ONLY"
          ? `session:${question.sessionId}:instructors`
          : `session:${question.sessionId}`;

      io.to(targetRoom).emit("question:resolved", {
        id: questionId,
        status: "RESOLVED",
      });
    } catch (error) {
      console.error("[QuestionHandler] Failed to resolve question:", error);
      socket.emit("question:error", {
        message: "An error occurred while resolving the question.",
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Unresolving
// ---------------------------------------------------------------------------

interface QuestionUnresolvePayload {
  questionId: string;
}

/**
 * Registers the `question:unresolve` event listener on the given socket.
 *
 * Only TA / PROFESSOR may unresolve. Reverts status to OPEN.
 * Shares the same rate limit counter as resolve.
 *
 * Guard order (cheap-before-expensive):
 *   1. Auth          — socket.data.userId must exist
 *   2. Payload shape — must be a non-null object with a string questionId
 *   3. Rate limit    — shared with resolve: 20 / 60 s per user
 *   4. Question      — must exist and currently be RESOLVED
 *   5. Permission    — TA/PROFESSOR only
 *   6. Persist       — question status updated to OPEN
 *   7. Broadcast     — emit unresolved status to the session room
 */
export function handleQuestionUnresolve(socket: Socket, io: Server): void {
  socket.on("question:unresolve", async (payload: QuestionUnresolvePayload) => {
    try {
      // 1. Auth guard
      const userId: string | undefined = socket.data?.userId;
      if (!userId) {
        socket.emit("question:error", { message: "Authentication required." });
        return;
      }

      // 2. Payload shape guard
      if (!payload || typeof payload !== "object") {
        socket.emit("question:error", { message: "Invalid request." });
        return;
      }

      const { questionId } = payload;
      if (!questionId || typeof questionId !== "string") {
        socket.emit("question:error", { message: "Question ID is required." });
        return;
      }

      // 3. Rate limit (shared with resolve)
      const isRateLimited = await checkResolveRateLimit(userId);
      if (isRateLimited) {
        socket.emit("question:error", {
          message: "You are resolving too quickly. Please wait before trying again.",
        });
        return;
      }

      // 4. Fetch question
      const question = await prisma.question.findUnique({
        where: { id: questionId },
        select: {
          id: true,
          sessionId: true,
          status: true,
          visibility: true,
          session: { select: { courseId: true } },
        },
      });

      if (!question) {
        socket.emit("question:error", { message: "Question not found." });
        return;
      }

      if (question.status !== "RESOLVED") {
        socket.emit("question:error", { message: "Question is not resolved." });
        return;
      }

      // 5. Permission check — only TA/PROFESSOR may unresolve
      const enrollment = await prisma.courseEnrollment.findUnique({
        where: {
          userId_courseId: { userId, courseId: question.session.courseId },
        },
        select: { role: true },
      });

      const requesterRole = enrollment?.role ?? "STUDENT";

      if (requesterRole !== "TA" && requesterRole !== "PROFESSOR") {
        socket.emit("question:error", {
          message: "You do not have permission to unresolve this question.",
        });
        return;
      }

      // 6. Update status back to OPEN
      await prisma.question.update({
        where: { id: questionId },
        data: { status: "OPEN" },
      });

      // 7. Broadcast to the appropriate room
      const targetRoom =
        question.visibility === "INSTRUCTOR_ONLY"
          ? `session:${question.sessionId}:instructors`
          : `session:${question.sessionId}`;

      io.to(targetRoom).emit("question:unresolved", {
        id: questionId,
        status: "OPEN",
      });
    } catch (error) {
      console.error("[QuestionHandler] Failed to unresolve question:", error);
      socket.emit("question:error", {
        message: "An error occurred while unresolving the question.",
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Deleting
// ---------------------------------------------------------------------------

/**
 * Registers the `question:delete` event listener on the given socket.
 *
 * Permission rules:
 *   - PROFESSOR     → may delete any question
 *   - TA            → may delete any STUDENT's question, or their own
 *   - STUDENT       → never allowed
 *
 * Roles are resolved via CourseEnrollment so that per-course TA status is
 * correctly detected regardless of the user's global User.role.
 */
export function handleQuestionDelete(socket: Socket, io: Server): void {
  socket.on("question:delete", async (payload: QuestionDeletePayload) => {
    try {
      // 1. Auth guard
      const userId: string | undefined = socket.data?.userId;
      if (!userId) {
        socket.emit("question:error", { message: "Authentication required." });
        return;
      }

      // 2. Payload shape guard
      if (
        !payload ||
        typeof payload !== "object" ||
        typeof payload.questionId !== "string" ||
        typeof payload.sessionId !== "string"
      ) {
        socket.emit("question:error", { message: "Invalid request." });
        return;
      }

      const { questionId, sessionId } = payload;

      // 3. Fetch question + its session (for courseId)
      const question = await prisma.question.findUnique({
        where: { id: questionId },
        select: {
          id: true,
          authorId: true,
          sessionId: true,
          visibility: true,
          session: { select: { courseId: true } },
        },
      });

      if (!question || question.sessionId !== sessionId) {
        socket.emit("question:error", { message: "Question not found." });
        return;
      }

      const courseId = question.session.courseId;

      // 4. Resolve the requester's per-course role
      const requesterEnrollment = await prisma.courseEnrollment.findUnique({
        where: { userId_courseId: { userId, courseId } },
        select: { role: true },
      });

      const requesterRole = requesterEnrollment?.role ?? "STUDENT";

      // 5. Permission check
      if (requesterRole === "STUDENT") {
        socket.emit("question:error", {
          message: "You do not have permission to delete this question.",
        });
        return;
      }

      if (requesterRole === "TA") {
        // TAs may only delete their own messages or those by STUDENT authors
        const isOwn = question.authorId === userId;
        if (!isOwn) {
          const authorEnrollment = question.authorId
            ? await prisma.courseEnrollment.findUnique({
                where: { userId_courseId: { userId: question.authorId, courseId } },
                select: { role: true },
              })
            : null;
          const authorRole = authorEnrollment?.role ?? "STUDENT";
          if (authorRole !== "STUDENT") {
            socket.emit("question:error", {
              message: "You do not have permission to delete this question.",
            });
            return;
          }
        }
      }

      // 6. Delete (cascades answers + upvotes via schema)
      await prisma.question.delete({ where: { id: questionId } });

      // 7. Broadcast to the appropriate room
      const targetRoom =
        question.visibility === "INSTRUCTOR_ONLY"
          ? `session:${sessionId}:instructors`
          : `session:${sessionId}`;

      io.to(targetRoom).emit("question:deleted", { questionId });
    } catch (error) {
      console.error("[QuestionHandler] Failed to delete question:", error);
      socket.emit("question:error", {
        message: "An error occurred while deleting the question.",
      });
    }
  });
}
