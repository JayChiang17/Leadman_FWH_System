import React from "react";
import { Tag, CheckCircle, Package, TrendingUp, ArrowRight } from "lucide-react";

export default function PCBAPackingSlipPanel({
  slip, setSlip, useSlipFilter, setUseSlipFilter, onSave, status,
  saving = false, onApplySlipFilter, appliedValue, disabled
}) {
  const disabledSave = disabled || !slip?.slipNumber?.trim();
  const progressPercent = (status?.targetPairs && status?.targetPairs > 0)
    ? Math.min(100, (Number(status?.completedPairs || 0) / status.targetPairs) * 100)
    : 0;

  return (
    <div className="bg-surface-panel rounded-xl border border-stroke shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-8 py-6 bg-gradient-to-r from-surface-raised to-surface-panel border-b border-stroke">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-surface-panel border-2 border-stroke rounded-xl flex items-center justify-center shadow-sm">
              <Tag size={20} className="text-ink-secondary" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-ink-primary">Packing Slip Manager</h3>
              <p className="text-sm text-ink-muted mt-0.5">Create and track AM7+AU8 pair completion</p>
            </div>
          </div>
          <label className="inline-flex items-center gap-2.5 px-4 py-2 rounded-xl bg-surface-panel border border-stroke text-sm text-ink-secondary select-none cursor-pointer hover:bg-surface-base transition-colors">
            <input
              type="checkbox"
              className="rounded border-stroke text-ink-secondary focus:ring-teal-500"
              checked={useSlipFilter}
              onChange={(e) => setUseSlipFilter(e.target.checked)}
            />
            <span className="font-semibold">Use as filter</span>
          </label>
        </div>
      </div>

      {/* Form */}
      <div className="p-8">
        {/* Input Section */}
        <div className="bg-surface-base rounded-xl p-6 border border-stroke">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-6">
              <label className="block text-sm font-semibold text-ink-secondary mb-2.5">
                Slip Number <span className="text-red-500">*</span>
              </label>
              <input
                value={slip?.slipNumber || ""}
                onChange={(e) => setSlip((p) => ({ ...p, slipNumber: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") onApplySlipFilter?.(slip?.slipNumber || ""); }}
                placeholder="e.g. PS-250102-01"
                className="w-full px-4 py-3.5 rounded-xl border-2 border-stroke bg-surface-raised focus:ring-2 focus:ring-blue-300 focus:border-blue-300 text-ink-primary placeholder-ink-muted font-medium transition-all text-base"
              />
              {appliedValue && (
                <p className="mt-2.5 flex items-center gap-2 text-sm text-emerald-400">
                  <CheckCircle size={16} className="flex-shrink-0" />
                  <span>Filter active: <span className="font-bold">{appliedValue}</span></span>
                </p>
              )}
            </div>

            <div className="lg:col-span-3">
              <label className="block text-sm font-semibold text-ink-secondary mb-2.5">
                Target Pairs <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min={0}
                value={slip?.targetPairs ?? 0}
                onChange={(e) => setSlip((p) => ({ ...p, targetPairs: Math.max(0, parseInt(e.target.value || 0, 10)) }))}
                className="w-full px-4 py-3.5 rounded-xl border-2 border-stroke bg-surface-raised focus:ring-2 focus:ring-blue-300 focus:border-blue-300 text-ink-primary font-bold text-xl transition-all text-center"
              />
            </div>

            <div className="lg:col-span-3">
              <label className="block text-sm font-semibold text-ink-secondary mb-2.5 opacity-0 pointer-events-none" aria-hidden="true">
                Actions
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onApplySlipFilter?.(slip?.slipNumber || "")}
                  className="flex-1 px-4 py-3.5 rounded-xl border-2 border-stroke bg-surface-panel hover:bg-surface-base hover:border-stroke-strong text-ink-secondary text-sm font-semibold transition-all"
                  title="Apply as list filter"
                >
                  Apply Filter
                </button>
                <button
                  onClick={onSave}
                  disabled={saving || disabledSave}
                  className={`flex-1 px-4 py-3.5 rounded-xl font-bold transition-all text-sm flex items-center justify-center gap-2 ${
                    saving || disabledSave
                      ? "bg-surface-raised text-ink-muted cursor-not-allowed border-2 border-stroke"
                      : "bg-gray-900 text-white hover:bg-gray-800 shadow-sm"
                  }`}
                  title={disabled ? "Viewer cannot save" : "Save or update this slip"}
                >
                  {saving ? "Saving..." : disabled ? "View Only" : (
                    <>
                      Save <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Progress Section */}
        {status?.slipNumber && (
          <div className="mt-8 space-y-6">
            {/* Progress Bar - Premium Design */}
            <div className="bg-gradient-to-br from-surface-raised to-surface-panel rounded-xl p-6 border-2 border-stroke">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">Overall Progress</p>
                  <p className="text-sm text-ink-secondary">Tracking: <span className="font-bold text-ink-primary">{status.slipNumber}</span></p>
                </div>
                <div className="text-right">
                  <div className="text-5xl font-bold text-ink-primary tabular-nums leading-none">{progressPercent.toFixed(0)}<span className="text-2xl text-ink-muted">%</span></div>
                  <p className="text-xs text-ink-muted mt-1">Complete</p>
                </div>
              </div>
              <div className="relative h-4 bg-surface-raised rounded-full overflow-hidden">
                <div
                  className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out ${
                    progressPercent >= 100 ? 'bg-signal-ok' : 'bg-gray-900'
                  }`}
                  style={{ width: `${progressPercent}%` }}
                >
                  {progressPercent > 10 && (
                    <div className="absolute inset-0 flex items-center justify-end pr-3">
                      <span className="text-xs font-bold text-white">{progressPercent.toFixed(1)}%</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Stats Grid - Enhanced */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="group relative bg-gradient-to-br from-signal-ok/10 to-surface-panel rounded-xl p-6 border-2 border-emerald-500/30 hover:border-emerald-400 hover:shadow-md transition-all">
                <div className="absolute top-4 right-4 w-12 h-12 bg-signal-ok/15 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                  <CheckCircle className="w-6 h-6 text-emerald-400" />
                </div>
                <div className="pr-14">
                  <p className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-3">Completed</p>
                  <div className="text-4xl font-bold text-ink-primary tabular-nums leading-none mb-2">
                    {status.completedPairs ?? 0}
                    {status.targetPairs > 0 && (
                      <span className="text-lg text-ink-muted font-semibold"> / {status.targetPairs}</span>
                    )}
                  </div>
                  <p className="text-sm text-emerald-400 font-semibold">Pairs Done</p>
                </div>
              </div>

              <div className="group relative bg-gradient-to-br from-signal-info/10 to-surface-panel rounded-xl p-6 border-2 border-sky-500/30 hover:border-sky-400 hover:shadow-md transition-all">
                <div className="absolute top-4 right-4 w-12 h-12 bg-signal-info/15 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Package className="w-6 h-6 text-sky-400" />
                </div>
                <div className="pr-14">
                  <p className="text-xs font-bold uppercase tracking-wider text-sky-400 mb-3">Boards Used</p>
                  <div className="text-4xl font-bold text-ink-primary tabular-nums leading-none mb-2">
                    {status.completed ?? 0}
                  </div>
                  <p className="text-sm text-sky-400 font-semibold">Total Boards</p>
                </div>
              </div>

              <div className="group relative bg-gradient-to-br from-signal-warn/10 to-surface-panel rounded-xl p-6 border-2 border-amber-500/30 hover:border-amber-400 hover:shadow-md transition-all">
                <div className="absolute top-4 right-4 w-12 h-12 bg-signal-warn/15 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                  <TrendingUp className="w-6 h-6 text-amber-400" />
                </div>
                <div className="pr-14">
                  <p className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-3">Remaining</p>
                  <div className="text-4xl font-bold text-ink-primary tabular-nums leading-none mb-2">
                    {Math.max(0, status.remainingPairs ?? 0)}
                  </div>
                  <p className="text-sm text-amber-400 font-semibold">Pairs Left</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
