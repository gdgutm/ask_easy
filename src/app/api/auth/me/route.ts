import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";

import { getSessionOptions, type SessionData } from "@/lib/session";
import { isAdmin } from "@/lib/adminWhitelist";

// ---------------------------------------------------------------------------
// GET /api/auth/me
//
// Returns the currently authenticated user from the session cookie.
// Used by client components to know who is logged in.
//
// Response:
//   200 { userId, utorid, name, email, role }
//   401 { error: "Not authenticated." }
// ---------------------------------------------------------------------------

export async function GET() {
  const session = await getIronSession<SessionData>(await cookies(), getSessionOptions());

  if (!session.userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  return NextResponse.json({
    userId: session.userId,
    utorid: session.utorid,
    name: session.name,
    email: session.email,
    role: session.role,
    isAdmin: isAdmin(session.utorid ?? ""),
  });
}
