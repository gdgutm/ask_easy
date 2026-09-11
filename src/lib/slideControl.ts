import { prisma } from "@/lib/prisma";
import { redisCache } from "@/lib/redis";
import { slideController } from "@/lib/redisKeys";

// ---------------------------------------------------------------------------
// Slide control
//
// Exactly one person drives the deck at a time. Taking control displaces
// whoever had it — there is no handing it back, because the displaced
// instructor keeps a Control Slides button and can simply take it again.
//
// Nobody holds it until someone claims it, and until then it belongs to the
// room's professor. That keeps a professor who starts a lecture and never
// touches the button in charge, with no write needed at session start.
// ---------------------------------------------------------------------------

/** Matches the slide position's TTL — the two expire together. */
export const SLIDE_CONTROL_TTL_SECONDS = 86400; // 24 hours

/**
 * The userId currently allowed to move the deck.
 *
 * Falls back to the room's professor while unclaimed. Returns null only for a
 * room with no professor at all, which is possible for rooms that predate
 * classlists; nobody can drive those until someone takes control.
 */
export async function resolveSlideController(
  sessionId: string,
  courseId: string
): Promise<string | null> {
  const claimed = await redisCache.get(slideController(sessionId));
  if (claimed) return claimed;

  const room = await prisma.course.findUnique({
    where: { id: courseId },
    select: { professorId: true },
  });
  return room?.professorId ?? null;
}

/** Hands the deck to `userId`, displacing whoever held it. */
export async function takeSlideControl(sessionId: string, userId: string): Promise<void> {
  await redisCache.set(slideController(sessionId), userId, "EX", SLIDE_CONTROL_TTL_SECONDS);
}

/** Forgets who holds the deck — used when a session ends. */
export async function releaseSlideControl(sessionId: string): Promise<void> {
  await redisCache.del(slideController(sessionId));
}
