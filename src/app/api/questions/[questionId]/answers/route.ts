import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  validateAnswerContent,
  checkAnswerRateLimit,
  answerRetryAfter,
  validateQuestionForAnswers,
} from "@/lib/answerValidation";
import { getQuestionAnswers } from "@/services/answerService";
import { getCurrentUser } from "@/lib/auth";
import { redisCache } from "@/lib/redis";
import { answerMode as answerModeKey } from "@/lib/redisKeys";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RouteParams {
  params: Promise<{ questionId: string }>;
}

interface AnswerCreateBody {
  content: string;
  isAnonymous?: boolean;
}

// ---------------------------------------------------------------------------
// GET /api/questions/[questionId]/answers
// ---------------------------------------------------------------------------

/**
 * Retrieves answers for a given question with cursor-based pagination.
 *
 * Query params:
 *   - cursor  (optional) — answer id to paginate from
 *   - limit   (optional) — page size (default 20, max 50)
 *
 * Returns answers sorted by: accepted first, then createdAt asc.
 * Anonymous answer authors are hidden from students.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { questionId } = await params;

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get("cursor") ?? undefined;
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    const result = await getQuestionAnswers(questionId, user.userId, { cursor, limit });

    if (!result.ok) {
      return NextResponse.json({ error: result.error.message }, { status: result.error.status });
    }

    return NextResponse.json(result.data);
  } catch (error) {
    console.error("[Answers API] Failed to fetch answers:", error);
    return NextResponse.json(
      { error: "An error occurred while fetching answers." },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/questions/[questionId]/answers
// ---------------------------------------------------------------------------

/**
 * Creates a new answer for the given question.
 *
 * Request body:
 *   - content:     string  (required, 1-1000 characters)
 *   - isAnonymous: boolean (optional, default false)
 *
 * Validations:
 *   1. Authenticated user from session cookie
 *   2. Question exists and belongs to an active session
 *   3. Content length bounds
 *   4. Rate limit (5 answers per 10 seconds per user)
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { questionId } = await params;

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    let body: AnswerCreateBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const questionValidation = await validateQuestionForAnswers(questionId);
    if (!questionValidation.valid) {
      const statusCode = questionValidation.error === "Question not found." ? 404 : 403;
      return NextResponse.json({ error: questionValidation.error }, { status: statusCode });
    }

    const sessionId = questionValidation.question!.sessionId;

    // Enrollment check — verify the user is enrolled in the session's course
    const sessionRecord = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { courseId: true },
    });
    if (sessionRecord) {
      const enrollment = await prisma.courseEnrollment.findUnique({
        where: { userId_courseId: { userId: user.userId, courseId: sessionRecord.courseId } },
        select: { role: true },
      });
      if (!enrollment) {
        return NextResponse.json(
          { error: "You are not enrolled in this session." },
          { status: 403 }
        );
      }

      // Answer mode check — mirror the socket-layer restriction
      const mode = await redisCache.get(answerModeKey(sessionId));
      if (mode === "instructors_only") {
        // The author exemption stops at anonymous questions — see answerHandlers.
        const isQuestionAuthor =
          questionValidation.question!.authorId === user.userId &&
          !questionValidation.question!.isAnonymous;
        if (!isQuestionAuthor) {
          const effectiveRole = enrollment?.role ?? "STUDENT";
          if (effectiveRole === "STUDENT") {
            return NextResponse.json(
              { error: "The professor has restricted answers to TAs and professors only." },
              { status: 403 }
            );
          }
        }
      }
    }

    const contentValidation = validateAnswerContent(body.content);
    if (!contentValidation.valid) {
      return NextResponse.json({ error: contentValidation.error }, { status: 400 });
    }

    const isRateLimited = await checkAnswerRateLimit(user.userId);
    if (isRateLimited) {
      const retryAfter = await answerRetryAfter(user.userId);
      return NextResponse.json(
        { error: "Too many answers.", retryAfterSeconds: retryAfter },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      );
    }

    const answer = await prisma.answer.create({
      data: {
        questionId,
        authorId: user.userId,
        content: body.content.trim(),
        isAnonymous: body.isAnonymous ?? false,
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
      },
    });

    return NextResponse.json(
      {
        id: answer.id,
        questionId: answer.questionId,
        content: answer.content,
        authorId: answer.author.id,
        authorName: answer.author.name,
        authorRole: answer.author.role,
        isAccepted: answer.isAccepted,
        isAnonymous: answer.isAnonymous,
        createdAt: answer.createdAt,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[Answers API] Failed to create answer:", error);
    return NextResponse.json(
      { error: "An error occurred while creating your answer." },
      { status: 500 }
    );
  }
}
