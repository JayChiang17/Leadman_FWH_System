import React from "react";
import { Tag } from "lucide-react";

export default function PCBASlipProgress({ status, pairByStage }) {
  if (!status?.slipNumber) {
    return (
      <div className="bg-surface-panel rounded-xl p-5 md:p-6 shadow-sm border border-stroke-subtle">
        <div className="flex items-center gap-2 text-ink-muted"><Tag size={18} /><span>Slip Progress</span></div>
        <p className="text-sm text-ink-muted mt-3">No slip selected. Open “Packing Slip” to set one.</p>
      </div>
    );
  }

  const target = Number(status.targetPairs || 0);
  const donePairs = Number(status.completedPairs || 0);
  const pct = target > 0 ? Math.min(100, (donePairs / target) * 100) : 0;
  const agingPairs   = Number((status?.agingPairs   ?? pairByStage?.aging)   || 0);
  const coatingPairs = Number((status?.coatingPairs ?? pairByStage?.coating) || 0);

  return (
    <div className="bg-surface-panel rounded-xl p-5 md:p-6 shadow-sm border border-stroke-subtle">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag size={18} className="text-signal-info" />
          <h3 className="text-lg font-bold text-ink-primary">Slip Progress</h3>
        </div>
        <span className="px-3 py-1 bg-signal-info/10 text-signal-info rounded-full text-xs font-semibold">
          {status.slipNumber}
        </span>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-secondary">Completed Pairs</span>
          <span className="font-semibold text-ink-primary">
            {donePairs}{target ? ` / ${target}` : ""}
          </span>
        </div>
        <div className="h-2.5 bg-surface-raised rounded-full overflow-hidden mt-2">
          <div className="h-full bg-teal-600 transition-all rounded-full" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 md:grid-cols-6 gap-3">
        <div className="rounded-lg border border-stroke p-3.5">
          <p className="text-xs text-ink-muted">Completed Pairs</p>
          <p className="mt-1 text-xl font-semibold text-ink-primary">{donePairs}</p>
        </div>
        <div className="rounded-lg border border-amber-500/30 p-3.5 bg-signal-warn/10">
          <p className="text-xs text-amber-400">Aging Pairs</p>
          <p className="mt-1 text-xl font-semibold text-amber-300">{agingPairs}</p>
        </div>
        <div className="rounded-lg border border-cyan-500/30 p-3.5 bg-signal-info/10">
          <p className="text-xs text-cyan-400">Coating Pairs</p>
          <p className="mt-1 text-xl font-semibold text-cyan-300">{coatingPairs}</p>
        </div>
        <div className="rounded-lg border border-stroke p-3.5">
          <p className="text-xs text-ink-muted">Completed Boards</p>
          <p className="mt-1 text-xl font-semibold text-ink-primary">{status.completed ?? 0}</p>
        </div>
        <div className="rounded-lg border border-stroke p-3.5">
          <p className="text-xs text-ink-muted">Remaining Pairs</p>
          <p className="mt-1 text-xl font-semibold text-ink-primary">{Math.max(0, status.remainingPairs ?? 0)}</p>
        </div>
        <div className="rounded-lg border border-stroke p-3.5">
          <p className="text-xs text-ink-muted">Pairs Done %</p>
          <p className="mt-1 text-xl font-semibold text-ink-primary">{pct.toFixed(1)}%</p>
        </div>
      </div>
    </div>
  );
}
