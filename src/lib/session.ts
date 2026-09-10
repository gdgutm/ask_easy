import type { SessionOptions } from "iron-session";

import { resolveCookieName } from "@/lib/devCookie";

// ---------------------------------------------------------------------------
// Session data shape stored inside the encrypted cookie
// ---------------------------------------------------------------------------

export interface SessionData {
  userId: string;
  utorid: string;
  name: string;
  email: string;
  role: string;
}

// ---------------------------------------------------------------------------
// iron-session configuration (lazy so build can run without SESSION_SECRET)
// ---------------------------------------------------------------------------

export function getSessionOptions(): SessionOptions {
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error(
      "SESSION_SECRET environment variable is not set. Generate a strong secret with: openssl rand -hex 32"
    );
  }

  if (secret.length < 32) {
    throw new Error(
      "SESSION_SECRET is insecure: it is shorter than 32 characters. Generate a strong secret with: openssl rand -hex 32"
    );
  }

  return {
    password: secret,
    // Normally "ask_easy_session". `pnpm dev:all` overrides it per instance so
    // three dev servers on localhost don't clobber each other's cookie.
    cookieName: resolveCookieName(),
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
      // 8-hour session lifetime. Reduces the window where a revoked user's
      // cookie stays valid after an ADMIN_WHITELIST update + server restart.
      maxAge: 60 * 60 * 8,
    },
  };
}
