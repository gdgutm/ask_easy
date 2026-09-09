/**
 * Multi-instance dev launcher — `pnpm dev:all`
 *
 * Spins up N professor, M TA, and K student dev servers so multi-user flows
 * can be tested in multiple tabs of one browser window.
 *
 *   pnpm dev:all              → 1 prof, 1 TA, 1 student (default)
 *   pnpm dev:all -- 2 1 3     → 2 profs, 1 TA, 3 students
 *
 * Default layout (1 of each):
 *   PROF     -> http://localhost:3000   askeasy-dev-prof
 *   TA       -> http://localhost:3001   askeasy-dev-ta
 *   STUDENT  -> http://localhost:3002   askeasy-dev-student
 *
 * Extra instances of a role get sequential ports, distinct cookie names /
 * dist dirs, and numbered default identities (devprof2, …). Override with
 * DEV_<ROLE>_2_UTORID / _NAME / _ROLE / _EMAIL (and _3, …).
 *
 * Identity is process-global (src/app/api/auth/session/route.ts reads
 * DEV_UTORID / DEV_NAME / DEV_ROLE from the environment), so one identity
 * requires one process.
 *
 * Each child also gets its own SESSION_COOKIE_NAME. Browser cookies are keyed
 * by host and ignore the port, so without distinct names all instances would
 * share one cookie and every tab would become whoever logged in last.
 *
 * All instances share one Postgres and one Redis — that is the point. The
 * Socket.IO Redis adapter is what carries events between the processes.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import type { Readable } from "node:stream";

import dotenv from "dotenv";

// Resolve personas from the same values the servers will see (src/server.ts:5-6).
dotenv.config();
dotenv.config({ path: ".env.local", override: true });

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

const ROLES = ["STUDENT", "TA", "PROFESSOR"] as const;
type Role = (typeof ROLES)[number];

interface PersonaBase {
  key: string;
  cookieName: string;
  distDir: string;
  color: string;
  defaults: { utorid: string; name: string; role: Role };
}

interface PersonaSpec extends PersonaBase {
  /** Env prefix: PROF, PROF_2, TA, STUDENT_3, … */
  envKey: string;
  port: number;
}

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

const PERSONA_BASES: PersonaBase[] = [
  {
    key: "PROF",
    cookieName: "askeasy-dev-prof",
    distDir: ".next-prof",
    color: "\x1b[35m", // magenta
    defaults: { utorid: "devprof", name: "Dev Professor", role: "PROFESSOR" },
  },
  {
    key: "TA",
    cookieName: "askeasy-dev-ta",
    distDir: ".next-ta",
    color: "\x1b[36m", // cyan
    defaults: { utorid: "devta", name: "Dev TA", role: "TA" },
  },
  {
    key: "STUDENT",
    cookieName: "askeasy-dev-student",
    distDir: ".next-student",
    color: "\x1b[32m", // green
    defaults: { utorid: "devstudent", name: "Dev Student", role: "STUDENT" },
  },
];

interface ResolvedPersona {
  spec: PersonaSpec;
  utorid: string;
  name: string;
  email: string;
  role: Role;
}

const warnings: string[] = [];
const errors: string[] = [];

/** Parse `pnpm dev:all -- <profs> <tas> <students>`. Default 1 1 1. */
function parseCounts(argv: string[]): { profs: number; tas: number; students: number } {
  const args = argv.slice(2);
  if (args.length === 0) return { profs: 1, tas: 1, students: 1 };

  if (args.length !== 3) {
    errors.push("Usage: pnpm dev:all -- <profs> <tas> <students>   (e.g. pnpm dev:all -- 2 1 3)");
    return { profs: 0, tas: 0, students: 0 };
  }

  const nums = args.map((a) => Number(a));
  if (nums.some((n) => !Number.isInteger(n) || n < 0)) {
    errors.push("Counts must be non-negative integers: <profs> <tas> <students>");
    return { profs: 0, tas: 0, students: 0 };
  }

  const [profs, tas, students] = nums;
  if (profs + tas + students === 0) {
    errors.push("At least one instance is required.");
    return { profs: 0, tas: 0, students: 0 };
  }

  return { profs, tas, students };
}

function expandPersonas(profs: number, tas: number, students: number): PersonaSpec[] {
  const counts = [profs, tas, students];
  let port = 3000;
  const out: PersonaSpec[] = [];

  for (let bi = 0; bi < PERSONA_BASES.length; bi++) {
    const base = PERSONA_BASES[bi];
    const count = counts[bi];
    for (let i = 1; i <= count; i++) {
      const alone = count === 1;
      // First of a multi-set still uses DEV_PROF_* so existing .env keeps working;
      // extras use DEV_PROF_2_*, DEV_PROF_3_*, …
      const envKey = alone || i === 1 ? base.key : `${base.key}_${i}`;
      const label = alone ? base.key : `${base.key}${i}`;
      out.push({
        key: label,
        envKey,
        port: port++,
        cookieName: alone ? base.cookieName : `${base.cookieName}-${i}`,
        distDir: alone ? base.distDir : `${base.distDir}-${i}`,
        color: base.color,
        defaults: {
          utorid: alone ? base.defaults.utorid : `${base.defaults.utorid}${i}`,
          name: alone ? base.defaults.name : `${base.defaults.name} ${i}`,
          role: base.defaults.role,
        },
      });
    }
  }

  return out;
}

function resolvePersona(spec: PersonaSpec): ResolvedPersona {
  const read = (suffix: string, fallback: string): string => {
    const varName = `DEV_${spec.envKey}_${suffix}`;
    const value = process.env[varName]?.trim();
    if (value) return value;
    warnings.push(`${varName} is not set — using default "${fallback}".`);
    return fallback;
  };

  const utorid = read("UTORID", spec.defaults.utorid);
  const name = read("NAME", spec.defaults.name);
  const role = read("ROLE", spec.defaults.role) as Role;

  if (!ROLES.includes(role)) {
    // route.ts casts DEV_ROLE straight to the Prisma enum, so a typo would
    // otherwise surface as an opaque database error on first login.
    errors.push(`DEV_${spec.envKey}_ROLE is "${role}" — must be one of ${ROLES.join(", ")}.`);
  }

  // Always set explicitly: a single global DEV_EMAIL shared by all personas
  // would collide on the User table's unique email.
  const email = process.env[`DEV_${spec.envKey}_EMAIL`]?.trim() || `${utorid}@mail.utoronto.ca`;

  return { spec, utorid, name, email, role };
}

// ---------------------------------------------------------------------------
// Pre-flight
// ---------------------------------------------------------------------------

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "0.0.0.0");
  });
}

function resolveTsxBin(): string {
  const local = path.join(process.cwd(), "node_modules", ".bin", "tsx");
  return existsSync(local) ? local : "tsx";
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** Tags every line of a child stream so interleaved output stays readable. */
function pipePrefixed(stream: Readable, prefix: string, onLine?: (line: string) => void): void {
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      process.stdout.write(`${prefix} ${line}\n`);
      onLine?.(line);
    }
  });
  stream.on("end", () => {
    if (pending.length > 0) {
      process.stdout.write(`${prefix} ${pending}\n`);
      onLine?.(pending);
    }
  });
}

/**
 * Next rewrites next-env.d.ts during startup, and each instance wants its own
 * distDir in the import line. A previous concurrent run may have interleaved
 * those writes and left garbage behind, which breaks `pnpm typecheck` and so
 * the pre-commit hook. The file is gitignored and regenerated, so drop it if it
 * contains anything other than the references, imports and comments Next emits.
 */
function repairNextEnv(): void {
  const file = path.join(process.cwd(), "next-env.d.ts");
  if (!existsSync(file)) return;

  const corrupted = readFileSync(file, "utf8")
    .split("\n")
    .some((raw) => {
      const line = raw.trim();
      if (line === "") return false;
      return !line.startsWith("//") && !line.startsWith("import ");
    });

  if (corrupted) {
    unlinkSync(file);
    console.log(`${YELLOW}⚠${RESET}  Removed a corrupted next-env.d.ts — Next will regenerate it.`);
  }
}

function printSummary(resolved: ResolvedPersona[]): void {
  if (warnings.length > 0) {
    console.log("");
    for (const warning of warnings) {
      console.log(`${YELLOW}⚠${RESET}  ${warning}`);
    }
    console.log(`${DIM}   Set these explicitly in your .env to avoid surprises.${RESET}`);
  }

  if (process.env.SOCKET_IO_USE_REDIS === "false") {
    console.log("");
    console.log(
      `${YELLOW}⚠${RESET}  SOCKET_IO_USE_REDIS is "false", so the Socket.IO Redis adapter is off.`
    );
    console.log(
      `${DIM}   Events will not cross instances: a question asked in one tab will not${RESET}`
    );
    console.log(
      `${DIM}   appear in the others until you refresh. Unset it for realtime testing.${RESET}`
    );
  }

  console.log("");
  const labelWidth = Math.max(8, ...resolved.map((p) => p.spec.key.length));
  for (const { spec, utorid, name, role } of resolved) {
    const label = `${spec.color}${BOLD}${spec.key.padEnd(labelWidth)}${RESET}`;
    const url = `http://localhost:${spec.port}`;
    console.log(`  ${label} ${url}   ${DIM}${name} (${utorid}, ${role})${RESET}`);
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const children: ChildProcess[] = [];
let shuttingDown = false;

function shutdown(code: number): void {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }

  // Give children a moment to exit cleanly, then leave regardless.
  setTimeout(() => process.exit(code), 2000).unref();

  void Promise.all(
    children.map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) return resolve();
          child.once("exit", () => resolve());
        })
    )
  ).then(() => process.exit(code));
}

const READY_PATTERN = /Ready on/;
const READY_TIMEOUT_MS = 120_000;

/** Spawns one instance and resolves once it reports ready (or gives up waiting). */
function launch(persona: ResolvedPersona, tsx: string): Promise<void> {
  const { spec, utorid, name, email, role } = persona;

  const child = spawn(tsx, ["watch", "src/server.ts"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(spec.port),
      DEV_UTORID: utorid,
      DEV_NAME: name,
      DEV_EMAIL: email,
      DEV_ROLE: role,
      SESSION_COOKIE_NAME: spec.cookieName,
      NEXT_DIST_DIR: spec.distDir,
    },
  });

  children.push(child);

  return new Promise<void>((resolve) => {
    let settled = false;
    const settle = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(() => {
      console.warn(
        `${YELLOW}⚠${RESET}  ${spec.key} did not report ready within ${READY_TIMEOUT_MS / 1000}s — continuing anyway.`
      );
      settle();
    }, READY_TIMEOUT_MS);

    const prefix = `${spec.color}[${spec.key}]${RESET}`;
    const onLine = (line: string): void => {
      if (READY_PATTERN.test(line)) settle();
    };
    if (child.stdout) pipePrefixed(child.stdout, prefix, onLine);
    if (child.stderr) pipePrefixed(child.stderr, prefix, onLine);

    child.on("error", (err) => {
      console.error(`${RED}\u2716${RESET}  ${spec.key} failed to start: ${err.message}`);
      settle();
      shutdown(1);
    });

    child.on("exit", (code, signal) => {
      settle();
      if (shuttingDown) return;
      // A half-running set is more confusing than none — tear the rest down.
      console.error(
        `${RED}\u2716${RESET}  ${spec.key} exited unexpectedly (${signal ?? `code ${code}`}). Stopping the others.`
      );
      shutdown(code ?? 1);
    });
  });
}

async function main(): Promise<void> {
  const { profs, tas, students } = parseCounts(process.argv);
  if (errors.length > 0) {
    console.error("");
    for (const error of errors) console.error(`${RED}✖${RESET}  ${error}`);
    console.error("");
    process.exit(1);
  }

  const specs = expandPersonas(profs, tas, students);
  const resolved = specs.map(resolvePersona);

  // Two personas sharing a utorid are the same database user, which defeats
  // the purpose of running multiple instances.
  const seen = new Map<string, string>();
  for (const { spec, utorid } of resolved) {
    const previous = seen.get(utorid.toLowerCase());
    if (previous) {
      errors.push(
        `DEV_${spec.envKey}_UTORID and DEV_${previous}_UTORID are both "${utorid}" — each persona needs a distinct UTORid.`
      );
    }
    seen.set(utorid.toLowerCase(), spec.envKey);
  }

  const portChecks = await Promise.all(
    resolved.map(async ({ spec }) => ({ spec, free: await isPortFree(spec.port) }))
  );
  for (const { spec, free } of portChecks) {
    if (!free) errors.push(`Port ${spec.port} (${spec.key}) is already in use.`);
  }

  if (errors.length > 0) {
    console.error("");
    for (const error of errors) console.error(`${RED}✖${RESET}  ${error}`);
    console.error("");
    process.exit(1);
  }

  printSummary(resolved);

  repairNextEnv();

  const tsx = resolveTsxBin();

  // Start one instance at a time, waiting for each to report ready.
  //
  // Next rewrites next-env.d.ts (and can rewrite tsconfig.json) during
  // app.prepare(), and each instance wants its own distDir in the import line.
  // Launching all at once interleaves those writes and corrupts the file,
  // which then breaks `pnpm typecheck` and the pre-commit hook.
  for (const persona of resolved) {
    await launch(persona, tsx);
    if (shuttingDown) return;
  }

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
}

main().catch((err) => {
  console.error("Failed to launch dev instances:", err);
  process.exit(1);
});
