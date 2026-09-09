"use client";

import { useState, useEffect, useRef } from "react";
import {
  X,
  UserPlus,
  GraduationCap,
  Pencil,
  Trash2,
  Search,
  UserMinus,
  Upload,
  RefreshCw,
} from "lucide-react";
import { parseAndProcessCSV } from "@/utils/create-class";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CourseForModal {
  id: string;
  code: string;
  name: string;
  semester: string;
}

interface ManageClassModalProps {
  course: CourseForModal;
  onClose: () => void;
  onRenamed: (courseId: string, code: string, semester: string) => void;
  onDeleted: (courseId: string) => void;
}

type Tab = "students" | "staff" | "rename" | "delete";

interface RosterEntry {
  name: string;
  utorid: string;
}

// ---------------------------------------------------------------------------
// Helper: split "Given Surname" into two parts
// ---------------------------------------------------------------------------
function splitName(fullName: string): { givenName: string; surname: string } {
  const idx = fullName.indexOf(" ");
  if (idx === -1) return { givenName: fullName, surname: "" };
  return { givenName: fullName.slice(0, idx), surname: fullName.slice(idx + 1) };
}

// ---------------------------------------------------------------------------
// RosterTable — defined outside ManageClassModal so React never remounts it
// ---------------------------------------------------------------------------
interface RosterTableProps {
  entries: RosterEntry[];
  search: string;
  onSearchChange: (v: string) => void;
  emptyMessage: string;
  loading: boolean;
  error: string | null;
  removingUtorid: string | null;
  removeError: string | null;
  onRemove: (utorid: string) => void;
}

function RosterTable({
  entries,
  search,
  onSearchChange,
  emptyMessage,
  loading,
  error,
  removingUtorid,
  removeError,
  onRemove,
}: RosterTableProps) {
  const q = search.trim().toLowerCase();
  const filtered = q
    ? entries.filter((e) => e.name.toLowerCase().includes(q) || e.utorid.toLowerCase().includes(q))
    : entries;

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-8 bg-stone-100 rounded animate-pulse" />
        ))}
      </div>
    );
  }
  if (error) {
    return <p className="text-xs text-red-500">{error}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by name or UTORid…"
          className="w-full pl-8 pr-3 py-1.5 text-xs border border-stone-200 rounded-lg focus:outline-none focus:border-blue-400 bg-stone-50"
        />
        {search && (
          <button
            onClick={() => onSearchChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {removeError && <p className="text-xs text-red-500">{removeError}</p>}

      {entries.length === 0 ? (
        <p className="text-xs text-stone-400 italic py-1">{emptyMessage}</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-stone-400 italic py-1">No results for &ldquo;{search}&rdquo;.</p>
      ) : (
        <div className="border border-stone-200 rounded-lg overflow-hidden">
          <div className="max-h-52 overflow-y-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-stone-50 border-b border-stone-200 sticky top-0">
                <tr>
                  <th className="px-3 py-2 font-semibold text-stone-500 uppercase tracking-wide">
                    Given Name
                  </th>
                  <th className="px-3 py-2 font-semibold text-stone-500 uppercase tracking-wide">
                    Surname
                  </th>
                  <th className="px-3 py-2 font-semibold text-stone-500 uppercase tracking-wide">
                    UTORid
                  </th>
                  <th className="px-3 py-2 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filtered.map((entry) => {
                  const { givenName, surname } = splitName(entry.name);
                  const isRemoving = removingUtorid === entry.utorid;
                  return (
                    <tr key={entry.utorid} className="hover:bg-stone-50 group">
                      <td className="px-3 py-2 text-stone-700">{givenName}</td>
                      <td className="px-3 py-2 text-stone-700">{surname}</td>
                      <td className="px-3 py-2 text-stone-500 font-mono">{entry.utorid}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => onRemove(entry.utorid)}
                          disabled={isRemoving}
                          title="Remove"
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-stone-400 hover:text-red-500 disabled:opacity-30"
                        >
                          {isRemoving ? (
                            <span className="text-xs text-stone-400">…</span>
                          ) : (
                            <UserMinus className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-1.5 bg-stone-50 border-t border-stone-200 text-xs text-stone-400">
            {filtered.length === entries.length
              ? `${entries.length} ${entries.length === 1 ? "person" : "people"}`
              : `${filtered.length} of ${entries.length} shown`}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ManageClassModal({
  course,
  onClose,
  onRenamed,
  onDeleted,
}: ManageClassModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>("students");

  // ---- Roster state ----
  const [rosterStudents, setRosterStudents] = useState<RosterEntry[]>([]);
  const [rosterTas, setRosterTas] = useState<RosterEntry[]>([]);
  const [rosterProfessors, setRosterProfessors] = useState<RosterEntry[]>([]);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [rosterError, setRosterError] = useState<string | null>(null);

  // ---- Search state ----
  const [studentSearch, setStudentSearch] = useState("");
  const [taSearch, setTaSearch] = useState("");
  const [professorSearch, setProfessorSearch] = useState("");

  // ---- Remove state ----
  const [removingUtorid, setRemovingUtorid] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // ---- Add students state ----
  const [utoridsInput, setUtoridsInput] = useState("");
  const [addingStudents, setAddingStudents] = useState(false);
  const [addResult, setAddResult] = useState<{
    added: string[];
    alreadyEnrolled: string[];
    invalid: string[];
  } | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  // ---- Add TAs state ----
  const [taUtoridsInput, setTaUtoridsInput] = useState("");
  const [addingTas, setAddingTas] = useState(false);
  const [taAddResult, setTaAddResult] = useState<{
    added: string[];
    alreadyEnrolled: string[];
    invalid: string[];
  } | null>(null);
  const [taAddError, setTaAddError] = useState<string | null>(null);

  // ---- Add professors state ----
  const [professorUtoridsInput, setProfessorUtoridsInput] = useState("");
  const [addingProfessors, setAddingProfessors] = useState(false);
  const [professorAddResult, setProfessorAddResult] = useState<{
    added: string[];
    alreadyEnrolled: string[];
    invalid: string[];
  } | null>(null);
  const [professorAddError, setProfessorAddError] = useState<string | null>(null);

  // ---- CSV sync state ----
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [csvParsing, setCsvParsing] = useState(false);
  // Parsed UTORids from the uploaded CSV — stored separately so the diff can be
  // recomputed reactively once the roster finishes loading.
  const [csvParsedUtorids, setCsvParsedUtorids] = useState<string[] | null>(null);
  const [csvPreview, setCsvPreview] = useState<{
    utorids: string[];
    toAdd: string[];
    toRemove: string[];
    unchanged: number;
  } | null>(null);
  const [csvSyncing, setCsvSyncing] = useState(false);
  const [csvSyncResult, setCsvSyncResult] = useState<{
    added: string[];
    removed: string[];
    unchanged: number;
  } | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);

  // ---- Rename state ----
  const [newCode, setNewCode] = useState(course.code);
  const [newSemester, setNewSemester] = useState(course.semester);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameSuccess, setRenameSuccess] = useState(false);

  // ---- Delete state ----
  const [deleteConfirmCode, setDeleteConfirmCode] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ---- Backdrop drag-close prevention ----
  const backdropMouseDownRef = useRef(false);

  // ---- Fetch roster ----
  async function fetchRoster() {
    setRosterError(null);
    try {
      const res = await fetch(`/api/courses/${course.id}/students`);
      const data = await res.json();
      if (!res.ok) {
        setRosterError(data.error ?? "Failed to load roster.");
        return;
      }
      setRosterStudents(data.students ?? []);
      setRosterTas(data.tas ?? []);
      setRosterProfessors(data.professors ?? []);
    } catch {
      setRosterError("Failed to load roster.");
    } finally {
      setRosterLoading(false);
    }
  }

  useEffect(() => {
    fetchRoster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.id]);

  // Recompute the CSV diff whenever either the parsed UTORids or the loaded
  // roster changes — this prevents stale-closure bugs where the roster hadn't
  // finished loading at the time the file was selected.
  useEffect(() => {
    if (!csvParsedUtorids || rosterLoading) return;
    const newSet = new Set(csvParsedUtorids);
    const currentSet = new Set(rosterStudents.map((s) => s.utorid.toLowerCase()));
    const toAdd = [...newSet].filter((u) => !currentSet.has(u));
    const toRemove = [...currentSet].filter((u) => !newSet.has(u));
    const unchanged = [...currentSet].filter((u) => newSet.has(u)).length;
    setCsvPreview({ utorids: csvParsedUtorids, toAdd, toRemove, unchanged });
  }, [csvParsedUtorids, rosterStudents, rosterLoading]);

  // ---- Handlers ----

  async function handleRemove(utorid: string) {
    setRemovingUtorid(utorid);
    setRemoveError(null);
    try {
      const res = await fetch(`/api/courses/${course.id}/students`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utorid }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRemoveError(data.error ?? "Failed to remove.");
        return;
      }
      // Optimistically remove from local state
      setRosterStudents((prev) => prev.filter((e) => e.utorid !== utorid));
      setRosterTas((prev) => prev.filter((e) => e.utorid !== utorid));
      setRosterProfessors((prev) => prev.filter((e) => e.utorid !== utorid));
    } catch {
      setRemoveError("Failed to remove. Please try again.");
    } finally {
      setRemovingUtorid(null);
    }
  }

  async function handleAddStudents() {
    const utorids = utoridsInput
      .split(/[\n,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (utorids.length === 0) return;

    setAddingStudents(true);
    setAddError(null);
    setAddResult(null);

    try {
      const res = await fetch(`/api/courses/${course.id}/students`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utorids }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error ?? "Failed to add students.");
        return;
      }
      setAddResult(data);
      setUtoridsInput("");
      await fetchRoster();
    } catch {
      setAddError("Failed to add students. Please try again.");
    } finally {
      setAddingStudents(false);
    }
  }

  async function handleAddTas() {
    const utorids = taUtoridsInput
      .split(/[\n,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (utorids.length === 0) return;

    setAddingTas(true);
    setTaAddError(null);
    setTaAddResult(null);

    try {
      const res = await fetch(`/api/courses/${course.id}/students`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utorids, role: "TA" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTaAddError(data.error ?? "Failed to add TAs.");
        return;
      }
      setTaAddResult(data);
      setTaUtoridsInput("");
      await fetchRoster();
    } catch {
      setTaAddError("Failed to add TAs. Please try again.");
    } finally {
      setAddingTas(false);
    }
  }

  async function handleAddProfessors() {
    const utorids = professorUtoridsInput
      .split(/[\n,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (utorids.length === 0) return;

    setAddingProfessors(true);
    setProfessorAddError(null);
    setProfessorAddResult(null);

    try {
      const res = await fetch(`/api/courses/${course.id}/students`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utorids, role: "PROFESSOR" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setProfessorAddError(data.error ?? "Failed to add professors.");
        return;
      }
      setProfessorAddResult(data);
      setProfessorUtoridsInput("");
      await fetchRoster();
    } catch {
      setProfessorAddError("Failed to add professors. Please try again.");
    } finally {
      setAddingProfessors(false);
    }
  }

  async function handleCsvSelect(file: File) {
    setCsvError(null);
    setCsvPreview(null);
    setCsvParsedUtorids(null);
    setCsvSyncResult(null);
    setCsvParsing(true);
    try {
      const processed = await parseAndProcessCSV(file);
      const utorids = processed.students
        .map((s) => s.utorid.trim().toLowerCase())
        .filter((u) => u && u !== "missing utorid" && u !== "error");

      if (utorids.length === 0) {
        setCsvError("No valid UTORids found in the CSV.");
        return;
      }

      // Store the parsed UTORids — the diff is computed reactively in the
      // useEffect above, which always runs against the latest rosterStudents.
      setCsvParsedUtorids(utorids);
    } catch {
      setCsvError("Failed to parse CSV. Please check the file format.");
    } finally {
      setCsvParsing(false);
    }
  }

  async function handleCsvSync() {
    if (!csvPreview) return;
    setCsvSyncing(true);
    setCsvError(null);
    try {
      const res = await fetch(`/api/courses/${course.id}/students`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utorids: csvPreview.utorids }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCsvError(data.error ?? "Failed to sync roster.");
        return;
      }
      setCsvSyncResult(data);
      setCsvPreview(null);
      setCsvParsedUtorids(null);
      if (csvInputRef.current) csvInputRef.current.value = "";
      await fetchRoster();
    } catch {
      setCsvError("Failed to sync roster. Please try again.");
    } finally {
      setCsvSyncing(false);
    }
  }

  async function handleRename() {
    if (!newCode.trim() || !newSemester.trim()) return;
    setRenaming(true);
    setRenameError(null);
    setRenameSuccess(false);

    try {
      const res = await fetch(`/api/courses/${course.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: newCode.trim(), semester: newSemester.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRenameError(data.error ?? "Failed to rename course.");
        return;
      }
      setRenameSuccess(true);
      onRenamed(course.id, newCode.trim(), newSemester.trim());
    } catch {
      setRenameError("Failed to rename course. Please try again.");
    } finally {
      setRenaming(false);
    }
  }

  async function handleDelete() {
    if (deleteConfirmCode !== course.code) return;
    setDeleting(true);
    setDeleteError(null);

    try {
      const res = await fetch(`/api/courses/${course.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setDeleteError(data.error ?? "Failed to delete course.");
        return;
      }
      onDeleted(course.id);
      onClose();
    } catch {
      setDeleteError("Failed to delete course. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  // ---- Render ----

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => {
        backdropMouseDownRef.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e) => {
        if (backdropMouseDownRef.current && e.target === e.currentTarget) onClose();
        backdropMouseDownRef.current = false;
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <p className="text-xs text-stone-400 font-medium uppercase tracking-wide">
              Manage Class
            </p>
            <h2 className="text-xl font-bold text-stone-900">{course.code}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b">
          {(
            [
              { id: "students", label: "Students", icon: UserPlus },
              { id: "staff", label: "Staff", icon: GraduationCap },
              { id: "rename", label: "Rename", icon: Pencil },
              { id: "delete", label: "Delete", icon: Trash2 },
            ] as { id: Tab; label: string; icon: React.ElementType }[]
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium transition-colors border-b-2 ${
                activeTab === id
                  ? id === "delete"
                    ? "border-red-500 text-red-600"
                    : "border-green-500 text-green-600"
                  : "border-transparent text-stone-500 hover:text-stone-700"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-6 overflow-y-auto max-h-[70vh]">
          {/* ---- Students ---- */}
          {activeTab === "students" && (
            <div className="flex flex-col gap-4">
              <RosterTable
                entries={rosterStudents}
                search={studentSearch}
                onSearchChange={setStudentSearch}
                emptyMessage="No students enrolled yet."
                loading={rosterLoading}
                error={rosterError}
                removingUtorid={removingUtorid}
                removeError={removeError}
                onRemove={handleRemove}
              />
              <div className="border-t border-stone-100 pt-4 flex flex-col gap-3">
                <p className="text-sm font-medium text-stone-700">Sync Roster from CSV</p>
                <p className="text-xs text-stone-500">
                  Upload your updated class list CSV. Students added to the file will be enrolled;
                  students removed from the file will be unenrolled. TAs and professors are not
                  affected.
                </p>

                {/* File picker */}
                <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-stone-300 rounded-lg cursor-pointer hover:border-green-400 hover:bg-green-50 transition-colors group">
                  <Upload className="w-4 h-4 text-stone-400 group-hover:text-green-500 shrink-0" />
                  <span className="text-xs text-stone-500 group-hover:text-green-600">
                    {csvParsing ? "Parsing…" : "Choose a CSV file"}
                  </span>
                  <input
                    ref={csvInputRef}
                    type="file"
                    accept=".csv"
                    className="sr-only"
                    disabled={csvParsing || csvSyncing}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleCsvSelect(file);
                    }}
                  />
                </label>

                {csvError && <p className="text-xs text-red-600">{csvError}</p>}

                {/* Diff preview */}
                {csvPreview && (
                  <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 flex flex-col gap-1.5 text-xs">
                    <p className="font-medium text-stone-700 mb-0.5">Preview changes</p>
                    {csvPreview.toAdd.length > 0 && (
                      <p className="text-green-700">
                        + {csvPreview.toAdd.length} student
                        {csvPreview.toAdd.length !== 1 ? "s" : ""} to enroll
                      </p>
                    )}
                    {csvPreview.toRemove.length > 0 && (
                      <p className="text-red-600">
                        − {csvPreview.toRemove.length} student
                        {csvPreview.toRemove.length !== 1 ? "s" : ""} to remove
                      </p>
                    )}
                    <p className="text-stone-500">
                      {csvPreview.unchanged} student{csvPreview.unchanged !== 1 ? "s" : ""}{" "}
                      unchanged
                    </p>
                    {csvPreview.toAdd.length === 0 && csvPreview.toRemove.length === 0 && (
                      <p className="text-stone-400 italic">
                        No changes — roster is already up to date.
                      </p>
                    )}
                  </div>
                )}

                {/* Sync result */}
                {csvSyncResult && (
                  <div className="rounded-lg border border-green-200 bg-green-50 p-3 flex flex-col gap-1 text-xs">
                    <p className="font-medium text-green-800 mb-0.5">Roster updated</p>
                    {csvSyncResult.added.length > 0 && (
                      <p className="text-green-700">+ {csvSyncResult.added.length} enrolled</p>
                    )}
                    {csvSyncResult.removed.length > 0 && (
                      <p className="text-red-600">− {csvSyncResult.removed.length} removed</p>
                    )}
                    <p className="text-stone-500">{csvSyncResult.unchanged} unchanged</p>
                  </div>
                )}

                <button
                  onClick={handleCsvSync}
                  disabled={
                    csvSyncing ||
                    !csvPreview ||
                    (csvPreview.toAdd.length === 0 && csvPreview.toRemove.length === 0)
                  }
                  className="flex items-center justify-center gap-1.5 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {csvSyncing ? "Applying…" : "Apply Changes"}
                </button>
              </div>

              <div className="border-t border-stone-100 pt-4 flex flex-col gap-3">
                <p className="text-sm font-medium text-stone-700">Add Students</p>
                <p className="text-xs text-stone-500">
                  Enter one or more UTORids — separated by commas, spaces, or new lines.
                </p>
                <textarea
                  value={utoridsInput}
                  spellCheck={false}
                  onChange={(e) => {
                    setUtoridsInput(e.target.value);
                    setAddResult(null);
                    setAddError(null);
                  }}
                  placeholder={"tasmith2, janedooe, scalijad"}
                  rows={3}
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:border-green-400 focus:ring-4 focus:ring-green-50 transition-all"
                />
                {addError && <p className="text-sm text-red-600">{addError}</p>}
                {addResult && (
                  <div className="text-sm space-y-1">
                    {addResult.added.length > 0 && (
                      <p className="text-green-700">Added: {addResult.added.join(", ")}</p>
                    )}
                    {addResult.alreadyEnrolled.length > 0 && (
                      <p className="text-stone-500">
                        Already enrolled: {addResult.alreadyEnrolled.join(", ")}
                      </p>
                    )}
                    {addResult.invalid.length > 0 && (
                      <p className="text-red-600">Invalid: {addResult.invalid.join(", ")}</p>
                    )}
                  </div>
                )}
                <button
                  onClick={handleAddStudents}
                  disabled={addingStudents || utoridsInput.trim().length === 0}
                  className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {addingStudents ? "Adding…" : "Add Students"}
                </button>
              </div>
            </div>
          )}

          {/* ---- Staff (professors + TAs) ---- */}
          {activeTab === "staff" && (
            <div className="flex flex-col gap-8">
              {/* Professors */}
              <div className="flex flex-col gap-4">
                <p className="text-sm font-semibold text-stone-800">Professors</p>
                <RosterTable
                  entries={rosterProfessors}
                  search={professorSearch}
                  onSearchChange={setProfessorSearch}
                  emptyMessage="No professors enrolled yet."
                  loading={rosterLoading}
                  error={rosterError}
                  removingUtorid={removingUtorid}
                  removeError={removeError}
                  onRemove={handleRemove}
                />
                <div className="border-t border-stone-100 pt-4 flex flex-col gap-3">
                  <p className="text-sm font-medium text-stone-700">Add Professors</p>
                  <p className="text-xs text-stone-500">
                    Enter one or more UTORids — separated by commas, spaces, or new lines.
                    Professors can start sessions, control slides, and manage this course.
                  </p>
                  <textarea
                    value={professorUtoridsInput}
                    spellCheck={false}
                    onChange={(e) => {
                      setProfessorUtoridsInput(e.target.value);
                      setProfessorAddResult(null);
                      setProfessorAddError(null);
                    }}
                    placeholder={"smithj, doejohn"}
                    rows={3}
                    className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:border-green-400 focus:ring-4 focus:ring-green-50 transition-all"
                  />
                  {professorAddError && <p className="text-sm text-red-600">{professorAddError}</p>}
                  {professorAddResult && (
                    <div className="text-sm space-y-1">
                      {professorAddResult.added.length > 0 && (
                        <p className="text-green-700">
                          Added: {professorAddResult.added.join(", ")}
                        </p>
                      )}
                      {professorAddResult.alreadyEnrolled.length > 0 && (
                        <p className="text-stone-500">
                          Already enrolled: {professorAddResult.alreadyEnrolled.join(", ")}
                        </p>
                      )}
                      {professorAddResult.invalid.length > 0 && (
                        <p className="text-red-600">
                          Invalid: {professorAddResult.invalid.join(", ")}
                        </p>
                      )}
                    </div>
                  )}
                  <button
                    onClick={handleAddProfessors}
                    disabled={addingProfessors || professorUtoridsInput.trim().length === 0}
                    className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {addingProfessors ? "Adding…" : "Add Professors"}
                  </button>
                </div>
              </div>

              {/* TAs */}
              <div className="flex flex-col gap-4 border-t border-stone-200 pt-6">
                <p className="text-sm font-semibold text-stone-800">TAs</p>
                <RosterTable
                  entries={rosterTas}
                  search={taSearch}
                  onSearchChange={setTaSearch}
                  emptyMessage="No TAs enrolled yet."
                  loading={rosterLoading}
                  error={rosterError}
                  removingUtorid={removingUtorid}
                  removeError={removeError}
                  onRemove={handleRemove}
                />
                <div className="border-t border-stone-100 pt-4 flex flex-col gap-3">
                  <p className="text-sm font-medium text-stone-700">Add TAs</p>
                  <p className="text-xs text-stone-500">
                    Enter one or more UTORids — separated by commas, spaces, or new lines. TAs can
                    see all questions and answer in restricted mode.
                  </p>
                  <textarea
                    value={taUtoridsInput}
                    spellCheck={false}
                    onChange={(e) => {
                      setTaUtoridsInput(e.target.value);
                      setTaAddResult(null);
                      setTaAddError(null);
                    }}
                    placeholder={"tasmith2, janedooe, scalijad"}
                    rows={3}
                    className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:border-green-400 focus:ring-4 focus:ring-green-50 transition-all"
                  />
                  {taAddError && <p className="text-sm text-red-600">{taAddError}</p>}
                  {taAddResult && (
                    <div className="text-sm space-y-1">
                      {taAddResult.added.length > 0 && (
                        <p className="text-green-700">Added: {taAddResult.added.join(", ")}</p>
                      )}
                      {taAddResult.alreadyEnrolled.length > 0 && (
                        <p className="text-stone-500">
                          Already enrolled: {taAddResult.alreadyEnrolled.join(", ")}
                        </p>
                      )}
                      {taAddResult.invalid.length > 0 && (
                        <p className="text-red-600">Invalid: {taAddResult.invalid.join(", ")}</p>
                      )}
                    </div>
                  )}
                  <button
                    onClick={handleAddTas}
                    disabled={addingTas || taUtoridsInput.trim().length === 0}
                    className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {addingTas ? "Adding…" : "Add TAs"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ---- Rename ---- */}
          {activeTab === "rename" && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-stone-700">Course Code</label>
                <input
                  type="text"
                  value={newCode}
                  onChange={(e) => {
                    setNewCode(e.target.value);
                    setRenameSuccess(false);
                    setRenameError(null);
                  }}
                  placeholder="e.g. CSC398H5"
                  className="border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-400 focus:ring-4 focus:ring-green-50 transition-all"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-stone-700">Semester</label>
                <input
                  type="text"
                  value={newSemester}
                  onChange={(e) => {
                    setNewSemester(e.target.value);
                    setRenameSuccess(false);
                    setRenameError(null);
                  }}
                  placeholder="e.g. Winter 2026"
                  className="border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-400 focus:ring-4 focus:ring-green-50 transition-all"
                />
              </div>
              {renameError && <p className="text-sm text-red-600">{renameError}</p>}
              {renameSuccess && (
                <p className="text-sm text-green-700">Course updated successfully.</p>
              )}
              <button
                onClick={handleRename}
                disabled={
                  renaming ||
                  !newCode.trim() ||
                  !newSemester.trim() ||
                  (newCode.trim() === course.code && newSemester.trim() === course.semester)
                }
                className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {renaming ? "Saving…" : "Save Changes"}
              </button>
            </div>
          )}

          {/* ---- Delete ---- */}
          {activeTab === "delete" && (
            <div className="flex flex-col gap-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
                This will permanently delete <strong>{course.code}</strong> and all its sessions,
                slides, and questions. This cannot be undone.
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-stone-700">
                  Type <span className="font-mono font-bold">{course.code}</span> to confirm
                </label>
                <input
                  type="text"
                  value={deleteConfirmCode}
                  onChange={(e) => {
                    setDeleteConfirmCode(e.target.value);
                    setDeleteError(null);
                  }}
                  placeholder={course.code}
                  className="border border-stone-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-red-400"
                />
              </div>
              {deleteError && <p className="text-sm text-red-600">{deleteError}</p>}
              <button
                onClick={handleDelete}
                disabled={deleting || deleteConfirmCode !== course.code}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete Course"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
