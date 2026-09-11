import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";
import { getSessionOptions, type SessionData } from "@/lib/session";
import { isAdmin } from "@/lib/adminWhitelist";

// ---------------------------------------------------------------------------
// GET /api/auth/me
//
// Returns the currently authenticated user from the session cookie.
// Used by client components to know who is logged in.
//
// The cookie can outlive the database — a wipe or restore recreates the row
// with a fresh id while the sealed cookie still carries the old one, which
// then matches no enrollments and breaks every write that uses it as a foreign
// key. UTORid is the stable identity, so this re-reads by UTORid and re-mints
// the cookie when the id has drifted. Every page calls this on mount, so the
// correction happens before anything else can act on a dead id.
//
// Response:
//   200 { userId, utorid, name, email, role, isAdmin }
//   401 { error: "Not authenticated." }
// ---------------------------------------------------------------------------

export async function GET() {
  const session = await getIronSession<SessionData>(await cookies(), getSessionOptions());

  if (!session.userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  if (session.utorid) {
    const live = await prisma.user.findUnique({
      where: { utorid: session.utorid },
      select: { id: true, name: true, email: true },
    });

    if (live && live.id !== session.userId) {
      console.warn(
        `[auth/me] Session for ${session.utorid} pointed at a stale user id; re-minting.`
      );
      session.userId = live.id;
      session.name = live.name;
      session.email = live.email;
      await session.save();
    }
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
