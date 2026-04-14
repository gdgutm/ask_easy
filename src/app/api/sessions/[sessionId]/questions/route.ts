import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser, getCurrentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  buildQuestionsWhere,
  getQuestionsOrderBy,
  parseQuestionsQueryParams,
} from "@/lib/questionFilters";
import {
  validateQuestionContent,
  validateVisibility,
  validateSessionForQuestions,
} from "@/lib/questionValidation";
import { getSessionMembership } from "@/lib/sessionService";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

interface QuestionCreateBody {
  content: string;
  visibility?: "PUBLIC" | "INSTRUCTOR_ONLY";
  isAnonymous?: boolean;
}

// ---------------------------------------------------------------------------
// GET /api/sessions/[sessionId]/questions
// ---------------------------------------------------------------------------

/**
 * Retrieves questions for a session with cursor-based pagination, filters, and role-based visibility.
 *
 * Requires authentication (placeholder: x-user-id or Authorization Bearer header).
 * User must be enrolled in the session's course.
 *
 * Query parameters:
 *   - limit: number (default 20, max 50)
 *   - cursor: id of last question from previous page
 *   - search: partial case-insensitive match on content
 *   - status: OPEN | ANSWERED | RESOLVED
 *   - sortBy: newest | votes (default newest)
 *   - includeTotal: true to include total matching count
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { sessionId } = await params;

    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const membership = await getSessionMembership(sessionId, userId);
    if (!membership.valid || !membership.role) {
      const statusCode = membership.statusCode ?? 403;
      return NextResponse.json({ error: membership.error ?? "Forbidden." }, { status: statusCode });
    }

    const role = membership.role;
    const { searchParams } = new URL(request.url);
    const queryParams = parseQuestionsQueryParams(searchParams);
    const where = buildQuestionsWhere(sessionId, role, {
      search: queryParams.search,
      status: queryParams.status,
    });

    let total: number | undefined;
    if (queryParams.includeTotal) {
      total = await prisma.question.count({ where });
    }

    const take = queryParams.limit + 1;
    const orderBy = getQuestionsOrderBy(queryParams.sortBy);
    const include = {
      author: { select: { id: true, name: true, role: true, utorid: true } },
      _count: { select: { answers: true } },
      answers: { where: { isAccepted: true }, select: { id: true }, take: 1 },
    } as const;

    const questions =
      queryParams.cursor !== null
        ? await prisma.question.findMany({
            where,
            orderBy,
            take,
            cursor: { id: queryParams.cursor },
            skip: 1,
            include,
          })
        : await prisma.question.findMany({
            where,
            orderBy,
            take,
            include,
          });

    const hasMore = questions.length > queryParams.limit;
    const page = hasMore ? questions.slice(0, queryParams.limit) : questions;
    const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].id : null;

    const canRevealAnonymous = role === "TA" || role === "PROFESSOR";

    const transformedQuestions = page.map((q) => ({
      id: q.id,
      content: q.content,
      visibility: q.visibility,
      status: q.status,
      isAnonymous: q.isAnonymous,
      upvoteCount: q.upvoteCount,
      answerCount: q._count.answers,
      hasAcceptedAnswer: q.answers.length > 0,
      acceptedAnswerId: q.answers[0]?.id ?? null,
      createdAt: q.createdAt,
      author: q.isAnonymous && !canRevealAnonymous ? null : q.author,
    }));

    const payload: {
      sessionId: string;
      questions: typeof transformedQuestions;
      nextCursor: string | null;
      count: number;
      total?: number;
    } = {
      sessionId,
      questions: transformedQuestions,
      nextCursor,
      count: transformedQuestions.length,
    };
    if (total !== undefined) {
      payload.total = total;
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[Questions API] Failed to fetch questions:", error);
    return NextResponse.json(
      { error: "An error occurred while fetching questions." },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/sessions/[sessionId]/questions
// ---------------------------------------------------------------------------

/**
 * Creates a new question in the given session.
 *
 * Request body:
 *   - content: string (required, 5-500 characters)
 *   - authorId: string (required)
 *   - visibility: "PUBLIC" | "INSTRUCTOR_ONLY" (optional, defaults to PUBLIC)
 *   - isAnonymous: boolean (optional, defaults to false)
 *
 * Validations:
 *   1. Content length bounds
 *   2. Visibility is valid if provided
 *   3. Rate limit (10 questions per 60 seconds per user)
 *   4. Session exists and has submissions enabled
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { sessionId } = await params;

    // Parse request body
    let body: QuestionCreateBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    // Get authenticated user — authorId comes from the session, not the request body
    const authUser = await getCurrentUser();
    if (!authUser) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    const authorId = authUser.userId;

    // 2. Verify the user is enrolled in the session's course
    const membership = await getSessionMembership(sessionId, authorId);
    if (!membership.valid) {
      const statusCode = membership.statusCode ?? 403;
      return NextResponse.json({ error: membership.error ?? "Forbidden." }, { status: statusCode });
    }

    // 4. Validate content using shared validation
    const contentValidation = validateQuestionContent(body.content);
    if (!contentValidation.valid) {
      return NextResponse.json({ error: contentValidation.error }, { status: 400 });
    }

    // 5. Validate visibility using shared validation
    const visibilityValidation = validateVisibility(body.visibility);
    if (!visibilityValidation.valid) {
      return NextResponse.json({ error: visibilityValidation.error }, { status: 400 });
    }

    // 6. Validate session using shared validation (submissions enabled check)
    const sessionValidation = await validateSessionForQuestions(sessionId);
    if (!sessionValidation.valid) {
      const statusCode = sessionValidation.error === "Session not found." ? 404 : 403;
      return NextResponse.json({ error: sessionValidation.error }, { status: statusCode });
    }

    // 7. Create the question and record activity on the session atomically
    const [question] = await prisma.$transaction([
      prisma.question.create({
        data: {
          sessionId,
          authorId,
          content: body.content.trim(),
          visibility: body.visibility ?? "PUBLIC",
          isAnonymous: body.isAnonymous ?? false,
        },
        include: {
          author: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      prisma.session.update({
        where: { id: sessionId },
        data: { lastActivityAt: new Date() },
      }),
    ]);

    // 7. Return the created question (respecting anonymity)
    return NextResponse.json(
      {
        id: question.id,
        content: question.content,
        visibility: question.visibility,
        status: question.status,
        isAnonymous: question.isAnonymous,
        upvoteCount: question.upvoteCount,
        createdAt: question.createdAt,
        author: question.isAnonymous ? null : question.author,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[Questions API] Failed to create question:", error);
    return NextResponse.json(
      { error: "An error occurred while creating your question." },
      { status: 500 }
    );
  }
}
