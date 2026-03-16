import React from "react";

const STAGE_STYLE = {
  aging:     "bg-orange-50 border-orange-200 text-orange-700",
  coating:   "bg-blue-50   border-blue-200   text-blue-700",
  completed: "bg-emerald-50 border-emerald-200 text-emerald-700",
};

export default function PCBAChip({ role, serial, pcbaStage, ngFlag }) {
  if (!serial) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-stone-50 border border-stone-200 text-gray-400 text-xs">
        <span className="font-bold text-gray-300 uppercase">{role}</span>
        <span className="text-gray-300">—</span>
        <span className="text-gray-300 italic">not linked</span>
      </div>
    );
  }

  const stageClass = STAGE_STYLE[pcbaStage] || "bg-stone-50 border-stone-200 text-gray-600";
  const isNG = ngFlag === 1 || ngFlag === true;

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-mono ${stageClass}`}>
      <span className="font-bold uppercase tracking-wider opacity-60">{role}</span>
      <span className="flex-1 truncate">{serial}</span>
      {pcbaStage && (
        <span className="opacity-60 capitalize text-xs">{pcbaStage}</span>
      )}
      {isNG && (
        <span className="px-1.5 py-0.5 rounded bg-red-100 border border-red-200 text-red-600 text-xs font-bold">
          NG
        </span>
      )}
    </div>
  );
}
