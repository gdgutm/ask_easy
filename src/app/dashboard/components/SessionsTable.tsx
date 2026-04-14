"use client";

import React, { useEffect, useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2, Search } from "lucide-react";
import DeleteConfirmModal from "./DeleteConfirmModal";

interface Session {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  course: { code: string; name: string };
  createdBy: { name: string; utorid: string };
  _count: { questions: number };
}

export default function SessionsTable() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{
    type: "single" | "all";
    id?: string;
    title?: string;
  } | null>(null);

  const fetchRef = useRef(0);

  useEffect(() => {
    const id = ++fetchRef.current;
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    fetch(`/api/admin/sessions?${params}`)
      .then((res) => (res.ok ? res.json() : { sessions: [] }))
      .then((data) => {
        if (id === fetchRef.current) setSessions(data.sessions ?? []);
      })
      .catch(() => {
        if (id === fetchRef.current) setSessions([]);
      });
  }, [search, statusFilter]);

  const confirmDeleteSingle = async (sessionId: string) => {
    const res = await fetch(`/api/admin/sessions/${sessionId}`, { method: "DELETE" });
    if (res.ok) {
      fetchRef.current++;
      setSessions((prev) => (prev ? prev.filter((s) => s.id !== sessionId) : prev));
    } else alert("Failed to delete session.");
  };

  const confirmDeleteAll = async () => {
    const res = await fetch(`/api/admin/sessions/all`, { method: "DELETE" });
    if (res.ok) {
      fetchRef.current++;
      setSessions([]);
    } else alert("Failed to delete all sessions.");
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <Input
            placeholder="Search by title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          <option value="">All Statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="SCHEDULED">Scheduled</option>
          <option value="ENDED">Ended</option>
        </select>
        <Button variant="destructive" onClick={() => setDeleteTarget({ type: "all" })}>
          Delete All Sessions
        </Button>
      </div>

      <div className="rounded-md border bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-stone-50 text-stone-500">
              <th className="text-left px-4 py-3 font-medium">Title</th>
              <th className="text-left px-4 py-3 font-medium">Course</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Created By</th>
              <th className="text-center px-4 py-3 font-medium">Questions</th>
              <th className="text-left px-4 py-3 font-medium">Created</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sessions === null ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-stone-400">
                  Loading…
                </td>
              </tr>
            ) : sessions.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-stone-400">
                  No sessions found.
                </td>
              </tr>
            ) : (
              sessions.map((session) => (
                <tr key={session.id} className="border-b last:border-0 hover:bg-stone-50">
                  <td className="px-4 py-3">{session.title}</td>
                  <td className="px-4 py-3 font-mono text-xs">{session.course.code}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={session.status} />
                  </td>
                  <td className="px-4 py-3 text-stone-500">{session.createdBy.name}</td>
                  <td className="px-4 py-3 text-center">{session._count.questions}</td>
                  <td className="px-4 py-3 text-stone-500">
                    {new Date(session.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        setDeleteTarget({ type: "single", id: session.id, title: session.title })
                      }
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <DeleteConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={deleteTarget?.type === "all" ? "Delete All Sessions" : "Delete Session"}
        description={
          deleteTarget?.type === "all" ? (
            <>
              This will permanently delete <strong>ALL sessions</strong> and{" "}
              <strong>ALL their associated questions, answers, and slides</strong>. This cannot be
              undone.
            </>
          ) : (
            <>
              This will permanently delete session <strong>{deleteTarget?.title}</strong> and{" "}
              <strong>ALL its questions, answers, and slides</strong>. This cannot be undone.
            </>
          )
        }
        requireTypeToConfirm={deleteTarget?.type === "all" ? "DELETE SESSIONS" : undefined}
        confirmText={deleteTarget?.type === "all" ? "Delete All Sessions" : "Delete Session"}
        onConfirm={async () => {
          if (deleteTarget?.type === "all") {
            await confirmDeleteAll();
          } else if (deleteTarget?.type === "single" && deleteTarget.id) {
            await confirmDeleteSingle(deleteTarget.id);
          }
        }}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ACTIVE: "bg-green-100 text-green-700",
    SCHEDULED: "bg-yellow-100 text-yellow-700",
    ENDED: "bg-stone-100 text-stone-600",
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? styles.ENDED}`}
    >
      {status}
    </span>
  );
}
