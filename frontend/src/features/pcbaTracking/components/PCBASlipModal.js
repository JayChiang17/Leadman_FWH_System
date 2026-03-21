import React from "react";
import { Tag, X } from "lucide-react";

export default function PCBASlipModal({ open, onClose, children, title = "Packing Slip Tracker" }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title}
        className="relative mx-auto w-full max-w-6xl bg-surface-panel rounded-xl shadow-lg border border-stroke max-h-[92vh] flex flex-col my-8">
        <div className="flex items-center justify-between px-10 py-8 border-b border-stroke-subtle sticky top-0 z-[1] rounded-t-3xl bg-surface-panel">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-surface-base border border-stroke rounded-xl flex items-center justify-center">
              <Tag size={22} className="text-ink-secondary" />
            </div>
            <div>
              <h3 className="text-2xl font-bold text-ink-primary">{title}</h3>
              <p className="text-sm text-ink-muted mt-0.5">Manage targets and track completion progress</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2.5 rounded-xl hover:bg-surface-raised transition-colors"
          >
            <X size={22} className="text-ink-muted" />
          </button>
        </div>
        <div className="p-10 overflow-y-auto flex-1 bg-surface-base space-y-6">{children}</div>
      </div>
    </div>
  );
}
