import dotenv from "dotenv";

// Vars injected per-instance by scripts/dev-all.ts. The `override: true` below
// would otherwise let .env.local clobber them and silently collapse all three
// dev instances into a single identity. Empty under plain `pnpm dev`.
const INJECTED_KEYS = [
  "PORT",
  "DEV_UTORID",
  "DEV_NAME",
  "DEV_EMAIL",
  "SESSION_COOKIE_NAME",
  "NEXT_DIST_DIR",
] as const;

const injected = Object.fromEntries(
  INJECTED_KEYS.filter((key) => process.env[key] !== undefined).map((key) => [
    key,
    process.env[key] as string,
  ])
);

// Load .env, then let .env.local override (same as prisma.config.ts).
// Required for `pnpm dev` outside Docker: hosts must be localhost, not postgres/redis.
dotenv.config();
dotenv.config({ path: ".env.local", override: true });
Object.assign(process.env, injected);
import { createServer, type IncomingMessage } from "node:http";
import next from "next";

import { initSocketIO } from "./socket";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

// ---------------------------------------------------------------------------
// Security: strip Shibboleth attribute headers from external connections
//
// In production, Apache + mod_shib runs on the same host and forwards these
// headers to Next.js over localhost. We strip them from any connection that
// does NOT come from 127.0.0.1 / ::1, preventing clients from spoofing their
// identity by injecting headers manually.
// ---------------------------------------------------------------------------

const SHIB_HEADERS = [
  "utorid",
  "mail",
  "email",
  "cn",
  "displayname",
  "givenname",
  "sn",
  "edupersonaffiliation",
  "edupersonscopedaffiliation",
  "edupersonprincipalname",
];

function stripShibHeaders(req: IncomingMessage): void {
  const remoteAddr = req.socket?.remoteAddress ?? "";
  const isLocalhost =
    remoteAddr === "127.0.0.1" ||
    remoteAddr === "::1" ||
    remoteAddr === "::ffff:127.0.0.1" ||
    remoteAddr.startsWith("::ffff:172.");

  if (!isLocalhost) {
    for (const header of SHIB_HEADERS) {
      delete req.headers[header];
    }
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // 1. Prepare the Next.js application
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  // 2. Create an HTTP server that strips Shibboleth headers on external
  //    connections, then delegates to Next.js
  const httpServer = createServer((req, res) => {
    stripShibHeaders(req);
    handle(req, res);
  });

  // 3. Attach Socket.IO (+ Redis adapter) to the same HTTP server
  await initSocketIO(httpServer);

  // 4. Start listening
  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port} (${dev ? "development" : "production"})`);
    console.log(`> Socket.IO server attached`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
