"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Calendar,
  DoorOpen,
  LayoutGrid,
  PlusCircle,
  Settings,
  Users,
} from "lucide-react";

import ManageClassModal from "../classes/ManageClassModal";
import RoomGrid from "./RoomGrid";
import type { ClasslistSummary } from "./classTypes";

interface ClassBrowserProps {
  isAdmin: boolean;
}

/** How often the live-session state is re-checked while the page is open. */
const REFRESH_MS = 8000;

export default function ClassBrowser({ isAdmin }: ClassBrowserProps) {
  const [classlists, setClasslists] = useState<ClasslistSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [managingId, setManagingId] = useState<string | null>(null);

  // The poll must not clobber a selection the reader made a moment ago, so it
  // only ever replaces the data.
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/classlists");
      if (!res.ok) return;
      const data = (await res.json()) as { classlists: ClasslistSummary[] };
      setClasslists(data.classlists ?? []);
    } catch {
      /* transient — the next poll retries */
    } finally {
      setReady(true);
    }
  }, []);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    void loadRef.current();
    const interval = setInterval(() => void loadRef.current(), REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  const selected = selectedId ? (classlists.find((c) => c.id === selectedId) ?? null) : null;
  const managing = managingId ? (classlists.find((c) => c.id === managingId) ?? null) : null;

  // A class deleted in another tab (or by another admin) leaves a dangling
  // selection pointing at nothing.
  useEffect(() => {
    if (selectedId && ready && !classlists.some((c) => c.id === selectedId)) {
      setSelectedId(null);
    }
  }, [classlists, ready, selectedId]);

  if (!ready) {
    return (
      <div className="w-full flex-1 flex items-center justify-center min-h-[40vh]">
        <span className="text-stone-400 text-sm">Loading…</span>
      </div>
    );
  }

  if (selected) {
    return (
      <RoomGrid
        classlist={selected}
        onBack={() => setSelectedId(null)}
        onRefresh={() => void load()}
      />
    );
  }

  return (
    <>
      <div className="max-w-6xl mx-auto w-full mb-10 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-4xl font-bold text-stone-900 tracking-tight mb-2">My Classes</h2>
          <p className="text-lg text-stone-500">
            {classlists.length === 0
              ? isAdmin
                ? "Upload a classlist to get started."
                : "You aren't on any classes yet."
              : "Open a class to see its rooms — one per professor."}
          </p>
        </div>
        {isAdmin && classlists.length > 0 && (
          <Link
            href="/create-class"
            className="hidden sm:flex items-center gap-2 px-6 py-3 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-md transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 shrink-0"
          >
            <PlusCircle className="w-5 h-5" />
            Create Classlist
          </Link>
        )}
      </div>

      {classlists.length === 0 ? (
        <EmptyState isAdmin={isAdmin} />
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto w-full">
          {classlists.map((classlist) => (
            <div
              key={classlist.id}
              onClick={() => setSelectedId(classlist.id)}
              className="group relative overflow-hidden flex flex-col p-6 sm:p-8 rounded-md transition-all duration-300 bg-white border-2 border-stone-100 hover:border-stone-200 shadow-sm hover:shadow-xl cursor-pointer min-h-[16rem]"
            >
              <div className="flex items-start justify-between w-full mb-6">
                <div className="w-12 h-12 rounded-md flex items-center justify-center shrink-0 bg-stone-50 text-stone-600 transition-all group-hover:scale-110">
                  <BookOpen className="w-6 h-6" />
                </div>

                <div className="flex items-center gap-2">
                  {classlist.liveRoomCount > 0 && (
                    <span className="flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 text-xs font-bold rounded-md border border-green-200 shadow-sm animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      {classlist.liveRoomCount} LIVE
                    </span>
                  )}
                  {classlist.isCreator && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setManagingId(classlist.id);
                      }}
                      aria-label={`Manage ${classlist.code}`}
                      className="w-8 h-8 flex items-center justify-center rounded-md text-stone-400 hover:text-stone-900 hover:bg-stone-100 transition-colors"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1 mt-auto">
                <h3 className="font-bold text-3xl tracking-tight text-stone-900 line-clamp-2 group-hover:text-green-600 transition-colors">
                  {classlist.code}
                </h3>
              </div>

              <div className="flex items-center gap-2 mt-4 pt-4 border-t border-stone-100 w-full text-sm font-medium text-stone-400">
                <Calendar className="w-4 h-4" />
                {classlist.semester}
                <span className="ml-auto flex items-center gap-1.5 text-stone-500 group-hover:text-green-600 transition-colors">
                  <DoorOpen className="w-4 h-4" />
                  {classlist.rooms.length} {classlist.rooms.length === 1 ? "room" : "rooms"}
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {isAdmin && classlists.length > 0 && (
        <div className="max-w-6xl mx-auto w-full mt-8 sm:hidden">
          <Link
            href="/create-class"
            className="flex items-center justify-center gap-2 w-full py-4 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-md transition-all shadow-sm"
          >
            <PlusCircle className="w-5 h-5" />
            Create Classlist
          </Link>
        </div>
      )}

      {managing && (
        <ManageClassModal
          classlist={{ id: managing.id, code: managing.code, semester: managing.semester }}
          onClose={() => setManagingId(null)}
          onChanged={() => void load()}
          onDeleted={() => {
            setManagingId(null);
            setSelectedId(null);
            void load();
          }}
        />
      )}
    </>
  );
}

function EmptyState({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="w-full flex-1 flex flex-col items-center justify-center min-h-[50vh]">
      <div
        className={`w-20 h-20 rounded-full flex items-center justify-center mb-6 ${
          isAdmin ? "bg-green-50 text-green-500" : "bg-stone-100 text-stone-400"
        }`}
      >
        {isAdmin ? <Users className="w-10 h-10" /> : <LayoutGrid className="w-10 h-10" />}
      </div>
      <h1 className="font-bold text-3xl text-stone-900 tracking-tight mb-2">
        {isAdmin ? "No Classes Yet" : "No Classes Found"}
      </h1>
      <p className="text-stone-500 text-lg max-w-md text-center mb-8">
        {isAdmin
          ? "Upload a classlist and add the professors teaching it. Each one gets their own room."
          : "You aren't in any classes yet. A participating admin professor will add you."}
      </p>

      {isAdmin && (
        <Link
          href="/create-class"
          className="flex items-center gap-2 px-8 py-4 bg-green-500 hover:bg-green-600 text-white font-bold rounded-md transition-all shadow-md hover:shadow-lg hover:-translate-y-1 text-lg"
        >
          <PlusCircle className="w-6 h-6" />
          Create a Classlist
        </Link>
      )}
    </div>
  );
}
