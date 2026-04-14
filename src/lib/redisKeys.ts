/**
 * Centralized Redis key naming conventions.
 * Keeps keys consistent and human-readable.
 */

/**
 * Session cache key
 * Example: "session:{abc123}"
 */
export function session(sessionId: string): string {
  return `session:{${sessionId}}`;
}

/**
 * Rate limit key
 * Example: "ratelimit:{user-42}"
 */
export function rateLimit(key: string): string {
  return `ratelimit:{${key}}`;
}

/**
 * Question rate-limit key (passed into checkRateLimit, which wraps it via rateLimit()).
 * Scoped per-session so a new session always gives every student a fresh counter.
 * Final Redis key: "ratelimit:{question:abc123:sessionXYZ}"
 */
export function questionRateLimit(userId: string, sessionId: string): string {
  return `question:${userId}:${sessionId}`;
}

/**
 * Answer rate-limit key (passed into checkRateLimit, which wraps it via rateLimit()).
 * Final Redis key: "ratelimit:{answer:abc123}"
 */
export function answerRateLimit(userId: string): string {
  return `answer:${userId}`;
}

/**
 * Slide upload rate-limit key (passed into checkRateLimit, which wraps it via rateLimit()).
 * Final Redis key: "ratelimit:{slide-upload:abc123}"
 */
export function slideUploadRateLimit(userId: string): string {
  return `slide-upload:${userId}`;
}

/**
 * Upvote rate-limit key (passed into checkRateLimit, which wraps it via rateLimit()).
 * Final Redis key: "ratelimit:{upvote:abc123}"
 */
export function upvoteRateLimit(userId: string): string {
  return `upvote:${userId}`;
}

/**
 * Resolve rate-limit key (passed into checkRateLimit, which wraps it via rateLimit()).
 * Final Redis key: "ratelimit:{resolve:abc123}"
 */
export function resolveRateLimit(userId: string): string {
  return `resolve:${userId}`;
}

/**
 * Session creation rate-limit key (passed into checkRateLimit, which wraps it via rateLimit()).
 * Final Redis key: "ratelimit:{session-create:abc123}"
 */
export function sessionCreateRateLimit(userId: string): string {
  return `session-create:${userId}`;
}

/**
 * Code regeneration rate-limit key (passed into checkRateLimit, which wraps it via rateLimit()).
 * Final Redis key: "ratelimit:{code-regen:abc123}"
 */
export function codeRegenRateLimit(userId: string): string {
  return `code-regen:${userId}`;
}

/**
 * Session join lookup rate-limit key (passed into checkRateLimit, which wraps it via rateLimit()).
 * Final Redis key: "ratelimit:{session-join-lookup:abc123}"
 */
export function sessionJoinLookupRateLimit(userId: string): string {
  return `session-join-lookup:${userId}`;
}

/**
 * Session join registration rate-limit key (passed into checkRateLimit, which wraps it via rateLimit()).
 * Final Redis key: "ratelimit:{session-join-register:abc123}"
 */
export function sessionJoinRegisterRateLimit(userId: string): string {
  return `session-join-register:${userId}`;
}

/**
 * Slide state key — stores the professor's current page index for a session.
 * Example: "slide-state:{abc123}"
 * TTL: 24 hours (set by the slide change handler).
 */
export function slideState(sessionId: string): string {
  return `slide-state:{${sessionId}}`;
}

/**
 * Answer mode key — stores whether only instructors or everyone can answer questions.
 * Example: "answer-mode:{abc123}"
 * Value: "all" | "instructors_only"
 * TTL: set by the answer mode handler (session-scoped, no persistence needed after session ends).
 */
export function answerMode(sessionId: string): string {
  return `answer-mode:{${sessionId}}`;
}
