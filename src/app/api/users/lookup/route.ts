import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/adminWhitelist";

// ---------------------------------------------------------------------------
// GET /api/users/lookup?utorids=smithj,doej
//
// Resolves UTORids to display names so the classlist form can autofill a
// professor who is already known and ask for a temporary name for one who is
// not.
//
// `hasLoggedIn` is the meaningful field: a user row can exist because someone
// was on a roster or because an admin typed a placeholder for them, and in
// neither case is `name` their real name.
//
// Admin-only — it discloses names for arbitrary UTORids.
//
// Response: { users: [{ utorid, name, hasLoggedIn, exists }] }
// ---------------------------------------------------------------------------

/** Refuse absurd batches; the form looks up a handful of professors at a time. */
const MAX_LOOKUPS = 50;

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    if (!isAdmin(user.utorid)) {
      return NextResponse.json({ error: "Admins only." }, { status: 403 });
    }

    const raw = request.nextUrl.searchParams.get("utorids") ?? "";
    const utorids = [
      ...new Set(
        raw
          .split(",")
          .map((u) => u.trim().toLowerCase())
          .filter(Boolean)
      ),
    ];

    if (utorids.length === 0) {
      return NextResponse.json({ users: [] });
    }

    if (utorids.length > MAX_LOOKUPS) {
      return NextResponse.json(
        { error: `Too many UTORids — ${MAX_LOOKUPS} at a time.` },
        { status: 400 }
      );
    }

    const found = await prisma.user.findMany({
      where: { utorid: { in: utorids } },
      select: { utorid: true, name: true, hasLoggedIn: true },
    });
    const byUtorid = new Map(found.map((u) => [u.utorid, u]));

    return NextResponse.json({
      users: utorids.map((utorid) => {
        const match = byUtorid.get(utorid);
        return {
          utorid,
          exists: !!match,
          // Only a signed-in user's name is worth autofilling — anything else
          // is a placeholder the admin should be allowed to replace.
          name: match?.hasLoggedIn ? match.name : null,
          hasLoggedIn: match?.hasLoggedIn ?? false,
        };
      }),
    });
  } catch (error) {
    console.error("[Users API] Failed to look up UTORids:", error);
    return NextResponse.json({ error: "An error occurred." }, { status: 500 });
  }
}
