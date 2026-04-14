"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2, Search } from "lucide-react";
import DeleteConfirmModal from "./DeleteConfirmModal";

interface Enrollment {
  id: string;
  role: string;
  user: { name: string; utorid: string };
  course: { code: string; name: string };
}

export default function EnrollmentsTable() {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    type: "single" | "all";
    id?: string;
    userName?: string;
    courseCode?: string;
  } | null>(null);

  const fetchEnrollments = useCallback(
    (append = false) => {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (roleFilter) params.set("role", roleFilter);
      params.set("limit", "50");
      if (append && cursor) params.set("cursor", cursor);

      fetch(`/api/admin/enrollments?${params}`)
        .then((res) => (res.ok ? res.json() : { enrollments: [], nextCursor: null }))
        .then((data) => {
          const items = data.enrollments ?? [];
          setEnrollments((prev) => (append ? [...prev, ...items] : items));
          setCursor(data.nextCursor ?? null);
          setHasMore(!!data.nextCursor);
        })
        .catch(() => {
          if (!append) setEnrollments([]);
        })
        .finally(() => setLoading(false));
    },
    [search, roleFilter, cursor]
  );

  useEffect(() => {
    setCursor(null);
    fetchEnrollments(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, roleFilter]);

  const confirmDeleteSingle = async (enrollmentId: string) => {
    const res = await fetch(`/api/admin/enrollments/${enrollmentId}`, { method: "DELETE" });
    if (res.ok) setEnrollments((prev) => prev.filter((e) => e.id !== enrollmentId));
    else alert("Failed to delete enrollment.");
  };

  const confirmDeleteAll = async () => {
    const res = await fetch(`/api/admin/enrollments/all`, { method: "DELETE" });
    if (res.ok) {
      setEnrollments([]);
    } else alert("Failed to delete all enrollments.");
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <Input
            placeholder="Search by name, UTORid, or course…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          <option value="">All Roles</option>
          <option value="STUDENT">Student</option>
          <option value="TA">TA</option>
          <option value="PROFESSOR">Professor</option>
        </select>
        <Button variant="destructive" onClick={() => setDeleteTarget({ type: "all" })}>
          Delete All Enrollments
        </Button>
      </div>

      <div className="rounded-md border bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-stone-50 text-stone-500">
              <th className="text-left px-4 py-3 font-medium">User</th>
              <th className="text-left px-4 py-3 font-medium">UTORid</th>
              <th className="text-left px-4 py-3 font-medium">Course</th>
              <th className="text-left px-4 py-3 font-medium">Role</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && enrollments.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-stone-400">
                  Loading…
                </td>
              </tr>
            ) : enrollments.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-stone-400">
                  No enrollments found.
                </td>
              </tr>
            ) : (
              enrollments.map((e) => (
                <tr key={e.id} className="border-b last:border-0 hover:bg-stone-50">
                  <td className="px-4 py-3">{e.user.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{e.user.utorid}</td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs">{e.course.code}</span>
                    <span className="text-stone-400 ml-1 text-xs">— {e.course.name}</span>
                  </td>
                  <td className="px-4 py-3">
                    <RoleBadge role={e.role} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        setDeleteTarget({
                          type: "single",
                          id: e.id,
                          userName: e.user.name,
                          courseCode: e.course.code,
                        })
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

      {hasMore && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchEnrollments(true)}
            disabled={loading}
          >
            {loading ? "Loading…" : "Load More"}
          </Button>
        </div>
      )}

      <DeleteConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={deleteTarget?.type === "all" ? "Delete All Enrollments" : "Delete Enrollment"}
        description={
          deleteTarget?.type === "all" ? (
            <>
              This will permanently delete <strong>ALL enrollments</strong>. This cannot be undone.
            </>
          ) : (
            <>
              Remove <strong>{deleteTarget?.userName}</strong> from{" "}
              <strong>{deleteTarget?.courseCode}</strong>?
            </>
          )
        }
        requireTypeToConfirm={deleteTarget?.type === "all" ? "DELETE ENROLLMENTS" : undefined}
        confirmText={deleteTarget?.type === "all" ? "Delete All Enrollments" : "Delete Enrollment"}
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

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    PROFESSOR: "bg-purple-100 text-purple-700",
    TA: "bg-blue-100 text-blue-700",
    STUDENT: "bg-stone-100 text-stone-600",
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[role] ?? styles.STUDENT}`}
    >
      {role}
    </span>
  );
}
