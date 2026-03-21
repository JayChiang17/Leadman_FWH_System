// src/features/pcbaTracking/components/PCBANGListPanel.js
import React, { useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { toCaliTime } from "../PCBAUtils";
import { labelOf } from "../PCBAConstants";

export default function PCBANGListPanel({ data = [], onView, onClear, defaultLimit = 8 }) {
  const [showAll, setShowAll] = useState(false);

  // 只取 NG
  const ngGlobal = useMemo(() => (data || []).filter((b) => !!b.ngFlag), [data]);

  // 各階段 NG 計數
  const byStage = useMemo(() => {
    const m = { aging: 0, coating: 0, completed: 0 };
    ngGlobal.forEach((b) => { if (m[b.stage] != null) m[b.stage] += 1; });
    return m;
  }, [ngGlobal]);

  // Top 4 NG 理由
  const topReasons = useMemo(() => {
    const map = new Map();
    ngGlobal.forEach((b) => {
      const r = (b.ngReason || "(none)").trim() || "(none)";
      map.set(r, (map.get(r) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [ngGlobal]);

  // 依時間新→舊排序
  const allSorted = useMemo(() => {
    const arr = [...ngGlobal];
    arr.sort((a, b) => new Date(b.lastUpdate || 0) - new Date(a.lastUpdate || 0));
    return arr;
  }, [ngGlobal]);

  // 可見清單：預設顯示 defaultLimit 筆；點 Show all 後顯示全部
  const visibleList = useMemo(() => {
    if (showAll) return allSorted;
    return allSorted.slice(0, Math.max(0, defaultLimit));
  }, [allSorted, showAll, defaultLimit]);

  const canToggle = ngGlobal.length > defaultLimit;

  return (
    <div className="bg-surface-panel rounded-xl p-5 md:p-6 shadow-sm border border-stroke-subtle">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertCircle size={18} className="text-rose-400" />
          <h3 className="text-base md:text-lg font-bold text-ink-primary">Quality Alerts (NG)</h3>
          <span className="px-2 py-0.5 rounded bg-signal-error/10 text-rose-400 text-xs font-semibold">
            {ngGlobal.length}
          </span>
        </div>

        {canToggle ? (
          <button
            onClick={() => setShowAll((s) => !s)}
            className="px-3 py-1.5 rounded-lg bg-signal-error/15 text-rose-400 hover:bg-rose-200 text-xs font-semibold"
            title={showAll ? "Collapse list" : "Show all NG in this panel"}
          >
            {showAll ? "Collapse" : "Show all"}
          </button>
        ) : (
          <span className="text-xs text-ink-muted">
            Showing {visibleList.length}/{ngGlobal.length}
          </span>
        )}
      </div>

      {/* Stage counters */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[
          {k:"aging", label:"Aging",   color:"bg-signal-warn/10 text-amber-400 border-amber-500/30"},
          {k:"coating", label:"Coating", color:"bg-signal-info/10 text-cyan-400 border-cyan-500/30"},
          {k:"completed", label:"Inventory", color:"bg-signal-ok/10 text-emerald-400 border-emerald-500/30"},
        ].map(s => (
          <div key={s.k} className={`rounded-lg border p-3 text-center ${s.color}`}>
            <div className="text-xs">{s.label}</div>
            <div className="text-lg font-semibold">{byStage[s.k] || 0}</div>
          </div>
        ))}
      </div>

      {/* Top reasons */}
      <div className="mt-4">
        <div className="text-sm font-semibold text-ink-primary mb-2">Top Reasons</div>
        {topReasons.length ? (
          <ul className="space-y-1.5">
            {topReasons.map(([reason, cnt]) => (
              <li key={reason} className="flex items-center justify-between text-sm">
                <span className="truncate text-ink-secondary">{reason}</span>
                <span className="px-2 py-0.5 rounded bg-surface-raised text-ink-secondary text-xs font-semibold">{cnt}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">No NG reasons</p>
        )}
      </div>

      {/* List (部分/全部) */}
      <div className="mt-4">
        <div className="text-sm font-semibold text-ink-primary mb-2">
          {showAll ? "All NG Boards" : "Recent NG"}
          <span className="ml-2 text-xs text-ink-muted">
            {visibleList.length}/{ngGlobal.length}
          </span>
        </div>
        {visibleList.length ? (
          <div className="space-y-2">
            {visibleList.map((b) => (
              <div
                key={b.serialNumber}
                className="flex items-center justify-between gap-2 rounded-lg border border-signal-error/20 bg-signal-error/10 px-3 py-2"
              >
                <div className="min-w-0">
                  <button
                    onClick={() => onView && onView(b.serialNumber)}
                    className="font-semibold text-ink-primary hover:underline break-all text-left"
                    title="Open detail"
                  >
                    {b.serialNumber}
                  </button>
                  <div className="flex items-center gap-2 mt-1 text-xs text-ink-secondary flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full ${b.model === "AU8" ? "bg-signal-info/15 text-signal-info" : "bg-signal-info/15 text-cyan-400"}`}>{b.model}</span>
                    <span className="px-2 py-0.5 rounded-full bg-surface-raised text-ink-secondary">{labelOf(b.stage)}</span>
                    {b.ngReason ? <span className="truncate max-w-[220px]">{b.ngReason}</span> : null}
                    <span className="text-ink-muted">{toCaliTime(b.lastUpdate)}</span>
                  </div>
                </div>
                <div className="shrink-0">
                  {onClear && (
                    <button
                      onClick={() => onClear(b)}
                      className="px-2.5 py-1.5 rounded bg-surface-panel border border-rose-500/30 text-rose-400 hover:bg-signal-error/10 text-xs"
                      title="Clear NG"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-muted">No NG boards</p>
        )}
      </div>
    </div>
  );
}
