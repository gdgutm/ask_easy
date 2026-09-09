"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import footer from "../components/footer";
import { User, getInitials, isLikelyAvatarImageUrl } from "@/utils/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import NoPermissions from "./components/NoPermissions";
import Upload from "./components/Upload";
import PreviewClass from "./components/PreviewClass";
import { parseAndProcessCSV } from "@/utils/create-class";
import type { ProcessedClassData } from "@/utils/types";

export default function CreateClassPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [processedData, setProcessedData] = useState<ProcessedClassData | null>(null);
  const [tasInput, setTasInput] = useState("");
  const [professorsInput, setProfessorsInput] = useState("");
  const [courseCodeInput, setCourseCodeInput] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.userId) {
          setUser({
            id: data.userId,
            username: data.name ?? data.utorid,
            pfp: data.name?.[0]?.toUpperCase() ?? "?",
            role: data.role as User["role"],
          });
        }
      })
      .catch(() => null);
  }, []);

  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile);
    setSubmitError(null);
    try {
      const processed = await parseAndProcessCSV(selectedFile);
      setProcessedData(processed);
      setCourseCodeInput(processed.courseCode ?? "");
    } catch (error) {
      console.error(error);
    }
  };

  const clearFile = () => {
    setFile(null);
    setProcessedData(null);
    setTasInput("");
    setProfessorsInput("");
    setCourseCodeInput("");
    setSubmitError(null);
  };

  const submitClassCreation = async () => {
    if (!processedData) return;
    setSubmitting(true);
    setSubmitError(null);
    const tas = tasInput
      .split(/[\n,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const professors = professorsInput
      .split(/[\n,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const res = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: courseCodeInput.trim() || processedData.courseCode,
          students: processedData.students,
          ...(tas.length > 0 ? { tas } : {}),
          ...(professors.length > 0 ? { professors } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error ?? "Failed to create course.");
        return;
      }
      router.push("/");
    } catch {
      setSubmitError("An unexpected error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // Show loading state while fetching user
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-stone-400 text-sm">Loading…</span>
      </div>
    );
  }

  if (user.role !== "PROFESSOR") {
    return <NoPermissions user={user} />;
  }

  return (
    <div className="min-h-screen flex flex-col dot-grid relative">
      <div className="absolute top-6 left-7 z-10">
        <Link
          href="/"
          className="flex items-center justify-center gap-2 py-2.5 px-4 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-md transition-colors font-medium text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>
      </div>
      <div className="absolute top-6 right-7 z-10 flex items-center gap-3">
        <Avatar className="h-10 w-10 shadow-sm border-2 border-stone-100">
          {isLikelyAvatarImageUrl(user.pfp) && <AvatarImage src={user.pfp} alt={user.username} />}
          <AvatarFallback className="bg-white font-medium text-lg text-stone-900 tracking-tighter">
            {getInitials(user.username)}
          </AvatarFallback>
        </Avatar>
      </div>
      <div className="flex-grow flex items-center justify-center pt-32 pb-12 px-6">
        <div className="max-w-3xl w-full bg-white p-6 sm:p-8 rounded-md border-2 border-stone-100 shadow-sm space-y-6 z-10 mx-auto">
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-stone-900 tracking-tight mb-2">
              Create a Lecture
            </h1>
            <p className="text-lg text-stone-500">
              Upload your student roster to create a new lecture.
            </p>
          </div>

          {submitError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-2">
              {submitError}
            </p>
          )}

          {!file ? (
            <Upload onFileSelect={handleFileSelect} />
          ) : (
            <PreviewClass
              file={file}
              processedData={processedData}
              onClear={clearFile}
              onSubmit={submitting ? () => {} : submitClassCreation}
              professorsInput={professorsInput}
              onProfessorsChange={setProfessorsInput}
              tasInput={tasInput}
              onTasChange={setTasInput}
              courseCodeInput={courseCodeInput}
              onCourseCodeChange={setCourseCodeInput}
            />
          )}

          {submitting && <p className="text-sm text-stone-500 text-center">Creating class…</p>}
        </div>
      </div>
      {footer()}
    </div>
  );
}
