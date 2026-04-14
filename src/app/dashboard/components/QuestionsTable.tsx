"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2, Search, ChevronDown, ChevronRight } from "lucide-react";
import DeleteConfirmModal from "./DeleteConfirmModal";

interface Answer {
  id: string;
  content: string;
  authorId: string;
  author: { name: string; utorid: string } | null;
  isAnonymous: boolean;
  isAccepted: boolean;
  upvoteCount: number;
  createdAt: string;
}

interface Question {
  id: string;
  content: string;
  status: string;
  visibility: string;
  isAnonymous: boolean;
  upvoteCount: number;
  createdAt: string;
  author: { name: string; utorid: string } | null;
  session: { title: string; course: { code: string } };
  _count: { answers: number };
}

export default function QuestionsTable() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer[]>>({});
  const [deleteTarget, setDeleteTarget] = useState<{
    type: "question" | "answer" | "all";
    id?: string; // id for single question or single answer
    parentId?: string; // questionId if deleting answer
    name?: string; // string snippet of question or answer text
  } | null>(null);

  const fetchQuestions = useCallback(
    (append = false) => {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      params.set("limit", "50");
      if (append && cursor) params.set("cursor", cursor);

      fetch(`/api/admin/questions?${params}`)
        .then((res) => (res.ok ? res.json() : { questions: [], nextCursor: null }))
        .then((data) => {
          const items = data.questions ?? [];
          setQuestions((prev) => (append ? [...prev, ...items] : items));
          setCursor(data.nextCursor ?? null);
          setHasMore(!!data.nextCursor);
        })
        .catch(() => {
          if (!append) setQuestions([]);
        })
        .finally(() => setLoading(false));
    },
    [search, statusFilter, cursor]
  );

  useEffect(() => {
    setCursor(null);
    fetchQuestions(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter]);

  const confirmDeleteQuestion = async (questionId: string) => {
    const res = await fetch(`/api/admin/questions/${questionId}`, { method: "DELETE" });
    if (res.ok) {
      setQuestions((prev) => prev.filter((q) => q.id !== questionId));
      if (expandedId === questionId) setExpandedId(null);
    } else alert("Failed to delete question.");
  };

  const confirmDeleteAll = async () => {
    const res = await fetch(`/api/admin/questions/all`, { method: "DELETE" });
    if (res.ok) {
      setQuestions([]);
      setAnswers({});
      setExpandedId(null);
    } else alert("Failed to delete all questions.");
  };

  const confirmDeleteAnswer = async (answerId: string, questionId: string) => {
    const res = await fetch(`/api/admin/answers/${answerId}`, { method: "DELETE" });
    if (res.ok) {
      setAnswers((prev) => ({
        ...prev,
        [questionId]: (prev[questionId] ?? []).filter((a) => a.id !== answerId),
      }));
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === questionId ? { ...q, _count: { answers: Math.max(0, q._count.answers - 1) } } : q
        )
      );
    } else alert("Failed to delete answer.");
  };

  const toggleExpand = async (questionId: string) => {
    if (expandedId === questionId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(questionId);
    if (!answers[questionId]) {
      const res = await fetch(`/api/questions/${questionId}/answers`);
      if (res.ok) {
        const data = await res.json();
        setAnswers((prev) => ({ ...prev, [questionId]: data.answers ?? [] }));
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <Input
            placeholder="Search by content…"
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
          <option value="OPEN">Open</option>
          <option value="ANSWERED">Answered</option>
          <option value="RESOLVED">Resolved</option>
        </select>
        <Button variant="destructive" onClick={() => setDeleteTarget({ type: "all" })}>
          Delete All Questions
        </Button>
      </div>

      <div className="rounded-md border bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-stone-50 text-stone-500">
              <th className="w-8 px-2 py-3"></th>
              <th className="text-left px-4 py-3 font-medium">Content</th>
              <th className="text-left px-4 py-3 font-medium">Author</th>
              <th className="text-left px-4 py-3 font-medium">Session</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-center px-4 py-3 font-medium">Answers</th>
              <th className="text-center px-4 py-3 font-medium">Votes</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && questions.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-stone-400">
                  Loading…
                </td>
              </tr>
            ) : questions.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-stone-400">
                  No questions found.
                </td>
              </tr>
            ) : (
              questions.map((q) => (
                <React.Fragment key={q.id}>
                  <tr className="border-b last:border-0 hover:bg-stone-50">
                    <td className="px-2 py-3">
                      {q._count.answers > 0 && (
                        <button
                          onClick={() => toggleExpand(q.id)}
                          className="text-stone-400 hover:text-stone-600"
                        >
                          {expandedId === q.id ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-xs truncate" title={q.content}>
                      {q.content.length > 80 ? q.content.slice(0, 80) + "…" : q.content}
                    </td>
                    <td className="px-4 py-3 text-stone-500">
                      {q.isAnonymous ? (
                        <span className="italic">Anonymous</span>
                      ) : (
                        (q.author?.name ?? "—")
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="font-mono">{q.session.course.code}</span>
                      <span className="text-stone-400 ml-1">/ {q.session.title}</span>
                    </td>
                    <td className="px-4 py-3">
                      <QuestionStatusBadge status={q.status} />
                    </td>
                    <td className="px-4 py-3 text-center">{q._count.answers}</td>
                    <td className="px-4 py-3 text-center">{q.upvoteCount}</td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() =>
                          setDeleteTarget({ type: "question", id: q.id, name: q.content })
                        }
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                  {expandedId === q.id && (
                    <tr>
                      <td colSpan={8} className="bg-stone-50 px-8 py-3">
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-stone-500 uppercase">Answers</p>
                          {(answers[q.id] ?? []).length === 0 ? (
                            <p className="text-sm text-stone-400">Loading answers…</p>
                          ) : (
                            (answers[q.id] ?? []).map((a) => (
                              <div
                                key={a.id}
                                className="flex items-start justify-between gap-4 rounded-md border bg-white px-4 py-3"
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm">{a.content}</p>
                                  <p className="text-xs text-stone-400 mt-1">
                                    {a.isAnonymous ? "Anonymous" : (a.author?.name ?? "—")} &middot;{" "}
                                    {a.upvoteCount} votes
                                    {a.isAccepted && (
                                      <span className="ml-2 text-green-600 font-medium">
                                        Accepted
                                      </span>
                                    )}
                                  </p>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() =>
                                    setDeleteTarget({
                                      type: "answer",
                                      id: a.id,
                                      parentId: q.id,
                                      name: a.content,
                                    })
                                  }
                                  className="text-red-500 hover:text-red-700 hover:bg-red-50 shrink-0"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            ))
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
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
            onClick={() => fetchQuestions(true)}
            disabled={loading}
          >
            {loading ? "Loading…" : "Load More"}
          </Button>
        </div>
      )}

      <DeleteConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={
          deleteTarget?.type === "all"
            ? "Delete All Questions"
            : deleteTarget?.type === "question"
              ? "Delete Question"
              : "Delete Answer"
        }
        description={
          deleteTarget?.type === "all" ? (
            <>
              This will permanently delete <strong>ALL questions</strong> and{" "}
              <strong>ALL answers</strong>. This cannot be undone.
            </>
          ) : deleteTarget?.type === "question" ? (
            <>
              This will permanently delete this question and <strong>ALL its answers</strong>. This
              cannot be undone.
              <br />
              <br />
              <span className="text-stone-500 italic block border-l-2 pl-2">
                &ldquo;
                {deleteTarget?.name?.slice(0, 100) +
                  (deleteTarget?.name && deleteTarget.name.length > 100 ? "..." : "")}
                &rdquo;
              </span>
            </>
          ) : (
            <>
              This will permanently delete this answer. This cannot be undone.
              <br />
              <br />
              <span className="text-stone-500 italic block border-l-2 pl-2">
                &ldquo;
                {deleteTarget?.name?.slice(0, 100) +
                  (deleteTarget?.name && deleteTarget.name.length > 100 ? "..." : "")}
                &rdquo;
              </span>
            </>
          )
        }
        requireTypeToConfirm={deleteTarget?.type === "all" ? "DELETE QUESTIONS" : undefined}
        confirmText={
          deleteTarget?.type === "all"
            ? "Delete All Questions"
            : deleteTarget?.type === "question"
              ? "Delete Question"
              : "Delete Answer"
        }
        onConfirm={async () => {
          if (deleteTarget?.type === "all") {
            await confirmDeleteAll();
          } else if (deleteTarget?.type === "question" && deleteTarget.id) {
            await confirmDeleteQuestion(deleteTarget.id);
          } else if (deleteTarget?.type === "answer" && deleteTarget.id && deleteTarget.parentId) {
            await confirmDeleteAnswer(deleteTarget.id, deleteTarget.parentId);
          }
        }}
      />
    </div>
  );
}

function QuestionStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    OPEN: "bg-blue-100 text-blue-700",
    ANSWERED: "bg-yellow-100 text-yellow-700",
    RESOLVED: "bg-green-100 text-green-700",
  };
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? styles.OPEN}`}
    >
      {status}
    </span>
  );
}
