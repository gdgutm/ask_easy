import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Admin whitelist
//
// Reads `admin_whitelist.txt` (or the path in ADMIN_WHITELIST_PATH env var)
// to determine which UTORids have god-mode dashboard access.
// One UTORid per line; comment lines start with #.
//
// File format (one entry per line):
//   utorid
//   # comment lines are ignored
// ---------------------------------------------------------------------------

function loadAdminWhitelist(): Set<string> {
  const whitelistPath = resolve(process.env.ADMIN_WHITELIST_PATH ?? "./admin_whitelist.txt");

  let contents: string;
  try {
    contents = readFileSync(whitelistPath, "utf-8");
  } catch {
    console.warn(
      `[admin-whitelist] Could not read admin whitelist at ${whitelistPath}. No users will have dashboard access.`
    );
    return new Set();
  }

  const set = new Set<string>();

  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const utorid = line.split(",")[0].trim().toLowerCase();
    if (utorid) set.add(utorid);
  }

  return set;
}

// Loaded once at startup (module-level cache).
// Restart the server to pick up changes to admin_whitelist.txt.
const ADMIN_WHITELIST: Set<string> = loadAdminWhitelist();

/**
 * Returns true if the UTORid is in the admin whitelist.
 */
export function isAdmin(utorid: string): boolean {
  return ADMIN_WHITELIST.has(utorid.toLowerCase());
}
