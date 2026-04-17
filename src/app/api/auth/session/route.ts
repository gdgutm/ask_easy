import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";
import { getSessionOptions, type SessionData } from "@/lib/session";
import { getRoleFromWhitelist } from "@/lib/whitelist";

// ---------------------------------------------------------------------------
// GET /api/auth/session
//
// Establishes an iron-session cookie for the authenticated user.
//
// Production: reads `utorid` (and optionally `mail`, `cn`) from headers
//             injected by Apache + mod_shib after a successful Shibboleth
//             SAML exchange.
//
// Development: reads DEV_UTORID (and optional DEV_EMAIL, DEV_NAME) from
//              environment variables so developers can work without Apache.
//
// After upserting the user in Postgres the route writes a sealed session
// cookie and redirects to the URL supplied in the `redirect` query param
// (defaults to "/").
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const isProd = process.env.NODE_ENV === "production";

  // ------------------------------------------------------------------
  // 1. Resolve identity from Shibboleth headers or dev env vars
  // ------------------------------------------------------------------
  let utorid: string | null = null;
  let name: string | null = null;
  let email: string | null = null;

  if (isProd) {
    // Apache + mod_shib injects these headers for every authenticated request.
    // The server strips them from external connections (see server.ts), so
    // they can be trusted here.
    utorid = request.headers.get("utorid");
    const rawCn = request.headers.get("cn");
    // Strip double-quotes and collapse whitespace to handle LDAP-formatted
    // names like `"First Middle" "Last"` → `First Middle Last`
    const sanitizedCn = rawCn ? rawCn.replace(/"/g, "").replace(/\s+/g, " ").trim() : null;
    name = sanitizedCn || request.headers.get("displayname") || request.headers.get("utorid");
    email = request.headers.get("mail") ?? request.headers.get("email");
  }

  if (!isProd || !utorid) {
    // Dev mode or local Docker without Shibboleth — fall back to DEV_UTORID.
    utorid = utorid ?? process.env.DEV_UTORID ?? null;
    name = name ?? process.env.DEV_NAME ?? utorid;
    email = email ?? process.env.DEV_EMAIL ?? `${utorid}@mail.utoronto.ca`;
  }

  if (!utorid) {
    return NextResponse.json(
      {
        error: isProd
          ? "Shibboleth authentication required. Access this application through the protected URL."
          : "DEV_UTORID is not set. Add it to your .env file to simulate a logged-in user.",
      },
      { status: 401 }
    );
  }

  // ------------------------------------------------------------------
  // 2. Resolve role from the instructor whitelist.
  //    PROFESSOR / TA → listed in whitelist.txt
  //    STUDENT       → everyone else (default)
  //    In dev mode DEV_ROLE overrides the whitelist (for testing instructor UI).
  // ------------------------------------------------------------------
  const whitelistRole = getRoleFromWhitelist(utorid);
  const role =
    !isProd && process.env.DEV_ROLE
      ? (process.env.DEV_ROLE as "STUDENT" | "TA" | "PROFESSOR")
      : whitelistRole;

  // ------------------------------------------------------------------
  // 3. Upsert user in Postgres.
  //    Role is re-evaluated on every login so whitelist changes take
  //    effect immediately on the user's next sign-in.
  // ------------------------------------------------------------------
  const user = await prisma.user.upsert({
    where: { utorid },
    update: {
      ...(name ? { name } : {}),
      ...(email ? { email } : {}),
      role,
    },
    create: {
      utorid,
      name: name ?? utorid,
      email: email ?? `${utorid}@mail.utoronto.ca`,
      role,
    },
  });

  // ------------------------------------------------------------------
  // 3. Write the iron-session cookie
  // ------------------------------------------------------------------
  const session = await getIronSession<SessionData>(await cookies(), getSessionOptions());
  session.userId = user.id;
  session.utorid = user.utorid;
  session.name = user.name;
  session.email = user.email;
  session.role = user.role;
  await session.save();

  // ------------------------------------------------------------------
  // 4. Redirect to the original destination (default: "/")
  // ------------------------------------------------------------------
  const redirectTo = request.nextUrl.searchParams.get("redirect") ?? "/";
  // Guard against open redirects — only allow relative paths on this origin.
  // Reject protocol-relative URLs like //evil.com which start with "/" but redirect off-site.
  const safeRedirect =
    redirectTo.startsWith("/") && !redirectTo.startsWith("//") ? redirectTo : "/";

  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost";
  const origin = `${proto}://${host}`;

  return NextResponse.redirect(new URL(safeRedirect, origin));
}
