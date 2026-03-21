import React from "react";

const STAGE_STYLE = {
  aging:     "bg-signal-warn/10 border-orange-500/30 text-orange-400",
  coating:   "bg-signal-info/10   border-blue-500/30   text-blue-400",
  completed: "bg-signal-ok/10 border-emerald-500/30 text-emerald-400",
};

export default function PCBAChip({ role, serial, pcbaStage, ngFlag }) {
  if (!serial) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-base border border-stroke text-ink-muted text-xs">
        <span className="font-bold text-ink-muted uppercase">{role}</span>
        <span className="text-ink-muted">—</span>
        <span className="text-ink-muted italic">not linked</span>
      </div>
    );
  }

  const stageClass = STAGE_STYLE[pcbaStage] || "bg-surface-base border-stroke text-ink-secondary";
  const isNG = ngFlag === 1 || ngFlag === true;

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-mono ${stageClass}`}>
      <span className="font-bold uppercase tracking-wider opacity-60">{role}</span>
      <span className="flex-1 truncate">{serial}</span>
      {pcbaStage && (
        <span className="opacity-60 capitalize text-xs">{pcbaStage}</span>
      )}
      {isNG && (
        <span className="px-1.5 py-0.5 rounded bg-signal-error/15 border border-red-500/30 text-red-400 text-xs font-bold">
          NG
        </span>
      )}
    </div>
  );
}
