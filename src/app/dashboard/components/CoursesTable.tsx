"use client";

import React, { useEffect, useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2, Search } from "lucide-react";
import DeleteConfirmModal from "./DeleteConfirmModal";

interface Course {
  id: string;
  code: string;
  name: string;
  semester: string;
  createdBy: { name: string; utorid: string };
  _count: { enrollments: number; sessions: number };
}

export default function CoursesTable() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{
    type: "single" | "all";
    id?: string;
    code?: string;
  } | null>(null);

  const fetchRef = useRef(0);

  useEffect(() => {
    const id = ++fetchRef.current;
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    fetch(`/api/admin/courses?${params}`)
      .then((res) => (res.ok ? res.json() : { courses: [] }))
      .then((data) => {
        if (id === fetchRef.current) setCourses(data.courses ?? []);
      })
      .catch(() => {
        if (id === fetchRef.current) setCourses([]);
      });
  }, [search]);

  const confirmDeleteSingle = async (courseId: string) => {
    const res = await fetch(`/api/admin/courses/${courseId}`, { method: "DELETE" });
    if (res.ok) {
      fetchRef.current++;
      setCourses((prev) => prev.filter((c) => c.id !== courseId));
    } else alert("Failed to delete course.");
  };

  const confirmDeleteAll = async () => {
    const res = await fetch(`/api/admin/courses/all`, { method: "DELETE" });
    if (res.ok) {
      fetchRef.current++;
      setCourses([]);
    } else alert("Failed to delete all courses.");
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <Input
            placeholder="Search by code or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="destructive" onClick={() => setDeleteTarget({ type: "all" })}>
          Delete All Courses
        </Button>
      </div>

      <div className="rounded-md border bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-stone-50 text-stone-500">
              <th className="text-left px-4 py-3 font-medium">Code</th>
              <th className="text-left px-4 py-3 font-medium">Name</th>
              <th className="text-left px-4 py-3 font-medium">Semester</th>
              <th className="text-left px-4 py-3 font-medium">Created By</th>
              <th className="text-center px-4 py-3 font-medium">Enrollments</th>
              <th className="text-center px-4 py-3 font-medium">Sessions</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {courses === null ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-stone-400">
                  Loading…
                </td>
              </tr>
            ) : courses.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-stone-400">
                  No courses found.
                </td>
              </tr>
            ) : (
              courses.map((course) => (
                <tr key={course.id} className="border-b last:border-0 hover:bg-stone-50">
                  <td className="px-4 py-3 font-mono text-xs">{course.code}</td>
                  <td className="px-4 py-3">{course.name}</td>
                  <td className="px-4 py-3 text-stone-500">{course.semester}</td>
                  <td className="px-4 py-3 text-stone-500">{course.createdBy.name}</td>
                  <td className="px-4 py-3 text-center">{course._count.enrollments}</td>
                  <td className="px-4 py-3 text-center">{course._count.sessions}</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        setDeleteTarget({ type: "single", id: course.id, code: course.code })
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
        title={deleteTarget?.type === "all" ? "Delete All Courses" : "Delete Course"}
        description={
          deleteTarget?.type === "all" ? (
            <>
              This will permanently delete <strong>ALL courses</strong> and{" "}
              <strong>ALL their sessions, questions, and enrollments</strong>. This cannot be
              undone.
            </>
          ) : (
            <>
              This will permanently delete <strong>{deleteTarget?.code}</strong> and{" "}
              <strong>ALL its sessions, questions, and enrollments</strong>. This cannot be undone.
            </>
          )
        }
        requireTypeToConfirm={deleteTarget?.type === "all" ? "DELETE COURSES" : undefined}
        confirmText={deleteTarget?.type === "all" ? "Delete All Courses" : "Delete Course"}
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
