// ProductionCharts.js
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  LineChart, Line, BarChart, Bar, Area, AreaChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ComposedChart, Cell, LabelList, ReferenceLine,
  Brush, Treemap,
} from "recharts";
import {
  Calendar, Factory, ArrowUpRight, ArrowDownRight,
  Activity, Package, AlertCircle, TrendingUp
} from "lucide-react";
import { format, parseISO, eachDayOfInterval } from "date-fns";
import axios from "../../services/api";
import { motion, AnimatePresence } from "framer-motion";
import Plot3D, { buildHourDowMatrix } from "../../components/Plot3D";

/* ─────────────────── UI constants ─────────────────── */
const TICK_FS = 11;
const LEGEND_FS = 11;
const LABEL_FS = 10;
const CHART_H = 300;
const GRID_COLOR = "#2e3650";
const CARD_SURFACE = "bg-surface-panel border border-stroke rounded-xl";
const CHART_CARD = `${CARD_SURFACE} p-4 md:p-5`;

/* ─────────────────── Animations (subtle) ─────────────────── */
const pageTransition = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2 }
};
const cardTransition = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  transition: { duration: 0.15 }
};

/* ─────────────────── Colors (Teal/Cyan primary) ─────────────────── */
const COLORS = {
  success: "#0d9488",
  danger: "#ef4444",
  warning: "#f59e0b",
  info: "#0891b2",
  pieColors: ["#0d9488", "#0891b2", "#f59e0b", "#64748b", "#ef4444", "#06b6d4"]
};

/* ─────────────────── Timezone helpers ─────────────────── */
const todayInTZ = (tz = "America/Los_Angeles") => {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const y = parts.find(p => p.type === "year")?.value || "1970";
  const m = parts.find(p => p.type === "month")?.value || "01";
  const d = parts.find(p => p.type === "day")?.value || "01";
  return `${y}-${m}-${d}`;
};

/* ─────────────────── NG Reasons utilities ─────────────────── */
// normalizeReason / cleanNgReasons removed — backend is now the single source of truth
const cleanNgReasons = (list = []) => {
  // Backend already returns normalized reasons, just aggregate counts
  const map = new Map();
  for (const item of list) {
    const reason = item?.reason ?? item?.name ?? "";
    const count = Number(item?.count);
    const percent = Number(item?.percent);

    if (!map.has(reason)) map.set(reason, { reason, count: 0, _percentSum: 0, _hasCount: false });
    const agg = map.get(reason);

    if (Number.isFinite(count) && count > 0) {
      agg.count += count;
      agg._hasCount = true;
    } else if (Number.isFinite(percent) && percent > 0) {
      agg._percentSum += percent;
    }
  }
  const result = Array.from(map.values()).map((x) => {
    if (x._hasCount) return { reason: x.reason, value: x.count };
    return { reason: x.reason, value: x._percentSum };
  });
  result.sort((a, b) => b.value - a.value);
  return result;
};
const rescaleTo100 = (arr) => {
  const total = arr.reduce((s, i) => s + (+i.value || 0), 0);
  if (total <= 0) return arr.map(i => ({ ...i, value: 0 }));
  const f = 100 / total;
  return arr.map(i => ({ ...i, value: +(i.value * f).toFixed(1) }));
};
const groupNgReasonsByCategory = (items = []) => {
  const cat = new Map();
  const subs = new Map();
  const add = (category, sublabel, val) => {
    if (!cat.has(category)) cat.set(category, 0);
    cat.set(category, cat.get(category) + val);
    if (!subs.has(category)) subs.set(category, new Map());
    const m = subs.get(category);
    m.set(sublabel, (m.get(sublabel) || 0) + val);
  };

  for (const { reason, value } of items) {
    const v = Number(value) || 0;
    const r = reason.toLowerCase();
    if (r.includes("air leak")) {
      const sub = r.includes("low") ? "Low" : r.includes("high") ? "High" : "General";
      add("Air Leak", sub, v);
      continue;
    }
    if (r.includes("broken") && r.includes("thread")) {
      let sub = "General";
      if (/side.*screw.*top/i.test(reason)) sub = "Side Screw (Top)";
      else if (/on.*screw/i.test(reason)) sub = "On Screw";
      else if (/screw/i.test(reason)) sub = "Screw";
      add("Broken Thread", sub, v);
      continue;
    }
    add(reason, "—", v);
  }

  let categories = Array.from(cat, ([name, value]) => ({ name, value }));
  categories = rescaleTo100(categories);
  categories.sort((a, b) => b.value - a.value);

  const subsByCategory = {};
  for (const [k, v] of subs) {
    const arr = Array.from(v, ([name, value]) => ({ name, value }));
    subsByCategory[k] = rescaleTo100(arr).sort((a, b) => b.value - a.value);
  }
  return { categories, subsByCategory };
};

/* ─────────────────── Helpers ─────────────────── */

// 將 "YYYY-MM-DD" 轉成本地「當天 00:00」的 Date（避免 new Date("YYYY-MM-DD") 的 UTC 陷阱）
const parseYMDLocal = (s) => {
  if (!s || typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2] - 1, d = +m[3];
  return new Date(y, mo, d); // local midnight
};

// 依期間回傳區間（含 targetDate 當天），全部以「本地午夜」計算
const getRangeByPeriod = (period, targetDateStr) => {
  // 如果沒傳 targetDateStr，就用今天的本地午夜
  const today = new Date();
  const fallback = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const td = parseYMDLocal(targetDateStr) || fallback;

  let start, end;
  if (period === "daily") {
    start = td; end = td;
  } else if (period === "weekly") {
    const dow = td.getDay();                        // 0=Sun ... 6=Sat
    const monday = new Date(td);                    // 以周一為週起始
    const diffToMon = (dow + 6) % 7;                // Mon=0, Tue=1, ... Sun=6
    monday.setDate(td.getDate() - diffToMon);
    start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate());
    end   = td;                                     // 週區間結束 = 目標日（含）
  } else {
    start = new Date(td.getFullYear(), td.getMonth(), 1); // 月初（本地）
    end   = td;                                           // 月區間結束 = 目標日（含）
  }

  return {
    startStr: format(start, "yyyy-MM-dd"),
    endStr:   format(end,   "yyyy-MM-dd"),
    targetDateObj: td,
    daysWTD: period === "weekly" ? ((td.getDay() + 6) % 7) + 1 : 1, // 週內已過天數（含當天）
    daysMTD: td.getDate(),                                          // 月內已過天數（含當天）
  };
};

// 由 YYYY-MM-DD(含) 到 YYYY-MM-DD(含) 產出連續日期字串陣列
const listDates = (startStr, endStr) => {
  const start = parseYMDLocal(startStr);
  const end   = parseYMDLocal(endStr);
  if (!start || !end) return [];
  const days = eachDayOfInterval({ start, end });   // inclusive
  return days.map((d) => format(d, "yyyy-MM-dd"));
};

// 取得 Y 軸上限（含 10% padding，至少 10）
const calcYMaxWithPad = (data, keys = []) => {
  let maxVal = 0;
  for (const row of data || []) {
    for (const k of keys) {
      const v = typeof k === "function" ? k(row) : row?.[k];
      const num = Number(v) || 0;
      if (num > maxVal) maxVal = num;
    }
  }
  const padded = Math.ceil(maxVal * 1.1);
  return padded > 0 ? padded : 10;
};

// 只保留「目標日（含）」之前的資料；日期欄位優先順序：fullDate > production_date > date
const cutToTargetInclusive = (rows = [], targetDate) => {
  const T = parseYMDLocal(targetDate);
  if (!T) return rows;
  return (rows || []).filter((r) => {
    const dStr = r.fullDate || r.production_date || r.date;
    if (!dStr) return true;
    // 僅接受 YYYY-MM-DD；其它格式（例如 "MM/dd"）視為前處理後的資料，直接保留
    const m = /^\d{4}-\d{2}-\d{2}$/.exec(String(dStr));
    if (!m) return true;
    const d = parseYMDLocal(m[0]);
    return d && d <= T;  // ✅ 含當天
  });
};

// Tooltip：隱藏用於排版的虛擬欄位
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const HIDE_KEYS = new Set(["anchorMax", "stack_total"]);
  const clean = payload.filter((e) => e && !HIDE_KEYS.has(e.dataKey));
  if (!clean.length) return null;

  return (
    <div className="bg-surface-panel p-3 rounded-lg border border-stroke shadow-lg">
      <p className="text-xs font-semibold text-ink-primary mb-1.5">{label}</p>
      {clean.map((entry, idx) => {
        const { name, value } = entry;
        const swatch = entry.color || entry.fill || entry.payload?.fill;
        return (
          <div key={idx} className="flex items-center gap-2 text-xs text-ink-secondary">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: swatch }} />
            <span className="font-medium">{name}</span>
            <span className="tabular-nums ml-auto font-semibold">{(value ?? 0).toLocaleString()}</span>
          </div>
        );
      })}
    </div>
  );
};

/* ─────────────────── NG Treemap helpers ─────────────────── */
const buildNgTreemapData = (categories) =>
  categories.slice(0, 8).map((cat, idx) => ({
    name: cat.name,
    size: Math.max(Number(cat.value) || 1, 1),
    color: COLORS.pieColors[idx % COLORS.pieColors.length],
  }));

const NgTreemapCell = ({ x, y, width, height, name, size, color }) => {
  const show = width > 38 && height > 18;
  const fs = Math.min(10, Math.max(8, width / 8));
  return (
    <g>
      <rect
        x={x + 1} y={y + 1}
        width={Math.max(width - 2, 0)} height={Math.max(height - 2, 0)}
        fill={color || "#0d9488"} fillOpacity={0.82}
        rx={3} stroke="#111827" strokeWidth={1.5}
      />
      {show && (
        <text x={x + width / 2} y={y + height / 2 + (height > 38 ? -7 : 0)}
              textAnchor="middle" dominantBaseline="middle"
              fill="#fff" fontSize={fs} fontWeight={600}
              style={{ pointerEvents: "none" }}>
          {name?.length > 14 ? `${name.slice(0, 13)}…` : name}
        </text>
      )}
      {show && height > 38 && (
        <text x={x + width / 2} y={y + height / 2 + 8}
              textAnchor="middle" dominantBaseline="middle"
              fill="rgba(255,255,255,0.65)" fontSize={9}
              style={{ pointerEvents: "none" }}>
          {size != null ? `${size}%` : ""}
        </text>
      )}
    </g>
  );
};

const NgTreemapTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="bg-surface-panel p-2.5 rounded-lg border border-stroke shadow-lg text-xs">
      <p className="font-semibold text-ink-primary">{d?.name}</p>
      <p className="text-ink-muted mt-0.5">{d?.size}%</p>
    </div>
  );
};

/* ─────────────────── Component ─────────────────── */
export default function ProductionCharts() {
  const containerRef = useRef(null);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const doc = document;
    const isFS =
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement;

    if (isFS) {
      (doc.exitFullscreen ||
        doc.webkitExitFullscreen ||
        doc.mozCancelFullScreen ||
        doc.msExitFullscreen)?.call(doc);
    } else {
      (el.requestFullscreen ||
        el.webkitRequestFullscreen ||
        el.mozRequestFullScreen ||
        el.msRequestFullscreen)?.call(el);
    }
  }, []);

  const [activeLine, setActiveLine] = useState("module");
  const [period, setPeriod] = useState("daily");
  const [targetDate, setTargetDate] = useState(todayInTZ("America/Los_Angeles"));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [moduleData, setModuleData] = useState(null);
  const [assemblyData, setAssemblyData] = useState(null);
  const [trendData, setTrendData] = useState(null);
  const [comparisonData, setComparisonData] = useState(null);
  const [hourlyData, setHourlyData] = useState(null);
  const [ngTimelineData, setNgTimelineData] = useState(null);
  const [heatmapData, setHeatmapData] = useState(null);
  const [drillDownDate, setDrillDownDate] = useState(null);
  const [drillDownData, setDrillDownData] = useState(null);

  const loadProductionData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { daysWTD, daysMTD, targetDateObj } = getRangeByPeriod(period, targetDate);

      const requests = [
        axios.get("production-charts/module/production", { params: { period, target_date: targetDate } }),
        axios.get("production-charts/assembly/production", { params: { period, target_date: targetDate } }),
        axios.get("production-charts/trend-analysis", { params: { line_type: activeLine, days: 30 } }),
        axios.get("production-charts/hourly-distribution", {
          params: {
            line_type: activeLine,
            period,
            target_date: targetDate,
            days: period === "daily" ? 1 : period === "weekly" ? daysWTD : daysMTD
          }
        })
      ];

      const [module, assembly, trend, hourly] = await Promise.all(requests);
      setModuleData(module.data);
      setAssemblyData(assembly.data);
      setTrendData(trend.data);
      setHourlyData(hourly.data);

      // Load new chart data in parallel (non-blocking)
      Promise.all([
        axios.get("production-charts/ng-timeline", { params: { days: 30 } }),
        axios.get("production-charts/hourly-heatmap", { params: { line_type: activeLine, days: 30 } }),
      ]).then(([ngTl, hm]) => {
        setNgTimelineData(ngTl.data);
        setHeatmapData(hm.data);
      }).catch(e => console.warn("Extra charts load error:", e));

      let comparisonStartDate, comparisonEndDate;
      if (period === "daily") {
        comparisonEndDate = new Date(targetDate);
        comparisonStartDate = new Date(comparisonEndDate);
        comparisonStartDate.setDate(comparisonStartDate.getDate() - 6);
      } else if (period === "weekly") {
        const dow = targetDateObj.getDay();
        const monday = new Date(targetDateObj);
        const diffToMon = (dow + 6) % 7;
        monday.setDate(targetDateObj.getDate() - diffToMon);
        comparisonStartDate = monday;
        comparisonEndDate = targetDateObj;
      } else {
        comparisonStartDate = new Date(targetDateObj.getFullYear(), targetDateObj.getMonth(), 1);
        comparisonEndDate = targetDateObj;
      }

      const comparison = await axios.get("production-charts/comparison", {
        params: {
          start_date: format(comparisonStartDate, "yyyy-MM-dd"),
          end_date: format(comparisonEndDate, "yyyy-MM-dd"),
          period
        }
      });
      setComparisonData(comparison.data);
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to load data");
      console.error("Load data error:", err);
    } finally {
      setLoading(false);
    }
  }, [period, targetDate, activeLine]);

  useEffect(() => { loadProductionData(); }, [loadProductionData]);

  /* build data rows */
  const buildChartData = (data, plan = [], range) => {
    if (!data || !data.production_data) return [];
    const prodMap = Object.fromEntries((data.production_data || []).map(i => [i.production_date, i]));
    const planMap = Object.fromEntries((plan || []).map(i => [i.date, i]));
    const allDates = listDates(range.startStr, range.endStr);
    return allDates.map(d => {
      const p = prodMap[d] || {};
      const q = planMap[d] || {};
      return {
        date: format(parseISO(d), "MM/dd"),
        fullDate: d,
        ...p,
        ...q
      };
    });
  };
  const buildHourlyChartData = (data) => {
    if (!data || !data.production_data) return [];
    return Array.from({ length: 24 }, (_, hour) => {
      const hourStr = hour.toString().padStart(2, "0");
      const existing = data.production_data.find(d => d.hour === hourStr) || {};
      let total = existing.total;
      if (total == null) {
        const sumAB = (existing.count_a || 0) + (existing.count_b || 0);
        const sumOkNg = (existing.ok_count || 0) + (existing.ng_count || 0);
        total = (sumAB || sumOkNg || 0);
      }
      return {
        date: `${hourStr}:00`,
        hour,
        count_a: existing.count_a || 0,
        count_b: existing.count_b || 0,
        ok_count: existing.ok_count || 0,
        ng_count: existing.ng_count || 0,
        total
      };
    });
  };

  /* Mini metric card (for Bento side slots) */
  const MiniMetric = ({ label, value, sub, trend, accent = "teal", children }) => {
    const colors = {
      teal: "text-teal-400",
      cyan: "text-cyan-400",
      red: "text-red-400",
      amber: "text-amber-400",
    };
    return (
      <div className={`${CARD_SURFACE} p-3 flex flex-col justify-between h-full`}>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink-muted">{label}</p>
        <div className="mt-auto">
          {children || (
            <p className={`text-3xl md:text-4xl font-extrabold tabular-nums tracking-tight ${colors[accent] || "text-ink-primary"}`}>
              {typeof value === "number" ? value.toLocaleString() : value}
            </p>
          )}
          {sub && <p className="text-xs text-ink-muted mt-0.5">{sub}</p>}
          {trend != null && (
            <div className={`inline-flex items-center gap-0.5 mt-1 text-xs font-semibold ${trend >= 0 ? "text-teal-400" : "text-red-400"}`}>
              {trend >= 0 ? <ArrowUpRight size={11}/> : <ArrowDownRight size={11}/>}
              <span>{Math.abs(trend)}%</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  /* ─────────────────── Module ─────────────────── */
  
const renderModuleCharts = () => {
  if (!moduleData) return null;
  const range = getRangeByPeriod(period, targetDate);

  const chartBase =
    period === "daily"
      ? buildHourlyChartData(moduleData)
      : buildChartData(moduleData, moduleData.plan_data, range);

  let chartData = period === "daily" ? chartBase : cutToTargetInclusive(chartBase, targetDate);
  let chartDataStacked = chartData;

  if (period !== "daily") {
    chartData = chartData.map((d) => {
      const stack_total = Number(d.count_a ?? 0) + Number(d.count_b ?? 0);
      const planCand = d.plan_total ?? d.plan ?? ((d.plan_a ?? 0) + (d.plan_b ?? 0));
      const planTotal = Number(planCand || 0);
      const achieved = planTotal > 0 ? stack_total >= planTotal : null;
      return { ...d, stack_total, _planTotal: planTotal, _miss: achieved === false };
    });
    chartDataStacked = chartData;
  }

  const { summary, ng_reasons } = moduleData;
  const hasPlanA = chartData.some((d) => d?.plan_a != null);
  const hasPlanB = chartData.some((d) => d?.plan_b != null);

  const yMaxModuleDaily = calcYMaxWithPad(chartData, ["count_a", "count_b", "total"]);
  const yMaxModuleMixed = calcYMaxWithPad(chartDataStacked, [
    (row) => Number(row.stack_total ?? 0),
    (row) => Number(row._planTotal ?? 0),
  ]);

  const cleanedModuleReasons = cleanNgReasons(ng_reasons || []);
  const { categories: moduleNgCategories } = groupNgReasonsByCategory(cleanedModuleReasons);

  const moduleYieldData =
    period === "daily"
      ? []
      : chartData
          .map((d) => {
            const total = Number(d.total ?? d.stack_total ?? 0);
            const ng = Number(d.ng_count ?? d.ng ?? 0);
            if (!total || total <= 0) return null;
            const ok = Math.max(total - ng, 0);
            return { ...d, yield: Math.round((ok / total) * 100) };
          })
          .filter(Boolean);
  const minModuleYield = moduleYieldData.reduce((m, d) => Math.min(m, d.yield ?? m), 100);

  const ModuleAggTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload ?? {};
    const dateLabel = row.fullDate || row.production_date || row.dateLabel || row.date || "";

    const a = Number(row.count_a ?? 0);
    const b = Number(row.count_b ?? 0);
    const total = a + b;
    const plan = Number(row._planTotal ?? row.plan_total ?? 0);
    const ng = Number(row.ng_count ?? row.ng ?? 0);

    return (
      <div className="bg-surface-panel p-3 rounded-lg border border-stroke shadow-lg">
        <p className="text-xs font-semibold text-ink-primary mb-1.5">{dateLabel}</p>
        <div className="space-y-1 text-xs text-ink-secondary">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: "#cbd5e1" }} />
            <span className="font-medium">Plan</span>
            <span className="tabular-nums ml-auto font-semibold">{plan.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: "#0d9488" }} />
            <span className="font-medium">A</span>
            <span className="tabular-nums ml-auto font-semibold">{a.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: "#f97316" }} />
            <span className="font-medium">B</span>
            <span className="tabular-nums ml-auto font-semibold">{b.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: "#0891b2" }} />
            <span className="font-medium">Total</span>
            <span className="tabular-nums ml-auto font-semibold">{total.toLocaleString()}</span>
          </div>
          {ng > 0 && (
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-sm" style={{ background: "#ef4444" }} />
              <span className="font-medium">NG</span>
              <span className="tabular-nums ml-auto font-semibold">{ng.toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const totalA = summary.total_a || 0;
  const totalB = summary.total_b || 0;
  const abTotal = totalA + totalB || 1;
  const ngCount = summary.ng_count ?? chartData.reduce((s, d) => s + (Number(d.ng_count) || 0), 0);

  return (
    <AnimatePresence mode="wait">
      <motion.div key="module" {...pageTransition} className="space-y-3">
        {/* ─── Bento Row 1: Hero + Mini Metrics ─── */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-3">
          {/* Hero: Production Trend */}
          <motion.div {...cardTransition} className="xl:col-span-3">
            <div className={`${CHART_CARD} h-full`}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-ink-primary">Production Trend</h3>
                <span className="text-[11px] font-medium text-ink-muted uppercase tracking-wider">
                  {period === "daily" ? "Hourly" : period}
                </span>
              </div>
              <ResponsiveContainer width="100%" height={CHART_H}>
                {period === "daily" ? (
                  <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
                    <XAxis dataKey="date" stroke="#565e74" tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis stroke="#565e74" tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, () => yMaxModuleDaily]} />
                    <Legend wrapperStyle={{ paddingTop: "4px", color: '#8d93a5' }} iconType="circle" iconSize={8}
                            formatter={(v) => <span style={{ color: "#8d93a5", fontWeight: 500, fontSize: LEGEND_FS }}>{v}</span>} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="count_a" name="Type A" stroke="#0d9488" strokeWidth={2}
                          dot={{ r: 3, fill: "#0d9488", strokeWidth: 0 }}
                          activeDot={{ r: 5, stroke: "#0d9488", strokeWidth: 2, fill: "#fff" }} />
                    <Line type="monotone" dataKey="count_b" name="Type B" stroke="#f97316" strokeWidth={2}
                          dot={{ r: 3, fill: "#f97316", strokeWidth: 0 }}
                          activeDot={{ r: 5, stroke: "#f97316", strokeWidth: 2, fill: "#fff" }} />
                    <Line type="monotone" dataKey="total" name="Total" stroke="#94a3b8" strokeWidth={1.5}
                          strokeDasharray="4 3" dot={false}
                          activeDot={{ r: 4, stroke: "#94a3b8", strokeWidth: 2, fill: "#fff" }} />
                  </LineChart>
                ) : (
                  <BarChart data={chartDataStacked} barGap={4} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
                           onClick={(e) => { if (e?.activePayload?.[0]?.payload?.fullDate) handleDrillDown(e.activePayload[0].payload.fullDate); }}
                           style={{ cursor: "pointer" }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
                    <XAxis dataKey={(d) => d.dateLabel || d.date} stroke="#565e74" tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis stroke="#565e74" tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, () => yMaxModuleMixed]} />
                    <Legend wrapperStyle={{ paddingTop: "4px", color: '#8d93a5' }} iconType="rect" iconSize={10}
                            formatter={(v) => <span style={{ color: "#8d93a5", fontWeight: 500, fontSize: LEGEND_FS }}>{v}</span>} />
                    <Tooltip content={<ModuleAggTooltip />} />

                    {hasPlanA && hasPlanB ? (
                      <>
                        <Bar dataKey="plan_a" name="Plan A" fill="#3d4867" stackId="planned" radius={[0, 0, 0, 0]} />
                        <Bar dataKey="plan_b" name="Plan B" fill="#3d4867" stackId="planned" radius={[4, 4, 0, 0]} />
                      </>
                    ) : (
                      <Bar dataKey={(d) => Number(d._planTotal ?? 0)} name="Plan" fill="#3d4867" radius={[4, 4, 0, 0]} stackId="planned" />
                    )}

                    <Bar dataKey="count_a" name="A" fill="#0d9488" stackId="actual" />
                    <Bar dataKey="count_b" name="B" fill="#f97316" stackId="actual" radius={[4, 4, 0, 0]}>
                      {chartDataStacked.map((row, idx) => (
                        <Cell key={idx} stroke={row._miss ? COLORS.danger : undefined} strokeWidth={row._miss ? 1.5 : 0} />
                      ))}
                    </Bar>

                    <Bar dataKey="stack_total" name="" fill="transparent" isAnimationActive={false} legendType="none">
                      <LabelList dataKey="stack_total" position="top"
                        formatter={(v) => (v ? v.toLocaleString() : "")}
                        style={{ fill: "#c8cedc", fontWeight: 600, fontSize: LABEL_FS }} />
                    </Bar>
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </motion.div>

          {/* Right side: 2x2 Mini Metrics */}
          <div className="xl:col-span-2 grid grid-cols-2 gap-3">
            <MiniMetric label="Total Output" value={summary.total} trend={summary.trend} accent="teal" />
            <MiniMetric label="Yield" accent="cyan">
              <p className="text-2xl font-bold tabular-nums text-cyan-400">{summary.yield_rate || 100}%</p>
              <div className="mt-1.5 h-1.5 bg-surface-raised rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-signal-info" style={{ width: `${summary.yield_rate || 100}%` }} />
              </div>
            </MiniMetric>
            <MiniMetric label="NG Count" value={ngCount} accent="red" sub={ngCount > 0 ? `${((ngCount / (summary.total || 1)) * 100).toFixed(1)}% rate` : "No defects"} />
            <MiniMetric label="A / B Split" accent="teal">
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-bold text-teal-400 tabular-nums">{totalA.toLocaleString()}</span>
                <span className="text-ink-muted">/</span>
                <span className="text-lg font-bold text-orange-500 tabular-nums">{totalB.toLocaleString()}</span>
              </div>
              <div className="mt-1.5 flex h-1.5 rounded-full overflow-hidden bg-surface-raised">
                <div className="h-full bg-teal-500" style={{ width: `${(totalA / abTotal) * 100}%` }} />
                <div className="h-full bg-orange-400" style={{ width: `${(totalB / abTotal) * 100}%` }} />
              </div>
            </MiniMetric>
          </div>
        </div>

        {/* ─── Bento Row 2: NG Analysis + Yield/NG Detail ─── */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {/* NG Reasons — Treemap */}
          {moduleNgCategories.length > 0 && (
            <motion.div {...cardTransition}>
              <div className={`${CHART_CARD} h-full`}>
                <div className="mb-2">
                  <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-ink-primary">NG Reasons</h3>
                  <p className="text-xs text-ink-muted mt-0.5">Normalized percentage share</p>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <Treemap
                    data={buildNgTreemapData(moduleNgCategories)}
                    dataKey="size"
                    aspectRatio={4 / 3}
                    content={<NgTreemapCell />}
                  >
                    <Tooltip content={<NgTreemapTooltip />} />
                  </Treemap>
                </ResponsiveContainer>
              </div>
            </motion.div>
          )}

          {/* Right: Yield Trend (weekly/monthly) or NG Bar (daily) */}
          <motion.div {...cardTransition}>
            <div className={`${CHART_CARD} h-full`}>
              {period !== "daily" && moduleYieldData.length > 0 ? (
                <>
                  <div className="mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-ink-primary">Yield Trend</h3>
                    <p className="text-xs text-ink-muted mt-0.5">Quality over time</p>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={moduleYieldData}>
                      <defs>
                        <linearGradient id="modYieldGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0d9488" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#0d9488" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
                      <XAxis dataKey="date" stroke="#565e74" tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis stroke="#565e74" unit="%" domain={[Math.max(70, minModuleYield - 5), 100]} tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Area type="monotone" dataKey="yield" stroke="#0d9488" strokeWidth={2} fill="url(#modYieldGrad)" name="Yield %"
                            dot={{ r: 3, fill: "#0d9488", strokeWidth: 0 }}
                            activeDot={{ r: 5, stroke: "#0d9488", strokeWidth: 2, fill: "#fff" }} />
                      <Line type="monotone" dataKey={() => 95} name="Target" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="6 4" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </>
              ) : (
                <>
                  <div className="mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-ink-primary">NG Distribution</h3>
                    <p className="text-xs text-ink-muted mt-0.5">NG units by time</p>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={chartDataStacked}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
                      <XAxis dataKey={(d) => d.dateLabel || d.date} stroke="#565e74" tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis stroke="#565e74" tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, (m) => Math.max(10, Math.ceil(m * 1.2))]} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="ng_count" name="NG" fill="#ef4444" radius={[4, 4, 0, 0]}>
                        <LabelList dataKey="ng_count" position="top" style={{ fill: "#ef4444", fontWeight: 600, fontSize: LABEL_FS }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </>
              )}
            </div>
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

/* ─────────────────── Assembly ─────────────────── */
  
const renderAssemblyCharts = () => {
  if (!assemblyData) return null;

  const range = getRangeByPeriod(period, targetDate);
  const base =
    period === "daily"
      ? buildHourlyChartData(assemblyData)
      : buildChartData(assemblyData, assemblyData.plan_data, range);

  const sliced = period === "daily" ? base : cutToTargetInclusive(base, targetDate);

  const chartData =
    period === "daily"
      ? sliced
      : sliced.map((d) => {
          const actual =
            d.total != null
              ? Number(d.total)
              : Number(d.ok_count ?? 0) + Number(d.ng_count ?? 0);
          const planned =
            d.plan_total != null ? Number(d.plan_total) : Number(d.plan ?? 0);
          const miss = planned > 0 && actual < planned;
          return {
            ...d,
            actual,
            planned,
            anchorMax: Math.max(actual || 0, planned || 0),
            _miss: miss,
          };
        });

  const { summary, ng_reasons } = assemblyData;
  const yMaxAssyDaily = calcYMaxWithPad(chartData, ["ok_count", "ng_count", "total"]);
  const yMaxAssyMixed = calcYMaxWithPad(chartData, ["actual", "planned"]);

  const cleanedNgReasons = cleanNgReasons(ng_reasons || []);
  const { categories: ngCategories } = groupNgReasonsByCategory(cleanedNgReasons);

  const assyYieldData = period === "daily" ? [] :
    chartData.filter((d) => d.total && d.total > 0)
      .map((d) => ({ ...d, yield: Math.round((d.ok_count / d.total) * 100) }));

  return (
    <AnimatePresence mode="wait">
      <motion.div key="assembly" {...pageTransition} className="space-y-3">
        {/* ─── Bento Row 1: Hero + Mini Metrics ─── */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-3">
          {/* Hero: Production Trend */}
          <motion.div {...cardTransition} className="xl:col-span-3">
            <div className={`${CHART_CARD} h-full`}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-ink-primary">Production Trend</h3>
                <span className="text-[11px] font-medium text-ink-muted uppercase tracking-wider">
                  {period === "daily" ? "Hourly" : period}
                </span>
              </div>
              <ResponsiveContainer width="100%" height={CHART_H}>
                {period === "daily" ? (
                  <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
                    <XAxis dataKey="date" stroke="#565e74" tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis stroke="#565e74" tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, () => yMaxAssyDaily]} />
                    <Legend wrapperStyle={{ paddingTop: "4px", color: '#8d93a5' }} iconType="circle" iconSize={8}
                            formatter={(v) => <span style={{ color: "#8d93a5", fontWeight: 500, fontSize: LEGEND_FS }}>{v}</span>} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="ok_count" name="OK" stroke="#0d9488" strokeWidth={2}
                          dot={{ r: 3, fill: "#0d9488", strokeWidth: 0 }}
                          activeDot={{ r: 5, stroke: "#0d9488", strokeWidth: 2, fill: "#fff" }} />
                    <Line type="monotone" dataKey="ng_count" name="NG" stroke="#ef4444" strokeWidth={2}
                          dot={{ r: 3, fill: "#ef4444", strokeWidth: 0 }}
                          activeDot={{ r: 5, stroke: "#ef4444", strokeWidth: 2, fill: "#fff" }} />
                    <Line type="monotone" dataKey="total" name="Total" stroke="#94a3b8" strokeWidth={1.5}
                          strokeDasharray="4 3" dot={false}
                          activeDot={{ r: 4, stroke: "#94a3b8", strokeWidth: 2, fill: "#fff" }} />
                  </LineChart>
                ) : (
                  <BarChart data={chartData} barGap={4} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
                           onClick={(e) => { if (e?.activePayload?.[0]?.payload?.fullDate) handleDrillDown(e.activePayload[0].payload.fullDate); }}
                           style={{ cursor: "pointer" }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
                    <XAxis dataKey="date" stroke="#565e74" tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis stroke="#565e74" tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, () => yMaxAssyMixed]} />
                    <Legend wrapperStyle={{ paddingTop: "4px", color: '#8d93a5' }} iconType="rect" iconSize={10}
                            formatter={(v) => <span style={{ color: "#8d93a5", fontWeight: 500, fontSize: LEGEND_FS }}>{v}</span>} />
                    <Tooltip content={<CustomTooltip />} />

                    <Bar dataKey="planned" name="Planned" fill="#3d4867" radius={[4, 4, 0, 0]}>
                      <LabelList dataKey="planned" position="top"
                                formatter={(v) => (v ? v.toLocaleString() : "")}
                                style={{ fill: "#8d93a5", fontWeight: 600, fontSize: LABEL_FS }} />
                    </Bar>

                    <Bar dataKey="actual" name="Actual" fill="#0891b2" radius={[4, 4, 0, 0]}>
                      {chartData.map((row, idx) => (
                        <Cell key={idx} stroke={row._miss ? COLORS.danger : undefined} strokeWidth={row._miss ? 1.5 : 0} />
                      ))}
                      <LabelList dataKey="actual" position="top"
                                formatter={(v) => (v ? v.toLocaleString() : "")}
                                style={{ fill: "#c8cedc", fontWeight: 600, fontSize: LABEL_FS }} />
                    </Bar>

                    <Bar dataKey="anchorMax" name="" fill="transparent" legendType="none" isAnimationActive={false}>
                      <LabelList position="top" content={(props) => {
                        const { x = 0, y = 0, width = 0, payload } = props || {};
                        const ng = Number(payload?.ng_count ?? payload?.ng ?? 0);
                        if (!Number.isFinite(ng) || ng <= 0) return null;
                        return (
                          <text x={x + width / 2} y={(Number.isFinite(y) ? y : 0) - 18}
                                textAnchor="middle" style={{ fill: "#ef4444", fontWeight: 700, fontSize: LABEL_FS }}>
                            {ng.toLocaleString()}
                          </text>
                        );
                      }} />
                    </Bar>
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </motion.div>

          {/* Right side: 2x2 Mini Metrics */}
          <div className="xl:col-span-2 grid grid-cols-2 gap-3">
            <MiniMetric label="Total Output" value={summary.total} trend={summary.trend} accent="teal" />
            <MiniMetric label="Yield" accent="cyan">
              <p className="text-2xl font-bold tabular-nums text-cyan-400">{summary.yield_rate}%</p>
              <div className="mt-1.5 h-1.5 bg-surface-raised rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-signal-info" style={{ width: `${summary.yield_rate}%` }} />
              </div>
            </MiniMetric>
            <MiniMetric label="NG Units" accent="red">
              <p className="text-2xl font-bold tabular-nums text-red-400">{summary.ng_count}</p>
              {summary.fixed_count > 0 && (
                <p className="text-xs text-emerald-400 font-medium mt-0.5">{summary.fixed_count} Fixed</p>
              )}
            </MiniMetric>
            <MiniMetric label="OK Units" value={summary.ok_count} accent="teal" sub={`${((summary.ok_count / (summary.total || 1)) * 100).toFixed(1)}% pass`} />
          </div>
        </div>

        {/* ─── Bento Row 2: NG Analysis + Yield/NG Detail ─── */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {/* NG Reasons — Treemap */}
          {ngCategories.length > 0 && (
            <motion.div {...cardTransition}>
              <div className={`${CHART_CARD} h-full`}>
                <div className="mb-2">
                  <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-ink-primary">NG Reasons</h3>
                  <p className="text-xs text-ink-muted mt-0.5">Normalized percentage share</p>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <Treemap
                    data={buildNgTreemapData(ngCategories)}
                    dataKey="size"
                    aspectRatio={4 / 3}
                    content={<NgTreemapCell />}
                  >
                    <Tooltip content={<NgTreemapTooltip />} />
                  </Treemap>
                </ResponsiveContainer>
              </div>
            </motion.div>
          )}

          {/* Right: Yield Trend (weekly/monthly) or NG Bar (daily) */}
          <motion.div {...cardTransition}>
            <div className={`${CHART_CARD} h-full`}>
              {period !== "daily" && assyYieldData.length > 0 ? (
                <>
                  <div className="mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-ink-primary">Yield Trend</h3>
                    <p className="text-xs text-ink-muted mt-0.5">Quality over time</p>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={assyYieldData}>
                      <defs>
                        <linearGradient id="assyYieldGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0d9488" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#0d9488" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
                      <XAxis dataKey="date" stroke="#565e74" tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis stroke="#565e74" unit="%" domain={[80, 100]} tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Area type="monotone" dataKey="yield" stroke="#0d9488" strokeWidth={2} fill="url(#assyYieldGrad)" name="Yield %"
                            dot={{ r: 3, fill: "#0d9488", strokeWidth: 0 }}
                            activeDot={{ r: 5, stroke: "#0d9488", strokeWidth: 2, fill: "#fff" }} />
                      <Line type="monotone" dataKey={() => 95} name="Target" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="6 4" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </>
              ) : (
                <>
                  <div className="mb-2">
                    <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-ink-primary">NG Distribution</h3>
                    <p className="text-xs text-ink-muted mt-0.5">NG units by time</p>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
                      <XAxis dataKey="date" stroke="#565e74" tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis stroke="#565e74" tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, (m) => Math.max(10, Math.ceil(m * 1.2))]} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="ng_count" name="NG" fill="#ef4444" radius={[4, 4, 0, 0]}>
                        <LabelList dataKey="ng_count" position="top" style={{ fill: "#ef4444", fontWeight: 600, fontSize: LABEL_FS }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </>
              )}
            </div>
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

const renderTrendAnalysis = () => {
    if (!trendData) return null;
    const { trend_data, prediction } = trendData;

    // 只取到目標日（含）
    const filtered = (trend_data || [])
      .filter(i => parseISO(i.production_date) <= parseISO(targetDate))
      .map(i => ({
        date: format(parseISO(i.production_date), "MM/dd"),
        production_date: i.production_date,
        ...i
      }));

    // Append prediction data
    const predictionEntries = (prediction || []).map(p => ({
      date: format(parseISO(p.date), "MM/dd"),
      production_date: p.date,
      predicted_total: p.predicted_total,
      total: null,
    }));
    const chartDataWithPrediction = [...filtered, ...predictionEntries];

    return (
      <motion.div {...cardTransition} className={CHART_CARD}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-ink-primary">Production Trend (Last 30 Days)</h3>
            <p className="text-[11px] text-ink-muted mt-0.5">Long-term performance + 5-day forecast</p>
          </div>
          {prediction?.length > 0 && (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-signal-info/10 border border-cyan-500/30 rounded-lg">
              <TrendingUp size={12} className="text-cyan-400" />
              <span className="text-[11px] font-medium text-cyan-400">Forecast: {prediction[prediction.length - 1]?.predicted_total}</span>
            </div>
          )}
        </div>

        <ResponsiveContainer width="100%" height={CHART_H + 40}>
          <ComposedChart data={chartDataWithPrediction} margin={{ top: 4, right: 16, left: 0, bottom: 20 }}>
            <defs>
              <linearGradient id="trendAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0891b2" stopOpacity={0.12}/>
                <stop offset="95%" stopColor="#0891b2" stopOpacity={0.02}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false}/>
            <XAxis dataKey="date" stroke="#565e74" tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis stroke="#565e74" tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => v.toLocaleString()} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ paddingTop: "4px", color: '#8d93a5' }} iconType="line" iconSize={14}
                    formatter={(v) => <span style={{ color: "#8d93a5", fontWeight: 500, fontSize: LEGEND_FS }}>{v}</span>} />

            <Area type="monotone" dataKey="total" name="Daily Output" stroke="#0891b2" fill="url(#trendAreaGrad)" strokeWidth={2} dot={false} connectNulls={false} />
            {filtered.some(d => d.moving_avg) && <Line type="monotone" dataKey="moving_avg" name="7-Day Average" stroke="#f59e0b" strokeWidth={2} dot={false} opacity={0.9} />}
            {predictionEntries.length > 0 && <Line type="monotone" dataKey="predicted_total" name="Prediction" stroke={COLORS.info} strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls />}
            <Brush dataKey="date" height={26} stroke={COLORS.success}
                   startIndex={Math.max(0, chartDataWithPrediction.length - 14)} />
          </ComposedChart>
        </ResponsiveContainer>
      </motion.div>
    );
  };


  /* ─────────────────── Hourly Distribution ─────────────────── */
  const renderHourlyDistribution = () => {
    if (!hourlyData) return null;
    const { distribution_data, summary } = hourlyData;
    const maxValue = distribution_data.length > 0 ? Math.max(...distribution_data.map(d => d.average || 0)) : 0;
    const avgValue = distribution_data.reduce((sum, d) => sum + (d.average || 0), 0) / (distribution_data.length || 1);

    return (
      <motion.div {...cardTransition} className={CHART_CARD}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-ink-primary">Hourly Production Pattern</h3>
            <p className="text-[11px] text-ink-muted mt-0.5">24-hour distribution</p>
          </div>
          {summary && (
            <div className="flex items-center gap-3">
              <div className="px-3 py-1.5 bg-surface-base border border-stroke rounded-lg">
                <span className="text-xs text-ink-muted block">Peak</span>
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-ink-primary">{summary.peak_hour}</span>
              </div>
              <div className="px-3 py-1.5 bg-surface-base border border-stroke rounded-lg">
                <span className="text-xs text-ink-muted block">Total</span>
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-ink-primary">{summary.total_production?.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>

        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={distribution_data} margin={{ top: 4, right: 16, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
            <XAxis dataKey="hour" stroke="#565e74" tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false}
                   label={{ value: "Hour", position: "insideBottom", offset: -25, style: { fill: "#94a3b8", fontSize: 11, fontWeight: 500 } }} />
            <YAxis stroke="#565e74" tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false}
                   tickFormatter={(v) => v.toLocaleString()} />
            <Tooltip content={<CustomTooltip />} />

            <ReferenceLine y={avgValue} stroke="#f59e0b" strokeDasharray="6 4" strokeWidth={1.5}
              label={{ value: `Avg: ${Math.round(avgValue).toLocaleString()}`, position: "right", style: { fill: "#f59e0b", fontWeight: 600, fontSize: LABEL_FS } }} />

            <Bar dataKey="average" name="Avg Output" radius={[4, 4, 0, 0]}>
              {distribution_data.map((entry, idx) => {
                const isMax = entry.average === maxValue;
                const isLow = entry.average < avgValue * 0.5;
                return (
                  <Cell key={idx} fill={isMax ? "#22d3ee" : isLow ? "#2e3650" : entry.average > 0 ? "#0d9488" : "#1e2437"} />
                );
              })}
              <LabelList dataKey="average" position="top"
                         formatter={(v) => (v >= avgValue ? v.toLocaleString() : "")}
                         style={{ fill: "#c8cedc", fontSize: LABEL_FS, fontWeight: 600 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </motion.div>
    );
  };

  /* ─────────────────── Module vs Assembly Comparison ─────────────────── */
  const renderComparisonAnalysis = () => {
    if (!comparisonData) return null;
    const { comparison_data, statistics: stats } = comparisonData;
    const data = comparison_data.map(i => ({ date: format(parseISO(i.date), "MM/dd"), ...i }));

    const maxEfficiency = data.length > 0 ? Math.max(...data.map(d => d.efficiency || 0)) : 0;
    const minEfficiency = data.length > 0 ? Math.min(...data.map(d => d.efficiency || 0)) : 0;
    const targetLabel = format(parseISO(targetDate), "MM/dd");

    // P2-3: Semantic correlation indicator
    const corr = stats.correlation;
    const corrColor = corr > 0.7 ? "text-emerald-400" : corr > 0.3 ? "text-amber-400" : "text-red-400";
    const corrLabel = corr > 0.7 ? "Strong" : corr > 0.3 ? "Moderate" : "Weak";
    const corrBg = corr > 0.7 ? "bg-signal-ok/10 border-emerald-500/30" : corr > 0.3 ? "bg-signal-warn/10 border-amber-500/30" : "bg-signal-error/10 border-red-500/30";

    return (
      <div className="space-y-3">
        <motion.div {...cardTransition} className={CHART_CARD}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-ink-primary">Module vs Assembly</h3>
              <p className="text-[11px] text-ink-muted mt-0.5">Line synchronization</p>
            </div>
            <div className="flex items-center gap-3">
              {/* Semantic correlation badge */}
              <div className={`px-3 py-1.5 border rounded-lg ${corrBg}`}>
                <span className="text-xs text-ink-muted block">Correlation</span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-sm font-bold tabular-nums ${corrColor}`}>{corr.toFixed(3)}</span>
                  <span className={`text-[10px] font-semibold uppercase tracking-wide ${corrColor}`}>{corrLabel}</span>
                </div>
              </div>
              <div className="px-3 py-1.5 bg-surface-base border border-stroke rounded-lg">
                <span className="text-xs text-ink-muted block">Avg Efficiency</span>
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-ink-primary">{stats.avg_efficiency}%</span>
              </div>
            </div>
          </div>

          <ResponsiveContainer width="100%" height={CHART_H - 40}>
            <ComposedChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false}/>
              <XAxis dataKey="date" stroke="#565e74" tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" stroke="#565e74" tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false}
                     tickFormatter={(v) => v.toLocaleString()} />
              <YAxis yAxisId="right" orientation="right" stroke="#565e74" tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false}
                     domain={[Math.min(80, minEfficiency - 5), Math.max(100, maxEfficiency + 5)]} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ paddingTop: "4px", color: '#8d93a5' }} iconType="rect" iconSize={10}
                      formatter={(v) => <span style={{ color: "#8d93a5", fontWeight: 500, fontSize: LEGEND_FS }}>{v}</span>} />

              <ReferenceLine x={targetLabel} stroke="#64748b" strokeDasharray="4 4"
                label={{ value: "Today", position: "top", style: { fill: "#8d93a5", fontWeight: 500, fontSize: LABEL_FS } }} />
              <ReferenceLine yAxisId="right" y={95} stroke="#ef4444" strokeDasharray="6 4" strokeWidth={1.5}
                label={{ value: "95%", position: "right", style: { fill: "#ef4444", fontWeight: 500, fontSize: LABEL_FS } }} />

              <Bar yAxisId="left" dataKey="module" name="Module" fill="#0891b2" radius={[4, 4, 0, 0]} barSize={28} />
              <Bar yAxisId="left" dataKey="assembly" name="Assembly" fill="#f59e0b" radius={[4, 4, 0, 0]} barSize={28} />
              <Line yAxisId="right" type="monotone" dataKey="efficiency" name="Efficiency %" stroke="#0d9488" strokeWidth={2}
                    dot={{ r: 3, fill: "#0d9488", strokeWidth: 0 }}
                    activeDot={{ r: 5, stroke: "#0d9488", strokeWidth: 2, fill: "#fff" }} />
            </ComposedChart>
          </ResponsiveContainer>
        </motion.div>

      </div>
    );
  };

  /* ─────────────────── NG Timeline Stacked Area ─────────────────── */
  const renderNgTimeline = () => {
    if (!ngTimelineData || !ngTimelineData.top_reasons?.length) return null;
    const { timeline_data, top_reasons } = ngTimelineData;
    const chartData = timeline_data.map(d => ({
      ...d,
      date: format(parseISO(d.date), "MM/dd"),
    }));

    return (
      <motion.div {...cardTransition} className={CHART_CARD}>
        <div className="mb-2">
          <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-ink-primary">NG Reason Timeline (30 Days)</h3>
          <p className="text-xs text-ink-muted mt-0.5">Top 5 reasons over time — stacked area</p>
        </div>
        <ResponsiveContainer width="100%" height={340}>
          <AreaChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
            <XAxis dataKey="date" stroke="#565e74" tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis stroke="#565e74" tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ paddingTop: "4px", color: '#8d93a5' }} iconType="rect" iconSize={10}
                    formatter={(v) => <span style={{ color: "#8d93a5", fontWeight: 500, fontSize: LEGEND_FS }}>{v}</span>} />
            {top_reasons.map((reason, idx) => (
              <Area key={reason} type="monotone" dataKey={reason} name={reason}
                    stackId="ng" fill={COLORS.pieColors[idx % COLORS.pieColors.length]}
                    stroke={COLORS.pieColors[idx % COLORS.pieColors.length]}
                    fillOpacity={0.6} strokeWidth={1.5} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </motion.div>
    );
  };

  /* ─────────────────── Hourly Heatmap (7x24) ─────────────────── */
  const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const renderHeatmap = () => {
    if (!heatmapData || !heatmapData.heatmap_data?.length) return null;
    const { heatmap_data, max_count } = heatmapData;

    // Build lookup: weekday -> hour -> data
    const lookup = {};
    for (const d of heatmap_data) {
      const key = `${d.weekday}:${d.hour}`;
      lookup[key] = d;
    }

    const intensityColor = (intensity) => {
      if (intensity <= 0) return "bg-surface-base";
      if (intensity < 0.2) return "bg-teal-500/10";
      if (intensity < 0.4) return "bg-teal-500/20";
      if (intensity < 0.6) return "bg-teal-500/40";
      if (intensity < 0.8) return "bg-teal-500/65";
      return "bg-teal-500";
    };
    const intensityText = (intensity) => {
      if (intensity >= 0.6) return "text-white";
      return "text-ink-secondary";
    };

    return (
      <motion.div {...cardTransition} className={CHART_CARD}>
        <div className="mb-2">
          <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-ink-primary">Production Heatmap</h3>
          <p className="text-xs text-ink-muted mt-0.5">Hour x Weekday — {heatmapData.line_type} (last {heatmapData.days} days)</p>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[700px]">
            {/* Hour header */}
            <div className="grid gap-[2px]" style={{ gridTemplateColumns: "56px repeat(24, 1fr)" }}>
              <div />
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="text-center text-[10px] font-medium text-ink-muted py-1">
                  {h.toString().padStart(2, "0")}
                </div>
              ))}
            </div>
            {/* Rows */}
            {[1, 2, 3, 4, 5, 6, 0].map(wd => (
              <div key={wd} className="grid gap-[2px]" style={{ gridTemplateColumns: "56px repeat(24, 1fr)" }}>
                <div className="flex items-center text-[11px] font-medium text-ink-muted pr-2 justify-end">
                  {WEEKDAY_LABELS[wd]}
                </div>
                {Array.from({ length: 24 }, (_, h) => {
                  const hr = h.toString().padStart(2, "0");
                  const cell = lookup[`${wd}:${hr}`] || { count: 0, intensity: 0 };
                  return (
                    <div key={h}
                         className={`aspect-square rounded-sm flex items-center justify-center ${intensityColor(cell.intensity)} ${intensityText(cell.intensity)} transition-colors duration-150 cursor-default group relative`}
                         title={`${WEEKDAY_LABELS[wd]} ${hr}:00 — ${cell.count} units`}>
                      <span className="text-[9px] font-medium tabular-nums opacity-70 group-hover:opacity-100">
                        {cell.count > 0 ? cell.count : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
            {/* Legend */}
            <div className="flex items-center gap-2 mt-3 justify-end">
              <span className="text-[10px] text-ink-muted">Less</span>
              {["bg-surface-base", "bg-teal-500/10", "bg-teal-500/20", "bg-teal-500/40", "bg-teal-500/65", "bg-teal-500"].map((c, i) => (
                <div key={i} className={`w-3 h-3 rounded-sm ${c}`} />
              ))}
              <span className="text-[10px] text-ink-muted">More</span>
              {max_count > 0 && <span className="text-[10px] text-ink-muted ml-1">(max: {max_count})</span>}
            </div>
          </div>
        </div>
      </motion.div>
    );
  };

  /* ─────────────────── Drill-down: Click bar → hourly detail ─────────────────── */
  const handleDrillDown = async (dateStr) => {
    if (drillDownDate === dateStr) {
      setDrillDownDate(null);
      setDrillDownData(null);
      return;
    }
    setDrillDownDate(dateStr);
    try {
      const res = await axios.get("production-charts/hourly-distribution", {
        params: { line_type: activeLine, period: "daily", target_date: dateStr, days: 1 }
      });
      setDrillDownData(res.data);
    } catch (e) {
      console.warn("Drill-down load error:", e);
      setDrillDownData(null);
    }
  };

  const renderDrillDown = () => {
    if (!drillDownDate || !drillDownData) return null;
    const { distribution_data } = drillDownData;
    const activeHours = distribution_data.filter(d => d.total > 0);
    if (!activeHours.length) return null;

    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className={CHART_CARD}
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-ink-primary">
                Hourly Detail — {drillDownDate}
              </h3>
              <p className="text-xs text-ink-muted mt-0.5">Click the same date bar again to close</p>
            </div>
            <button onClick={() => { setDrillDownDate(null); setDrillDownData(null); }}
                    className="text-xs text-ink-muted hover:text-ink-secondary px-2 py-1 rounded-md hover:bg-surface-raised transition-colors">
              Close
            </button>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={distribution_data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
              <XAxis dataKey="hour" stroke="#565e74" tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis stroke="#565e74" tick={{ fill: '#8d93a5', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="total" name="Output" fill={COLORS.info} radius={[4, 4, 0, 0]}>
                <LabelList dataKey="total" position="top"
                           formatter={(v) => (v > 0 ? v.toLocaleString() : "")}
                           style={{ fill: "#c8cedc", fontSize: LABEL_FS, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      </AnimatePresence>
    );
  };

  /* ─────────────────── Render ─────────────────── */
  return (
    <div
      ref={containerRef}
      onDoubleClick={toggleFullscreen}
      className="min-h-screen bg-surface-base"
      style={{ overflowY: "auto", fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}
    >
      {/* ─── Splunk Page Header ─── */}
      <div className="bg-surface-panel border-b border-stroke px-5 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 flex-shrink-0">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-teal-400 mb-0.5">Analytics</p>
          <h1 className="text-ink-primary font-semibold text-xl leading-tight">Production Charts</h1>
          <p className="text-ink-muted text-xs mt-0.5">Module &amp; Assembly line performance · double-click to fullscreen</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {loading ? (
            <span className="flex items-center gap-1.5 text-xs text-ink-muted">
              <div className="w-2.5 h-2.5 border-2 border-stroke border-t-teal-500 rounded-full animate-spin" />
              Loading...
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-signal-ok/10 border border-emerald-500/30 text-xs font-semibold text-emerald-400">
              <Activity size={11} />
              Live
            </span>
          )}
        </div>
      </div>

      <div className="p-3 md:p-4">

      {/* Controls Bar */}
      <div className={`${CARD_SURFACE} p-2.5 mb-3`}>
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          {/* Line Selector */}
          <div className="flex items-center gap-1 p-1 bg-surface-raised rounded-lg">
            {[
              { key: "module", label: "Module", icon: Factory },
              { key: "assembly", label: "Assembly", icon: Package },
            ].map((item) => {
              const active = activeLine === item.key;
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  onClick={() => setActiveLine(item.key)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-150 ${active ? "bg-surface-overlay text-signal-info shadow-sm border border-stroke-strong" : "text-ink-muted hover:text-ink-primary hover:bg-surface-raised"}`}
                >
                  <Icon size={14} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Period Selector */}
          <div className="flex items-center gap-1 p-1 bg-surface-raised rounded-lg">
            {["daily", "weekly", "monthly"].map((p) => (
              <button key={p}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors duration-150 ${period === p ? "bg-surface-overlay text-signal-info shadow-sm border border-stroke-strong" : "text-ink-muted hover:text-ink-primary hover:bg-surface-raised"}`}
                onClick={() => setPeriod(p)}>
                {p === "daily" ? "Daily" : p === "weekly" ? "Weekly" : "Monthly"}
              </button>
            ))}
          </div>

          {/* Date Picker */}
          <div className="flex items-center gap-2 ml-auto">
            <Calendar size={14} className="text-ink-muted" />
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)}
              className="px-3 py-2 bg-surface-raised border border-stroke rounded-lg text-sm text-ink-primary font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors"
              max={todayInTZ("America/Los_Angeles")}
            />
          </div>

          {/* Status */}
          <div className="flex items-center gap-2 text-xs text-ink-muted">
            {loading ? (
              <>
                <div className="w-3 h-3 border-2 border-stroke border-t-teal-600 rounded-full animate-spin" />
                <span>Loading...</span>
              </>
            ) : (
              <>
                <Activity size={12} />
                <span>Live</span>
              </>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-signal-error/10 border border-red-500/30 rounded-xl p-3 mb-3 flex items-center gap-3">
          <AlertCircle className="text-red-500" size={18} />
          <p className="text-sm text-red-400 font-medium">{error}</p>
        </div>
      )}

      {/* Content */}
      {!loading && !error && (
        <div className="space-y-3">
          {activeLine === "module" ? renderModuleCharts() : renderAssemblyCharts()}
          {/* Drill-down detail (appears when user clicks a date bar) */}
          {renderDrillDown()}
          {/* ─── Trend Analysis section ─── */}
          <div className="flex items-center gap-3 mb-1"><span className="text-[10px] uppercase tracking-[0.24em] font-semibold text-ink-muted">Trend Analysis</span><div className="flex-1 h-px bg-stroke" /></div>
          {/* ─── Bento Row 3: Trend + Hourly side by side ─── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {renderTrendAnalysis()}
            {renderHourlyDistribution()}
          </div>
          {/* ─── Pattern Analysis section ─── */}
          <div className="flex items-center gap-3 mb-1"><span className="text-[10px] uppercase tracking-[0.24em] font-semibold text-ink-muted">Pattern Analysis</span><div className="flex-1 h-px bg-stroke" /></div>
          {/* ─── Bento Row 4: Heatmap + NG Timeline ─── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {renderHeatmap()}
            {renderNgTimeline()}
          </div>
          {/* ─── Line Comparison section ─── */}
          <div className="flex items-center gap-3 mb-1"><span className="text-[10px] uppercase tracking-[0.24em] font-semibold text-ink-muted">Line Comparison</span><div className="flex-1 h-px bg-stroke" /></div>
          {/* ─── Bento Row 5: Comparison full width ─── */}
          {renderComparisonAnalysis()}
          {/* ─── 3D Pattern section ─── */}
          <div className="flex items-center gap-3 mb-1"><span className="text-[10px] uppercase tracking-[0.24em] font-semibold text-ink-muted">3D Pattern</span><div className="flex-1 h-px bg-stroke" /></div>
          {/* ─── Bento Row 6: 3D Assembly Pattern ─── */}
          <Uph3DCard />
        </div>
      )}

      </div> {/* closes padding wrapper p-4 md:p-5 */}
    </div>
  );
}

/* ──────────────── 3D Assembly UPH Pattern Card ──────────────── */
function Uph3DCard() {
  const [data3d, setData3d] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get("assembly-inventory/uph-3d", { params: { days: 30 } })
      .then((r) => setData3d(r.data?.data || []))
      .catch(() => setData3d([]))
      .finally(() => setLoading(false));
  }, []);

  const DOW_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

  const renderChart = () => {
    if (!data3d || data3d.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center text-ink-muted" style={{ height: 460 }}>
          <Activity size={36} className="mb-3 opacity-40" />
          <p className="font-semibold text-sm">No scan data in the past 30 days</p>
        </div>
      );
    }
    const { z, x, y } = buildHourDowMatrix(data3d, "scan_count");
    return (
      <Plot3D
        title=""
        xTitle="Hour of Day"
        yTitle="Day of Week"
        zTitle="Scan Count"
        height={460}
        data={[{
          type: "surface",
          z, x, y,
          colorscale: [
            [0,   "#f0fdf4"],
            [0.25, "#6ee7b7"],
            [0.5, "#0d9488"],
            [0.75, "#0891b2"],
            [1,   "#1e40af"],
          ],
          contours: {
            z: { show: true, usecolormap: true, highlightcolor: "#0d9488", project: { z: true } }
          },
          hovertemplate: "<b>%{y}</b><br>Hour: %{x}<br>Scans: <b>%{z}</b><extra></extra>",
        }]}
        layout={{
          scene: {
            camera: { eye: { x: 1.5, y: 1.5, z: 1.2 } },
            yaxis: {
              backgroundcolor: "#1e2437", gridcolor: "#2e3650", title: "Day of Week",
              tickfont: { color: "#8d93a5" }, titlefont: { color: "#8d93a5" },
              tickmode: "array", tickvals: [0,1,2,3,4,5,6], ticktext: DOW_FULL,
            },
            xaxis: { backgroundcolor: "#1e2437", gridcolor: "#2e3650", title: "Hour of Day", tickfont: { color: "#8d93a5" }, titlefont: { color: "#8d93a5" } },
            zaxis: { backgroundcolor: "#1e2437", gridcolor: "#2e3650", title: "Scan Count", tickfont: { color: "#8d93a5" }, titlefont: { color: "#8d93a5" } },
          },
          margin: { l: 0, r: 0, t: 10, b: 0 },
          paper_bgcolor: "#1e2437",
          font: { color: "#c8cedc" },
        }}
      />
    );
  };

  return (
    <div className={`${CARD_SURFACE} p-4 md:p-5`}>
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 bg-teal-500/10 rounded-lg">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0d9488" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          </svg>
        </div>
        <div>
          <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-ink-primary">3D Production Pattern</h3>
          <p className="text-xs text-ink-muted">Assembly scans: Hour × Day-of-Week — past 30 days · drag to rotate</p>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center justify-center bg-surface-base rounded-lg border border-stroke animate-pulse" style={{ height: 460 }}>
          <p className="text-sm text-ink-muted">Building 3D surface…</p>
        </div>
      ) : renderChart()}
    </div>
  );
}
