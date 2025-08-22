import React, { useEffect, useState, useMemo, useCallback, useContext } from "react";
import {
  Package, Activity, Clock, CheckCircle, Tag,
  Wifi, WifiOff, Download, Search, Bell, Cpu,
  Database, X, QrCode, AlertCircle, Filter,
  Trash2, Edit, Settings, ChevronRight, BarChart3, RefreshCw
} from "lucide-react";

import usePCBAWebSocket from "../../utils/usePCBAWebSocket";
import { AuthCtx } from "../../auth/AuthContext";

/* ----------------------- API base ----------------------- */
const API_BASE = (process.env.REACT_APP_API_BASE || `${window.location.origin}/api`).replace(/\/+$/, "");

/* ----------------------- JWT helpers ----------------------- */
const decodeJWT = (jwt) => {
  try {
    const payload = jwt.split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
};
const getToken = () => localStorage.getItem("token");

/* ----------------------- Stages ----------------------- */
const classStage = [
  { key: "aging",    label: "Aging",     color: "bg-amber-500",  bgGradient: "from-amber-500 to-orange-600",  icon: Clock },
  { key: "coating",  label: "Coating",   color: "bg-purple-500", bgGradient: "from-purple-500 to-purple-600", icon: Activity },
  // 以 Inventory（Completed）呈現，但資料仍用 completed
  { key: "completed",label: "Inventory", color: "bg-green-500",  bgGradient: "from-green-500 to-emerald-600", icon: CheckCircle },
];
const labelOf = (k) => ({ aging: "Aging", coating: "Coating", completed: "Inventory" }[String(k || "").toLowerCase()] || k);

/* ----------------------- Model classification ----------------------- */
const MODEL_RULES = { AU8: ["10030035"], AM7: ["10030034"] };
const inferModel = (serial) => {
  if (!serial) return null;
  const s = String(serial).toUpperCase().replace(/[- ]/g, "");
  for (const [model, prefixes] of Object.entries(MODEL_RULES)) {
    if (prefixes.some((p) => s.startsWith(p))) return model;
  }
  if (s.includes("AU8")) return "AU8";
  if (s.includes("AM7")) return "AM7";
  return null;
};

/* ----------------------- Time / format helpers ----------------------- */
// 當 stage 是 completed（Inventory）時，用 lastUpdate 當結束時間；否則用現在時間（會持續跳動）
const fmtElapsed = (startIso, lastIso, stage) => {
  const start = new Date(startIso).getTime();
  if (!start) return "-";
  const isCompleted = String(stage || "").toLowerCase() === "completed";
  const end = isCompleted && lastIso ? new Date(lastIso).getTime() : Date.now();
  if (!end || Number.isNaN(end)) return "-";

  let diff = Math.max(0, end - start);
  const h = Math.floor(diff / 3_600_000);
  diff -= h * 3_600_000;
  const m = Math.floor(diff / 60_000);
  diff -= m * 60_000;
  const s = Math.floor(diff / 1_000);

  return `${h}h ${m}m ${s}s`;
};

const toCaliTime = (iso) => {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
  });
};



/* ----------------------- Auth fetch ----------------------- */
const authFetch = async (path, options = {}) => {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  return res;
};

/* ----------------------- Cards ----------------------- */
const StatCard = ({ title, value, icon: Icon, gradient, subtitle, breakdown, badgeLabel }) => (
  <div className="relative">
    {/* NG badge（Inventory 卡專用） */}
    {badgeLabel ? (
      <span className="absolute top-2 right-2 z-20 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-700 border border-rose-200">
        {badgeLabel}
      </span>
    ) : null}

    <div className="relative bg-white rounded-2xl p-6 shadow-sm hover:shadow-md transition-all duration-200 border border-gray-100 overflow-hidden">
      <div className="absolute top-0 right-0 -mt-4 -mr-4 opacity-[0.06]"><Icon size={120} /></div>
      <div className="relative z-10">
        <div className="flex items-start justify-between mb-4">
          <div className={`p-3 rounded-xl bg-gradient-to-br ${gradient || "from-blue-500 to-blue-600"} shadow-sm`}>
            <Icon className="text-white" size={22} />
          </div>
        </div>
        <div className="space-y-3">
          <p className="text-sm text-gray-500 font-medium">{title}</p>
          <p className="text-3xl font-bold text-gray-900">{Number(value || 0).toLocaleString()}</p>

          {/* AM7 / AU8 分列 */}
          {breakdown ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center justify-between px-2 py-1 rounded-md bg-gray-50 text-xs">
                <span className="text-gray-600 font-medium">AM7</span>
                <span className="text-gray-900 font-semibold">{Number(breakdown.AM7 || 0).toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between px-2 py-1 rounded-md bg-gray-50 text-xs">
                <span className="text-gray-600 font-medium">AU8</span>
                <span className="text-gray-900 font-semibold">{Number(breakdown.AU8 || 0).toLocaleString()}</span>
              </div>
            </div>
          ) : null}

          {subtitle ? <p className="text-xs text-gray-400">{subtitle}</p> : null}
        </div>
      </div>
    </div>
  </div>
);

/* ----------------------- Production Flow（總覽條） ----------------------- */
const ProductionFlow = ({ stats }) => {
  const stages = [
    { name: "Aging",     value: stats.aging,     color: "bg-amber-500",  icon: Clock },
    { name: "Coating",   value: stats.coating,   color: "bg-purple-500", icon: Activity },
    { name: "Inventory", value: stats.completed, color: "bg-green-500",  icon: CheckCircle }, // Completed 視為 Inventory（原始 completed 數）
  ];
  const total = stages.reduce((s, v) => s + (v.value || 0), 0);
  return (
    <div className="bg-white rounded-2xl p-6 md:p-7 shadow-sm border border-gray-100">
      <h3 className="text-lg md:text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
        <BarChart3 size={22} className="text-indigo-600" /> Production Pipeline (Live)
      </h3>
      <div className="space-y-5">
        {stages.map((stage, idx) => {
          const pct = total > 0 ? (stage.value / total) * 100 : 0;
          const Icon = stage.icon;
          return (
            <div key={stage.name} className="relative">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <Icon size={18} className="text-gray-600" />
                  <span className="text-sm md:text-base font-medium text-gray-700">{stage.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm md:text-base font-bold text-gray-900">{stage.value || 0}</span>
                  <span className="text-xs md:text-sm text-gray-500">({pct.toFixed(1)}%)</span>
                </div>
              </div>
              <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full ${stage.color} transition-all duration-700 ease-out rounded-full`} style={{ width: `${pct}%` }} />
              </div>
              {idx < stages.length - 1 && <ChevronRight className="absolute -right-3 top-1/2 -translate-y-1/2 text-gray-300" size={16} />}
            </div>
          );
        })}
      </div>
      <div className="mt-6 pt-4 border-t border-gray-100">
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-500">Total In System</span>
          <span className="text-xl md:text-2xl font-bold text-gray-900">{total}</span>
        </div>
      </div>
    </div>
  );
};

/* ----------------------- Slip Progress（含 Aging/Coating Pairs） ----------------------- */
const SlipProgress = ({ status, pairByStage }) => {
  if (!status?.slipNumber) return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
      <div className="flex items-center gap-2 text-gray-500"><Tag size={18} /><span>Slip Progress</span></div>
      <p className="text-sm text-gray-400 mt-3">No slip applied. Open “Packing Slip” to set.</p>
    </div>
  );

  const target = Number(status.targetPairs || 0);
  const donePairs = Number(status.completedPairs || 0);
  const pct = target > 0 ? Math.min(100, (donePairs / target) * 100) : 0;

  const agingPairs   = Number(pairByStage?.aging   || 0);
  const coatingPairs = Number(pairByStage?.coating || 0);

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag size={18} className="text-indigo-600" />
          <h3 className="text-lg font-bold text-gray-900">Slip Progress</h3>
        </div>
        <span className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-semibold">
          {status.slipNumber}
        </span>
      </div>

      {/* 目標完成度 */}
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

      {/* 指標卡：完成/在製（pairs）+ 其他統計 */}
      <div className="mt-4 grid grid-cols-3 md:grid-cols-6 gap-3">
        <div className="rounded-lg border border-gray-200 p-3.5">
          <p className="text-xs text-slate-500">Completed Pairs</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{donePairs}</p>
        </div>
        <div className="rounded-lg border border-amber-200 p-3.5 bg-amber-50/30">
          <p className="text-xs text-amber-700">Aging Pairs</p>
          <p className="mt-1 text-xl font-semibold text-amber-800">{agingPairs}</p>
        </div>
        <div className="rounded-lg border border-purple-200 p-3.5 bg-purple-50/30">
          <p className="text-xs text-purple-700">Coating Pairs</p>
          <p className="mt-1 text-xl font-semibold text-purple-800">{coatingPairs}</p>
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
};

/* ----------------------- Enhanced Scanner Panel（compact） ----------------------- */
const EnhancedScannerPanel = ({ scanInput, setScanInput, handleScan, stageToAssign, setStageToAssign }) => {
  const [selected, setSelected] = useState(stageToAssign);
  const [isScanning, setIsScanning] = useState(false);
  const [modelPreview, setModelPreview] = useState(null);

  useEffect(() => setSelected(stageToAssign), [stageToAssign]);
  useEffect(() => setModelPreview(scanInput ? inferModel(scanInput) : null), [scanInput]);

  const palette = {
    aging:     { active: "bg-amber-600 border-amber-600",   dot: "bg-amber-300" },
    coating:   { active: "bg-purple-600 border-purple-600", dot: "bg-purple-300" },
    completed: { active: "bg-emerald-600 border-emerald-600", dot: "bg-emerald-300" },
  };
  const submitColors = {
    aging: "bg-amber-600 hover:bg-amber-700",
    coating: "bg-purple-600 hover:bg-purple-700",
    completed: "bg-emerald-600 hover:bg-emerald-700",
  };

  const submit = async () => {
    if (!modelPreview) return;
    setIsScanning(true);
    setStageToAssign(selected);
    await handleScan(selected);
    setTimeout(() => setIsScanning(false), 200);
  };

  return (
    <div className="rounded-2xl p-5 md:p-6 bg-white border border-gray-200 shadow-sm">
      <div className="space-y-5">
        {/* Header 更緊湊 */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center p-2 rounded-lg bg-gray-100 text-slate-700 mb-2">
            <QrCode size={24} />
          </div>
          <h2 className="text-xl font-semibold text-slate-900 leading-tight">Scan Production Board</h2>
          <p className="text-xs md:text-sm text-slate-500 mt-0.5">Aging → Coating → Inventory</p>
        </div>

        {/* 階段選擇：高度與間距縮小 */}
        <div className="grid grid-cols-3 gap-2.5">
          {classStage.map((s) => {
            const Icon = s.icon;
            const active = selected === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setSelected(s.key)}
                className={`relative w-full min-h-[84px] p-3 rounded-xl border transition-colors shadow-sm 
                            flex flex-col items-center justify-center gap-1.5 ${
                              active
                                ? `${palette[s.key].active} text-white shadow`
                                : "bg-gray-50 text-slate-800 border-gray-200 hover:bg-gray-100"
                            }`}
              >
                <Icon className={`w-6 h-6 ${active ? "text-white" : "text-slate-700"}`} />
                <span className="text-sm font-semibold">{s.label}</span>
                {active && (<span className={`absolute top-2 right-2 w-2 h-2 rounded-full ${palette[s.key].dot}`} />)}
              </button>
            );
          })}
        </div>

        {/* 輸入區：高度、字級縮小 */}
        <div className="space-y-2">
          <div className="relative">
            <input
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && modelPreview && submit()}
              placeholder="Scan or type serial number..."
              className="w-full px-4 py-3.5 rounded-lg bg-white border border-gray-300 
                         text-base md:text-[17px] text-slate-900 placeholder-slate-400 
                         focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
            />
            {isScanning && (
              <div className="absolute inset-0 rounded-lg bg-white/60 flex items-center justify-center">
                <div className="animate-spin rounded-full h-6 w-6 border-2 border-slate-600 border-b-transparent"></div>
              </div>
            )}
          </div>

          {/* Model 提示：更小的徽章 */}
          {scanInput && (
            <div className="text-center">
              {modelPreview ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle size={16} /> Detected: {modelPreview} Model
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-rose-50 text-rose-700 border border-rose-200">
                  <AlertCircle size={16} /> Invalid Model - Only AM7/AU8 Accepted
                </span>
              )}
            </div>
          )}
        </div>

        {/* 送出按鈕：高度與字級縮小 */}
        <button
          onClick={submit}
          disabled={!scanInput.trim() || !modelPreview}
          className={`w-full py-3.5 rounded-lg font-semibold text-base transition-colors 
            ${scanInput.trim() && modelPreview ? submitColors[stageToAssign] || "bg-indigo-600 hover:bg-indigo-700 text-black" : "bg-gray-100 text-gray-400 cursor-not-allowed"}`}
        >
          {modelPreview
            ? `Process ${modelPreview} to ${classStage.find((s) => s.key === stageToAssign)?.label}`
            : "Enter Valid Serial Number"}
        </button>
      </div>
    </div>
  );
};


/* ----------------------- Slip Modal（原樣） ----------------------- */
const SlipModal = ({ open, onClose, children, title = "Packing Slip Tracker" }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-4xl bg-white rounded-xl shadow-2xl border border-gray-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Tag size={18} className="text-indigo-600" />
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-md hover:bg-gray-100">
            <X size={18} className="text-slate-600" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
};

/* ----------------------- Packing Slip Panel（原樣） ----------------------- */
const PackingSlipPanel = ({ slip, setSlip, useSlipFilter, setUseSlipFilter, onSave, status, saving = false, onApplySlipFilter, appliedValue }) => {
  const disabled = !slip?.slipNumber?.trim();
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gray-100 text-indigo-600">
            <Tag size={18} />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900 leading-tight">Packing Slip Tracker</h3>
            <p className="text-xs text-slate-500">Track AM7+AU8 pairs progress for a slip</p>
          </div>
        </div>

        <label className="shrink-0 inline-flex items-center gap-2 text-sm text-slate-600 select-none">
          <input
            type="checkbox"
            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            checked={useSlipFilter}
            onChange={(e) => setUseSlipFilter(e.target.checked)}
          />
          Use as list filter
        </label>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-12 gap-3">
        <div className="sm:col-span-7 min-w-0">
          <label className="block text-sm font-medium text-slate-700 mb-1">Slip Number</label>
          <div className="flex gap-2">
            <input
              value={slip?.slipNumber || ""}
              onChange={(e) => setSlip((p) => ({ ...p, slipNumber: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") onApplySlipFilter?.(slip?.slipNumber || ""); }}
              placeholder="e.g. PS-240812-01"
              className="w-full px-3 py-2.5 rounded-md border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-900 placeholder-slate-400"
            />
            <button
              type="button"
              onClick={() => onApplySlipFilter?.(slip?.slipNumber || "")}
              className="px-3 py-2.5 rounded-md bg-slate-200 hover:bg-slate-300 text-slate-800 text-sm"
              title="Apply as list filter"
            >
              Apply
            </button>
          </div>
          {appliedValue ? <p className="mt-1 text-xs text-slate-500">Current filter: <b>{appliedValue}</b></p> : null}
        </div>

        <div className="sm:col-span-3">
          <label className="block text-sm font-medium text-slate-700 mb-1">Target Pairs</label>
          <input
            type="number"
            min={0}
            value={slip?.targetPairs ?? 0}
            onChange={(e) => setSlip((p) => ({ ...p, targetPairs: Math.max(0, parseInt(e.target.value || 0, 10)) }))}
            className="w-full px-3 py-2.5 rounded-md border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-900"
          />
        </div>

        <div className="sm:col-span-2 flex sm:items-center">
          <button
            onClick={onSave}
            disabled={saving || disabled}
            className={`w-full sm:w-auto px-4 py-2.5 rounded-md font-semibold transition-colors
              ${saving || disabled ? "bg-indigo-200 text-white cursor-not-allowed"
                                   : "bg-indigo-600 text-white hover:bg-indigo-700"}`}
            title="Save or update this slip"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {status?.slipNumber && (
        <div className="mt-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-gray-200 p-3.5">
              <p className="text-xs text-slate-500">Completed Pairs</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">
                {status.completedPairs ?? 0}{status.targetPairs ? ` / ${status.targetPairs}` : ""}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3.5">
              <p className="text-xs text-slate-500">Completed Boards</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{status.completed ?? 0}</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-3.5">
              <p className="text-xs text-slate-500">Remaining Pairs</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{Math.max(0, status.remainingPairs ?? 0)}</p>
            </div>
          </div>
          <div className="mt-3 h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-600 rounded-full transition-all"
              style={{
                width: `${
                  (status.targetPairs && status.targetPairs > 0)
                    ? Math.min(100, (Number(status.completedPairs || 0) / status.targetPairs) * 100)
                    : 0
                }%`
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

/* ----------------------- Slip Library（原樣） ----------------------- */
const SlipLibrary = ({ items = [], loading, onRefresh, onEditTarget, onDelete, onApplyFilter }) => {
  const [kw, setKw] = useState("");
  const list = useMemo(() => {
    const t = kw.trim().toLowerCase();
    return (items || []).filter((x) => !t || String(x.slipNumber).toLowerCase().includes(t));
  }, [kw, items]);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Tag size={18} className="text-indigo-600" />
          <h3 className="text-base font-semibold text-slate-900">Packing Slip Library</h3>
          <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-xs font-semibold">{items.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              placeholder="Search slip..."
              className="pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <button onClick={onRefresh} className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center gap-2">
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-900">
              <th className="py-2.5 px-2">Packing Slip Number</th>
              <th className="py-2.5 px-2">Target Pairs</th>
              <th className="py-2.5 px-2">Completed Pairs</th>
              <th className="py-2.5 px-2">Aging</th>
              <th className="py-2.5 px-2">Coating</th>
              <th className="py-2.5 px-2">Inventory</th>
              <th className="py-2.5 px-2">Updated</th>
              <th className="py-2.5 px-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="py-6 text-center text-slate-400" colSpan={8}>Loading...</td></tr>
            ) : list.length === 0 ? (
              <tr><td className="py-6 text-center text-slate-400" colSpan={8}>No slips</td></tr>
            ) : list.map((s) => (
              <tr key={s.slipNumber} className="border-t border-gray-100">
                <td className="py-2.5 px-2">
                  <span className="px-2.5 py-1 rounded bg-amber-50 text-amber-800 font-medium">{s.slipNumber}</span>
                </td>
                <td className="py-2.5 px-2 text-gray-900">{s.targetPairs}</td>
                <td className="py-2.5 px-2 font-semibold text-gray-900">{s.completedPairs}</td>
                <td className="py-2.5 px-2 text-gray-900">{s.aging}</td>
                <td className="py-2.5 px-2 text-gray-900">{s.coating}</td>
                <td className="py-2.5 px-2 text-gray-900">{s.completed}</td>
                <td className="py-2.5 px-2 text-gray-900">{toCaliTime(s.updatedAt)}</td>
                <td className="py-2.5 px-2">
                  <div className="flex justify-end gap-1.5">
                    <button
                      onClick={() => onApplyFilter(s.slipNumber)}
                      className="px-2 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700"
                      title="Apply to filter">
                      Apply
                    </button>
                    <button
                      onClick={async () => {
                        const v = prompt(`New target pairs for ${s.slipNumber}:`, String(s.targetPairs ?? 0));
                        if (v === null) return;
                        const num = Math.max(0, parseInt(v || "0", 10));
                        await onEditTarget(s.slipNumber, num);
                      }}
                      className="px-2 py-1.5 rounded bg-blue-500 hover:bg-blue-600 text-white flex items-center gap-1"
                      title="Edit target pairs">
                      <Edit size={14} /> Edit
                    </button>
                    <button
                      onClick={() => onDelete(s.slipNumber)}
                      className="px-2 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white flex items-center gap-1"
                      title="Delete slip">
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* ----------------------- Board Card（原樣，標籤改 Inventory） ----------------------- */
const ModernBoardCard = ({ board, onViewDetails, isBlink, isAdmin, onEdit, onDelete, onToggleNG }) => {
  const stage = classStage.find((s) => s.key === board.stage);
  const Icon = stage?.icon || Package;

  const ng = !!board.ngFlag;
  const ngClasses = ng
    ? "bg-rose-50 border-rose-300 hover:border-rose-400 ring-1 ring-rose-200"
    : "bg-white border-gray-200 hover:border-indigo-300";

  return (
    <div className="relative group">
      <div
        onClick={onViewDetails}
        className={`${ngClasses} rounded-xl p-5 border hover:shadow-lg transition-all duration-300 cursor-pointer ${isBlink ? "animate-pulse ring-2 ring-indigo-400 ring-opacity-50" : ""}`}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-start gap-3">
              <div className={`p-2.5 rounded-lg bg-gradient-to-br ${stage?.bgGradient || "from-gray-400 to-gray-500"} ${ng ? "grayscale" : ""}`}>
                <Icon className="text-white" size={18} />
              </div>
              <div className="min-w-0">
                <h4 className={`font-semibold text-sm md:text-base truncate ${ng ? "text-rose-800" : "text-gray-900"}`}>{board.serialNumber}</h4>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${board.model === "AU8" ? "bg-indigo-100 text-indigo-700" : "bg-cyan-100 text-cyan-700"}`}>{board.model}</span>
                  {board.batchNumber && <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-700">{board.batchNumber}</span>}
                  {board.slipNumber && <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">{board.slipNumber}</span>}
                  {ng ? <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-rose-200 text-rose-800">NG</span> : null}
                  {board.ngReason ? <span className="px-2 py-0.5 rounded-md text-xs bg-rose-100 text-rose-700 truncate max-w-[160px]">{board.ngReason}</span> : null}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between mt-3">
              <div className={`flex items-center gap-4 text-xs ${ng ? "text-rose-700" : "text-gray-500"}`}>
                <span className="flex items-center gap-1"><Clock size={13} />{fmtElapsed(board.startTime, board.lastUpdate, board.stage)}</span>
                <span>{labelOf(board.stage)}</span>
              </div>
              <ChevronRight className={`${ng ? "text-rose-400" : "text-gray-400"} group-hover:text-indigo-600 transition-colors`} size={18} />
            </div>
          </div>
        </div>
      </div>

      {/* Admin actions */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 z-10">
        <button
          onClick={(e) => { e.stopPropagation(); onToggleNG?.(board, !board.ngFlag); }}
          className={`p-1.5 rounded ${board.ngFlag ? "bg-rose-600 hover:bg-rose-700 text-white" : "bg-rose-100 hover:bg-rose-200 text-rose-700"}`}
          title={board.ngFlag ? "Clear NG" : "Mark NG"}
        >NG</button>
        {isAdmin && (
          <>
            <button onClick={(e) => { e.stopPropagation(); onEdit(board); }} className="p-1.5 rounded bg-blue-500 text-white hover:bg-blue-600 transition" title="Edit"><Edit size={12} /></button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(board); }} className="p-1.5 rounded bg-red-500 text-white hover:bg-red-600 transition" title="Delete"><Trash2 size={12} /></button>
          </>
        )}
      </div>
    </div>
  );
};

/* ----------------------- Admin Edit Modal（原樣） ----------------------- */
const AdminEditModal = ({ board, onClose, onSave }) => {
  const [formData, setFormData] = useState({
    newSerialNumber: board.serialNumber,
    batchNumber: board.batchNumber,
    model: board.model,
    stage: board.stage,
    operator: board.operator || "User",
    note: "",
    slipNumber: board.slipNumber || "",
    targetPairs: undefined,
  });
  const handleSubmit = () => onSave(board.serialNumber, formData);
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-6 text-white rounded-t-2xl">
          <h3 className="text-xl font-bold">Admin Edit Board</h3>
          <p className="text-blue-100 text-sm mt-1">Modify board details</p>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Serial Number</label>
            <input value={formData.newSerialNumber} onChange={(e) => setFormData({ ...formData, newSerialNumber: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 placeholder-gray-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
              <select value={formData.model} onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-gray-900">
                <option value="AM7">AM7</option><option value="AU8">AU8</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Stage</label>
              <select value={formData.stage} onChange={(e) => setFormData({ ...formData, stage: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-gray-900">
                {["aging","coating","completed"].map((k)=> <option key={k} value={k}>{labelOf(k)}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Slip Number</label>
              <input value={formData.slipNumber || ""} onChange={(e) => setFormData({ ...formData, slipNumber: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 placeholder-gray-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Target Pairs</label>
              <input type="number" min={0} value={formData.targetPairs ?? ""} onChange={(e) => setFormData({ ...formData, targetPairs: e.target.value === "" ? undefined : Math.max(0, parseInt(e.target.value || 0, 10)) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 placeholder-gray-400" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Batch Number</label>
            <input value={formData.batchNumber} onChange={(e) => setFormData({ ...formData, batchNumber: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 placeholder-gray-400" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Note</label>
            <textarea value={formData.note} onChange={(e) => setFormData({ ...formData, note: e.target.value })} rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-900 placeholder-gray-400" placeholder="Optional admin note..." />
          </div>
        </div>
        <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:text-gray-800 transition">Cancel</button>
          <button onClick={handleSubmit} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">Save Changes</button>
        </div>
      </div>
    </div>
  );
};

/* ----------------------- Main ----------------------- */
export default function PCBATracking() {
  const [data, setData] = useState([]);
  const [stats, setStats] = useState({ total: 0, aging: 0, coating: 0, completed: 0, efficiency: 0, byModel: {} });

  const [slipOpen, setSlipOpen] = useState(false);
  const [slip, setSlip] = useState(() => {
    try { return JSON.parse(localStorage.getItem("pcba_slip") || "null") || { slipNumber: "", targetPairs: 0 }; }
    catch { return { slipNumber: "", targetPairs: 0 }; }
  });
  const [useSlipFilter, setUseSlipFilter] = useState(() => localStorage.getItem("pcba_slip_filter") === "1");
  const [slipFilterApplied, setSlipFilterApplied] = useState(() => localStorage.getItem("pcba_slip_filter_value") || "");
  const [savingSlip, setSavingSlip] = useState(false);
  const [slipStatus, setSlipStatus] = useState(null);

  // Slip library
  const [slipList, setSlipList] = useState([]);
  const [loadingSlipList, setLoadingSlipList] = useState(false);

  const [scan, setScan] = useState("");
  const [stage, setStage] = useState("aging");
  const [pick, setPick] = useState(null);
  const [editBoard, setEditBoard] = useState(null);
  const [fStage, setFStage] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [ngFilter, setNgFilter] = useState("all"); // all | ng | ok
  const [q, setQ] = useState("");
  const [log, setLog] = useState([]);
  const [blink, setBlink] = useState(new Set());

  const auth = useContext(AuthCtx) || {};
  const token = getToken();
  const claims = token ? decodeJWT(token) : null;
  const isAdmin = (claims?.role || auth?.user?.role) === "admin";
  const operatorName = claims?.sub || auth?.user?.username || "User";

  const toast = useCallback((msg, level = "info") => {
    if (!msg) return;
    const id = Date.now() + Math.random();
    setLog((l) => [...l, { id, msg, level }]);
    setTimeout(() => setLog((l) => l.filter((x) => x.id !== id)), 3200);
  }, []);

  const upsertLocal = useCallback((b) => {
    setData((p) => {
      const i = p.findIndex((x) => x.serialNumber === b.serialNumber);
      if (i >= 0) { const cp = [...p]; cp[i] = { ...cp[i], ...b }; return cp; }
      return [b, ...p];
    });
    setBlink((s) => new Set(s).add(b.serialNumber));
    setTimeout(() => setBlink((s) => { const n = new Set(s); n.delete(b.serialNumber); return n; }), 700);
  }, []);

 /* KPI breakdowns from stats.byModel */
const statsByModel = stats?.byModel;

// 分站別統計（以後端 byModel 為主）
const stageBreakdown = useMemo(() => {
  const bm = statsByModel ?? {};
  const safe = (m, k) => Number(bm?.[m]?.[k] ?? 0);
  return {
    aging:     { AM7: safe("AM7", "aging"),     AU8: safe("AU8", "aging") },
    coating:   { AM7: safe("AM7", "coating"),   AU8: safe("AU8", "coating") },
    completed: { AM7: safe("AM7", "completed"), AU8: safe("AU8", "completed") }, // Inventory（原始 completed）
  };
}, [statsByModel]);

// 依前端清單推估 Inventory(=completed) 的 AM7/AU8（排除 NG），做為最後保底
const completedByModel = useMemo(() => {
  const am7 = data.reduce((n, b) =>
    n + (b.stage === "completed" && !b.ngFlag && b.model === "AM7" ? 1 : 0), 0);
  const au8 = data.reduce((n, b) =>
    n + (b.stage === "completed" && !b.ngFlag && b.model === "AU8" ? 1 : 0), 0);
  return { AM7: am7, AU8: au8, total: am7 + au8 };
}, [data]);

// 取第一個「>0」的候選值；如果都沒有才回 0
const pickPositive = (...candidates) => {
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
};

// 顯示可用量（available）：優先用後端 available*；若為 0 或缺值，退回 byModel.completed；再退回前端推估 completedByModel
const available = useMemo(() => {
  const a7 = pickPositive(
    stats.availableAM7,
    stageBreakdown.completed.AM7,
    completedByModel.AM7
  );
  const a8 = pickPositive(
    stats.availableAU8,
    stageBreakdown.completed.AU8,
    completedByModel.AU8
  );
  const total = pickPositive(
    stats.availableTotal,
    stats.completed,
    a7 + a8
  );
  return { AM7: a7, AU8: a8, total };
}, [
  stats.availableAM7, stats.availableAU8, stats.availableTotal, stats.completed,
  stageBreakdown.completed, completedByModel
]);

/* Pairs（可裝配對數）= min(available AM7, available AU8) */
const pairsDone = useMemo(() => Math.min(available.AM7, available.AU8), [available]);

/* NG 總數（徽章顯示在 Inventory 卡） */
const ngCount = useMemo(() => data.filter((b) => b.ngFlag).length, [data]);



  /* Slip handlers */
  const refreshSlip = useCallback(async (slipNumber) => {
    if (!slipNumber) { setSlipStatus(null); return; }
    try {
      const r = await authFetch(`/pcba/slips/${encodeURIComponent(slipNumber)}/status`);
      if (r.ok) {
        const s = await r.json();
        setSlipStatus({ ...s });
      }
    } catch { /* ignore */ }
  }, []);

  const fetchSlipList = useCallback(async () => {
    setLoadingSlipList(true);
    try {
      const r = await authFetch(`/pcba/slips`);
      if (r.ok) {
        const arr = await r.json();
        arr.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        setSlipList(arr);
      }
    } catch { /* ignore */ }
    finally { setLoadingSlipList(false); }
  }, []);

  const saveSlip = useCallback(async () => {
    if (!slip?.slipNumber?.trim()) return;
    setSavingSlip(true);
    try {
      const res = await authFetch(`/pcba/slips`, {
        method: "POST",
        body: JSON.stringify({ slipNumber: slip.slipNumber.trim(), targetPairs: Number(slip.targetPairs || 0) }),
      });
      if (!res.ok) {
        const t = await res.json().catch(() => ({ detail: "" }));
        throw new Error(t.detail || `Save failed (${res.status})`);
      }
      localStorage.setItem("pcba_slip", JSON.stringify({ slipNumber: slip.slipNumber.trim(), targetPairs: Number(slip.targetPairs || 0) }));
      localStorage.setItem("pcba_slip_filter_value", slip.slipNumber.trim());
      setSlipFilterApplied(slip.slipNumber.trim());
      toast(`Slip saved: ${slip.slipNumber} (${slip.targetPairs || 0})`, "success");
      refreshSlip(slip.slipNumber.trim());
      await fetchSlipList();
    } catch (e) {
      toast(e.message || "Save slip failed", "error");
    } finally { setSavingSlip(false); }
  }, [slip, toast, refreshSlip, fetchSlipList]);

  useEffect(() => { localStorage.setItem("pcba_slip_filter", useSlipFilter ? "1" : "0"); }, [useSlipFilter]);

  /* WebSocket */
  const onWSMessage = useCallback((msg) => {
    switch (msg.type) {
      case "initial_data":
        if (Array.isArray(msg.boards)) setData(msg.boards);
        if (msg.statistics) setStats((s) => ({ ...s, ...msg.statistics }));
        break;
      case "board_update":
        if (msg.board?.serialNumber) {
          upsertLocal(msg.board);
          setPick((p) => (p && p.serialNumber === msg.board.serialNumber ? { ...p, ...msg.board } : p));
        }
        if (slipFilterApplied) refreshSlip(slipFilterApplied);
        break;
      case "board_deleted":
        if (msg.serialNumber) setData((p) => p.filter((x) => x.serialNumber !== msg.serialNumber));
        if (slipFilterApplied) refreshSlip(slipFilterApplied);
        break;
      case "statistics_update":
        if (msg.statistics) setStats((s) => ({ ...s, ...msg.statistics }));
        break;
      case "notification": toast(msg.message, msg.level || "info"); break;
      case "error": toast(msg.message || "Server error", "error"); break;
      default: break;
    }
  }, [upsertLocal, toast, slipFilterApplied, refreshSlip]);
  const { isConnected, isConnecting, reconnect } = usePCBAWebSocket(onWSMessage);

  /* Initial fetch（多抓 /assembly/pcba_inventory 以帶入 available 初值） */
  useEffect(() => {
    (async () => {
      try {
        const [r1, r2, r3] = await Promise.all([
          authFetch(`/pcba/boards`),
          authFetch(`/pcba/statistics`),
          authFetch(`/assembly/pcba_inventory`), // ← 新增
        ]);
        let boards = [];
        if (r1.ok) boards = await r1.json();
        setData(boards);
        if (r2.ok) {
          const statsData = await r2.json();
          setStats((v) => ({ ...v, ...statsData }));
        }
        if (r3.ok) {
          const inv = await r3.json();
          setStats((v) => ({
            ...v,
            availableAM7:  inv.availableAM7 ?? v.availableAM7 ?? 0,
            availableAU8:  inv.availableAU8 ?? v.availableAU8 ?? 0,
            availableTotal:inv.availableTotal ?? v.availableTotal ?? ((inv.availableAM7 || 0) + (inv.availableAU8 || 0)),
            consumedAM7:   inv.usedAM7 ?? v.consumedAM7 ?? 0,
            consumedAU8:   inv.usedAU8 ?? v.consumedAU8 ?? 0,
            consumedTotal: inv.usedTotal ?? v.consumedTotal ?? 0,
          }));
        }
      } catch { /* ignore */ }
    })();
  }, []);

  /* Apply Slip (手動) */
  const applySlip = useCallback((val) => {
    setSlipFilterApplied(val);
    localStorage.setItem("pcba_slip_filter_value", val || "");
    if (val) refreshSlip(val);
    else setSlipStatus(null);
  }, [refreshSlip]);

  const editSlipTarget = useCallback(async (sn, tp) => {
    try {
      const r = await authFetch(`/pcba/slips/${encodeURIComponent(sn)}`, {
        method: "PATCH",
        body: JSON.stringify({ slipNumber: sn, targetPairs: Number(tp || 0) })
      });
      if (!r.ok) {
        const t = await r.json().catch(() => ({ detail: "" }));
        throw new Error(t.detail || `Update failed (${r.status})`);
      }
      toast(`Updated ${sn} → ${tp}`, "success");
      await fetchSlipList();
      if (slipStatus?.slipNumber === sn) refreshSlip(sn);
    } catch (e) {
      toast(e.message || "Update slip failed", "error");
    }
  }, [fetchSlipList, toast, slipStatus, refreshSlip]);

  const deleteSlip = useCallback(async (sn) => {
    const ok = window.confirm(`Delete slip ${sn}? (Only allowed when no boards use it)`);
    if (!ok) return;
    try {
      const r = await authFetch(`/pcba/slips/${encodeURIComponent(sn)}`, { method: "DELETE" });
      if (r.status === 409) {
        const t = await r.json().catch(() => ({ detail: "Cannot delete: related boards exist" }));
        throw new Error(t.detail);
      }
      if (!r.ok) {
        const t = await r.json().catch(() => ({ detail: "" }));
        throw new Error(t.detail || `Delete failed (${r.status})`);
      }
      toast(`Deleted slip ${sn}`, "success");
      await fetchSlipList();
      if (slipFilterApplied === sn) { applySlip(""); }
    } catch (e) {
      toast(e.message || "Delete slip failed", "error");
    }
  }, [fetchSlipList, toast, slipFilterApplied, applySlip]);

  /* Scan → /scan */
  const submit = async (selectedStageFromPanel) => {
    const chosenStage = selectedStageFromPanel || stage;
    const serial = scan.trim();
    if (!serial) return toast("Please scan a barcode", "warning");
    const model = inferModel(serial);
    if (!model) return toast("Only AU8/AM7 models accepted", "error");

    try {
      const res = await authFetch(`/pcba/scan`, {
        method: "POST",
        body: JSON.stringify({
          serialNumber: serial,
          stage: chosenStage,
          model,
          operator: operatorName,
          slipNumber: slip?.slipNumber || undefined,
          targetPairs: slip?.targetPairs ?? undefined,
        }),
      });
      if (!res.ok) {
        const t = await res.json().catch(() => ({ detail: "" }));
        throw new Error(t.detail || `Scan failed (${res.status})`);
      }
      const updated = await res.json();
      upsertLocal(updated);
      toast(`${serial} → ${labelOf(chosenStage)}`, "success");
      if (slipFilterApplied) refreshSlip(slipFilterApplied);
    } catch (e) {
      toast(e.message || "Submit failed", "error");
    } finally {
      setScan("");
    }
  };

  /* Admin Edit / Delete / NG */
  const handleAdminEdit = async (serialNumber, formData) => {
    try {
      const res = await authFetch(`/pcba/boards/${encodeURIComponent(serialNumber)}/admin`, {
        method: "PATCH",
        body: JSON.stringify(formData),
      });
      if (!res.ok) {
        const t = await res.json().catch(() => ({ detail: "" }));
        throw new Error(t.detail || `Edit failed (${res.status})`);
      }
      const updatedBoard = await res.json();
      if (formData.newSerialNumber && formData.newSerialNumber !== serialNumber) {
        setData((p) => p.filter((x) => x.serialNumber !== serialNumber));
        upsertLocal(updatedBoard);
      } else {
        upsertLocal(updatedBoard);
      }
      setEditBoard(null);
      toast("Board updated successfully", "success");
      if (slipFilterApplied) refreshSlip(slipFilterApplied);
    } catch (e) {
      toast(e.message || "Edit failed", "error");
    }
  };

  const handleDelete = async (board) => {
    const yes = window.confirm(`Delete ${board.serialNumber}?`);
    if (!yes) return;
    try {
      const res = await authFetch(`/pcba/boards/${encodeURIComponent(board.serialNumber)}`, { method: "DELETE" });
      if (res.status === 404) return toast(`Board ${board.serialNumber} not found`, "warning");
      if (!res.ok) {
        const t = await res.json().catch(() => ({ detail: "" }));
        throw new Error(t.detail || `Delete failed (${res.status})`);
      }
      setData((p) => p.filter((x) => x.serialNumber !== board.serialNumber));
      setPick(null);
      toast(`Deleted ${board.serialNumber}`, "success");
      if (slipFilterApplied) refreshSlip(slipFilterApplied);
    } catch (e) {
      toast(e.message || "Delete failed", "error");
    }
  };

  const toggleNG = async (board, setToNG) => {
    try {
      let reason = "";
      if (setToNG) reason = prompt("Enter NG reason (optional):") || "";
      else { const ok = window.confirm("Clear NG flag?"); if (!ok) return; }

      const res = await authFetch(`/pcba/boards/${encodeURIComponent(board.serialNumber)}/ng`, {
        method: "PATCH",
        body: JSON.stringify({ ng: !!setToNG, reason }),
      });
      if (!res.ok) {
        const t = await res.json().catch(() => ({ detail: "" }));
        throw new Error(t.detail || `NG update failed (${res.status})`);
      }
      const updated = await res.json();
      upsertLocal(updated);
      setPick((p) => (p && p.serialNumber === updated.serialNumber ? { ...p, ...updated } : p));
      toast(setToNG ? "Marked NG" : "Cleared NG", "success");
      if (slipFilterApplied) refreshSlip(slipFilterApplied);
    } catch (e) {
      toast(e.message || "NG update failed", "error");
    }
  };

  /* Filtered list（含 NG & Slip） */
  const list = useMemo(() => {
    const t = q.toLowerCase();
    return data.filter((b) => {
      const matchText = (b.serialNumber || "").toLowerCase().includes(t) || (b.batchNumber || "").toLowerCase().includes(t);
      const matchStage = fStage === "all" || b.stage === fStage;
      const matchModel = modelFilter === "all" || b.model === modelFilter;
      const matchSlip = !useSlipFilter || !slipFilterApplied
        ? true
        : (b.slipNumber || "").includes(slipFilterApplied) || (b.batchNumber || "").includes(slipFilterApplied);
      const matchNG = ngFilter === "all" ? true : (ngFilter === "ng" ? !!b.ngFlag : !b.ngFlag);
      return matchText && matchStage && matchModel && matchSlip && matchNG;
    });
  }, [data, q, fStage, modelFilter, useSlipFilter, slipFilterApplied, ngFilter]);

  /* --------- 計算目前 slip 在 Aging/Coating 的 pairs（排除 NG），若後端提供則優先使用 --------- */
  const slipPairByStage = useMemo(() => {
    if (!slipStatus?.slipNumber) return { aging: 0, coating: 0, completed: Number(slipStatus?.completedPairs || 0) };

    // 後端欄位優先
    if (typeof slipStatus.agingPairs === "number" || typeof slipStatus.coatingPairs === "number") {
      return {
        aging: Number(slipStatus.agingPairs || 0),
        coating: Number(slipStatus.coatingPairs || 0),
        completed: Number(slipStatus.completedPairs || 0),
      };
    }

    // 前端推算：同 slip、同站別、排除 NG；pairs = min(AM7, AU8)
    const countPairsAt = (stageKey) => {
      const arr = data.filter(b =>
        b.slipNumber === slipStatus.slipNumber &&
        b.stage === stageKey &&
        !b.ngFlag
      );
      const am7 = arr.reduce((n, b) => n + (b.model === "AM7" ? 1 : 0), 0);
      const au8 = arr.reduce((n, b) => n + (b.model === "AU8" ? 1 : 0), 0);
      return Math.min(am7, au8);
    };

    return {
      aging: countPairsAt("aging"),
      coating: countPairsAt("coating"),
      completed: Number(slipStatus.completedPairs || countPairsAt("completed")),
    };
  }, [data, slipStatus]);

  /* Export CSV */
  const exportCsv = () => {
    const rows = [
      ["Serial", "Batch", "Slip", "Model", "Stage", "Start (CA Time)", "Last Update (CA Time)", "Duration", "Operator", "NG Flag", "NG Reason"],
      ...list.map((b) => [
        b.serialNumber, b.batchNumber, b.slipNumber || "",
        b.model, labelOf(b.stage),
        toCaliTime(b.startTime), toCaliTime(b.lastUpdate), fmtElapsed(b.startTime, b.lastUpdate, b.stage),
        b.operator || "User",
        b.ngFlag ? "NG" : "",
        (b.ngReason || "").replace(/\n/g, " "),
      ]),
    ];
    const blob = new Blob([rows.map((r) => r.map((cell) => {
      const str = String(cell ?? "");
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    }).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `PCBA_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    toast("Report exported", "success");
  };

  useEffect(() => { if (slipOpen) fetchSlipList(); }, [slipOpen, fetchSlipList]);

  /* KPI cards 使用分列與 NG 徽章（Inventory=Available） */
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 text-[15px]">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-xl shadow-lg"><Cpu className="text-white" size={26} /></div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">PCBA Production Tracker</h1>
                  <p className="text-xs text-gray-500">Live dashboard</p>
                </div>
              </div>
              {isAdmin && <span className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-semibold">Admin</span>}
              {slipStatus?.slipNumber && (
                <span className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-semibold">
                  Slip: {slipStatus.slipNumber} • {slipStatus.completedPairs}/{slipStatus.targetPairs} pairs
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSlipOpen(true)}
                className="flex items-center gap-2 px-3.5 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 transition-colors"
                title="Open Packing Slip Tracker"
              >
                <Tag size={18} />Packing Slip
              </button>

              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${isConnected ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                {isConnected ? <Wifi size={18} /> : <WifiOff size={18} />}
                <span className="text-sm font-medium">{isConnected ? "Connected" : isConnecting ? "Connecting..." : "Offline"}</span>
              </div>
              <button onClick={reconnect} className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors" disabled={isConnecting} title="Reconnect"><Settings size={20} /></button>
              <button onClick={exportCsv} className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:shadow-lg transition-all duration-200 font-medium">
                <Download size={18} /> Export
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
<div className="p-6 md:p-8 space-y-7 max-w-7xl xl:max-w-8xl mx-auto">
  {/* ① KPI：Aging / Coating / Inventory / Pairs */}
  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
    <StatCard
      title="Aging In Progress"
      value={stats.aging}
      icon={Clock}
      gradient="from-amber-500 to-orange-600"
      breakdown={stageBreakdown.aging}
      subtitle="Real-time by model"
    />
    <StatCard
      title="Coating In Progress"
      value={stats.coating}
      icon={Activity}
      gradient="from-purple-500 to-purple-600"
      breakdown={stageBreakdown.coating}
      subtitle="Real-time by model"
    />
    <StatCard
      title="Inventory (Available)"
      value={available.total}
      icon={CheckCircle}
      gradient="from-green-500 to-emerald-600"
      breakdown={available}
      subtitle="Ready for assembly (real-time)"
      badgeLabel={`NG ${ngCount}`}
    />
    <StatCard
      title="Pairs Done"
      value={pairsDone}
      icon={Package}
      gradient="from-indigo-500 to-indigo-700"
      subtitle="min(AM7, AU8) available"
    />
  </div>

  {/* ② Slip Progress — 單獨一行 */}
  <SlipProgress status={slipStatus} pairByStage={slipPairByStage} />

  {/* ③ Scan Panel — 單獨一行（放大） */}
  <EnhancedScannerPanel
    scanInput={scan}
    setScanInput={setScan}
    handleScan={submit}
    stageToAssign={stage}
    setStageToAssign={setStage}
  />

  {/* ④ Active Boards（左 2 欄） + Production Pipeline (Live)（右 1 欄） */}
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
    {/* Active Boards */}
    <div className="lg:col-span-2 space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-5 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <Database size={22} className="text-indigo-600" /> Active Boards
            </h3>
            <span className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-sm font-semibold">
              {list.length} items
            </span>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search serial or batch..."
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm 
                           focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 
                           text-gray-900 placeholder-gray-400"
              />
            </div>
            <select
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              className="px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
            >
              <option value="all">All Models</option>
              <option value="AM7">AM7</option>
              <option value="AU8">AU8</option>
            </select>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <select
                value={fStage}
                onChange={(e) => setFStage(e.target.value)}
                className="pl-10 pr-8 py-2.5 bg-white border border-gray-200 rounded-lg text-sm 
                           focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none cursor-pointer text-gray-900"
              >
                <option value="all">All Stages</option>
                {["aging", "coating", "completed"].map((k) => (
                  <option key={k} value={k}>
                    {labelOf(k)}
                  </option>
                ))}
              </select>
            </div>
            {/* NG Filter */}
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-rose-400" size={18} />
              <select
                value={ngFilter}
                onChange={(e) => setNgFilter(e.target.value)}
                className="pl-10 pr-8 py-2.5 bg-white border border-rose-200 rounded-lg text-sm 
                           focus:outline-none focus:ring-2 focus:ring-rose-400 appearance-none cursor-pointer text-gray-900"
              >
                <option value="all">NG: All</option>
                <option value="ng">NG Only</option>
                <option value="ok">OK Only</option>
              </select>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-3 max-h-[560px] overflow-y-auto">
          {list.length ? (
            list.map((b) => (
              <ModernBoardCard
                key={b.serialNumber}
                board={b}
                onViewDetails={() => setPick(b)}
                isBlink={blink.has(b.serialNumber)}
                isAdmin={isAdmin}
                onEdit={() => setEditBoard(b)}
                onDelete={handleDelete}
                onToggleNG={toggleNG}
              />
            ))
          ) : (
            <div className="text-center py-14">
              <Database className="mx-auto text-gray-300 mb-4" size={52} />
              <p className="text-gray-500">No boards found</p>
              <p className="text-sm text-gray-400 mt-1">Try adjusting your filters</p>
            </div>
          )}
        </div>
      </div>
    </div>

    {/* Production Pipeline (Live) */}
    <div className="lg:col-span-1">
      <ProductionFlow stats={stats} />
    </div>
  </div>
</div>


      {/* Detail modal */}
      {pick && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden">
            <div className={`p-6 text-white ${pick.ngFlag ? "bg-gradient-to-r from-rose-600 to-red-600" : "bg-gradient-to-r from-indigo-600 to-purple-600"}`}>
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-2xl font-bold mb-2">{pick.serialNumber}</h3>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="px-3 py-1 bg-white/20 rounded-full text-sm font-medium backdrop-blur-sm">{pick.model}</span>
                    {pick.slipNumber && <span className="px-3 py-1 bg-white/20 rounded-full text-sm font-medium backdrop-blur-sm">{pick.slipNumber}</span>}
                    {pick.ngFlag && <span className="px-3 py-1 bg-white/25 rounded-full text-sm font-semibold text-white">NG</span>}
                    <span className="text-sm opacity-90">{pick.batchNumber}</span>
                  </div>
                </div>
                <button onClick={() => setPick(null)} className="p-2 hover:bg-white/20 rounded-lg transition-colors"><X size={24} /></button>
              </div>
            </div>
            <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
              <div className="bg-gradient-to-r from-gray-50 to-gray-100 rounded-xl p-4">
                <h4 className="text-sm font-semibold text-gray-600 mb-3">Current Status</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div><p className="text-xs text-gray-500 mb-1">Stage</p><p className="font-semibold text-gray-900">{labelOf(pick.stage)}</p></div>
                  <div><p className="text-xs text-gray-500 mb-1">Duration</p><p className="font-semibold text-gray-900">{fmtElapsed(pick.startTime, pick.lastUpdate, pick.stage)}</p></div>
                  <div><p className="text-xs text-gray-500 mb-1">Operator</p><p className="font-semibold text-gray-900">{pick.operator || "System"}</p></div>
                  <div><p className="text-xs text-gray-500 mb-1">Start Time (CA)</p><p className="font-semibold text-gray-900">{toCaliTime(pick.startTime)}</p></div>
                  <div><p className="text-xs text-gray-500 mb-1">Last Update (CA)</p><p className="font-semibold text-gray-900">{toCaliTime(pick.lastUpdate)}</p></div>
                  <div><p className="text-xs text-gray-500 mb-1">Serial (PK)</p><p className="font-semibold text-gray-900">{pick.serialNumber}</p></div>
                  {pick.slipNumber && <div><p className="text-xs text-gray-500 mb-1">Slip Number</p><p className="font-semibold text-gray-900">{pick.slipNumber}</p></div>}
                  {pick.ngReason && <div className="md:col-span-3"><p className="text-xs text-gray-500 mb-1">NG Reason</p><p className="font-semibold text-gray-900 break-words">{pick.ngReason}</p></div>}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-gray-600 mb-3">Production History</h4>
                <div className="space-y-3">
                  {(pick.history || []).map((h, i) => {
                    const isNGNote = (h.notes || "").toLowerCase().startsWith("ng ");
                    const st = isNGNote
                      ? { bgGradient: "from-rose-500 to-rose-600", icon: AlertCircle, label: "NG" }
                      : (classStage.find((s) => s.key === h.stage) || { bgGradient: "from-gray-400 to-gray-500", icon: Activity, label: h.stage });
                    const Icon = st.icon;
                    return (
                      <div key={i} className="flex items-start gap-3">
                        <div className={`p-2 rounded-lg bg-gradient-to-br ${st.bgGradient} mt-1`}><Icon className="text-white" size={16} /></div>
                        <div className="flex-1">
                          <p className="font-medium text-gray-900">{st.label}</p>
                          <p className="text-xs text-gray-500 mt-1">{toCaliTime(h.timestamp)} • Processed by {h.operator}</p>
                          {h.notes && <p className="text-xs text-gray-400 mt-1 italic">{h.notes}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="border-t border-gray-200 p-6 bg-gray-50">
              <div className="flex justify-between items-center">
                <div className="text-xs text-gray-400">Serial: {pick.serialNumber}</div>
                <div className="flex gap-3">
                  <button
                    onClick={() => toggleNG(pick, !pick.ngFlag)}
                    className={`px-4 py-2 rounded-lg transition-colors font-medium ${
                      pick.ngFlag ? "bg-rose-50 text-rose-600 hover:bg-rose-100"
                                  : "bg-amber-50 text-amber-700 hover:bg-amber-100"
                    }`}
                  >
                    {pick.ngFlag ? "Clear NG" : "Mark NG"}
                  </button>
                  {isAdmin && (
                    <button onClick={() => handleDelete(pick)} className="px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors font-medium">
                      Delete Board
                    </button>
                  )}
                  <button onClick={() => setPick(null)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium">Close</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {editBoard && <AdminEditModal board={editBoard} onClose={() => setEditBoard(null)} onSave={handleAdminEdit} />}

      {/* Packing Slip Modal */}
      <SlipModal open={slipOpen} onClose={() => setSlipOpen(false)}>
        <div className="grid grid-cols-1 gap-6">
          <PackingSlipPanel
            slip={slip}
            setSlip={setSlip}
            useSlipFilter={useSlipFilter}
            setUseSlipFilter={setUseSlipFilter}
            onSave={saveSlip}
            status={slipStatus}
            saving={savingSlip}
            onApplySlipFilter={applySlip}
            appliedValue={slipFilterApplied}
          />
          <SlipLibrary
            items={slipList}
            loading={loadingSlipList}
            onRefresh={fetchSlipList}
            onEditTarget={editSlipTarget}
            onDelete={deleteSlip}
            onApplyFilter={(sn) => { applySlip(sn); setSlip((p) => ({ ...p, slipNumber: sn })); }}
          />
        </div>
      </SlipModal>

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 space-y-2 z-50">
        {log.map((n) => (
          <div key={n.id} className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg backdrop-blur-sm animate-slide-in ${
              n.level === "error" ? "bg-red-500 text-white" :
              n.level === "warning" ? "bg-amber-500 text-white" :
              n.level === "success" ? "bg-green-500 text-white" : "bg-gray-800 text-white"}`}>
            {n.level === "error" ? <AlertCircle size={20} /> : <Bell size={20} />}
            <span className="font-medium">{n.msg}</span>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes slide-in { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .animate-slide-in { animation: slide-in 0.3s ease-out; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
        .animate-pulse { animation: pulse 2s cubic-bezier(0.4,0,0.6,1) infinite; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 10px; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
      `}</style>
    </div>
  );
}
