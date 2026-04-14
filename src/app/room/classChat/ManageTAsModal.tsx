"use client";

import { useEffect, useRef, useState } from "react";
import { X, UserMinus, UserPlus, GraduationCap, Loader2 } from "lucide-react";
import { useRoom } from "../RoomContext";

interface TAEntry {
  name: string;
  utorid: string;
}

interface ManageTAsModalProps {
  onClose: () => void;
}

export default function ManageTAsModal({ onClose }: ManageTAsModalProps) {
  const { sessionId } = useRoom();

  const [courseId, setCourseId] = useState<string | null>(null);
  const [tas, setTas] = useState<TAEntry[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [rosterError, setRosterError] = useState<string | null>(null);

  const [utoridInput, setUtoridInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);

  const [removingUtorid, setRemovingUtorid] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Resolve courseId from the session, then load TAs
  useEffect(() => {
    if (!sessionId) return;

    async function load() {
      setLoadingRoster(true);
      setRosterError(null);
      try {
        const sessionRes = await fetch(`/api/sessions/${sessionId}`);
        if (!sessionRes.ok) throw new Error("Could not load session.");
        const sessionData = await sessionRes.json();
        const cId: string = sessionData.courseId;
        setCourseId(cId);

        const rosterRes = await fetch(`/api/courses/${cId}/students`);
        if (!rosterRes.ok) throw new Error("Could not load TA roster.");
        const rosterData = await rosterRes.json();
        setTas(rosterData.tas ?? []);
      } catch (err) {
        setRosterError(err instanceof Error ? err.message : "An error occurred.");
      } finally {
        setLoadingRoster(false);
      }
    }

    load();
  }, [sessionId]);

  async function handleAdd() {
    const utorid = utoridInput.trim().toLowerCase();
    if (!utorid || !courseId) return;
    setAdding(true);
    setAddError(null);
    setAddSuccess(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/students`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utorids: [utorid], role: "TA" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error ?? "Failed to add TA.");
        return;
      }
      if (data.alreadyEnrolled?.includes(utorid)) {
        setAddError(`${utorid} is already a TA or enrolled in this course.`);
        return;
      }
      setUtoridInput("");
      setAddSuccess(`${utorid} added as TA.`);
      // Refresh TA list
      const rosterRes = await fetch(`/api/courses/${courseId}/students`);
      if (rosterRes.ok) {
        const rosterData = await rosterRes.json();
        setTas(rosterData.tas ?? []);
      }
      inputRef.current?.focus();
    } catch {
      setAddError("An error occurred. Please try again.");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(utorid: string) {
    if (!courseId) return;
    setRemovingUtorid(utorid);
    setRemoveError(null);
    setAddSuccess(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/students`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utorid }),
      });
      if (!res.ok) {
        const data = await res.json();
        setRemoveError(data.error ?? "Failed to remove TA.");
        return;
      }
      setTas((prev) => prev.filter((ta) => ta.utorid !== utorid));
    } catch {
      setRemoveError("An error occurred. Please try again.");
    } finally {
      setRemovingUtorid(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-md shadow-xl border border-stone-200 w-full max-w-sm mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-stone-500" />
            <h2 className="text-base font-bold text-stone-900">Manage TAs</h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Add TA */}
        <div className="px-5 pt-4 pb-3 border-b border-stone-100">
          <p className="text-xs font-medium text-stone-500 mb-2">Add by UTORid</p>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={utoridInput}
              onChange={(e) => {
                setUtoridInput(e.target.value);
                setAddError(null);
                setAddSuccess(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
              placeholder="e.g. smithj12"
              className="flex-1 h-9 px-3 text-sm border border-stone-200 rounded-md bg-stone-50 focus:outline-none focus:border-stone-400 focus:bg-white transition-colors placeholder:text-stone-400"
              disabled={adding}
            />
            <button
              onClick={handleAdd}
              disabled={adding || !utoridInput.trim()}
              className="h-9 px-3 flex items-center gap-1.5 bg-green-100 hover:bg-green-200 text-green-700 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {adding ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <UserPlus className="w-3.5 h-3.5" />
              )}
              Add
            </button>
          </div>
          {addError && <p className="mt-1.5 text-xs text-red-500">{addError}</p>}
          {addSuccess && <p className="mt-1.5 text-xs text-green-600">{addSuccess}</p>}
        </div>

        {/* TA list */}
        <div className="px-5 py-3">
          <p className="text-xs font-medium text-stone-500 mb-2">
            Current TAs{!loadingRoster && ` (${tas.length})`}
          </p>

          {loadingRoster ? (
            <div className="space-y-2 py-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-8 bg-stone-100 rounded animate-pulse" />
              ))}
            </div>
          ) : rosterError ? (
            <p className="text-xs text-red-500 py-1">{rosterError}</p>
          ) : tas.length === 0 ? (
            <p className="text-xs text-stone-400 py-2">No TAs assigned yet.</p>
          ) : (
            <ul className="max-h-48 overflow-y-auto -mx-1 divide-y divide-stone-50">
              {tas.map((ta) => (
                <li key={ta.utorid} className="flex items-center justify-between gap-2 px-1 py-1.5">
                  <div className="min-w-0">
                    <span className="text-sm text-stone-800 font-medium truncate block">
                      {ta.name}
                    </span>
                    <span className="text-xs text-stone-400">{ta.utorid}</span>
                  </div>
                  <button
                    onClick={() => handleRemove(ta.utorid)}
                    disabled={removingUtorid === ta.utorid}
                    className="w-7 h-7 flex items-center justify-center rounded-md text-stone-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40 shrink-0"
                    aria-label={`Remove ${ta.utorid}`}
                  >
                    {removingUtorid === ta.utorid ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <UserMinus className="w-3.5 h-3.5" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {removeError && <p className="mt-1 text-xs text-red-500">{removeError}</p>}
        </div>
      </div>
    </div>
  );
}
