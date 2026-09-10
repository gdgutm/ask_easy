import { CheckCircle2, File as FileIcon, X } from "lucide-react";
import { ProcessedClassData } from "@/utils/types";

import ProfessorList, { type ProfessorRow } from "./ProfessorList";

interface PreviewClassProps {
  file: File;
  processedData: ProcessedClassData | null;
  onClear: () => void;
  onSubmit: () => void;
  professorRows: ProfessorRow[];
  onProfessorRowsChange: (rows: ProfessorRow[]) => void;
  tasInput: string;
  onTasChange: (value: string) => void;
  courseCodeInput: string;
  onCourseCodeChange: (value: string) => void;
}

export default function PreviewClass({
  file,
  processedData,
  onClear,
  onSubmit,
  professorRows,
  onProfessorRowsChange,
  tasInput,
  onTasChange,
  courseCodeInput,
  onCourseCodeChange,
}: PreviewClassProps) {
  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div className="bg-stone-50 border-2 border-stone-100 rounded-md p-6 relative">
        <button
          onClick={onClear}
          className="absolute top-4 right-4 text-stone-400 hover:text-stone-600 transition-colors p-1"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="flex items-start gap-4 pr-8">
          <div className="p-3 bg-white rounded-md border-2 border-stone-100 shrink-0 shadow-sm">
            <FileIcon className="w-8 h-8 text-stone-700" />
          </div>
          <div className="min-w-0">
            <h3 className="text-stone-900 font-bold truncate text-lg tracking-tight">
              {file.name}
            </h3>
            <p className="text-sm text-stone-500 mt-1">
              {(file.size / 1024).toFixed(2)} KB • {processedData?.students?.length || 0} students
              found
            </p>
            <div className="flex items-center gap-1.5 mt-3 text-stone-700 text-sm font-medium bg-stone-200/50 w-fit px-2 py-1 rounded-md">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Ready to align and process</span>
            </div>
          </div>
        </div>
      </div>

      {processedData && processedData.students.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-stone-900 tracking-tight">
              Class Roster Preview
            </h3>
            <div className="flex gap-4 items-center">
              <div className="flex flex-col gap-1.5 w-[140px]">
                <label className="text-xs uppercase tracking-wide font-bold text-stone-500">
                  Course
                </label>
                <input
                  type="text"
                  value={courseCodeInput}
                  onChange={(e) => onCourseCodeChange(e.target.value)}
                  placeholder="e.g. CSC398"
                  className="w-full bg-white border-2 border-stone-200 focus:border-green-400 focus:ring-4 focus:ring-green-50 rounded-md px-3 py-2 text-sm font-bold text-stone-800 outline-none transition-all placeholder:font-normal placeholder:text-stone-400 shadow-sm"
                />
              </div>
            </div>
          </div>

          <div className="bg-white border-2 border-stone-100 rounded-md overflow-hidden shadow-sm">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="text-xs text-stone-500 bg-stone-50 uppercase border-b border-stone-200">
                <tr>
                  <th className="px-6 py-4 font-semibold tracking-wide">Given Name</th>
                  <th className="px-6 py-4 font-semibold tracking-wide">Surname</th>
                  <th className="px-6 py-4 font-semibold tracking-wide">UTORid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {processedData.students.slice(0, 4).map((student, idx) => (
                  <tr key={idx} className="hover:bg-stone-50 transition-colors">
                    <td className="px-6 py-3.5 text-stone-700 font-medium">{student.givenName}</td>
                    <td className="px-6 py-3.5 text-stone-700 font-medium">{student.surname}</td>
                    <td className="px-6 py-3.5 text-stone-500 font-mono text-xs">
                      {student.utorid}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {processedData.students.length > 4 && (
            <p className="text-xs text-stone-500 text-center pt-2 font-medium tracking-wide">
              Showing 4 of {processedData.students.length} students
            </p>
          )}
        </div>
      )}

      <ProfessorList rows={professorRows} onChange={onProfessorRowsChange} />

      {/* TA UTORid input */}
      <div className="space-y-3 mt-4">
        <label className="text-xl font-bold text-stone-900 tracking-tight block">
          Add TAs <span className="text-stone-400 font-normal text-base">(optional)</span>
        </label>
        <p className="text-sm text-stone-500">
          Enter UTORids separated by commas, spaces, or new lines. TAs can answer all questions and
          delete posts, in every room on this classlist.
        </p>
        <textarea
          value={tasInput}
          spellCheck={false}
          onChange={(e) => onTasChange(e.target.value)}
          placeholder={"tasmith2, janedooe, scalijad"}
          rows={3}
          className="w-full border-2 border-stone-100 rounded-md px-4 py-3 text-sm font-mono resize-none focus:outline-none focus:border-green-400 focus:ring-4 focus:ring-green-50 transition-all shadow-sm"
        />
      </div>

      <button
        onClick={onSubmit}
        className="w-full py-4 bg-green-500 text-white hover:bg-green-600 rounded-md font-bold shadow-sm transition-colors text-lg mt-8"
      >
        Confirm & Create Classlist
      </button>
    </div>
  );
}
