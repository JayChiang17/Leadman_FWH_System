import React from "react";
import { Tag, X } from "lucide-react";

export default function PCBASlipModal({ open, onClose, children, title = "Packing Slip Tracker" }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title}
        className="relative mx-auto w-full max-w-6xl bg-white rounded-3xl shadow-2xl border border-gray-200 max-h-[92vh] flex flex-col my-8">
        <div className="flex items-center justify-between px-10 py-8 border-b border-gray-100 sticky top-0 z-[1] rounded-t-3xl bg-white">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gray-50 border border-gray-200 rounded-2xl flex items-center justify-center">
              <Tag size={22} className="text-gray-700" />
            </div>
            <div>
              <h3 className="text-2xl font-bold text-gray-900">{title}</h3>
              <p className="text-sm text-gray-500 mt-0.5">Manage targets and track completion progress</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2.5 rounded-xl hover:bg-gray-100 transition-colors"
          >
            <X size={22} className="text-gray-500" />
          </button>
        </div>
        <div className="p-10 overflow-y-auto flex-1 bg-gray-50 space-y-6">{children}</div>
      </div>
    </div>
  );
}
