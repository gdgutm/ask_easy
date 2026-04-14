import { NextResponse } from "next/server";

import { getCurrentUser, type AuthUser } from "@/lib/auth";
import { isAdmin } from "@/lib/adminWhitelist";

/**
 * Checks that the current request is from an authenticated admin user.
 * Returns the AuthUser if valid, or null if not authenticated / not admin.
 */
export async function requireAdmin(): Promise<AuthUser | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!isAdmin(user.utorid)) return null;
  return user;
}

/**
 * Convenience helper for API route handlers.
 * Returns a NextResponse (401/403) if the user is not an admin, or null if OK.
 *
 * Usage:
 *   const user = await requireAdmin();
 *   const guard = adminGuardResponse(user);
 *   if (guard) return guard;
 */
export function adminGuardResponse(user: AuthUser | null): NextResponse | null {
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // If requireAdmin returned a user, they are already verified as admin.
  return null;
}
