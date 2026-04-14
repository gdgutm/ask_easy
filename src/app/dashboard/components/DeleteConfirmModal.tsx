import React, { useState, useRef } from "react";
import { X, Trash2 } from "lucide-react";

interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  title: string;
  description: React.ReactNode;
  requireTypeToConfirm?: string;
  confirmText?: string;
}

export default function DeleteConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  requireTypeToConfirm,
  confirmText = "Delete",
}: DeleteConfirmModalProps) {
  const [confirmInput, setConfirmInput] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const backdropMouseDownRef = useRef(false);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (requireTypeToConfirm && confirmInput !== requireTypeToConfirm) return;
    setIsDeleting(true);
    try {
      await onConfirm();
    } finally {
      setIsDeleting(false);
      onClose();
      setConfirmInput("");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => {
        backdropMouseDownRef.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e) => {
        if (backdropMouseDownRef.current && e.target === e.currentTarget) {
          onClose();
          setConfirmInput("");
        }
        backdropMouseDownRef.current = false;
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2 text-red-600">
            <Trash2 className="w-5 h-5" />
            <h2 className="text-xl font-bold">{title}</h2>
          </div>
          <button
            onClick={() => {
              onClose();
              setConfirmInput("");
            }}
            className="w-8 h-8 flex items-center justify-center rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex flex-col gap-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 leading-relaxed">
            {description}
          </div>

          {requireTypeToConfirm && (
            <div className="flex flex-col gap-1.5 mt-2">
              <label className="text-sm font-medium text-stone-700">
                Type{" "}
                <span className="font-mono font-bold bg-stone-100 px-1 rounded">
                  {requireTypeToConfirm}
                </span>{" "}
                to confirm
              </label>
              <input
                type="text"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder={requireTypeToConfirm}
                className="border border-stone-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-red-400"
              />
            </div>
          )}

          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={() => {
                onClose();
                setConfirmInput("");
              }}
              className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={
                isDeleting || (!!requireTypeToConfirm && confirmInput !== requireTypeToConfirm)
              }
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {isDeleting ? "Deleting..." : confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
