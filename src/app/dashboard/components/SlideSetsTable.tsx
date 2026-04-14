"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2, Search } from "lucide-react";
import DeleteConfirmModal from "./DeleteConfirmModal";

interface SlideSet {
  id: string;
  filename: string;
  fileSize: number;
  pageCount: number;
  createdAt: string;
  session: { title: string; course: { code: string } };
  uploader: { name: string; utorid: string };
}

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export default function SlideSetsTable() {
  const [slideSets, setSlideSets] = useState<SlideSet[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    type: "single" | "all";
    id?: string;
    filename?: string;
  } | null>(null);

  const fetchRef = useRef(0);

  const fetchSlideSets = useCallback(
    (append = false) => {
      setLoading(true);
      const id = ++fetchRef.current;
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("limit", "50");
      if (append && cursor) params.set("cursor", cursor);

      fetch(`/api/admin/slidesets?${params}`)
        .then((res) => (res.ok ? res.json() : { slideSets: [], nextCursor: null }))
        .then((data) => {
          if (id !== fetchRef.current) return;
          const items = data.slideSets ?? [];
          setSlideSets((prev) => (append ? [...prev, ...items] : items));
          setCursor(data.nextCursor ?? null);
          setHasMore(!!data.nextCursor);
        })
        .catch(() => {
          if (!append && id === fetchRef.current) setSlideSets([]);
        })
        .finally(() => {
          if (id === fetchRef.current) setLoading(false);
        });
    },
    [search, cursor]
  );

  useEffect(() => {
    setCursor(null);
    const timeout = setTimeout(() => {
      fetchSlideSets(false);
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const confirmDeleteSingle = async (slideSetId: string) => {
    const res = await fetch(`/api/admin/slidesets/${slideSetId}`, { method: "DELETE" });
    if (res.ok) setSlideSets((prev) => prev.filter((s) => s.id !== slideSetId));
    else alert("Failed to delete slideset.");
  };

  const confirmDeleteAll = async () => {
    const res = await fetch(`/api/admin/slidesets/all`, { method: "DELETE" });
    if (res.ok) {
      setSlideSets([]);
    } else alert("Failed to delete all slidesets.");
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <Input
            placeholder="Search by filename…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="destructive" onClick={() => setDeleteTarget({ type: "all" })}>
          Delete All Slide Sets
        </Button>
      </div>

      <div className="rounded-md border bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-stone-50 text-stone-500">
              <th className="text-left px-4 py-3 font-medium">Filename</th>
              <th className="text-left px-4 py-3 font-medium">Session</th>
              <th className="text-left px-4 py-3 font-medium">Uploader</th>
              <th className="text-center px-4 py-3 font-medium">Pages</th>
              <th className="text-center px-4 py-3 font-medium">Size</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && slideSets.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-stone-400">
                  Loading…
                </td>
              </tr>
            ) : slideSets.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-stone-400">
                  No slide sets found.
                </td>
              </tr>
            ) : (
              slideSets.map((s) => (
                <tr key={s.id} className="border-b last:border-0 hover:bg-stone-50">
                  <td className="px-4 py-3 max-w-[200px] truncate" title={s.filename}>
                    {s.filename}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs">{s.session?.course?.code}</span>
                    <span className="text-stone-400 ml-1 text-xs">{s.session?.title}</span>
                  </td>
                  <td className="px-4 py-3 text-stone-500">{s.uploader?.name}</td>
                  <td className="px-4 py-3 text-center">{s.pageCount}</td>
                  <td className="px-4 py-3 text-center text-stone-500 text-xs">
                    {formatBytes(s.fileSize)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        setDeleteTarget({ type: "single", id: s.id, filename: s.filename })
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
            onClick={() => fetchSlideSets(true)}
            disabled={loading}
          >
            {loading ? "Loading…" : "Load More"}
          </Button>
        </div>
      )}

      <DeleteConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={deleteTarget?.type === "all" ? "Delete All Slide Sets" : "Delete Slide Set"}
        description={
          deleteTarget?.type === "all" ? (
            <>
              This will permanently delete <strong>ALL slide sets</strong> and their associated
              physical storage files. This cannot be undone.
            </>
          ) : (
            <>
              Permanently delete <strong>{deleteTarget?.filename}</strong> and its physical storage
              file?
            </>
          )
        }
        requireTypeToConfirm={deleteTarget?.type === "all" ? "DELETE SLIDESETS" : undefined}
        confirmText={deleteTarget?.type === "all" ? "Delete All Slide Sets" : "Delete Slide Set"}
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
