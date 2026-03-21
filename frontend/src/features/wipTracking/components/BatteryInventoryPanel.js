import React from "react";
import { AlertTriangle } from "lucide-react";

function BatteryCard({ battery, onAdjust, isAdmin }) {
  if (!battery) return (
    <div className="flex-1 bg-surface-base border border-stroke rounded-lg p-4 text-center">
      <p className="text-xs text-stone-400">No data</p>
    </div>
  );

  const { kind, produced, consumed, manual_adj, available } = battery;

  const availColor = available < 0   ? "text-red-400"
                   : available < 20  ? "text-red-500"
                   : available < 100 ? "text-amber-400"
                   : "text-emerald-400";

  const ringColor  = available < 0   ? "ring-red-200 bg-signal-error/10"
                   : available < 20  ? "ring-red-200 bg-signal-error/10"
                   : available < 100 ? "ring-amber-200 bg-signal-warn/10"
                   : "ring-emerald-200 bg-signal-ok/10";

  return (
    <div className={`flex-1 border rounded-lg p-4 ring-1 ${ringColor}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-widest text-ink-muted">
          Battery {kind}
        </span>
        {available < 20 && (
          <AlertTriangle size={14} className="text-red-500" />
        )}
      </div>

      {/* Hero number */}
      <div className="mb-3">
        <span className={`text-4xl font-black font-mono leading-none ${availColor}`}>
          {available.toLocaleString()}
        </span>
        <span className="text-xs text-stone-400 ml-2">available</span>
      </div>

      {/* Sub stats */}
      <div className="flex gap-4 text-xs text-ink-muted mb-3">
        <span>Produced: <span className="font-mono font-semibold text-ink-secondary">{produced.toLocaleString()}</span></span>
        <span>Consumed: <span className="font-mono font-semibold text-ink-secondary">{consumed.toLocaleString()}</span></span>
        {manual_adj !== 0 && (
          <span>Adj: <span className={`font-mono font-semibold ${manual_adj > 0 ? "text-teal-400" : "text-red-500"}`}>
            {manual_adj > 0 ? "+" : ""}{manual_adj}
          </span></span>
        )}
      </div>

      {/* Discrepancy note */}
      {available < 0 && (
        <p className="text-xs text-red-500 bg-signal-error/10 border border-red-500/30 rounded px-2 py-1 mb-2">
          Deficit: more consumed than tracked. Use "Adjust" to correct.
        </p>
      )}

      {isAdmin && (
        <button
          onClick={() => onAdjust(kind)}
          className="text-xs text-stone-400 hover:text-teal-400 border border-stroke
                     hover:border-teal-300 rounded-md px-2.5 py-1 transition-colors"
        >
          Adjust
        </button>
      )}
    </div>
  );
}

export default function BatteryInventoryPanel({ batteries = [], onAdjust, isAdmin }) {
  const batA = batteries.find(b => b.kind === "A");
  const batB = batteries.find(b => b.kind === "B");

  return (
    <div className="flex gap-3">
      <BatteryCard battery={batA} onAdjust={onAdjust} isAdmin={isAdmin} />
      <BatteryCard battery={batB} onAdjust={onAdjust} isAdmin={isAdmin} />
    </div>
  );
}
