import React from "react";
import { Calendar, Clock, Activity, CheckCircle, ArrowRight, TrendingDown, Package } from "lucide-react";

export default function PCBATodayScansCard({ today }) {
  const items = [
    { label: "Aging", value: today?.aging || 0, color: "text-amber-400", bg: "bg-signal-warn/10", icon: Clock },
    { label: "Coating", value: today?.coating || 0, color: "text-cyan-400", bg: "bg-signal-info/10", icon: Activity },
    { label: "Inventory", value: today?.completed || 0, color: "text-emerald-400", bg: "bg-signal-ok/10", icon: CheckCircle },
    { label: "Consumed", value: today?.consumed || 0, color: "text-rose-400", bg: "bg-signal-error/10", icon: TrendingDown },
  ];

  const consumedPairs = today?.consumedPairs || Math.min(
    today?.consumedAM7 || 0,
    today?.consumedAU8 || 0
  );

  return (
    <div className="bg-surface-panel rounded-xl p-5 md:p-6 shadow-sm border border-stroke-subtle">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calendar size={18} className="text-signal-info" />
          <h3 className="text-base md:text-lg font-bold text-ink-primary">Today's Activity</h3>
        </div>
        <span className="text-xs text-ink-muted">{today?.date || ""}</span>
      </div>

      {/* WIP Flow Visualization */}
      <div className="mb-4 p-3 bg-gradient-to-r from-signal-info/10 to-signal-info/10 rounded-xl border border-blue-500/30">
        <div className="flex items-center justify-between text-xs font-semibold text-ink-secondary">
          <span className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-signal-warn"></div>
            Aging
          </span>
          <ArrowRight size={14} className="text-ink-muted" />
          <span className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-signal-info"></div>
            Coating
          </span>
          <ArrowRight size={14} className="text-ink-muted" />
          <span className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-signal-ok"></div>
            Inventory
          </span>
          <ArrowRight size={14} className="text-ink-muted" />
          <span className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-signal-error"></div>
            Assembly
          </span>
        </div>
        <div className="mt-2 text-[10px] text-ink-secondary text-center">
          Work in Process: Boards move through stages & leave at consumption
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <div key={it.label} className="rounded-xl border border-stroke p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-lg ${it.bg}`}><Icon size={16} className={it.color} /></div>
                <div className="text-xs font-medium text-ink-secondary">{it.label}</div>
              </div>
              <div className="text-2xl font-bold text-ink-primary">{it.value.toLocaleString()}</div>
            </div>
          );
        })}
      </div>

      {/* Consumed Pairs Highlight */}
      {consumedPairs > 0 && (
        <div className="mt-3 p-3 bg-gradient-to-r from-signal-error/10 to-pink-50 rounded-xl border border-rose-500/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package size={16} className="text-rose-400" />
              <span className="text-sm font-semibold text-ink-secondary">Consumed Pairs (Today)</span>
            </div>
            <span className="text-2xl font-black text-rose-400">{consumedPairs.toLocaleString()}</span>
          </div>
          <div className="mt-1 text-xs text-ink-secondary">
            AM7: {today?.consumedAM7 || 0} | AU8: {today?.consumedAU8 || 0}
          </div>
        </div>
      )}
    </div>
  );
}
