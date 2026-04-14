import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rateLimit";
import { questionRateLimit, upvoteRateLimit, resolveRateLimit } from "@/lib/redisKeys";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const QUESTION_MIN_LENGTH = 5;
export const QUESTION_MAX_LENGTH = 500;
export const RATE_LIMIT_COUNT = 10;
export const RATE_LIMIT_WINDOW_SECONDS = 60;

export const UPVOTE_RATE_LIMIT_COUNT = 30;
export const UPVOTE_RATE_LIMIT_WINDOW_SECONDS = 60;
export const RESOLVE_RATE_LIMIT_COUNT = 20;
export const RESOLVE_RATE_LIMIT_WINDOW_SECONDS = 60;

export const VALID_VISIBILITIES = new Set<string>(["PUBLIC", "INSTRUCTOR_ONLY"]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface SessionValidationResult {
  valid: boolean;
  error?: string;
  session?: {
    id: string;
    isSubmissionsEnabled: boolean;
  };
}

// ---------------------------------------------------------------------------
// Validation Functions
// ---------------------------------------------------------------------------

/**
 * Validates question content.
 * Checks that content is a non-empty string within the allowed length bounds.
 */
export function validateQuestionContent(content: unknown): ValidationResult {
  if (!content || typeof content !== "string") {
    return { valid: false, error: "Question content is required." };
  }

  const trimmed = content.trim();

  if (trimmed.length < QUESTION_MIN_LENGTH) {
    return {
      valid: false,
      error: `Question must be at least ${QUESTION_MIN_LENGTH} characters.`,
    };
  }

  if (trimmed.length > QUESTION_MAX_LENGTH) {
    return {
      valid: false,
      error: `Question must be no more than ${QUESTION_MAX_LENGTH} characters.`,
    };
  }

  return { valid: true };
}

/**
 * Validates visibility setting.
 * Returns valid if visibility is undefined (will use default) or a recognized value.
 */
export function validateVisibility(visibility: unknown): ValidationResult {
  if (visibility === undefined || visibility === null) {
    return { valid: true };
  }

  if (typeof visibility !== "string" || !VALID_VISIBILITIES.has(visibility)) {
    return {
      valid: false,
      error: "Invalid visibility setting. Must be PUBLIC or INSTRUCTOR_ONLY.",
    };
  }

  return { valid: true };
}

/**
 * Checks whether the given user has exceeded the question rate limit
 * (10 questions per 60-second window).
 * The counter is scoped to the session so a new session always starts fresh.
 * Returns true if the limit has been exceeded.
 */
export async function checkQuestionRateLimit(userId: string, sessionId: string): Promise<boolean> {
  return checkRateLimit(
    questionRateLimit(userId, sessionId),
    RATE_LIMIT_COUNT,
    RATE_LIMIT_WINDOW_SECONDS
  );
}

/**
 * Checks whether the given user has exceeded the upvote rate limit
 * (30 upvotes per 60-second window).
 * Returns true if the limit has been exceeded.
 */
export async function checkUpvoteRateLimit(userId: string): Promise<boolean> {
  return checkRateLimit(
    upvoteRateLimit(userId),
    UPVOTE_RATE_LIMIT_COUNT,
    UPVOTE_RATE_LIMIT_WINDOW_SECONDS
  );
}

/**
 * Checks whether the given user has exceeded the resolve rate limit
 * (20 resolves per 60-second window).
 * Returns true if the limit has been exceeded.
 */
export async function checkResolveRateLimit(userId: string): Promise<boolean> {
  return checkRateLimit(
    resolveRateLimit(userId),
    RESOLVE_RATE_LIMIT_COUNT,
    RESOLVE_RATE_LIMIT_WINDOW_SECONDS
  );
}

/**
 * Validates that a session exists and accepts question submissions.
 * Returns the session if valid, or an error message if not.
 */
export async function validateSessionForQuestions(
  sessionId: string
): Promise<SessionValidationResult> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, isSubmissionsEnabled: true },
  });

  if (!session) {
    return { valid: false, error: "Session not found." };
  }

  if (!session.isSubmissionsEnabled) {
    return {
      valid: false,
      error: "Question submissions are currently disabled for this session.",
    };
  }

  return { valid: true, session };
}
