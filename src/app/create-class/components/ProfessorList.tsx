"use client";

import { useEffect, useRef } from "react";
import { CheckCircle2, Clock, Loader2, Plus, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProfessorRow {
  /** Stable key — UTORids change as the admin types, so they cannot be keys. */
  key: string;
  utorid: string;
  displayName: string;
  /**
   * idle     — nothing typed yet
   * checking — lookup in flight
   * known    — already signed in; name comes from their U of T account
   * unknown  — never signed in; the admin supplies a temporary name
   */
  status: "idle" | "checking" | "known" | "unknown";
}

interface LookupResult {
  utorid: string;
  exists: boolean;
  name: string | null;
  hasLoggedIn: boolean;
}

export function emptyProfessorRow(): ProfessorRow {
  return {
    key: Math.random().toString(36).slice(2),
    utorid: "",
    displayName: "",
    status: "idle",
  };
}

interface ProfessorListProps {
  rows: ProfessorRow[];
  onChange: (rows: ProfessorRow[]) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProfessorList({ rows, onChange }: ProfessorListProps) {
  // Always read the newest rows inside the debounce callback — the timer is set
  // up when a UTORid changes but fires long after that render.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  function patch(key: string, changes: Partial<ProfessorRow>) {
    onChange(rowsRef.current.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  }

  function handleUtoridChange(key: string, raw: string) {
    const utorid = raw.trim().toLowerCase();
    patch(key, { utorid, status: utorid ? "checking" : "idle" });

    const existing = timers.current.get(key);
    if (existing) clearTimeout(existing);
    if (!utorid) return;

    timers.current.set(
      key,
      setTimeout(() => {
        timers.current.delete(key);
        void lookup(key, utorid);
      }, 400)
    );
  }

  async function lookup(key: string, utorid: string) {
    try {
      const res = await fetch(`/api/users/lookup?utorids=${encodeURIComponent(utorid)}`);
      if (!res.ok) throw new Error("lookup failed");
      const data = (await res.json()) as { users: LookupResult[] };
      const match = data.users?.[0];

      // The admin may have kept typing while this was in flight; that response
      // is about a UTORid they have already moved on from.
      const current = rowsRef.current.find((row) => row.key === key);
      if (!current || current.utorid !== utorid) return;

      if (match?.hasLoggedIn && match.name) {
        patch(key, { status: "known", displayName: match.name });
      } else {
        patch(key, { status: "unknown" });
      }
    } catch {
      // Treat a failed lookup as an unknown user rather than blocking the form —
      // the admin can still type a name, and the server re-checks anyway.
      const current = rowsRef.current.find((row) => row.key === key);
      if (current?.utorid === utorid) patch(key, { status: "unknown" });
    }
  }

  function addRow() {
    onChange([...rows, emptyProfessorRow()]);
  }

  function removeRow(key: string) {
    const timer = timers.current.get(key);
    if (timer) clearTimeout(timer);
    timers.current.delete(key);
    const remaining = rows.filter((row) => row.key !== key);
    onChange(remaining.length > 0 ? remaining : [emptyProfessorRow()]);
  }

  return (
    <div className="space-y-3 mt-4">
      <label className="text-xl font-bold text-stone-900 tracking-tight block">
        Add Professors <span className="text-stone-400 font-normal text-base">(optional)</span>
      </label>
      <p className="text-sm text-stone-500">
        Each professor gets their own room, named after them, and can only see that room. You get a
        room of your own plus TA access to all of theirs.
      </p>

      <div className="space-y-2">
        {rows.map((row) => {
          const known = row.status === "known";
          return (
            <div key={row.key} className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  value={row.utorid}
                  spellCheck={false}
                  onChange={(e) => handleUtoridChange(row.key, e.target.value)}
                  placeholder="UTORid — ex. smithj"
                  className="w-full border-2 border-stone-100 rounded-md px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-green-400 focus:ring-4 focus:ring-green-50 transition-all shadow-sm"
                />
              </div>

              <div className="flex-1 min-w-0">
                <div className="relative">
                  <input
                    type="text"
                    value={row.displayName}
                    spellCheck={false}
                    disabled={known}
                    onChange={(e) => patch(row.key, { displayName: e.target.value })}
                    placeholder="Last name - ex. Engineer (For room naming)"
                    className="w-full border-2 border-stone-100 rounded-md px-4 py-2.5 pr-9 text-sm focus:outline-none focus:border-green-400 focus:ring-4 focus:ring-green-50 transition-all shadow-sm disabled:bg-stone-50 disabled:text-stone-500"
                  />
                  {row.status === "checking" && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-300 animate-spin" />
                  )}
                  {known && (
                    <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
                  )}
                  {row.status === "unknown" && (
                    <Clock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-500" />
                  )}
                </div>
                {known && (
                  <p className="mt-1 text-xs text-emerald-600">Name from their U of T account.</p>
                )}
                {row.status === "unknown" && (
                  <p className="mt-1 text-xs text-amber-600">
                    Hasn&rsquo;t signed in yet — this name is temporary and is replaced by their
                    real one when they do.
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => removeRow(row.key)}
                aria-label="Remove professor"
                className="mt-2.5 text-stone-300 hover:text-red-500 transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addRow}
        className="flex items-center gap-1.5 text-sm font-medium text-stone-500 hover:text-stone-900 transition-colors"
      >
        <Plus className="w-4 h-4" />
        Add another professor
      </button>
    </div>
  );
}

/** Drops blank rows and hands the API the shape it wants. */
export function professorRowsToPayload(
  rows: ProfessorRow[]
): { utorid: string; displayName?: string }[] {
  return rows
    .filter((row) => row.utorid.trim().length > 0)
    .map((row) => ({
      utorid: row.utorid.trim().toLowerCase(),
      // A known user's name is theirs already; only send a placeholder.
      ...(row.status !== "known" && row.displayName.trim()
        ? { displayName: row.displayName.trim() }
        : {}),
    }));
}

/** Rows with a UTORid but no name to show — the admin has nothing to label the room with. */
export function professorRowsMissingNames(rows: ProfessorRow[]): string[] {
  return rows
    .filter((row) => row.utorid.trim().length > 0 && row.displayName.trim().length === 0)
    .map((row) => row.utorid.trim().toLowerCase());
}
