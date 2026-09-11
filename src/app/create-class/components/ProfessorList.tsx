"use client";

import { Plus, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProfessorRow {
  /** Stable key — UTORids change as the admin types, so they cannot be keys. */
  key: string;
  utorid: string;
  /** What this professor's room will be called. Permanent; admin-editable later. */
  roomName: string;
}

export function emptyProfessorRow(): ProfessorRow {
  return {
    key: Math.random().toString(36).slice(2),
    utorid: "",
    roomName: "",
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
  function patch(key: string, changes: Partial<ProfessorRow>) {
    onChange(rows.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  }

  function addRow() {
    onChange([...rows, emptyProfessorRow()]);
  }

  function removeRow(key: string) {
    const remaining = rows.filter((row) => row.key !== key);
    onChange(remaining.length > 0 ? remaining : [emptyProfessorRow()]);
  }

  return (
    <div className="space-y-3 mt-4">
      <label className="text-xl font-bold text-stone-900 tracking-tight block">
        Add Professors <span className="text-stone-400 font-normal text-base">(optional)</span>
      </label>
      <p className="text-sm text-stone-500">
        Each professor gets their own room and can only see that room. You get a room of your own
        plus TA access to all of theirs. The name you give a room is what everyone sees — you can
        change it later.
      </p>

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.key} className="flex items-start gap-2">
            <input
              type="text"
              value={row.utorid}
              spellCheck={false}
              onChange={(e) => patch(row.key, { utorid: e.target.value.trim().toLowerCase() })}
              placeholder="UTORid — ex. smithj"
              className="flex-1 min-w-0 border-2 border-stone-100 rounded-md px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-green-400 focus:ring-4 focus:ring-green-50 transition-all shadow-sm"
            />
            <input
              type="text"
              value={row.roomName}
              spellCheck={false}
              onChange={(e) => patch(row.key, { roomName: e.target.value })}
              placeholder="Room name — ex. Scali"
              className="flex-1 min-w-0 border-2 border-stone-100 rounded-md px-4 py-2.5 text-sm focus:outline-none focus:border-green-400 focus:ring-4 focus:ring-green-50 transition-all shadow-sm"
            />
            <button
              type="button"
              onClick={() => removeRow(row.key)}
              aria-label="Remove professor"
              className="mt-2.5 text-stone-300 hover:text-red-500 transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
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
): { utorid: string; roomName: string }[] {
  return rows
    .filter((row) => row.utorid.trim().length > 0)
    .map((row) => ({
      utorid: row.utorid.trim().toLowerCase(),
      roomName: row.roomName.trim(),
    }));
}

/** UTORids entered without a room name — there would be nothing to call the room. */
export function professorRowsMissingNames(rows: ProfessorRow[]): string[] {
  return rows
    .filter((row) => row.utorid.trim().length > 0 && row.roomName.trim().length === 0)
    .map((row) => row.utorid.trim().toLowerCase());
}
