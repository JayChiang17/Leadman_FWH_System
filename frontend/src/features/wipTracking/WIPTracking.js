import React, { useState, useRef, useContext, useCallback } from "react";
import { RefreshCw, Scan, X, Zap } from "lucide-react";
import "./WIPTracking.css";

import StageColumn from "./components/StageColumn";
import BatteryInventoryPanel from "./components/BatteryInventoryPanel";
import BatteryAdjModal from "./components/BatteryAdjModal";
import useWIPData from "./hooks/useWIPData";
import useBatteryInventory from "./hooks/useBatteryInventory";
import { AuthCtx } from "../../auth/AuthContext";

const STAGES = ["assembling", "aging", "fqc_passed", "shipped"];
const PRIMARY_STAGES = ["assembling", "aging", "fqc_passed"];

const STAGE_LABEL = {
  assembling: "Assembling",
  aging: "Aging",
  fqc_passed: "FQC Passed",
  shipped: "Shipped",
};

const STAGE_DOT = {
  assembling: "bg-cyan-500",
  aging: "bg-amber-500",
  fqc_passed: "bg-emerald-500",
  shipped: "bg-sky-500",
};

const STAGE_CARD = {
  assembling: "from-cyan-500/15 to-white border-cyan-200 text-cyan-900",
  aging: "from-amber-500/15 to-white border-amber-200 text-amber-900",
  fqc_passed: "from-emerald-500/15 to-white border-emerald-200 text-emerald-900",
  shipped: "from-sky-500/15 to-white border-sky-200 text-sky-900",
};

function timeAgo(iso) {
  if (!iso) return "No update";
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ago`;
    if (h > 0) return `${h}h ago`;
    const m = Math.floor(diff / 60000);
    return m > 0 ? `${m}m ago` : "just now";
  } catch {
    return "No update";
  }
}

function formatAbsoluteTime(iso) {
  if (!iso) return "No timestamp";
  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "No timestamp";
  }
}

export default function WIPTracking() {
  const { role } = useContext(AuthCtx);
  const isAdmin = role === "admin";

  const { stats, statsLoading, columns, totals, loading, error, advanceStage, loadMore, loadStage, refresh } = useWIPData();
  const { batteries, error: batError, adjust, refresh: refreshBat } = useBatteryInventory();

  const [scanInput, setScanInput] = useState("");
  const [scanError, setScanError] = useState("");
  const [scanResult, setScanResult] = useState(null);
  const [showBattery, setShowBattery] = useState(false);
  const [adjModal, setAdjModal] = useState(null);
  const [dragStage, setDragStage] = useState(null);
  const [collapsedStages, setCollapsedStages] = useState({ shipped: true });
  const scanRef = useRef(null);

  const handleScanKey = useCallback((e) => {
    if (e.key !== "Enter") return;
    const sn = scanInput.trim();
    if (!sn) return;
    setScanInput("");
    setScanError("");
    setScanResult(null);

    let found = null;
    let foundStage = null;
    for (const s of STAGES) {
      const card = (columns[s] || []).find((c) => c.us_sn === sn || c.cn_sn === sn);
      if (card) {
        found = card;
        foundStage = s;
        break;
      }
    }
    if (!found) {
      setScanError(`"${sn}" not found`);
      return;
    }
    setScanResult({ card: found, stage: foundStage });
  }, [scanInput, columns]);

  async function handleAdjConfirm(payload) {
    const r = await adjust(payload);
    if (r.ok) {
      setAdjModal(null);
      refreshBat();
    }
  }

  const allErrors = [error, batError, scanError].filter(Boolean);
  const scanCanAdvance = scanResult && ["assembling", "aging"].includes(scanResult.stage);
  const isShippedCollapsed = !!collapsedStages.shipped;

  const handleToggleCollapse = useCallback((stageId) => {
    setCollapsedStages((prev) => {
      const nextCollapsed = !prev[stageId];
      if (stageId === "shipped" && prev[stageId] && !columns.shipped?.length) {
        loadStage("shipped");
      }
      return { ...prev, [stageId]: nextCollapsed };
    });
  }, [columns.shipped, loadStage]);

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <div className="flex-shrink-0 bg-white border-b border-stone-200">
        <div className="px-5 py-4 bg-gradient-to-r from-stone-100 via-white to-cyan-50 border-b border-stone-200">
          <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-4 mb-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.32em] text-teal-600 mb-1">Live Dashboard</p>
              <h1 className="text-stone-900 font-semibold text-2xl leading-tight">APower WIP</h1>
              <p className="text-stone-500 text-sm">Assembly Pipeline</p>
            </div>
            <div className="flex gap-3 flex-wrap self-start xl:self-auto">
              <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3 min-w-[170px] shadow-sm">
                <div className="text-[11px] uppercase tracking-[0.24em] text-stone-400 mb-1">Total Tracked</div>
                <div className="text-4xl font-black font-mono text-stone-900 leading-none">
                  {(stats.total || 0).toLocaleString()}
                </div>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 min-w-[170px] shadow-sm">
                <div className="text-[11px] uppercase tracking-[0.24em] text-emerald-700/80 mb-1">Today FQC</div>
                <div className="text-4xl font-black font-mono text-emerald-900 leading-none">
                  {(stats.today_fqc || 0).toLocaleString()}
                </div>
              </div>
              <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 min-w-[170px] shadow-sm">
                <div className="text-[11px] uppercase tracking-[0.24em] text-sky-700/80 mb-1">Today Shipped</div>
                <div className="text-4xl font-black font-mono text-sky-900 leading-none">
                  {(stats.today_shipped || 0).toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            {STAGES.map((s) => (
              <div
                key={s}
                className={`rounded-2xl border bg-gradient-to-br ${STAGE_CARD[s]} px-4 py-3 shadow-sm`}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className={`w-2.5 h-2.5 rounded-full ${STAGE_DOT[s]}`} />
                  <span className="text-[11px] uppercase tracking-[0.22em] font-semibold opacity-80">
                    {STAGE_LABEL[s]}
                  </span>
                </div>
                <div className="text-3xl font-black font-mono leading-none">
                  {(stats.counts?.[s] ?? 0).toLocaleString()}
                </div>
                <div className="mt-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-stone-400">Last updated</div>
                  <div className="text-xs font-semibold text-stone-700 mt-1">
                    {timeAgo(stats.last_updated?.[s])}
                  </div>
                  <div className="text-[11px] text-stone-500 mt-0.5">
                    {formatAbsoluteTime(stats.last_updated?.[s])}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 px-5 py-3 bg-white">
          <div className="text-xs text-stone-400 uppercase tracking-[0.2em] font-semibold">Controls</div>

          <button
            onClick={() => setShowBattery((v) => !v)}
            className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors
              ${showBattery
                ? "bg-amber-50 border-amber-200 text-amber-700"
                : "bg-white border-stone-200 text-stone-500 hover:border-stone-300"
              }`}
          >
            <Zap size={13} className={showBattery ? "text-amber-500" : "text-stone-400"} />
            Battery
          </button>

          <div className="relative shrink-0">
            <Scan size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              ref={scanRef}
              value={scanInput}
              onChange={(e) => { setScanInput(e.target.value); setScanError(""); setScanResult(null); }}
              onKeyDown={handleScanKey}
              placeholder="Scan SN..."
              className="w-48 border border-stone-200 rounded-lg pl-8 pr-3 py-1.5 text-stone-800 text-sm bg-white focus:border-teal-400 scan-input transition-colors"
              style={{ fontSize: "16px" }}
            />
          </div>

          <button
            onClick={() => { refresh(); refreshBat(); }}
            disabled={statsLoading}
            className="shrink-0 p-1.5 rounded-lg border border-stone-200 text-stone-400 hover:text-stone-600 hover:border-stone-300 transition-colors disabled:opacity-40"
          >
            <RefreshCw size={14} className={statsLoading ? "animate-spin" : ""} />
          </button>
        </div>

        {showBattery && (
          <div className="border-t border-stone-100 px-5 py-3 bg-stone-50">
            <BatteryInventoryPanel
              batteries={batteries}
              onAdjust={(kind) => {
                const currentAvailableByKind = batteries.reduce((acc, bat) => {
                  acc[bat.kind] = bat?.available ?? 0;
                  return acc;
                }, {});
                setAdjModal({ kind, currentAvailableByKind });
              }}
              isAdmin={isAdmin}
            />
          </div>
        )}

      </div>

      {(allErrors.length > 0 || scanResult) && (
        <div className="flex-shrink-0 px-5 pt-3 space-y-2">
          {allErrors.map((err, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <span className="flex-1">{err}</span>
              <button onClick={() => setScanError("")}><X size={13} className="text-red-400" /></button>
            </div>
          ))}
          {scanResult && (
            <div className="flex items-center gap-3 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2">
              <span className="text-sm text-teal-800 flex-1">
                <span className="font-mono font-semibold">{scanResult.card.us_sn}</span>
                {" "}-> {" "}<span className="font-semibold">{STAGE_LABEL[scanResult.stage]}</span>
                {scanCanAdvance ? " -> advance to next stage?" : ""}
              </span>
              {scanCanAdvance && (
                <button
                  onClick={() => { advanceStage(scanResult.card.us_sn, null); setScanResult(null); }}
                  className="text-xs font-semibold px-3 py-1.5 bg-teal-600 text-white rounded-md hover:bg-teal-700 transition-colors"
                >
                  Advance
                </button>
              )}
              <button onClick={() => setScanResult(null)} className="text-teal-400 hover:text-teal-600"><X size={13} /></button>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-hidden p-5 pt-3">
        <div className="h-full flex flex-col gap-4 xl:flex-row">
          <div className="min-h-0 flex-1">
            <div className="h-full grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {PRIMARY_STAGES.map((s) => (
                <StageColumn
                  key={s}
                  stageId={s}
                  cards={columns[s] || []}
                  total={totals[s] ?? stats.counts?.[s] ?? 0}
                  loading={!!loading[s]}
                  onAdvance={(usSn) => advanceStage(usSn, null)}
                  onMove={(usSn, targetStage) => advanceStage(usSn, targetStage)}
                  onLoadMore={loadMore}
                  dragStage={dragStage}
                  onDragStageChange={setDragStage}
                  collapsed={!!collapsedStages[s]}
                  onToggleCollapse={null}
                />
              ))}
            </div>
          </div>

          <div className={`min-h-0 shrink-0 ${isShippedCollapsed ? "xl:w-[220px]" : "xl:w-[380px]"}`}>
            <StageColumn
              key="shipped"
              stageId="shipped"
              cards={columns.shipped || []}
              total={totals.shipped ?? stats.counts?.shipped ?? 0}
              loading={!!loading.shipped}
              onAdvance={(usSn) => advanceStage(usSn, null)}
              onMove={(usSn, targetStage) => advanceStage(usSn, targetStage)}
              onLoadMore={loadMore}
              dragStage={dragStage}
              onDragStageChange={setDragStage}
              collapsed={isShippedCollapsed}
              compactRail={isShippedCollapsed}
              onToggleCollapse={handleToggleCollapse}
            />
          </div>
        </div>
      </div>

      {adjModal && (
        <BatteryAdjModal
          kind={adjModal.kind}
          currentAvailableByKind={adjModal.currentAvailableByKind}
          onConfirm={handleAdjConfirm}
          onClose={() => setAdjModal(null)}
        />
      )}
    </div>
  );
}
