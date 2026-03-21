import React, { useMemo, useState } from "react";
import { Search, RefreshCw, Edit, Trash2, FileText, CheckCircle2 } from "lucide-react";
import { toCaliTime } from "../PCBAUtils";

export default function PCBASlipLibrary({ items = [], loading, onRefresh, onEditTarget, onDelete, onApplyFilter, disabled }) {
  const [kw, setKw] = useState("");
  const list = useMemo(() => {
    const t = kw.trim().toLowerCase();
    return (items || []).filter((x) => !t || String(x.slipNumber).toLowerCase().includes(t));
  }, [kw, items]);

  return (
    <div className="bg-surface-panel rounded-xl border border-stroke shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-8 py-6 border-b border-stroke-subtle">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-surface-base border border-stroke rounded-xl flex items-center justify-center">
              <FileText size={20} className="text-ink-secondary" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-ink-primary">Packing Slip Library</h3>
              <p className="text-sm text-ink-muted">View and manage all packing slips</p>
            </div>
            <span className="px-3 py-1.5 rounded-lg bg-surface-raised text-ink-primary text-sm font-semibold">{items.length}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" size={16} />
              <input
                value={kw}
                onChange={(e) => setKw(e.target.value)}
                placeholder="Search slip..."
                className="pl-9 pr-3 py-2.5 text-sm bg-surface-raised border-2 border-stroke rounded-xl focus:ring-2 focus:ring-gray-300 focus:border-stroke text-ink-primary placeholder-ink-muted transition-colors"
              />
            </div>
            <button
              onClick={onRefresh}
              className="px-5 py-2.5 rounded-xl border-2 border-stroke bg-surface-panel hover:bg-surface-base hover:border-stroke text-ink-secondary flex items-center gap-2 font-semibold text-sm transition-all"
            >
              <RefreshCw size={16} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-surface-base border-b border-stroke-subtle">
              <th className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-secondary">Slip Number</th>
              <th className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-secondary">Progress</th>
              <th className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-secondary">Target</th>
              <th className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-secondary">Done</th>
              <th className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-secondary">Aging</th>
              <th className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-secondary">Coating</th>
              <th className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-secondary">Inventory</th>
              <th className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-secondary">Updated</th>
              <th className="py-3 px-3 text-right text-xs font-semibold uppercase tracking-wide text-ink-secondary">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stroke-subtle">
            {loading ? (
              <tr>
                <td className="py-8 text-center text-ink-muted" colSpan={9}>
                  <div className="flex items-center justify-center gap-2">
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-900 border-t-transparent"></div>
                    Loading...
                  </div>
                </td>
              </tr>
            ) : list.length === 0 ? (
              <tr>
                <td className="py-8 text-center text-ink-muted" colSpan={9}>No packing slips found</td>
              </tr>
            ) : (
              list.map((s) => {
                const progress = s.targetPairs > 0 ? (s.completedPairs / s.targetPairs) * 100 : 0;
                const isComplete = s.completedPairs >= s.targetPairs && s.targetPairs > 0;
                return (
                  <tr key={s.slipNumber} className="hover:bg-surface-base/50 transition-colors">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <span className="px-3 py-1.5 rounded-lg bg-surface-raised border border-stroke text-ink-primary font-semibold text-xs">
                          {s.slipNumber}
                        </span>
                        {isComplete && <CheckCircle2 size={16} className="text-emerald-400 flex-shrink-0" />}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-ink-primary">{progress.toFixed(0)}%</span>
                        </div>
                        <div className="w-20 h-1.5 bg-surface-raised rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              isComplete ? "bg-signal-ok" : "bg-gray-900"
                            }`}
                            style={{ width: `${Math.min(100, progress)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-sm font-semibold text-ink-primary">{s.targetPairs}</span>
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-sm font-semibold text-ink-primary">{s.completedPairs}</span>
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-1 rounded-md bg-signal-warn/10 text-amber-400 text-xs font-semibold">
                        {s.aging}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-1 rounded-md bg-signal-info/10 text-sky-400 text-xs font-semibold">
                        {s.coating}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-1 rounded-md bg-signal-ok/10 text-emerald-400 text-xs font-semibold">
                        {s.completed}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-xs text-ink-secondary">{toCaliTime(s.updatedAt)}</span>
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => onApplyFilter(s.slipNumber)}
                          className="px-2.5 py-1.5 rounded-lg border-2 border-stroke bg-surface-panel hover:bg-surface-base hover:border-stroke text-ink-secondary text-xs font-semibold transition-all"
                          title="Apply to filter"
                        >
                          Apply
                        </button>
                        <button
                          onClick={async () => {
                            if (disabled) return;
                            const v = prompt(`New target pairs for ${s.slipNumber}:`, String(s.targetPairs ?? 0));
                            if (v === null) return;
                            const num = Math.max(0, parseInt(v || "0", 10));
                            await onEditTarget(s.slipNumber, num);
                          }}
                          disabled={disabled}
                          className={`px-2.5 py-1.5 rounded-lg flex items-center gap-1 text-xs font-semibold transition-all ${
                            disabled
                              ? "bg-surface-raised text-ink-muted cursor-not-allowed border-2 border-stroke"
                              : "bg-gray-900 text-white hover:bg-gray-800"
                          }`}
                          title={disabled ? "Viewer cannot edit" : "Edit target pairs"}
                        >
                          <Edit size={12} /> Edit
                        </button>
                        <button
                          onClick={() => !disabled && onDelete(s.slipNumber)}
                          disabled={disabled}
                          className={`px-2.5 py-1.5 rounded-lg flex items-center gap-1 text-xs font-semibold transition-all ${
                            disabled
                              ? "bg-surface-raised text-ink-muted cursor-not-allowed border-2 border-stroke"
                              : "bg-red-600 text-white hover:bg-red-700"
                          }`}
                          title={disabled ? "Viewer cannot delete" : "Delete slip"}
                        >
                          <Trash2 size={12} /> Del
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
