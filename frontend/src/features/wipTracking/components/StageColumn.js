import React from "react";
import { AnimatePresence } from "framer-motion";
import APowerCard from "./APowerCard";

const CFG = {
  assembling: { label: "ASSEMBLING", bar: "stage-bar-assembling", dot: "bg-signal-info", badge: "bg-signal-info/10 text-cyan-400 ring-1 ring-cyan-200" },
  aging: { label: "AGING", bar: "stage-bar-aging", dot: "bg-signal-warn", badge: "bg-signal-warn/10 text-amber-400 ring-1 ring-amber-200" },
  fqc_passed: { label: "FQC PASSED", bar: "stage-bar-fqc", dot: "bg-signal-ok", badge: "bg-signal-ok/10 text-emerald-400 ring-1 ring-emerald-200" },
  shipped: { label: "SHIPPED", bar: "stage-bar-shipped", dot: "bg-signal-info", badge: "bg-signal-info/10 text-sky-400 ring-1 ring-sky-200" },
};

export default function StageColumn({
  stageId,
  cards = [],
  total = 0,
  loading,
  onAdvance,
  onMove,
  onLoadMore,
  dragStage,
  onDragStageChange,
  collapsed = false,
  compactRail = false,
  onToggleCollapse,
}) {
  const cfg = CFG[stageId];
  if (!cfg) return null;
  const { label, bar, dot, badge } = cfg;
  const hasMore = cards.length < total;
  const isDropTarget = dragStage === stageId;
  const canDrop = stageId !== "shipped";

  const handleDrop = (e) => {
    e.preventDefault();
    if (!canDrop) return;
    const usSn = e.dataTransfer.getData("text/plain");
    onDragStageChange(null);
    if (usSn && onMove) onMove(usSn, stageId);
  };

  if (collapsed && compactRail) {
    return (
      <div
        className="flex h-full min-h-0 flex-col overflow-hidden rounded-[22px] border border-signal-info/20 bg-gradient-to-b from-signal-info/10 via-surface-panel to-surface-panel shadow-sm"
      >
        <div className={`h-1 shrink-0 ${bar}`} />
        <div className="flex flex-1 flex-col px-4 py-4">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-300/80">
              {label}
            </span>
          </div>

          <div className="mt-4 rounded-xl border border-signal-info/20 bg-surface-panel px-3 py-3 shadow-sm">
            <div className="text-[10px] uppercase tracking-[0.18em] text-stone-400">Tracked</div>
            <div className="mt-1 text-3xl font-black font-mono leading-none text-sky-300">
              {total.toLocaleString()}
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-dashed border-sky-500/30 bg-signal-info/10 px-3 py-4">
            <p className="text-xs font-medium text-sky-300">Collapsed shipped rail</p>
            <p className="mt-1 text-[11px] leading-5 text-ink-muted">
              Hidden by default so the active WIP stages stay primary.
            </p>
          </div>

          <button
            type="button"
            onClick={() => onToggleCollapse?.(stageId)}
            className="mt-auto rounded-xl border border-sky-500/30 bg-surface-panel px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky-400 transition-colors hover:border-sky-300 hover:bg-signal-info/10"
          >
            Expand
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col rounded-xl min-h-0 overflow-hidden transition-colors ${isDropTarget ? "bg-teal-500/10 ring-2 ring-teal-300" : "bg-surface-raised"}`}
      onDragOver={(e) => { if (canDrop) e.preventDefault(); }}
      onDragEnter={() => { if (canDrop) onDragStageChange(stageId); }}
      onDragLeave={(e) => {
        if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget)) onDragStageChange(null);
      }}
      onDrop={handleDrop}
    >
      <div className={`h-[3px] shrink-0 ${bar}`} />

      <div className="flex items-center justify-between px-3 py-2.5 shrink-0">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${dot}`} />
          <span className="text-xs font-semibold uppercase tracking-widest text-ink-muted">
            {label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {onToggleCollapse && (
            <button
              type="button"
              onClick={() => onToggleCollapse(stageId)}
              className="text-[11px] uppercase tracking-wide text-stone-400 hover:text-ink-secondary transition-colors"
            >
              {collapsed ? "Expand" : "Collapse"}
            </button>
          )}
          <span className={`text-xs font-semibold font-mono px-1.5 py-0.5 rounded-md ${badge}`}>
            {total.toLocaleString()}
          </span>
        </div>
      </div>

      {collapsed ? (
        <div className="px-3 pb-3">
          <div className="rounded-lg border border-dashed border-stroke bg-surface-panel px-4 py-6 text-center">
            <p className="text-xs text-ink-muted">Column collapsed</p>
            <p className="text-[11px] text-stone-400 mt-1">{total.toLocaleString()} records hidden</p>
          </div>
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto wip-column-scroll px-2 pb-2 space-y-2">
        {isDropTarget && canDrop && (
          <div className="border border-dashed border-teal-300 rounded-lg px-3 py-2 bg-surface-panel/70 text-[11px] text-teal-400 text-center">
            Drop here to move to this stage
          </div>
        )}
        {loading && cards.length === 0 && (
          <div className="flex justify-center pt-10">
            <div className="w-4 h-4 border-2 border-stroke border-t-stone-500 rounded-full animate-spin" />
          </div>
        )}

        {!loading && cards.length === 0 && (
          <div className="mt-6 border-2 border-dashed border-stroke rounded-lg px-4 py-8 text-center">
            <p className="text-stone-400 text-xs">No units in this stage</p>
          </div>
        )}

        <AnimatePresence mode="popLayout">
          {cards.map((card, i) => (
            <APowerCard
              key={`${stageId}-${card.us_sn}`}
              card={card}
              index={i}
              stageId={stageId}
              onAdvance={onAdvance}
              onMove={onMove}
              onDragStageChange={onDragStageChange}
            />
          ))}
        </AnimatePresence>

        {hasMore && !loading && (
          <button
            onClick={() => onLoadMore(stageId)}
            className="w-full py-1.5 text-xs text-stone-400 hover:text-ink-secondary border border-dashed border-stroke hover:border-stone-400 rounded-lg transition-colors"
          >
            {(total - cards.length).toLocaleString()} more...
          </button>
        )}

        {loading && cards.length > 0 && (
          <div className="flex justify-center py-2">
            <div className="w-3 h-3 border-2 border-stroke border-t-stone-500 rounded-full animate-spin" />
          </div>
        )}
      </div>
      )}
    </div>
  );
}
