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
    <div className="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-8 py-6 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gray-50 border border-gray-200 rounded-2xl flex items-center justify-center">
              <FileText size={20} className="text-gray-700" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">Packing Slip Library</h3>
              <p className="text-sm text-gray-500">View and manage all packing slips</p>
            </div>
            <span className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-900 text-sm font-semibold">{items.length}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input
                value={kw}
                onChange={(e) => setKw(e.target.value)}
                placeholder="Search slip..."
                className="pl-9 pr-3 py-2.5 text-sm bg-white border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-gray-300 focus:border-gray-300 text-black placeholder-gray-400 transition-colors"
              />
            </div>
            <button
              onClick={onRefresh}
              className="px-5 py-2.5 rounded-xl border-2 border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 text-gray-700 flex items-center gap-2 font-semibold text-sm transition-all"
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
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">Slip Number</th>
              <th className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">Progress</th>
              <th className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">Target</th>
              <th className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">Done</th>
              <th className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">Aging</th>
              <th className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">Coating</th>
              <th className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">Inventory</th>
              <th className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">Updated</th>
              <th className="py-3 px-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td className="py-8 text-center text-gray-400" colSpan={9}>
                  <div className="flex items-center justify-center gap-2">
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-900 border-t-transparent"></div>
                    Loading...
                  </div>
                </td>
              </tr>
            ) : list.length === 0 ? (
              <tr>
                <td className="py-8 text-center text-gray-400" colSpan={9}>No packing slips found</td>
              </tr>
            ) : (
              list.map((s) => {
                const progress = s.targetPairs > 0 ? (s.completedPairs / s.targetPairs) * 100 : 0;
                const isComplete = s.completedPairs >= s.targetPairs && s.targetPairs > 0;
                return (
                  <tr key={s.slipNumber} className="hover:bg-gray-50/50 transition-colors">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <span className="px-3 py-1.5 rounded-lg bg-gray-100 border border-gray-200 text-gray-900 font-semibold text-xs">
                          {s.slipNumber}
                        </span>
                        {isComplete && <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-gray-900">{progress.toFixed(0)}%</span>
                        </div>
                        <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              isComplete ? "bg-emerald-500" : "bg-gray-900"
                            }`}
                            style={{ width: `${Math.min(100, progress)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-sm font-semibold text-gray-900">{s.targetPairs}</span>
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-sm font-semibold text-gray-900">{s.completedPairs}</span>
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-1 rounded-md bg-amber-50 text-amber-700 text-xs font-semibold">
                        {s.aging}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-1 rounded-md bg-sky-50 text-sky-700 text-xs font-semibold">
                        {s.coating}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs font-semibold">
                        {s.completed}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-xs text-gray-600">{toCaliTime(s.updatedAt)}</span>
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => onApplyFilter(s.slipNumber)}
                          className="px-2.5 py-1.5 rounded-lg border-2 border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 text-gray-700 text-xs font-semibold transition-all"
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
                              ? "bg-gray-100 text-gray-400 cursor-not-allowed border-2 border-gray-200"
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
                              ? "bg-gray-100 text-gray-400 cursor-not-allowed border-2 border-gray-200"
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
