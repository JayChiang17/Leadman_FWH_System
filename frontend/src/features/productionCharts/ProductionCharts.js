// ProductionCharts.js
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  LineChart, Line, BarChart, Bar, Area, AreaChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ComposedChart, PieChart, Pie, Cell, LabelList, ReferenceLine
} from "recharts";
import {
  Calendar, TrendingUp, BarChart3, Factory,
  ArrowUpRight, ArrowDownRight, Target, Activity,
  Package, AlertCircle, Info
} from "lucide-react";
import { format, parseISO, eachDayOfInterval } from "date-fns";
import axios from "../../services/api";
import { motion, AnimatePresence } from "framer-motion";

/* ─────────────────── UI constants ─────────────────── */
const TICK_FS = 13;
const LEGEND_FS = 14;
const LABEL_FS = 12;
const CHART_H = 420;
const GRID_COLOR = "#e2e8f0";
const CARD_SURFACE = "bg-white border border-slate-200 rounded-xl shadow-sm";
const CHART_CARD = `${CARD_SURFACE} p-6 md:p-8`;

/* ─────────────────── Animations ─────────────────── */
const pageTransition = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
  transition: { duration: 0.3 }
};
const cardTransition = {
  initial: { scale: 0.98, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  transition: { duration: 0.2 }
};

/* ─────────────────── Colors ─────────────────── */
const COLORS = {
  success: "#10b981",
  danger: "#ef4444",
  warning: "#f59e0b",
  info: "#3b82f6",
  pieColors: ["#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#64748b", "#ef4444"]
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
const normalizeReason = (raw = "") => {
  let s = String(raw).trim().replace(/\s+/g, " ");
  const lower = s.toLowerCase();

  if (/air leak/.test(lower)) {
    if (/low/.test(lower)) return "Air Leak (Low)";
    if (/high/.test(lower)) return "Air Leak (High)";
    return "Air Leak";
  }
  if (/wt333e.*charging.*l1.*power/.test(lower)) return "WT333E Read Charging L1 - Power";
  if (/broken.*thread.*side.*screw.*top/.test(lower)) return "Broken Thread Side Screw (Top)";
  if (/broken.*thread.*on.*screw/.test(lower)) return "Broken Thread on Screw";
  if (/broken.*thread.*screw/.test(lower)) return "Broken Thread Screw";
  if (/misthread/.test(lower)) return "Misthread Screw";
  if (/waterproof.*lock.*head/.test(lower)) return "Waterproof Lock Head";
  if (/apower.*split/.test(lower)) return "aPower Split";
  if (/screws?\s*hole\s*25.*26.*blocked/.test(lower)) return "Screw holes 25 & 26 blocked";
  if (/red.*object.*l1/.test(lower)) return "Red Object L1";
  if (/pe.*write.*station/.test(lower)) return "PE Write Station";
  if (/connector.*switch.*broken/.test(lower)) return "Connector Switch Broken";
  if (/bms.*write.*sn/.test(lower)) return "BMS Write SN";

  s = s.replace(/\b\w/g, (m) => m.toUpperCase());
  return s;
};
const cleanNgReasons = (list = []) => {
  const map = new Map();
  for (const item of list) {
    const reasonRaw = item?.reason ?? item?.name ?? "";
    const reason = normalizeReason(reasonRaw);
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
    add(normalizeReason(reason), "—", v);
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
    <div className="bg-white/95 backdrop-blur-sm p-3 rounded-lg border border-slate-200 shadow-md">
      <p className="text-sm font-semibold text-slate-900 mb-1">{label}</p>
      {clean.map((entry, idx) => {
        const { name, value } = entry;
        const swatch = entry.color || entry.fill || entry.payload?.fill;
        return (
          <div key={idx} className="flex items-center gap-2 text-sm text-slate-800">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: swatch }} />
            <span className="font-medium">{name}</span>
            <span className="tabular-nums">{(value ?? 0).toLocaleString()}</span>
          </div>
        );
      })}
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

  /* Stat card */
  const StatCard = ({ title, value, icon, trend, color = "blue", delay = 0 }) => {
    const accents = {
      blue: { bar: "bg-sky-500", icon: "bg-sky-50 text-sky-700" },
      cyan: { bar: "bg-cyan-500", icon: "bg-cyan-50 text-cyan-700" },
      teal: { bar: "bg-teal-500", icon: "bg-teal-50 text-teal-700" },
      green: { bar: "bg-emerald-500", icon: "bg-emerald-50 text-emerald-700" },
      red: { bar: "bg-rose-500", icon: "bg-rose-50 text-rose-700" }
    };
    const accent = accents[color] || accents.blue;
    return (
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3, delay }}
        whileHover={{ scale: 1.01 }}
        className={`relative overflow-hidden ${CARD_SURFACE} p-5 transition-all`}
      >
        <span className={`absolute inset-x-4 top-2 h-1 rounded-full ${accent.bar}`} />
        <div className="relative z-10 flex items-start gap-4">
          <motion.div initial={{ rotate: -180 }} animate={{ rotate: 0 }} transition={{ duration: 0.5, delay: delay + 0.2 }} className={`p-3 rounded-lg border border-slate-200 ${accent.icon}`}>
            {icon}
          </motion.div>
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">{title}</p>
            <motion.p initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.3, delay: delay + 0.3 }} className="text-3xl font-semibold text-slate-900">
              {typeof value === "number" ? value.toLocaleString() : value}
            </motion.p>
            {trend != null && (
              <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, delay: delay + 0.4 }}
                className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${trend >= 0 ? "text-emerald-700 bg-emerald-50" : "text-rose-700 bg-rose-50"}`}>
                {trend >= 0 ? <ArrowUpRight size={14}/> : <ArrowDownRight size={14}/>}
                <span>{Math.abs(trend)}%</span>
              </motion.div>
            )}
          </div>
        </div>
      </motion.div>
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
  const topModuleNgReasons = moduleNgCategories.slice(0, 5);

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
      <div className="bg-white/95 backdrop-blur-sm p-3 rounded-lg border border-slate-200 shadow-md">
        <p className="text-sm font-semibold text-slate-900 mb-1">{dateLabel}</p>
        <div className="space-y-1 text-sm text-slate-800">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#d1d5db" }} />
            <span className="font-medium">Plan Total</span>
            <span className="tabular-nums">{plan.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#fb923c" }} />
            <span className="font-medium">Actual A</span>
            <span className="tabular-nums">{a.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#10b981" }} />
            <span className="font-medium">Actual B</span>
            <span className="tabular-nums">{b.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#60a5fa" }} />
            <span className="font-medium">Actual Total</span>
            <span className="tabular-nums">{total.toLocaleString()}</span>
          </div>
          {ng > 0 && (
            <div className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#ef4444" }} />
              <span className="font-medium">NG</span>
              <span className="tabular-nums">{ng.toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <AnimatePresence mode="wait">
      <motion.div key="module" {...pageTransition} className="space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Total Output" value={summary.total} icon={<Factory size={24} className="text-blue-600" />} trend={summary.trend} color="blue" delay={0} />
          <StatCard title="Type A" value={summary.total_a} icon={<BarChart3 size={24} className="text-cyan-600" />} color="cyan" delay={0.1} />
          <StatCard title="Type B" value={summary.total_b} icon={<BarChart3 size={24} className="text-teal-600" />} color="teal" delay={0.2} />
          <StatCard title="Yield Rate" value={`${summary.yield_rate || 100}%`} icon={<TrendingUp size={24} className="text-green-600" />} trend={summary.yield_trend} color="green" delay={0.3} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
          {/* Production Trend */}
          <motion.div {...cardTransition} className="xl:col-span-2">
            <div className={`${CHART_CARD} h-full`}>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-semibold text-slate-900">Production Trend</h3>
                <div className="flex items-center gap-2 px-3 py-1 bg-slate-100 rounded-full border border-slate-200">
                  <Info size={16} className="text-slate-600" />
                  <span className="text-xs font-semibold text-slate-700">
                    {period === "daily" ? "Hourly View" : `${period.charAt(0).toUpperCase() + period.slice(1)} View`}
                  </span>
                </div>
              </div>

              <ResponsiveContainer width="100%" height={CHART_H}>
                {period === "daily" ? (
                  <LineChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
                    <defs>
                      <linearGradient id="lineGradientA" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#fb923c" stopOpacity={0.85} />
                        <stop offset="100%" stopColor="#fb923c" stopOpacity={0.25} />
                      </linearGradient>
                      <linearGradient id="lineGradientB" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.85} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0.25} />
                      </linearGradient>
                      <linearGradient id="lineGradientTotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.85} />
                        <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.25} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="6 3" stroke={GRID_COLOR} strokeOpacity={0.7} />
                    <XAxis dataKey="date" stroke="#6b7280" tick={{ fontSize: TICK_FS }} axisLine={{ stroke: GRID_COLOR }} />
                    <YAxis stroke="#6b7280" tick={{ fontSize: TICK_FS }} axisLine={{ stroke: GRID_COLOR }} domain={[0, () => yMaxModuleDaily]} />
                    <Legend wrapperStyle={{ paddingTop: "14px" }} iconType="circle"
                            formatter={(v) => <span style={{ color: "#111827", fontWeight: 600, fontSize: LEGEND_FS }}>{v}</span>} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="count_a" name="Type A" stroke="url(#lineGradientA)" strokeWidth={3}
                          dot={{ r: 4, fill: "#fb923c", strokeWidth: 2, stroke: "#fff" }}
                          activeDot={{ r: 6, stroke: "#fb923c", strokeWidth: 2, fill: "#fff" }} />
                    <Line type="monotone" dataKey="count_b" name="Type B" stroke="url(#lineGradientB)" strokeWidth={3}
                          dot={{ r: 4, fill: "#10b981", strokeWidth: 2, stroke: "#fff" }}
                          activeDot={{ r: 6, stroke: "#10b981", strokeWidth: 2, fill: "#fff" }} />
                    <Line type="monotone" dataKey="total" name="Total" stroke="url(#lineGradientTotal)" strokeWidth={2.5}
                          strokeDasharray="8 4" dot={{ r: 3, fill: "#60a5fa" }}
                          activeDot={{ r: 5, stroke: "#60a5fa", strokeWidth: 2, fill: "#fff" }} />
                  </LineChart>
                ) : (
                  <BarChart data={chartDataStacked} barGap={8} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
                    <defs>
                      <linearGradient id="barGradientA" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#fb923c" stopOpacity={1} />
                        <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.9} />
                      </linearGradient>
                      <linearGradient id="barGradientB" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                        <stop offset="100%" stopColor="#059669" stopOpacity={0.9} />
                      </linearGradient>
                      <linearGradient id="planGrayA" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#d1d5db" stopOpacity={1} />
                        <stop offset="100%" stopColor="#9ca3af" stopOpacity={0.95} />
                      </linearGradient>
                      <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
                        <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.12" />
                      </filter>
                    </defs>

                    <CartesianGrid strokeDasharray="6 3" stroke={GRID_COLOR} strokeOpacity={0.7} />
                    {/* ?????? dateLabel??????????? date */}
                    <XAxis dataKey={(d) => d.dateLabel || d.date} stroke="#6b7280" tick={{ fontSize: TICK_FS }} axisLine={{ stroke: GRID_COLOR }} />
                    <YAxis stroke="#6b7280" tick={{ fontSize: TICK_FS }} axisLine={{ stroke: GRID_COLOR }} domain={[0, () => yMaxModuleMixed]} />
                    <Legend wrapperStyle={{ paddingTop: "14px" }} iconType="rect"
                            formatter={(v) => <span style={{ color: "#111827", fontWeight: 600, fontSize: LEGEND_FS }}>{v}</span>} />
                    <Tooltip content={<ModuleAggTooltip />} />

                    {hasPlanA && hasPlanB ? (
                      <>
                        <Bar dataKey="plan_a" name="Plan A" fill="url(#planGrayA)" stackId="planned" />
                        <Bar dataKey="plan_b" name="Plan B" fill="url(#planGrayA)" stackId="planned" />
                      </>
                    ) : (
                      <Bar dataKey={(d) => Number(d._planTotal ?? 0)} name="Plan Total" fill="url(#planGrayA)" radius={[12, 12, 0, 0]} stackId="planned" />
                    )}

                    <Bar dataKey="count_a" name="Actual A" fill="url(#barGradientA)" stackId="actual" filter="url(#shadow)" />
                    <Bar dataKey="count_b" name="Actual B" fill="url(#barGradientB)" stackId="actual" radius={[12, 12, 0, 0]}>
                      {chartDataStacked.map((row, idx) => (
                        <Cell key={idx} stroke={row._miss ? COLORS.danger : undefined} strokeWidth={row._miss ? 1.25 : 0} />
                      ))}
                    </Bar>

                    <Bar dataKey="stack_total" name="" fill="transparent" isAnimationActive={false} legendType="none">
                      <LabelList
                        dataKey="stack_total"
                        position="top"
                        formatter={(v) => (v ? v.toLocaleString() : "")}
                        style={{ fill: "#111827", fontWeight: 700, fontSize: LABEL_FS }}
                      />
                    </Bar>
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </motion.div>

          {/* Daily NG Units */}
          <motion.div {...cardTransition}>
            <div className={`${CHART_CARD} h-full`}>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-semibold text-slate-900">Daily NG Units</h3>
                <p className="text-sm text-slate-500">Number of NG units recorded per day</p>
              </div>
              <ResponsiveContainer width="100%" height={CHART_H}>
                <BarChart data={chartDataStacked}>
                  <CartesianGrid strokeDasharray="6 3" stroke={GRID_COLOR} />
                  {/* ?????? dateLabel?????? date */}
                  <XAxis dataKey={(d) => d.dateLabel || d.date} stroke="#6b7280" tick={{ fontSize: TICK_FS }} />
                  <YAxis stroke="#6b7280" tick={{ fontSize: TICK_FS }} domain={[0, (m) => Math.max(10, Math.ceil(m * 1.2))]} />
                  <Tooltip formatter={(v) => [`${v}`, "NG Units"]} />
                  <Bar dataKey="ng_count" name="NG Units" fill="#ef4444" radius={[6, 6, 0, 0]}>
                    <LabelList
                      dataKey="ng_count"
                      position="top"
                      style={{ fill: "#ef4444", fontWeight: 700, fontSize: LABEL_FS }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          {moduleNgCategories.length > 0 && (
            <motion.div {...cardTransition} className="xl:col-span-2">
              <div className={`${CHART_CARD} h-full`}>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                  <div>
                    <h3 className="text-xl font-semibold text-slate-900">NG Reasons (Normalized)</h3>
                    <p className="text-sm text-slate-500">Percentage share after normalization</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                  <div className="lg:col-span-2 bg-slate-50 rounded-xl p-4 border border-slate-200">
                    <ResponsiveContainer width="100%" height={320}>
                      <PieChart>
                        <Tooltip
                          formatter={(v, n) => [`${v}%`, n]}
                          contentStyle={{ backgroundColor: "rgba(255,255,255,0.98)", border: "none", borderRadius: 12, boxShadow: "0 10px 40px rgba(0,0,0,0.12)" }}
                          itemStyle={{ color: "#111827", fontSize: 13 }}
                        />
                        <Legend
                          verticalAlign="bottom"
                          wrapperStyle={{ paddingTop: 12 }}
                          formatter={(v) => <span style={{ color: "#111827", fontWeight: 600, fontSize: 14 }}>{v}</span>}
                        />
                        <Pie
                          data={moduleNgCategories}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={70}
                          outerRadius={110}
                          paddingAngle={2}
                        >
                          {moduleNgCategories.map((_, idx) => (
                            <Cell key={idx} fill={COLORS.pieColors[idx % COLORS.pieColors.length]} stroke="#fff" strokeWidth={2} />
                          ))}
                          <LabelList
                            dataKey="value"
                            position="outside"
                            formatter={(v) => (v ? `${v}%` : "")}
                            style={{ fill: "#111827", fontWeight: 600, fontSize: 12 }}
                          />
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="w-full space-y-3">
                    <div className="text-sm font-semibold text-slate-700">Top reasons</div>
                    {topModuleNgReasons.map((item, idx) => {
                      const color = COLORS.pieColors[idx % COLORS.pieColors.length];
                      const value = Number(item.value) || 0;
                      return (
                        <div key={item.name} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                          <div className="flex items-center justify-between text-sm font-medium text-slate-800 mb-2">
                            <span className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                              <span className="truncate">{item.name}</span>
                            </span>
                            <span className="text-slate-600">{value}%</span>
                          </div>
                          <div className="h-2.5 bg-white rounded-full overflow-hidden border border-slate-100">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${Math.min(value, 100)}%`, backgroundColor: color }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {period !== "daily" && moduleYieldData.length > 0 && (
            <motion.div {...cardTransition}>
              <div className={`${CHART_CARD} h-full`}>
                <div className="mb-6">
                  <h3 className="text-xl font-semibold text-slate-900">Yield Trend Analysis</h3>
                  <p className="text-sm text-slate-500 mt-1">Production quality performance over time</p>
                </div>
                <ResponsiveContainer width="100%" height={360}>
                  <AreaChart data={moduleYieldData}>
                    <defs>
                      <linearGradient id="moduleYieldGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="6 3" stroke={GRID_COLOR} strokeOpacity={0.7} />
                    <XAxis dataKey="date" stroke="#6b7280" tick={{ fontSize: TICK_FS }} axisLine={{ stroke: GRID_COLOR }} />
                    <YAxis stroke="#6b7280" unit="%" domain={[Math.max(70, minModuleYield - 5), 100]} tick={{ fontSize: TICK_FS }} axisLine={{ stroke: GRID_COLOR }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ paddingTop: "14px" }} iconType="rect"
                            formatter={(v) => <span style={{ color: "#111827", fontWeight: 600, fontSize: LEGEND_FS }}>{v}</span>} />
                    <Area type="monotone" dataKey="yield" stroke="#10b981" strokeWidth={3} fill="url(#moduleYieldGradient)" name="Yield %"
                          dot={{ r: 5, fill: "#10b981", strokeWidth: 2, stroke: "#fff" }}
                          activeDot={{ r: 7, stroke: "#10b981", strokeWidth: 2, fill: "#fff" }} />
                    <Line type="monotone" dataKey={() => 95} name="Target" stroke="#ef4444" strokeWidth={2.5} strokeDasharray="10 5" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          )}
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
  const topNgReasons = ngCategories.slice(0, 5);

  return (
    <AnimatePresence mode="wait">
      <motion.div key="assembly" {...pageTransition} className="space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Output"
            value={summary.total}
            icon={<Factory size={24} className="text-blue-600" />}
            trend={summary.trend}
            color="blue"
            delay={0}
          />
          <StatCard
            title="OK Units"
            value={summary.ok_count}
            icon={<Target size={24} className="text-green-600" />}
            color="green"
            delay={0.1}
          />
          <StatCard
            title="NG Units"
            value={`${summary.ng_count}${summary.fixed_count > 0 ? ` (${summary.fixed_count} Fixed)` : ""}`}
            icon={<AlertCircle size={24} className="text-red-600" />}
            color="red"
            delay={0.2}
          />
          <StatCard
            title="Yield Rate"
            value={`${summary.yield_rate}%`}
            icon={<TrendingUp size={24} className="text-cyan-600" />}
            trend={summary.yield_trend}
            color="cyan"
            delay={0.3}
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
          {/* Production Trend */}
          <motion.div {...cardTransition} className="xl:col-span-2">
            <div className={`${CHART_CARD} h-full`}>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-xl font-semibold text-slate-900">Production Trend</h3>
                  <p className="text-sm text-slate-500 mt-1">Production performance monitoring</p>
                </div>
                <div className="flex items-center gap-2 px-3 py-1 bg-slate-100 rounded-full border border-slate-200">
                  <Info size={16} className="text-slate-600" />
                  <span className="text-xs font-semibold text-slate-800">
                    {period === "daily" ? "Hourly View" : `${period.charAt(0).toUpperCase() + period.slice(1)} View`}
                  </span>
                </div>
              </div>

              <ResponsiveContainer width="100%" height={CHART_H}>
                {period === "daily" ? (
                  <LineChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
                    <defs>
                      <linearGradient id="okGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.85} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0.25} />
                      </linearGradient>
                      <linearGradient id="ngGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ef4444" stopOpacity={0.85} />
                        <stop offset="100%" stopColor="#ef4444" stopOpacity={0.25} />
                      </linearGradient>
                      <linearGradient id="totalGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.85} />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.25} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="6 3" stroke={GRID_COLOR} strokeOpacity={0.7} />
                    <XAxis dataKey="date" stroke="#6b7280" tick={{ fontSize: TICK_FS }} axisLine={{ stroke: GRID_COLOR }} />
                    <YAxis stroke="#6b7280" tick={{ fontSize: TICK_FS }} axisLine={{ stroke: GRID_COLOR }} domain={[0, () => yMaxAssyDaily]} />
                    <Legend wrapperStyle={{ paddingTop: "14px" }} iconType="circle"
                            formatter={(v) => <span style={{ color: "#111827", fontWeight: 600, fontSize: LEGEND_FS }}>{v}</span>} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="ok_count" name="OK Units" stroke="url(#okGradient)" strokeWidth={3}
                          dot={{ r: 5, fill: "#10b981", strokeWidth: 2, stroke: "#fff" }}
                          activeDot={{ r: 7, stroke: "#10b981", strokeWidth: 2, fill: "#fff" }} />
                    <Line type="monotone" dataKey="ng_count" name="NG Units" stroke="url(#ngGradient)" strokeWidth={3}
                          dot={{ r: 5, fill: "#ef4444", strokeWidth: 2, stroke: "#fff" }}
                          activeDot={{ r: 7, stroke: "#ef4444", strokeWidth: 2, fill: "#fff" }} />
                    <Line type="monotone" dataKey="total" name="Total" stroke="url(#totalGradient)" strokeWidth={2.5}
                          strokeDasharray="8 4" dot={{ r: 4, fill: "#3b82f6" }}
                          activeDot={{ r: 6, stroke: "#3b82f6", strokeWidth: 2, fill: "#fff" }} />
                  </LineChart>
                ) : (
                  <BarChart data={chartData} barGap={8} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
                    <defs>
                      <linearGradient id="actualGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#06b6d4" stopOpacity={1} />
                        <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.8} />
                      </linearGradient>
                      <pattern id="plannedPatternGray" patternUnits="userSpaceOnUse" width="6" height="6">
                        <rect width="6" height="6" fill="#e2e8f0" />
                        <path d="M0,6 L6,0" stroke="#cbd5e1" strokeWidth="1.5" opacity="0.55" />
                      </pattern>
                    </defs>

                    <CartesianGrid strokeDasharray="6 3" stroke={GRID_COLOR} strokeOpacity={0.7} />
                    <XAxis dataKey="date" stroke="#6b7280" tick={{ fontSize: TICK_FS }} axisLine={{ stroke: GRID_COLOR }} />
                    <YAxis stroke="#6b7280" tick={{ fontSize: TICK_FS }} axisLine={{ stroke: GRID_COLOR }} domain={[0, () => yMaxAssyMixed]} />
                    <Legend wrapperStyle={{ paddingTop: "14px" }} iconType="rect"
                            formatter={(v) => <span style={{ color: "#111827", fontWeight: 600, fontSize: LEGEND_FS }}>{v}</span>} />
                    <Tooltip content={<CustomTooltip />} />

                    <Bar dataKey="planned" name="Planned" fill="url(#plannedPatternGray)" radius={[10, 10, 0, 0]}>
                      <LabelList dataKey="planned" position="top"
                                formatter={(v) => (v ? v.toLocaleString() : "")}
                                style={{ fill: "#475569", fontWeight: 600, fontSize: LABEL_FS }} />
                    </Bar>

                    <Bar dataKey="actual" name="Actual" fill="url(#actualGradient)" radius={[10, 10, 0, 0]}>
                      {chartData.map((row, idx) => (
                        <Cell key={idx} stroke={row._miss ? COLORS.danger : undefined} strokeWidth={row._miss ? 1.25 : 0} />
                      ))}
                      <LabelList dataKey="actual" position="top"
                                formatter={(v) => (v ? v.toLocaleString() : "")}
                                style={{ fill: "#111827", fontWeight: 700, fontSize: LABEL_FS }} />
                    </Bar>

                    <Bar dataKey="anchorMax" name="" fill="transparent" legendType="none" isAnimationActive={false}>
                      <LabelList
                        position="top"
                        content={(props) => {
                          const { x = 0, y = 0, width = 0, payload } = props || {};
                          const ng = Number(payload?.ng_count ?? payload?.ng ?? 0);
                          if (!Number.isFinite(ng) || ng <= 0) return null;
                          return (
                            <text x={x + width / 2} y={(Number.isFinite(y) ? y : 0) - 18}
                                  textAnchor="middle" style={{ fill: "#ef4444", fontWeight: 700, fontSize: LABEL_FS }}>
                              {ng.toLocaleString()}
                            </text>
                          );
                        }}
                      />
                    </Bar>
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </motion.div>

          {/* Daily NG Units */}
          <motion.div {...cardTransition}>
            <div className={`${CHART_CARD} h-full`}>
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-semibold text-slate-900">Daily NG Units</h3>
                <p className="text-sm text-slate-500">Number of NG units recorded per day</p>
              </div>
              <ResponsiveContainer width="100%" height={CHART_H}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="6 3" stroke={GRID_COLOR} />
                  <XAxis dataKey={period === "daily" ? "date" : "date"} stroke="#6b7280" tick={{ fontSize: TICK_FS }} />
                  <YAxis stroke="#6b7280" tick={{ fontSize: TICK_FS }} domain={[0, (m) => Math.max(10, Math.ceil(m * 1.2))]} />
                  <Tooltip formatter={(v) => [`${v}`, "NG Units"]} />
                  <Bar dataKey="ng_count" name="NG Units" fill="#ef4444" radius={[6, 6, 0, 0]}>
                    <LabelList dataKey="ng_count" position="top" style={{ fill: "#ef4444", fontWeight: 700, fontSize: LABEL_FS }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          {ngCategories.length > 0 && (
            <motion.div {...cardTransition} className="xl:col-span-2">
              <div className={`${CHART_CARD} h-full`}>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                  <div>
                    <h3 className="text-xl font-semibold text-slate-900">NG Reasons (Normalized)</h3>
                    <p className="text-sm text-slate-500">Percentage share after normalization</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                  <div className="lg:col-span-2 bg-slate-50 rounded-xl p-4 border border-slate-200">
                    <ResponsiveContainer width="100%" height={320}>
                      <PieChart>
                        <Tooltip
                          formatter={(v, n) => [`${v}%`, n]}
                          contentStyle={{ backgroundColor: "rgba(255,255,255,0.98)", border: "none", borderRadius: 12, boxShadow: "0 10px 40px rgba(0,0,0,0.12)" }}
                          itemStyle={{ color: "#111827", fontSize: 13 }}
                        />
                        <Legend
                          verticalAlign="bottom"
                          wrapperStyle={{ paddingTop: 12 }}
                          formatter={(v) => <span style={{ color: "#111827", fontWeight: 600, fontSize: 14 }}>{v}</span>}
                        />
                        <Pie
                          data={ngCategories}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={70}
                          outerRadius={110}
                          paddingAngle={2}
                        >
                          {ngCategories.map((_, idx) => (
                            <Cell key={idx} fill={COLORS.pieColors[idx % COLORS.pieColors.length]} stroke="#fff" strokeWidth={2} />
                          ))}
                          <LabelList
                            dataKey="value"
                            position="outside"
                            formatter={(v) => (v ? `${v}%` : "")}
                            style={{ fill: "#111827", fontWeight: 600, fontSize: 12 }}
                          />
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="w-full space-y-3">
                    <div className="text-sm font-semibold text-slate-700">Top reasons</div>
                    {topNgReasons.map((item, idx) => {
                      const color = COLORS.pieColors[idx % COLORS.pieColors.length];
                      const value = Number(item.value) || 0;
                      return (
                        <div key={item.name} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                          <div className="flex items-center justify-between text-sm font-medium text-slate-800 mb-2">
                            <span className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                              <span className="truncate">{item.name}</span>
                            </span>
                            <span className="text-slate-600">{value}%</span>
                          </div>
                          <div className="h-2.5 bg-white rounded-full overflow-hidden border border-slate-100">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${Math.min(value, 100)}%`, backgroundColor: color }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {period !== "daily" && (
            <motion.div {...cardTransition}>
              <div className={`${CHART_CARD} h-full`}>
                <div className="mb-6">
                  <h3 className="text-xl font-semibold text-slate-900">Yield Trend Analysis</h3>
                  <p className="text-sm text-slate-500 mt-1">Production quality performance over time</p>
                </div>
                <ResponsiveContainer width="100%" height={360}>
                  <AreaChart
                    data={chartData
                      .filter((d) => d.total && d.total > 0)
                      .map((d) => ({ ...d, yield: Math.round((d.ok_count / d.total) * 100) }))}
                  >
                    <defs>
                      <linearGradient id="yieldGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="6 3" stroke={GRID_COLOR} strokeOpacity={0.7} />
                    <XAxis dataKey="date" stroke="#6b7280" tick={{ fontSize: TICK_FS }} axisLine={{ stroke: GRID_COLOR }} />
                    <YAxis stroke="#6b7280" unit="%" domain={[80, 100]} tick={{ fontSize: TICK_FS }} axisLine={{ stroke: GRID_COLOR }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ paddingTop: "14px" }} iconType="rect"
                            formatter={(v) => <span style={{ color: "#111827", fontWeight: 600, fontSize: LEGEND_FS }}>{v}</span>} />
                    <Area type="monotone" dataKey="yield" stroke="#10b981" strokeWidth={3} fill="url(#yieldGradient)" name="Yield %"
                          dot={{ r: 5, fill: "#10b981", strokeWidth: 2, stroke: "#fff" }}
                          activeDot={{ r: 7, stroke: "#10b981", strokeWidth: 2, fill: "#fff" }} />
                    <Line type="monotone" dataKey={() => 95} name="Target" stroke="#ef4444" strokeWidth={2.5} strokeDasharray="10 5" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

const renderTrendAnalysis = () => {
    if (!trendData) return null;
    const { trend_data } = trendData;

    // 只取到目標日（含），不做任何 Tgt 欄/參考線
    const filtered = (trend_data || [])
      .filter(i => parseISO(i.production_date) <= parseISO(targetDate))
      .map(i => ({
        date: format(parseISO(i.production_date), "MM/dd"),
        production_date: i.production_date,
        ...i
      }));

    return (
      <motion.div {...cardTransition} className={CHART_CARD}>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-xl font-semibold text-slate-900">Production Trend (Last 30 Days)</h3>
            <p className="text-sm text-slate-500 mt-1">Long-term production performance insights</p>
          </div>
        </div>

        <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
          <ResponsiveContainer width="100%" height={CHART_H}>
            <ComposedChart data={filtered} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
              <defs>
                <linearGradient id="totalGradientClean" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="0" stroke={GRID_COLOR} vertical={false}/>
              <XAxis dataKey="date" stroke="#6b7280" tick={{ fontSize: TICK_FS }} axisLine={{ stroke: GRID_COLOR }} />
              <YAxis stroke="#6b7280" tick={{ fontSize: TICK_FS }} axisLine={{ stroke: GRID_COLOR }} tickFormatter={(v) => v.toLocaleString()} />
              <Tooltip contentStyle={{ backgroundColor: "rgba(255,255,255,0.98)", border: "none", borderRadius: "12px", boxShadow: "0 10px 40px rgba(0,0,0,0.12)" }}
                      labelStyle={{ color: "#111827", fontWeight: 600, marginBottom: 8 }}
                      itemStyle={{ color: "#111827", fontSize: 13 }} />
              <Legend wrapperStyle={{ paddingTop: "18px" }} iconType="line" iconSize={18}
                      formatter={(v) => <span style={{ color: "#111827", fontWeight: 600, fontSize: LEGEND_FS }}>{v}</span>} />

              <Area type="monotone" dataKey="total" name="Daily Output" stroke="#3b82f6" fill="url(#totalGradientClean)" strokeWidth={3} dot={false} />
              {filtered.some(d => d.moving_avg) && <Line type="monotone" dataKey="moving_avg" name="7-Day Average" stroke="#f59e0b" strokeWidth={2.5} dot={false} opacity={0.9} />}
              {filtered.some(d => d.trend_line) && <Line type="monotone" dataKey="trend_line" name="Trend Line" stroke="#6b7280" strokeWidth={2} strokeDasharray="8 6" dot={false} opacity={0.6} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </motion.div>
    );
  };


  /* ─────────────────── Hourly Distribution ─────────────────── */
  const renderHourlyDistribution = () => {
    if (!hourlyData) return null;
    const { distribution_data, summary } = hourlyData;
    const maxValue = Math.max(...distribution_data.map(d => d.average || 0));
    const avgValue = distribution_data.reduce((sum, d) => sum + (d.average || 0), 0) / (distribution_data.length || 1);

    return (
      <motion.div {...cardTransition} className={CHART_CARD}>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-xl font-semibold text-slate-900">Hourly Production Pattern</h3>
            <p className="text-sm text-slate-500 mt-1">24-hour production distribution analysis</p>
          </div>
          {summary && (
            <div className="flex items-center gap-4">
              <div className="px-4 py-2 bg-slate-100 border border-slate-200 rounded-lg">
                <span className="text-xs text-slate-500 block">Peak Hour</span>
                <span className="text-sm font-semibold text-slate-900">{summary.peak_hour}</span>
              </div>
              <div className="px-4 py-2 bg-slate-100 border border-slate-200 rounded-lg">
                <span className="text-xs text-slate-500 block">Total Output</span>
                <span className="text-sm font-semibold text-slate-900">{summary.total_production?.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>

        <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
          <ResponsiveContainer width="100%" height={360}>
            <BarChart data={distribution_data} margin={{ top: 10, right: 30, left: 20, bottom: 50 }}>
              <defs>
                <linearGradient id="barGradientHourly" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={1} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.7} />
                </linearGradient>
                <linearGradient id="barGradientPeak" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.7} />
                </linearGradient>
                <linearGradient id="barGradientLow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#e2e8f0" stopOpacity={1} />
                  <stop offset="100%" stopColor="#e2e8f0" stopOpacity={0.85} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="0" stroke={GRID_COLOR} vertical={false} />
              <XAxis dataKey="hour" stroke="#6b7280" tick={{ fontSize: TICK_FS }} axisLine={{ stroke: GRID_COLOR }}
                     label={{ value: "Hour of Day", position: "insideBottom", offset: -35, style: { fill: "#6b7280", fontSize: 12, fontWeight: 500 } }} />
              <YAxis stroke="#6b7280" tick={{ fontSize: TICK_FS }} axisLine={{ stroke: GRID_COLOR }}
                     tickFormatter={(v) => v.toLocaleString()}
                     label={{ value: "Average Output", angle: -90, position: "insideLeft", style: { fill: "#6b7280", fontSize: 12, fontWeight: 500 } }} />
              <Tooltip contentStyle={{ backgroundColor: "rgba(255,255,255,0.98)", border: "none", borderRadius: "12px", boxShadow: "0 10px 40px rgba(0,0,0,0.12)" }}
                       labelStyle={{ color: "#111827", fontWeight: 600, marginBottom: 8 }} itemStyle={{ color: "#111827", fontSize: 13 }} />

              <ReferenceLine y={avgValue} stroke="#f59e0b" strokeDasharray="8 4" strokeWidth={2}
                label={{ value: `Avg: ${Math.round(avgValue).toLocaleString()}`, position: "right", style: { fill: "#f59e0b", fontWeight: 600, fontSize: LABEL_FS } }} />

              <Bar dataKey="average" name="Avg Output" radius={[8, 8, 0, 0]}>
                {distribution_data.map((entry, idx) => {
                  const isMax = entry.average === maxValue;
                  const isLow = entry.average < avgValue * 0.5;
                  return (
                    <Cell key={idx} fill={isMax ? "url(#barGradientPeak)" : isLow ? "url(#barGradientLow)" : entry.average > 0 ? "url(#barGradientHourly)" : "#f3f4f6"} />
                  );
                })}
                <LabelList dataKey="average" position="top"
                           formatter={(v) => (v >= avgValue ? v.toLocaleString() : "")}
                           style={{ fill: "#111827", fontSize: 11, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </motion.div>
    );
  };

  /* ─────────────────── Module vs Assembly Comparison ─────────────────── */
  const renderComparisonAnalysis = () => {
    if (!comparisonData) return null;
    const { comparison_data, statistics } = comparisonData;
    const data = comparison_data.map(i => ({ date: format(parseISO(i.date), "MM/dd"), ...i }));

    const maxEfficiency = Math.max(...data.map(d => d.efficiency || 0));
    const minEfficiency = Math.min(...data.map(d => d.efficiency || 0));

    const targetLabel = format(parseISO(targetDate), "MM/dd");

    return (
      <motion.div {...cardTransition} className={CHART_CARD}>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-xl font-semibold text-slate-900">Module vs Assembly Comparison</h3>
            <p className="text-sm text-slate-500 mt-1">Production line synchronization analysis</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="px-5 py-2 bg-slate-100 border border-slate-200 rounded-lg">
              <span className="text-xs text-slate-500 block">Correlation</span>
              <span className="text-sm font-semibold text-slate-900">{statistics.correlation.toFixed(3)}</span>
            </div>
            <div className="px-5 py-2 bg-slate-100 border border-slate-200 rounded-lg">
              <span className="text-xs text-slate-500 block">Avg Efficiency</span>
              <span className="text-sm font-semibold text-slate-900">{statistics.avg_efficiency}%</span>
            </div>
          </div>
        </div>

        <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
          <ResponsiveContainer width="100%" height={CHART_H - 40}>
            <ComposedChart data={data} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
              <defs>
                <linearGradient id="moduleGradientComp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity={1} />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.7} />
                </linearGradient>
                <linearGradient id="assemblyGradientComp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity={1} />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.7} />
                </linearGradient>
                <linearGradient id="efficiencyGradient" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.8} />
                  <stop offset="50%" stopColor="#10b981" stopOpacity={1} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.8} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="0" stroke={GRID_COLOR} vertical={false}/>
              <XAxis dataKey="date" stroke="#6b7280" tick={{ fontSize: TICK_FS }} axisLine={{ stroke: GRID_COLOR }} />
              <YAxis yAxisId="left" stroke="#6b7280" tick={{ fontSize: TICK_FS }} axisLine={{ stroke: GRID_COLOR }}
                     tickFormatter={(v) => v.toLocaleString()}
                     label={{ value: "Production Units", angle: -90, position: "insideLeft", style: { fill: "#111827", fontWeight: 600, fontSize: 12 } }} />
              <YAxis yAxisId="right" orientation="right" stroke="#6b7280" tick={{ fontSize: TICK_FS }} axisLine={{ stroke: GRID_COLOR }}
                     domain={[Math.min(80, minEfficiency - 5), Math.max(100, maxEfficiency + 5)]}
                     label={{ value: "Efficiency %", angle: 90, position: "insideRight", style: { fill: "#111827", fontWeight: 600, fontSize: 12 } }} />
              <Tooltip contentStyle={{ backgroundColor: "rgba(255,255,255,0.98)", border: "none", borderRadius: "12px", boxShadow: "0 10px 40px rgba(0,0,0,0.12)" }}
                       labelStyle={{ color: "#111827", fontWeight: 600, marginBottom: 8 }}
                       itemStyle={{ color: "#111827", fontSize: 13 }}
                       formatter={(value, name) => (name === "Efficiency %" ? [`${value}%`, name] : [value?.toLocaleString(), name])} />
              <Legend wrapperStyle={{ paddingTop: "18px" }} iconType="rect" iconSize={12}
                      formatter={(v) => <span style={{ color: "#111827", fontWeight: 600, fontSize: LEGEND_FS }}>{v}</span>} />

              <ReferenceLine x={targetLabel} stroke="#111827" strokeDasharray="6 4"
                label={{ value: "Target", position: "top", style: { fill: "#111827", fontWeight: 600, fontSize: LABEL_FS } }} />

              <ReferenceLine yAxisId="right" y={95} stroke="#ef4444" strokeDasharray="8 4" strokeWidth={1.5}
                label={{ value: "Target 95%", position: "right", style: { fill: "#ef4444", fontWeight: 600, fontSize: 11 } }} />

              <Bar yAxisId="left" dataKey="module" name="Module" fill="url(#moduleGradientComp)" radius={[6, 6, 0, 0]} barSize={35} />
              <Bar yAxisId="left" dataKey="assembly" name="Assembly" fill="url(#assemblyGradientComp)" radius={[6, 6, 0, 0]} barSize={35} />
              <Line yAxisId="right" type="monotone" dataKey="efficiency" name="Efficiency %" stroke="url(#efficiencyGradient)" strokeWidth={3}
                    dot={{ r: 5, fill: "#10b981", strokeWidth: 2, stroke: "#fff" }}
                    activeDot={{ r: 7, stroke: "#10b981", strokeWidth: 2, fill: "#fff" }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </motion.div>
    );
  };

  /* ─────────────────── Render ─────────────────── */
  return (
    <div
      ref={containerRef}
      onDoubleClick={toggleFullscreen}
      className="min-h-screen bg-slate-50 p-6"
      style={{ overflowY: "auto" }}
    >
      <motion.header initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
        <h1 className="text-4xl font-semibold text-slate-900 mb-2 flex items-center justify-center gap-3">
          <BarChart3 className="w-10 h-10 text-sky-600"/>
          Production Analytics
        </h1>
      </motion.header>

      {/* Controls */}
      <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }} className={`${CARD_SURFACE} p-6 mb-6`}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-slate-700">Production Line</label>
            <div className="relative bg-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              <motion.div
                className="absolute top-1 bottom-1 w-1/2 rounded-lg bg-slate-900"
                initial={false}
                animate={{ x: activeLine === "module" ? "0%" : "100%" }}
                transition={{ type: "spring", stiffness: 260, damping: 26 }}
              />
              <div className="grid grid-cols-2 relative z-10">
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
                      className={`flex items-center gap-3 px-4 py-3 transition-colors ${active ? "text-white" : "text-slate-700 hover:text-slate-900"}`}
                    >
                      <span className={`p-2 rounded-lg ${active ? "bg-white/10" : "bg-white text-slate-700 border border-slate-200"}`}>
                        <Icon size={16} />
                      </span>
                      <span className="text-left text-sm font-semibold tracking-wide">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-slate-700">Time Period</label>
            <div className="flex gap-2">
              {["daily", "weekly", "monthly"].map((p) => (
                <motion.button key={p} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                  className={`px-4 py-2 rounded-md transition-all border ${period === p ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 hover:bg-slate-50 border-slate-200"}`}
                  onClick={() => setPeriod(p)}>
                  {p === "daily" ? "Daily" : p === "weekly" ? "Weekly" : "Monthly"}
                </motion.button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-slate-700 flex items-center gap-1"><Calendar size={16}/> Target Date</label>
            <motion.input whileFocus={{ scale: 1.02 }} type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)}
              className="px-4 py-2 bg-white border border-slate-300 rounded-md text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-transparent transition-all shadow-sm"
              max={todayInTZ("America/Los_Angeles")}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 text-sm text-slate-600 mt-4">
          {loading ? (
            <div className="flex items-center gap-2">
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="w-4 h-4 border-2 border-gray-300 border-t-slate-900 rounded-full" />
              <span>Loading latest data…</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Activity size={14} className="text-slate-800" />
              <span>Auto-refresh on filter change</span>
            </div>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-center gap-3">
            <AlertCircle className="text-red-600" size={24} />
            <p className="text-red-700">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 內容 */}
      <AnimatePresence mode="wait">
        {!loading && !error && (
          <motion.div key="content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8">
            {activeLine === "module" ? renderModuleCharts() : renderAssemblyCharts()}
            {renderTrendAnalysis()}
            {renderHourlyDistribution()}
            {renderComparisonAnalysis()}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
