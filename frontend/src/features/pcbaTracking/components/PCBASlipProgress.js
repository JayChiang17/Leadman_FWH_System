import React from "react";
import { Tag } from "lucide-react";

export default function PCBASlipProgress({ status, pairByStage }) {
  if (!status?.slipNumber) {
    return (
      <div className="bg-white rounded-2xl p-5 md:p-6 shadow-sm border border-gray-100">
        <div className="flex items-center gap-2 text-gray-500"><Tag size={18} /><span>Slip Progress</span></div>
        <p className="text-sm text-gray-400 mt-3">No slip selected. Open “Packing Slip” to set one.</p>
      </div>
    );
  }

  const target = Number(status.targetPairs || 0);
  const donePairs = Number(status.completedPairs || 0);
  const pct = target > 0 ? Math.min(100, (donePairs / target) * 100) : 0;
  const agingPairs   = Number((status?.agingPairs   ?? pairByStage?.aging)   || 0);
  const coatingPairs = Number((status?.coatingPairs ?? pairByStage?.coating) || 0);

  return (
    <div className="bg-white rounded-2xl p-5 md:p-6 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag size={18} className="text-indigo-600" />
          <h3 className="text-lg font-bold text-gray-900">Slip Progress</h3>
        </div>
        <span className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-semibold">
          {status.slipNumber}
        </span>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">Completed Pairs</span>
          <span className="font-semibold text-gray-900">
            {donePairs}{target ? ` / ${target}` : ""}
          </span>
        </div>
        <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden mt-2">
          <div className="h-full bg-indigo-600 transition-all rounded-full" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 md:grid-cols-6 gap-3">
        <div className="rounded-lg border border-gray-200 p-3.5">
          <p className="text-xs text-slate-500">Completed Pairs</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{donePairs}</p>
        </div>
        <div className="rounded-lg border border-amber-200 p-3.5 bg-amber-50/30">
          <p className="text-xs text-amber-700">Aging Pairs</p>
          <p className="mt-1 text-xl font-semibold text-amber-800">{agingPairs}</p>
        </div>
        <div className="rounded-lg border border-cyan-200 p-3.5 bg-cyan-50/30">
          <p className="text-xs text-cyan-700">Coating Pairs</p>
          <p className="mt-1 text-xl font-semibold text-cyan-800">{coatingPairs}</p>
        </div>
        <div className="rounded-lg border border-gray-200 p-3.5">
          <p className="text-xs text-slate-500">Completed Boards</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{status.completed ?? 0}</p>
        </div>
        <div className="rounded-lg border border-gray-200 p-3.5">
          <p className="text-xs text-slate-500">Remaining Pairs</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{Math.max(0, status.remainingPairs ?? 0)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 p-3.5">
          <p className="text-xs text-slate-500">Pairs Done %</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{pct.toFixed(1)}%</p>
        </div>
      </div>
    </div>
  );
}
