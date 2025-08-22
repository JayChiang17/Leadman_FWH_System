import React, { useState, useEffect, useCallback } from "react";
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
import { format, parseISO } from "date-fns";
import axios from "../../services/api";
import { motion, AnimatePresence } from "framer-motion";

const pageTransition = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
  transition: { duration: 0.3 }
};

const cardTransition = {
  initial: { scale: 0.9, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  transition: { duration: 0.2 }
};

const COLORS = {
  primary: ["#3b82f6", "#06b6d4", "#8b5cf6", "#10b981"],
  success: "#10b981",
  danger: "#ef4444",
  warning: "#f59e0b",
  info: "#3b82f6",
  pieColors: ["#3b82f6", "#06b6d4", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444"]
};

/* ────────────────────── NG Reasons 清理/合併/分群 ────────────────────── */
const normalizeReason = (raw = "") => {
  let s = String(raw).trim().replace(/\s+/g, " ");
  const lower = s.toLowerCase();

  // Air Leak (Low / High / General)
  if (/air leak/.test(lower)) {
    if (/low/.test(lower)) return "Air Leak (Low)";
    if (/high/.test(lower)) return "Air Leak (High)";
    return "Air Leak";
  }

  // WT333E 讀值充電 L1 Power
  if (/wt333e.*charging.*l1.*power/.test(lower)) {
    return "WT333E Read Charging L1 - Power";
  }

  // Broken thread 類
  if (/broken.*thread.*side.*screw.*top/.test(lower)) {
    return "Broken Thread Side Screw (Top)";
  }
  if (/broken.*thread.*on.*screw/.test(lower)) {
    return "Broken Thread on Screw";
  }
  if (/broken.*thread.*screw/.test(lower)) {
    return "Broken Thread Screw";
  }

  // 其他常見條目
  if (/misthread/.test(lower)) return "Misthread Screw";
  if (/waterproof.*lock.*head/.test(lower)) return "Waterproof Lock Head";
  if (/apower.*split/.test(lower)) return "aPower Split";
  if (/screws?\s*hole\s*25.*26.*blocked/.test(lower)) return "Screw holes 25 & 26 blocked";
  if (/red.*object.*l1/.test(lower)) return "Red Object L1";
  if (/pe.*write.*station/.test(lower)) return "PE Write Station";
  if (/connector.*switch.*broken/.test(lower)) return "Connector Switch Broken";
  if (/bms.*write.*sn/.test(lower)) return "BMS Write SN";

  // Title Case fallback
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
/* ─────────────────────────────────────────────────────────────── */

/* 工具：取週/月區間（只到 target 日） */
const getRangeByPeriod = (period, targetDateStr) => {
  const td = new Date(targetDateStr);
  let start, end;
  if (period === "daily") {
    start = td;
    end = td;
  } else if (period === "weekly") {
    const dow = td.getDay();                 // 0=Sun..6=Sat
    const monday = new Date(td);
    const diffToMon = (dow + 6) % 7;         // 週一=0
    monday.setDate(td.getDate() - diffToMon);
    start = monday;
    end = td;
  } else { // monthly
    start = new Date(td.getFullYear(), td.getMonth(), 1);
    end = td;
  }
  return {
    startStr: format(start, "yyyy-MM-dd"),
    endStr: format(end, "yyyy-MM-dd"),
    targetDateObj: td,
    daysWTD: period === "weekly" ? ((td.getDay() + 6) % 7) + 1 : 1,
    daysMTD: td.getDate()
  };
};

/* 工具：列舉日期（YYYY-MM-DD） */
const listDates = (startStr, endStr) => {
  const out = [];
  const d = new Date(`${startStr}T00:00:00`);
  const e = new Date(`${endStr}T00:00:00`);
  for (let cur = new Date(d); cur <= e; cur.setDate(cur.getDate() + 1)) {
    out.push(format(cur, "yyyy-MM-dd"));
  }
  return out;
};

/* 工具：計算 Y 軸上限（加 10% 緩衝） */
const calcYMaxWithPad = (data, keys = []) => {
  let maxVal = 0;
  for (const row of data || []) {
    for (const k of keys) {
      const v = typeof k === "function" ? k(row) : row[k];
      const num = Number(v) || 0;
      if (num > maxVal) maxVal = num;
    }
  }
  const padded = Math.ceil(maxVal * 1.1);
  return padded > 0 ? padded : 10; // 至少 10
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white/95 backdrop-blur-sm p-3 rounded-lg border border-gray-300 shadow-xl">
      <p className="text-xs font-semibold text-gray-800 mb-1">{label}</p>
      {payload.map((entry, idx) => {
        const { name, value } = entry;
        const swatch = entry.color || entry.fill || entry.payload?.fill;
        return (
          <div key={idx} className="flex items-center gap-2 text-sm text-gray-900">
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: swatch }} />
            <span>{name}：</span>
            <span className="tabular-nums">{(value ?? 0).toLocaleString()}</span>
          </div>
        );
      })}
    </div>
  );
};

export default function ProductionCharts() {
  const [activeLine, setActiveLine] = useState("module");
  const [period, setPeriod] = useState("daily");
  const [targetDate, setTargetDate] = useState(format(new Date(), "yyyy-MM-dd"));
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
      const {daysWTD, daysMTD, targetDateObj } = getRangeByPeriod(period, targetDate);

      const requests = [
        axios.get("production-charts/module/production", {
          params: { period, target_date: targetDate }
        }),
        axios.get("production-charts/assembly/production", {
          params: { period, target_date: targetDate }
        }),
        axios.get("production-charts/trend-analysis", {
          params: { line_type: activeLine, days: 30 }
        }),
        axios.get("production-charts/hourly-distribution", {
          params: {
            line_type: activeLine,
            period,
            target_date: targetDate,
            days:
              period === "daily" ? 1 :
              period === "weekly" ? daysWTD :
              daysMTD
          }
        })
      ];

      const [module, assembly, trend, hourly] = await Promise.all(requests);
      setModuleData(module.data);
      setAssemblyData(assembly.data);
      setTrendData(trend.data);
      setHourlyData(hourly.data);

      // Comparison：月視圖只到 target day；週視圖 Mon→target day；日為近 7 天
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

  /* 週/月：補齊整段日期；合併 actual 與 plan（plan 可為 plan_total 或 plan_a/plan_b） */
  const buildChartData = (data, plan = [], range) => {
    if (!data || !data.production_data) return [];
    const prodMap = Object.fromEntries((data.production_data || []).map(i => [i.production_date, i]));
    const planMap = Object.fromEntries((plan || []).map(i => [i.date, i]));

    // 補齊整段日期（Mon→target / 1→target）
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

  // 每日：補齊 24 小時
  const buildHourlyChartData = (data) => {
    if (!data || !data.production_data) return [];
    return Array.from({ length: 24 }, (_, hour) => {
      const hourStr = hour.toString().padStart(2, '0');
      const existing = data.production_data.find(d => d.hour === hourStr) || {};
      let total = existing.total;
      if (total == null) {
        const sumAB = (existing.count_a || 0) + (existing.count_b || 0);
        const sumOkNg = (existing.ok_count || 0) + (existing.ng_count || 0);
        total = sumAB || sumOkNg || 0;
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

  const achievement = (actual, plan) => !plan ? 0 : Math.round((actual / plan) * 100);

  const StatCard = ({ title, value, icon, trend, color = "blue", delay = 0 }) => {
    const colorClasses = {
      blue: "from-blue-50 to-blue-100 border-blue-200",
      cyan: "from-cyan-50 to-cyan-100 border-cyan-200",
      purple: "from-purple-50 to-purple-100 border-purple-200",
      green: "from-green-50 to-green-100 border-green-200",
      red: "from-red-50 to-red-100 border-red-200"
    };
    return (
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3, delay }}
        whileHover={{ scale: 1.02 }}
        className={`relative p-6 bg-gradient-to-br ${colorClasses[color]} rounded-xl border shadow-sm hover:shadow-md transition-all`}
      >
        <div className="relative z-10 flex items-start gap-4">
          <motion.div initial={{ rotate: -180 }} animate={{ rotate: 0 }} transition={{ duration: 0.5, delay: delay + 0.2 }} className="p-3 bg-white rounded-lg shadow-sm">
            {icon}
          </motion.div>
          <div className="flex-1">
            <p className="text-sm text-gray-600 mb-1">{title}</p>
            <motion.p initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ duration: 0.3, delay: delay + 0.3 }} className="text-2xl font-bold text-gray-800">
              {typeof value === "number" ? value.toLocaleString() : value}
            </motion.p>
            {trend != null && (
              <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, delay: delay + 0.4 }}
                className={`mt-2 flex items-center gap-1 text-sm ${trend >= 0 ? "text-green-600" : "text-red-600"}`}>
                {trend >= 0 ? <ArrowUpRight size={16}/> : <ArrowDownRight size={16}/>}
                <span>{Math.abs(trend)}%</span>
              </motion.div>
            )}
          </div>
        </div>
      </motion.div>
    );
  };

const renderModuleCharts = () => {
  if (!moduleData) return null;
  const range = getRangeByPeriod(period, targetDate);

  const chartData =
    period === "daily"
      ? buildHourlyChartData(moduleData)
      : buildChartData(moduleData, moduleData.plan_data, range);

  const { summary } = moduleData;
  const hasPlanA = chartData.some((d) => d?.plan_a != null);
  const hasPlanB = chartData.some((d) => d?.plan_b != null);

  // 週/月視圖：加總 A+B 作為堆疊總量，供頂端標籤與 Y 軸上限計算
  const chartDataStacked =
    period === "daily"
      ? chartData
      : chartData.map((d) => ({ ...d, stack_total: (d.count_a || 0) + (d.count_b || 0) }));

  // Y 軸上限 +10% 緩衝
  const yMaxModuleDaily = calcYMaxWithPad(chartData, ["count_a", "count_b", "total"]);
  const yMaxModuleMixed = calcYMaxWithPad(chartDataStacked, [
    (row) => row.stack_total || 0,
    (row) => row.plan_a ?? 0,
    (row) => row.plan_b ?? 0,
    (row) => row.plan_total ?? row.plan ?? ((row.plan_a || 0) + (row.plan_b || 0)),
  ]);

  return (
    <AnimatePresence mode="wait">
      <motion.div key="module" {...pageTransition} className="space-y-6">
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
            title="Type A"
            value={summary.total_a}
            icon={<BarChart3 size={24} className="text-cyan-600" />}
            color="cyan"
            delay={0.1}
          />
          <StatCard
            title="Type B"
            value={summary.total_b}
            icon={<BarChart3 size={24} className="text-purple-600" />}
            color="purple"
            delay={0.2}
          />
          <StatCard
            title="Yield Rate"
            value={`${summary.yield_rate || 100}%`}
            icon={<TrendingUp size={24} className="text-green-600" />}
            trend={summary.yield_trend}
            color="green"
            delay={0.3}
          />
        </div>

        <motion.div {...cardTransition} className="bg-gradient-to-br from-white to-gray-50 border border-gray-200 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
                Production Trend
              </h3>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-lg">
              <Info size={16} className="text-gray-600" />
              <span className="text-sm font-medium text-gray-700">
                {period === "daily" ? "Hourly View" : `${period.charAt(0).toUpperCase() + period.slice(1)} View`}
              </span>
            </div>
          </div>

          <ResponsiveContainer width="100%" height={400}>
            {period === "daily" ? (
              <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                <defs>
                  <linearGradient id="lineGradientA" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#fb923c" stopOpacity={0.8} />
                    <stop offset="100%" stopColor="#fb923c" stopOpacity={0.3} />
                  </linearGradient>
                  <linearGradient id="lineGradientB" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34d399" stopOpacity={0.8} />
                    <stop offset="100%" stopColor="#34d399" stopOpacity={0.3} />
                  </linearGradient>
                  <linearGradient id="lineGradientTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.8} />
                    <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.3} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="8 4" stroke="#e5e7eb" strokeOpacity={0.5} />
                <XAxis 
                  dataKey="date" 
                  stroke="#9ca3af"
                  tick={{ fontSize: 12 }}
                  axisLine={{ stroke: '#e5e7eb' }}
                />
                <YAxis 
                  stroke="#9ca3af"
                  tick={{ fontSize: 12 }}
                  axisLine={{ stroke: '#e5e7eb' }}
                  domain={[0, () => yMaxModuleDaily]}
                />
                <Legend 
                  wrapperStyle={{ paddingTop: '20px' }}
                  iconType="circle"
                  formatter={(v) => <span style={{ color: "#4b5563", fontWeight: 600, fontSize: 14 }}>{v}</span>}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    border: '1px solid #e5e7eb',
                    borderRadius: '12px',
                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
                  }}
                  content={<CustomTooltip />}
                />
                <Line
                  type="monotone"
                  dataKey="count_a"
                  name="Type A"
                  stroke="#fb923c"
                  strokeWidth={3}
                  dot={{ r: 4, fill: "#fb923c", strokeWidth: 2, stroke: '#fff' }}
                  activeDot={{ r: 6, stroke: '#fb923c', strokeWidth: 2, fill: '#fff' }}
                />
                <Line
                  type="monotone"
                  dataKey="count_b"
                  name="Type B"
                  stroke="#34d399"
                  strokeWidth={3}
                  dot={{ r: 4, fill: "#34d399", strokeWidth: 2, stroke: '#fff' }}
                  activeDot={{ r: 6, stroke: '#34d399', strokeWidth: 2, fill: '#fff' }}
                />
                <Line
                  type="monotone"
                  dataKey="total"
                  name="Total"
                  stroke="#60a5fa"
                  strokeWidth={2.5}
                  strokeDasharray="8 4"
                  dot={{ r: 3, fill: "#60a5fa" }}
                  activeDot={{ r: 5, stroke: '#60a5fa', strokeWidth: 2, fill: '#fff' }}
                />
              </LineChart>
            ) : (
              <BarChart data={chartDataStacked} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                <defs>
                  <linearGradient id="barGradientA" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#fb923c" stopOpacity={1} />
                    <stop offset="100%" stopColor="#f97316" stopOpacity={0.8} />
                  </linearGradient>
                  <linearGradient id="barGradientB" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34d399" stopOpacity={1} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.8} />
                  </linearGradient>
                  {/* Plan 柱狀圖漸變 - 使用斜紋效果 */}
                  <pattern id="planPatternA" patternUnits="userSpaceOnUse" width="6" height="6">
                    <rect width="6" height="6" fill="#fef3c7" />
                    <path d="M0,6 L6,0" stroke="#f59e0b" strokeWidth="1.5" opacity="0.5" />
                  </pattern>
                  <pattern id="planPatternB" patternUnits="userSpaceOnUse" width="6" height="6">
                    <rect width="6" height="6" fill="#fee2e2" />
                    <path d="M0,6 L6,0" stroke="#ef4444" strokeWidth="1.5" opacity="0.5" />
                  </pattern>
                  <pattern id="planPatternTotal" patternUnits="userSpaceOnUse" width="6" height="6">
                    <rect width="6" height="6" fill="#e0f2fe" />
                    <path d="M0,6 L6,0" stroke="#0ea5e9" strokeWidth="1.5" opacity="0.5" />
                  </pattern>
                  <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
                    <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.1"/>
                  </filter>
                </defs>

                <CartesianGrid strokeDasharray="8 4" stroke="#e5e7eb" strokeOpacity={0.5} />
                <XAxis 
                  dataKey="date" 
                  stroke="#9ca3af"
                  tick={{ fontSize: 12 }}
                  axisLine={{ stroke: '#e5e7eb' }}
                />
                <YAxis 
                  stroke="#9ca3af"
                  tick={{ fontSize: 12 }}
                  axisLine={{ stroke: '#e5e7eb' }}
                  domain={[0, () => yMaxModuleMixed]}
                />
                <Legend 
                  wrapperStyle={{ paddingTop: '20px' }}
                  iconType="rect"
                  formatter={(v) => <span style={{ color: "#4b5563", fontWeight: 600, fontSize: 14 }}>{v}</span>}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    border: '1px solid #e5e7eb',
                    borderRadius: '12px',
                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
                  }}
                  content={<CustomTooltip />}
                />

                {/* Plan 柱狀圖 - 放在實際數據旁邊 */}
                {hasPlanA && hasPlanB ? (
                  <>
                    {/* Plan A + Plan B 堆疊 */}
                    <Bar 
                      dataKey="plan_a" 
                      name="Plan A" 
                      fill="url(#planPatternA)"
                      radius={[0, 0, 0, 0]}
                      stackId="plan"
                    />
                    <Bar 
                      dataKey="plan_b" 
                      name="Plan B" 
                      fill="url(#planPatternB)"
                      radius={[12, 12, 0, 0]}
                      stackId="plan"
                    />
                  </>
                ) : (
                  /* 單一 Plan Total */
                  <Bar 
                    dataKey={(d) => d.plan_total ?? d.plan ?? ((d.plan_a || 0) + (d.plan_b || 0))}
                    name="Plan Total" 
                    fill="url(#planPatternTotal)"
                    radius={[12, 12, 0, 0]}
                  />
                )}

                {/* Actual：A/B 以同一 stackId 堆疊 */}
                <Bar 
                  dataKey="count_a" 
                  name="Actual A" 
                  fill="url(#barGradientA)" 
                  radius={[0, 0, 0, 0]} 
                  stackId="actual"
                  filter="url(#shadow)"
                />
                <Bar 
                  dataKey="count_b" 
                  name="Actual B" 
                  fill="url(#barGradientB)" 
                  radius={[12, 12, 0, 0]} 
                  stackId="actual"
                />

                {/* 在實際數據堆疊頂端顯示「總量」標籤 */}
                <Bar dataKey="stack_total" fill="transparent" isAnimationActive={false}>
                  <LabelList
                    dataKey="stack_total"
                    position="top"
                    formatter={(v) => (v ? v.toLocaleString() : "")}
                    style={{ fill: "#1f2937", fontWeight: 700, fontSize: 13 }}
                  />
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        </motion.div>

        {/* 達成率（有計畫才顯示） */}
        {period !== "daily" && moduleData.plan_data?.length > 0 && (
          <motion.div {...cardTransition} className="bg-gradient-to-br from-white to-gray-50 border border-gray-200 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow">
            <div className="mb-8">
              <h3 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
                Plan Achievement Rate
              </h3>
              <p className="text-sm text-gray-500 mt-1">Performance against planned targets</p>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={chartData.map((d) => ({
                  ...d,
                  achievementA: achievement(d.count_a || 0, d.plan_a || 0),
                  achievementB: achievement(d.count_b || 0, d.plan_b || 0),
                  achievementTotal: achievement(
                    (d.count_a || 0) + (d.count_b || 0),
                    d.plan_total ?? d.plan ?? (d.plan_a || 0) + (d.plan_b || 0)
                  ),
                }))}
                margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
              >
                <defs>
                  <linearGradient id="achieveGradientA" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34d399" stopOpacity={1} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.7} />
                  </linearGradient>
                  <linearGradient id="achieveGradientB" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#60a5fa" stopOpacity={1} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.7} />
                  </linearGradient>
                  <linearGradient id="achieveGradientTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#06b6d4" stopOpacity={1} />
                    <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.7} />
                  </linearGradient>
                  <filter id="barShadow" x="-50%" y="-50%" width="200%" height="200%">
                    <feDropShadow dx="0" dy="1" stdDeviation="2" floodOpacity="0.15"/>
                  </filter>
                </defs>
                <CartesianGrid strokeDasharray="8 4" stroke="#e5e7eb" strokeOpacity={0.5} />
                <XAxis 
                  dataKey="date" 
                  stroke="#9ca3af"
                  tick={{ fontSize: 12 }}
                  axisLine={{ stroke: '#e5e7eb' }}
                />
                <YAxis 
                  stroke="#9ca3af"
                  tick={{ fontSize: 12 }}
                  axisLine={{ stroke: '#e5e7eb' }}
                  unit="%" 
                  domain={[0, 120]}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    border: '1px solid #e5e7eb',
                    borderRadius: '12px',
                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
                  }}
                  content={<CustomTooltip />}
                />
                <Legend 
                  wrapperStyle={{ paddingTop: '20px' }}
                  iconType="circle"
                  formatter={(v) => <span style={{ color: "#4b5563", fontWeight: 600, fontSize: 14 }}>{v}</span>}
                />
                {chartData.some((d) => d.plan_a != null) || chartData.some((d) => d.plan_b != null) ? (
                  <>
                    <Bar 
                      dataKey="achievementA" 
                      name="Type A" 
                      fill="url(#achieveGradientA)" 
                      radius={[10, 10, 0, 0]}
                      filter="url(#barShadow)"
                    />
                    <Bar 
                      dataKey="achievementB" 
                      name="Type B" 
                      fill="url(#achieveGradientB)" 
                      radius={[10, 10, 0, 0]}
                      filter="url(#barShadow)"
                    />
                  </>
                ) : (
                  <Bar 
                    dataKey="achievementTotal" 
                    name="Total" 
                    fill="url(#achieveGradientTotal)" 
                    radius={[10, 10, 0, 0]}
                    filter="url(#barShadow)"
                  />
                )}
                <Line 
                  type="monotone" 
                  dataKey={() => 100} 
                  name="Target 100%" 
                  stroke="#ef4444" 
                  strokeWidth={2.5}
                  strokeDasharray="8 6"
                  dot={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </motion.div>
        )}

        {period !== "daily" && moduleData.module_yield_data?.length > 0 && (
          <motion.div {...cardTransition} className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <h3 className="text-xl font-semibold text-gray-800 mb-6">Yield Rate Trend</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={moduleData.module_yield_data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" stroke="#6b7280" />
                <YAxis stroke="#6b7280" unit="%" domain={[95, 100]} />
                <Tooltip content={<CustomTooltip />} />
                <Legend formatter={(v) => <span style={{ color: "#000", fontWeight: 500 }}>{v}</span>} />
                <Line
                  type="monotone"
                  dataKey="yield_rate"
                  name="Yield Rate %"
                  stroke="#10b981"
                  strokeWidth={3}
                  dot={{ r: 5, fill: "#10b981" }}
                />
                <Line type="monotone" dataKey={() => 99} name="Target" stroke="#ef4444" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </motion.div>
        )}
      </motion.div>
    </AnimatePresence>
  );
};


  /* Assembly */
  const renderAssemblyCharts = () => {
    if (!assemblyData) return null;
    const range = getRangeByPeriod(period, targetDate);
  
    const chartData = period === 'daily'
      ? buildHourlyChartData(assemblyData)
      : buildChartData(assemblyData, assemblyData.plan_data, range);
  
    const chartDataAvP =
      period === 'daily'
        ? chartData
        : chartData.map(d => {
            const actual = d.total ?? ((d.ok_count || 0) + (d.ng_count || 0));
            const planned = d.plan_total ?? d.plan ?? 0;
            return { ...d, actual, planned, achieved: planned > 0 && actual >= planned };
          });
  
    const { summary, ng_reasons } = assemblyData;
  
    // Y 軸上限 +10%（考量 actual 與 plan）
    const yMaxAssyDaily = calcYMaxWithPad(chartData, ["ok_count", "ng_count", "total"]);
    const yMaxAssyMixed  = calcYMaxWithPad(chartDataAvP, ["actual", "planned"]);
  
    // 清理 + 分群 + 正規化到 100%
    const cleanedNgReasons = cleanNgReasons(ng_reasons || []);
    const { categories: ngCategories, subsByCategory } = groupNgReasonsByCategory(cleanedNgReasons);
  
    return (
      <AnimatePresence mode="wait">
        <motion.div key="assembly" {...pageTransition} className="space-y-6">
  
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="Total Output" value={summary.total} icon={<Factory size={24} className="text-blue-600" />} trend={summary.trend} color="blue" delay={0} />
            <StatCard title="OK Units" value={summary.ok_count} icon={<Target size={24} className="text-green-600" />} color="green" delay={0.1} />
            <StatCard title="NG Units" value={`${summary.ng_count}${summary.fixed_count > 0 ? ` (${summary.fixed_count} Fixed)` : ''}`} icon={<AlertCircle size={24} className="text-red-600" />} color="red" delay={0.2} />
            <StatCard title="Yield Rate" value={`${summary.yield_rate}%`} icon={<TrendingUp size={24} className="text-cyan-600" />} trend={summary.yield_trend} color="cyan" delay={0.3} />
          </div>
  
          <motion.div {...cardTransition} className="bg-gradient-to-br from-white to-gray-50 border border-gray-200 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
                  Assembly Output Trend
                </h3>
                <p className="text-sm text-gray-500 mt-1">Production performance monitoring</p>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-lg">
                <Info size={16} className="text-gray-600" />
                <span className="text-sm font-medium text-black">
                  {period === 'daily' ? 'Hourly View' : `${period.charAt(0).toUpperCase() + period.slice(1)} View`}
                </span>
              </div>
            </div>
  
            <ResponsiveContainer width="100%" height={400}>
              {period === 'daily' ? (
                <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                  <defs>
                    <linearGradient id="okGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.8} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.3} />
                    </linearGradient>
                    <linearGradient id="ngGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity={0.8} />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0.3} />
                    </linearGradient>
                    <linearGradient id="totalGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.8} />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.3} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="8 4" stroke="#e5e7eb" strokeOpacity={0.5} />
                  <XAxis 
                    dataKey="date" 
                    stroke="#6b7280"
                    tick={{ fontSize: 12, fill: '#000' }}
                    axisLine={{ stroke: '#e5e7eb' }}
                  />
                  <YAxis 
                    stroke="#6b7280"
                    tick={{ fontSize: 12, fill: '#000' }}
                    axisLine={{ stroke: '#e5e7eb' }}
                    domain={[0, () => yMaxAssyDaily]}
                  />
                  <Legend 
                    wrapperStyle={{ paddingTop: '20px' }}
                    iconType="circle"
                    formatter={(v) => <span style={{ color: '#000', fontWeight: 600, fontSize: 14 }}>{v}</span>}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                      border: '1px solid #e5e7eb',
                      borderRadius: '12px',
                      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
                    }}
                    labelStyle={{ color: '#000', fontWeight: 600 }}
                    itemStyle={{ color: '#000' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="ok_count" 
                    name="OK Units" 
                    stroke="#10b981" 
                    strokeWidth={3} 
                    dot={{ r: 5, fill: '#10b981', strokeWidth: 2, stroke: '#fff' }} 
                    activeDot={{ r: 7, stroke: '#10b981', strokeWidth: 2, fill: '#fff' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="ng_count" 
                    name="NG Units" 
                    stroke="#ef4444" 
                    strokeWidth={3} 
                    dot={{ r: 5, fill: '#ef4444', strokeWidth: 2, stroke: '#fff' }} 
                    activeDot={{ r: 7, stroke: '#ef4444', strokeWidth: 2, fill: '#fff' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="total" 
                    name="Total" 
                    stroke="#3b82f6" 
                    strokeWidth={2.5}
                    strokeDasharray="8 4"
                    dot={{ r: 4, fill: '#3b82f6' }}
                    activeDot={{ r: 6, stroke: '#3b82f6', strokeWidth: 2, fill: '#fff' }}
                  />
                </LineChart>
              ) : (
                <BarChart data={chartDataAvP} barGap={8} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                  <defs>
                    <linearGradient id="actualGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#06b6d4" stopOpacity={1} />
                      <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.7} />
                    </linearGradient>
                    <pattern id="plannedPattern" patternUnits="userSpaceOnUse" width="6" height="6">
                      <rect width="6" height="6" fill="#e5e7eb" />
                      <path d="M0,6 L6,0" stroke="#94a3b8" strokeWidth="1.5" opacity="0.5" />
                    </pattern>
                    <filter id="barShadow" x="-50%" y="-50%" width="200%" height="200%">
                      <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.1"/>
                    </filter>
                  </defs>
                  <CartesianGrid strokeDasharray="8 4" stroke="#e5e7eb" strokeOpacity={0.5} />
                  <XAxis 
                    dataKey="date" 
                    stroke="#6b7280"
                    tick={{ fontSize: 12, fill: '#000' }}
                    axisLine={{ stroke: '#e5e7eb' }}
                  />
                  <YAxis 
                    stroke="#6b7280"
                    tick={{ fontSize: 12, fill: '#000' }}
                    axisLine={{ stroke: '#e5e7eb' }}
                    domain={[0, () => yMaxAssyMixed]}
                  />
                  <Legend 
                    wrapperStyle={{ paddingTop: '20px' }}
                    iconType="rect"
                    formatter={(v) => <span style={{ color: '#000', fontWeight: 600, fontSize: 14 }}>{v}</span>}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                      border: '1px solid #e5e7eb',
                      borderRadius: '12px',
                      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
                    }}
                    labelStyle={{ color: '#000', fontWeight: 600 }}
                    itemStyle={{ color: '#000' }}
                  />
  
                  {/* Planned - 斜紋樣式 */}
                  <Bar 
                    dataKey="planned" 
                    name="Planned" 
                    fill="url(#plannedPattern)" 
                    radius={[10, 10, 0, 0]}
                  >
                    <LabelList
                      dataKey="planned"
                      position="top"
                      formatter={(value, entry) => entry?.payload?.achieved ? `⭐ ${value}` : `${value}`}
                      style={{ fill: '#000', fontWeight: 700, fontSize: 13 }}
                    />
                  </Bar>
  
                  {/* Actual - 漸變填充 */}
                  <Bar 
                    dataKey="actual" 
                    name="Actual" 
                    fill="url(#actualGradient)" 
                    radius={[10, 10, 0, 0]}
                    filter="url(#barShadow)"
                  >
                    <LabelList 
                      dataKey="actual" 
                      position="top" 
                      formatter={(v) => (v ? v.toLocaleString() : '')} 
                      style={{ fill: '#000', fontWeight: 700, fontSize: 13 }} 
                    />
                  </Bar>
                </BarChart>
              )}
            </ResponsiveContainer>
          </motion.div>
  
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {period !== 'daily' && (
              <motion.div {...cardTransition} className="bg-gradient-to-br from-white to-gray-50 border border-gray-200 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow">
                <div className="mb-8">
                  <h3 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
                    Yield Trend Analysis
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">Production quality performance over time</p>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={chartData
                    .filter(d => d.total && d.total > 0) // 過濾掉沒有數據的天數
                    .map(d => ({ ...d, yield: Math.round((d.ok_count / d.total) * 100) }))
                  }>
                    <defs>
                      <linearGradient id="yieldGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.05}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="8 4" stroke="#e5e7eb" strokeOpacity={0.5} />
                    <XAxis 
                      dataKey="date" 
                      stroke="#6b7280"
                      tick={{ fontSize: 12, fill: '#000' }}
                      axisLine={{ stroke: '#e5e7eb' }}
                    />
                    <YAxis 
                      stroke="#6b7280" 
                      unit="%" 
                      domain={[80,100]}
                      tick={{ fontSize: 12, fill: '#000' }}
                      axisLine={{ stroke: '#e5e7eb' }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                        border: '1px solid #e5e7eb',
                        borderRadius: '12px',
                        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
                      }}
                      labelStyle={{ color: '#000', fontWeight: 600 }}
                      itemStyle={{ color: '#000' }}
                    />
                    <Legend 
                      wrapperStyle={{ paddingTop: '20px' }}
                      iconType="rect"
                      formatter={(v) => <span style={{ color: '#000', fontWeight: 600, fontSize: 14 }}>{v}</span>}
                    />
                    
                    <Area 
                      type="monotone" 
                      dataKey="yield" 
                      stroke="#10b981" 
                      strokeWidth={3}
                      fill="url(#yieldGradient)"
                      name="Yield %"
                      dot={{ r: 5, fill: "#10b981", strokeWidth: 2, stroke: '#fff' }}
                      activeDot={{ r: 7, stroke: '#10b981', strokeWidth: 2, fill: '#fff' }}
                    />
                    
                    <Line 
                      type="monotone" 
                      dataKey={() => 95} 
                      name="Target" 
                      stroke="#ef4444" 
                      strokeWidth={2.5}
                      strokeDasharray="10 5"
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
                
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center">
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Average</p>
                      <p className="text-lg font-bold text-black mt-1">
                        {(() => {
                          const validData = chartData.filter(d => d.total && d.total > 0);
                          if (validData.length === 0) return '—';
                          const avgYield = validData.reduce((acc, d) => acc + (d.ok_count / d.total) * 100, 0) / validData.length;
                          return `${Math.round(avgYield)}%`;
                        })()}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Target</p>
                      <p className="text-lg font-bold text-black mt-1">95%</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Latest</p>
                      <p className="text-lg font-bold text-black mt-1">
                        {(() => {
                          const validData = chartData.filter(d => d.total && d.total > 0);
                          if (validData.length === 0) return '—';
                          const latestData = validData[validData.length - 1];
                          return `${Math.round((latestData.ok_count / latestData.total) * 100)}%`;
                        })()}
                      </p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
  
            {activeLine === "assembly" && ngCategories.length > 0 && (
              <motion.div {...cardTransition} className="bg-gradient-to-br from-white to-gray-50 border border-gray-200 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow">
                <div className="mb-8">
                  <h3 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
                    NG Reasons Distribution
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">Quality issue breakdown analysis</p>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <defs>
                      <filter id="pieShadow" x="-50%" y="-50%" width="200%" height="200%">
                        <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.15"/>
                      </filter>
                    </defs>
                    <Pie
                      data={ngCategories}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={90}
                      dataKey="value"
                      nameKey="name"
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(1)}%`}
                      labelStyle={{ fontSize: 12, fill: '#000', fontWeight: 600 }}
                      filter="url(#pieShadow)"
                    >
                      {ngCategories.map((_, i) => (
                        <Cell key={i} fill={COLORS.pieColors[i % COLORS.pieColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                        border: '1px solid #e5e7eb',
                        borderRadius: '12px',
                        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
                      }}
                      labelStyle={{ color: '#000', fontWeight: 600 }}
                      itemStyle={{ color: '#000' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
  
                {/* 子項拆解（顯示主類下 Low/High 等細分比例） */}
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <p className="text-sm font-semibold text-black mb-4">Detailed Breakdown</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {ngCategories.map(cat => {
                      const subs = (subsByCategory[cat.name] || []).filter(s => s.name !== "—");
                      return (
                        <div key={cat.name} className="bg-white rounded-lg p-3 border border-gray-200">
                          <div className="font-semibold text-black text-sm">
                            {cat.name}: {cat.value.toFixed(1)}%
                          </div>
                          {subs.length > 0 && (
                            <div className="text-gray-600 text-xs mt-1">
                              {subs.map((s, idx) => (
                                <span key={idx}>
                                  {s.name} {s.value.toFixed(1)}%{idx < subs.length - 1 ? " · " : ""}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    );
  };

  /* 其他分析維持原樣（30 天趨勢/比較） */
  const renderTrendAnalysis = () => {
    if (!trendData) return null;
    const { trend_data, statistics } = trendData;
    const data = trend_data.map(i => ({ date: format(parseISO(i.production_date), "MM/dd"), ...i }));
    
    return (
      <motion.div {...cardTransition} className="bg-gradient-to-br from-white to-gray-50 border border-gray-200 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h3 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
              30-Day Production Trend Analysis
            </h3>
            <p className="text-sm text-gray-500 mt-1">Long-term production performance insights</p>
          </div>
          <div className="flex items-center gap-6 bg-white border border-gray-200 rounded-xl px-5 py-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-blue-500 rounded-full shadow-sm"></div>
              <span className="text-sm font-medium text-black">Actual</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-amber-500 rounded-full shadow-sm"></div>
              <span className="text-sm font-medium text-black">7-Day Avg</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-12 h-1 bg-gradient-to-r from-gray-400 to-gray-600 rounded"></div>
              <span className="text-sm font-medium text-black">Trend</span>
            </div>
          </div>
        </div>
        
        <div className="mb-6 grid grid-cols-3 gap-4">
          <div className="relative overflow-hidden bg-white rounded-xl border border-gray-200 p-5 transition-all hover:shadow-md">
            <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-2">Average</p>
            <p className="text-2xl font-bold text-black">{Math.round(statistics.mean).toLocaleString()}</p>
            <p className="text-xs text-gray-400 mt-1">units/day</p>
          </div>
          <div className="relative overflow-hidden bg-white rounded-xl border border-gray-200 p-5 transition-all hover:shadow-md">
            <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-2">Std Dev</p>
            <p className="text-2xl font-bold text-black">{Math.round(statistics.std_dev).toLocaleString()}</p>
            <p className="text-xs text-gray-400 mt-1">±variance</p>
          </div>
          <div className="relative overflow-hidden bg-white rounded-xl border border-gray-200 p-5 transition-all hover:shadow-md">
            <div className={`absolute top-0 left-0 w-1 h-full ${
              statistics.trend_direction === 'increasing' ? 'bg-green-500' : 
              statistics.trend_direction === 'decreasing' ? 'bg-red-500' : 
              'bg-gray-400'
            }`}></div>
            <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-2">Trend</p>
            <div className="flex items-center gap-2">
              <span className={`text-2xl font-bold ${
                statistics.trend_direction === 'increasing' ? 'text-green-600' : 
                statistics.trend_direction === 'decreasing' ? 'text-red-600' : 
                'text-black'
              }`}>
                {statistics.trend_direction === 'increasing' ? '↑' : 
                 statistics.trend_direction === 'decreasing' ? '↓' : '→'}
              </span>
              <span className="text-2xl font-bold text-black">
                {statistics.trend_direction.charAt(0).toUpperCase() + statistics.trend_direction.slice(1)}
              </span>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <defs>
                <linearGradient id="totalGradientClean" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05}/>
                </linearGradient>
                <filter id="areaGlow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                  <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
              </defs>
              <CartesianGrid 
                strokeDasharray="0" 
                stroke="#f3f4f6" 
                vertical={false}
              />
              <XAxis 
                dataKey="date" 
                stroke="#9ca3af"
                tick={{ fontSize: 11, fill: '#000' }}
                axisLine={{ stroke: '#e5e7eb', strokeWidth: 1 }}
                tickLine={{ stroke: '#e5e7eb' }}
              />
              <YAxis 
                stroke="#9ca3af"
                tick={{ fontSize: 11, fill: '#000' }}
                axisLine={{ stroke: '#e5e7eb', strokeWidth: 1 }}
                tickLine={{ stroke: '#e5e7eb' }}
                tickFormatter={(value) => value.toLocaleString()}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'rgba(255, 255, 255, 0.98)',
                  border: 'none',
                  borderRadius: '12px',
                  boxShadow: '0 10px 40px rgba(0, 0, 0, 0.12)'
                }}
                labelStyle={{ color: '#000', fontWeight: 600, marginBottom: 8 }}
                itemStyle={{ color: '#000', fontSize: 13 }}
                cursor={{ stroke: '#3b82f6', strokeWidth: 1, strokeDasharray: '5 5' }}
              />
              <Legend 
                wrapperStyle={{ paddingTop: '30px' }}
                iconType="line"
                iconSize={18}
                formatter={(v) => <span style={{ color: '#000', fontWeight: 600, fontSize: 13 }}>{v}</span>}
              />
              
              <Area 
                type="monotone" 
                dataKey="total" 
                name="Daily Output" 
                stroke="#3b82f6" 
                fill="url(#totalGradientClean)" 
                strokeWidth={3}
                dot={{ r: 0 }}
                activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2, fill: '#3b82f6', filter: 'url(#areaGlow)' }}
              />
              
              {data.some(d => d.moving_avg) && (
                <Line 
                  type="monotone" 
                  dataKey="moving_avg" 
                  name="7-Day Average" 
                  stroke="#f59e0b" 
                  strokeWidth={2.5} 
                  strokeDasharray="0"
                  dot={false}
                  opacity={0.9}
                />
              )}
              
              {data.some(d => d.trend_line) && (
                <Line 
                  type="monotone" 
                  dataKey="trend_line" 
                  name="Trend Line" 
                  stroke="#6b7280" 
                  strokeWidth={2} 
                  strokeDasharray="8 6" 
                  dot={false}
                  opacity={0.6}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        
        {/* 新增底部洞察區 */}
        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg p-3 border border-gray-100">
            <p className="text-xs text-gray-500 mb-1">Peak Day</p>
            <p className="text-sm font-semibold text-black">
              {data.reduce((max, d) => d.total > max.total ? d : max).date}
            </p>
            <p className="text-xs text-gray-400">
              {Math.max(...data.map(d => d.total)).toLocaleString()} units
            </p>
          </div>
          <div className="bg-white rounded-lg p-3 border border-gray-100">
            <p className="text-xs text-gray-500 mb-1">Low Day</p>
            <p className="text-sm font-semibold text-black">
              {data.reduce((min, d) => d.total < min.total ? d : min).date}
            </p>
            <p className="text-xs text-gray-400">
              {Math.min(...data.map(d => d.total)).toLocaleString()} units
            </p>
          </div>
          <div className="bg-white rounded-lg p-3 border border-gray-100">
            <p className="text-xs text-gray-500 mb-1">Total Output</p>
            <p className="text-sm font-semibold text-black">
              {data.reduce((sum, d) => sum + d.total, 0).toLocaleString()}
            </p>
            <p className="text-xs text-gray-400">30 days</p>
          </div>
          <div className="bg-white rounded-lg p-3 border border-gray-100">
            <p className="text-xs text-gray-500 mb-1">Consistency</p>
            <p className="text-sm font-semibold text-black">
              {statistics.std_dev && statistics.mean 
                ? `${Math.round((1 - statistics.std_dev / statistics.mean) * 100)}%` 
                : '—'}
            </p>
            <p className="text-xs text-gray-400">stability score</p>
          </div>
        </div>
      </motion.div>
    );
  };

  const renderHourlyDistribution = () => {
    if (!hourlyData) return null;
    const { distribution_data, summary } = hourlyData;
    
    // 找出最高和平均值用於視覺化
    const maxValue = Math.max(...distribution_data.map(d => d.average || 0));
    const avgValue = distribution_data.reduce((sum, d) => sum + (d.average || 0), 0) / distribution_data.length;
    
    return (
      <motion.div {...cardTransition} className="bg-gradient-to-br from-white to-gray-50 border border-gray-200 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h3 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
              Hourly Production Pattern
            </h3>
            <p className="text-sm text-gray-500 mt-1">24-hour production distribution analysis</p>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg">
              <Info size={16} className="text-gray-500" />
              <span className="text-sm font-medium text-black">
                Period: {hourlyData.period ? hourlyData.period.charAt(0).toUpperCase() + hourlyData.period.slice(1) : 'Weekly'}
              </span>
            </div>
            {summary && (
              <div className="flex items-center gap-4">
                <div className="px-4 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                  <span className="text-xs text-gray-500 block">Peak Hour</span>
                  <span className="text-sm font-bold text-black">{summary.peak_hour}</span>
                </div>
                <div className="px-4 py-2 bg-green-50 border border-green-200 rounded-lg">
                  <span className="text-xs text-gray-500 block">Total Output</span>
                  <span className="text-sm font-bold text-black">{summary.total_production?.toLocaleString()}</span>
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* 新增統計指標卡片 */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider">Morning</span>
              <span className="text-xs px-2 py-1 bg-orange-100 text-orange-700 rounded-full">6-12</span>
            </div>
            <p className="text-lg font-bold text-black">
              {Math.round(distribution_data.slice(6, 12).reduce((sum, d) => sum + (d.average || 0), 0) / 6).toLocaleString()}
            </p>
            <p className="text-xs text-gray-400 mt-1">avg/hour</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider">Afternoon</span>
              <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full">12-18</span>
            </div>
            <p className="text-lg font-bold text-black">
              {Math.round(distribution_data.slice(12, 18).reduce((sum, d) => sum + (d.average || 0), 0) / 6).toLocaleString()}
            </p>
            <p className="text-xs text-gray-400 mt-1">avg/hour</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider">Evening</span>
              <span className="text-xs px-2 py-1 bg-indigo-100 text-indigo-700 rounded-full">18-24</span>
            </div>
            <p className="text-lg font-bold text-black">
              {Math.round(distribution_data.slice(18, 24).reduce((sum, d) => sum + (d.average || 0), 0) / 6).toLocaleString()}
            </p>
            <p className="text-xs text-gray-400 mt-1">avg/hour</p>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider">Night</span>
              <span className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded-full">0-6</span>
            </div>
            <p className="text-lg font-bold text-black">
              {Math.round(distribution_data.slice(0, 6).reduce((sum, d) => sum + (d.average || 0), 0) / 6).toLocaleString()}
            </p>
            <p className="text-xs text-gray-400 mt-1">avg/hour</p>
          </div>
        </div>
        
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={distribution_data} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
              <defs>
                <linearGradient id="barGradientHourly" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={1} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.6} />
                </linearGradient>
                <linearGradient id="barGradientPeak" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.6} />
                </linearGradient>
                <linearGradient id="barGradientLow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#e5e7eb" stopOpacity={1} />
                  <stop offset="100%" stopColor="#e5e7eb" stopOpacity={0.8} />
                </linearGradient>
                <filter id="barShadowHourly" x="-50%" y="-50%" width="200%" height="200%">
                  <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.1"/>
                </filter>
              </defs>
              
              <CartesianGrid 
                strokeDasharray="0" 
                stroke="#f3f4f6" 
                vertical={false}
              />
              
              <XAxis 
                dataKey="hour" 
                stroke="#9ca3af"
                tick={{ fontSize: 11, fill: '#000' }}
                axisLine={{ stroke: '#e5e7eb', strokeWidth: 1 }}
                tickLine={{ stroke: '#e5e7eb' }}
                label={{ 
                  value: 'Hour of Day', 
                  position: 'insideBottom', 
                  offset: -40,
                  style: { fill: '#6b7280', fontSize: 12, fontWeight: 500 }
                }}
              />
              
              <YAxis 
                stroke="#9ca3af"
                tick={{ fontSize: 11, fill: '#000' }}
                axisLine={{ stroke: '#e5e7eb', strokeWidth: 1 }}
                tickLine={{ stroke: '#e5e7eb' }}
                tickFormatter={(value) => value.toLocaleString()}
                label={{ 
                  value: 'Average Output', 
                  angle: -90, 
                  position: 'insideLeft',
                  style: { fill: '#6b7280', fontSize: 12, fontWeight: 500 }
                }}
              />
              
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'rgba(255, 255, 255, 0.98)',
                  border: 'none',
                  borderRadius: '12px',
                  boxShadow: '0 10px 40px rgba(0, 0, 0, 0.12)'
                }}
                labelStyle={{ color: '#000', fontWeight: 600, marginBottom: 8 }}
                itemStyle={{ color: '#000', fontSize: 13 }}
                cursor={{ fill: 'rgba(59, 130, 246, 0.05)' }}
                formatter={(value, name) => [value?.toLocaleString(), name]}
              />
              
              {/* 平均線 */}
              <ReferenceLine 
                y={avgValue} 
                stroke="#f59e0b" 
                strokeDasharray="8 4" 
                strokeWidth={2}
                label={{ 
                  value: `Avg: ${Math.round(avgValue).toLocaleString()}`, 
                  position: 'right',
                  style: { fill: '#f59e0b', fontWeight: 600, fontSize: 11 }
                }}
              />
              
              <Bar 
                dataKey="average" 
                name="Avg Output" 
                radius={[8, 8, 0, 0]}
                filter="url(#barShadowHourly)"
              >
                {distribution_data.map((entry, index) => {
                  const isMax = entry.average === maxValue;
                  const isLow = entry.average < avgValue * 0.5;
                  return (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={
                        isMax ? "url(#barGradientPeak)" :
                        isLow ? "url(#barGradientLow)" :
                        entry.average > 0 ? "url(#barGradientHourly)" : 
                        "#f3f4f6"
                      }
                    />
                  );
                })}
                <LabelList 
                  dataKey="average" 
                  position="top"
                  formatter={(value) => value > maxValue * 0.8 ? value.toLocaleString() : ''}
                  style={{ fill: '#000', fontSize: 10, fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          
          {/* 圖表底部說明 */}
          <div className="flex items-center justify-center gap-6 mt-4 pt-4 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-gradient-to-b from-green-500 to-green-400 rounded"></div>
              <span className="text-xs text-gray-600">Peak Hours</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-gradient-to-b from-blue-500 to-blue-400 rounded"></div>
              <span className="text-xs text-gray-600">Normal Hours</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-gradient-to-b from-gray-300 to-gray-200 rounded"></div>
              <span className="text-xs text-gray-600">Low Activity</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-0.5 bg-amber-500"></div>
              <span className="text-xs text-gray-600">Daily Average</span>
            </div>
          </div>
        </div>
      </motion.div>
    );
  };

  const renderComparisonAnalysis = () => {
    if (!comparisonData) return null;
    const { comparison_data, statistics } = comparisonData;
    const data = comparison_data.map(i => ({ date: format(parseISO(i.date), "MM/dd"), ...i }));
    
    // 計算額外的統計數據
    const moduleAvg = Math.round(data.reduce((acc, d) => acc + (d.module || 0), 0) / data.length);
    const assemblyAvg = Math.round(data.reduce((acc, d) => acc + (d.assembly || 0), 0) / data.length);
    const maxEfficiency = Math.max(...data.map(d => d.efficiency || 0));
    const minEfficiency = Math.min(...data.map(d => d.efficiency || 0));
    
    return (
      <motion.div {...cardTransition} className="bg-gradient-to-br from-white to-gray-50 border border-gray-200 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h3 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
              Module vs Assembly Comparison
            </h3>
            <p className="text-sm text-gray-500 mt-1">Production line synchronization analysis</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg">
              <Info size={16} className="text-gray-500" />
              <span className="text-sm font-medium text-black">
                Period: {comparisonData.period ? comparisonData.period.charAt(0).toUpperCase() + comparisonData.period.slice(1) : 'Weekly'}
              </span>
            </div>
            <div className="px-5 py-2 bg-gradient-to-r from-blue-50 to-blue-100 border border-blue-200 rounded-lg">
              <span className="text-xs text-gray-600 block">Correlation</span>
              <span className="text-sm font-bold text-black">{statistics.correlation.toFixed(3)}</span>
            </div>
            <div className="px-5 py-2 bg-gradient-to-r from-green-50 to-green-100 border border-green-200 rounded-lg">
              <span className="text-xs text-gray-600 block">Avg Efficiency</span>
              <span className="text-sm font-bold text-black">{statistics.avg_efficiency}%</span>
            </div>
          </div>
        </div>
        
        {/* 統計卡片區 */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="relative overflow-hidden bg-white rounded-xl border border-gray-200 p-4">
            <div className="absolute top-0 left-0 w-1 h-full bg-cyan-500"></div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider">Module</span>
              <div className="w-2 h-2 bg-cyan-500 rounded-full animate-pulse"></div>
            </div>
            <p className="text-xl font-bold text-black">{moduleAvg.toLocaleString()}</p>
            <p className="text-xs text-gray-400 mt-1">avg units/period</p>
          </div>
          
          <div className="relative overflow-hidden bg-white rounded-xl border border-gray-200 p-4">
            <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider">Assembly</span>
              <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></div>
            </div>
            <p className="text-xl font-bold text-black">{assemblyAvg.toLocaleString()}</p>
            <p className="text-xs text-gray-400 mt-1">avg units/period</p>
          </div>
          
          <div className="relative overflow-hidden bg-white rounded-xl border border-gray-200 p-4">
            <div className="absolute top-0 left-0 w-1 h-full bg-green-500"></div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider">Peak Eff.</span>
              <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <p className="text-xl font-bold text-black">{maxEfficiency}%</p>
            <p className="text-xs text-gray-400 mt-1">maximum</p>
          </div>
          
          <div className="relative overflow-hidden bg-white rounded-xl border border-gray-200 p-4">
            <div className="absolute top-0 left-0 w-1 h-full bg-red-500"></div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider">Min Eff.</span>
              <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
              </svg>
            </div>
            <p className="text-xl font-bold text-black">{minEfficiency}%</p>
            <p className="text-xs text-gray-400 mt-1">minimum</p>
          </div>
        </div>
        
        {/* 圖表區域 */}
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <ResponsiveContainer width="100%" height={380}>
            <ComposedChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <defs>
                <linearGradient id="moduleGradientComp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#06b6d4" stopOpacity={1} />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.6} />
                </linearGradient>
                <linearGradient id="assemblyGradientComp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity={1} />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.6} />
                </linearGradient>
                <linearGradient id="efficiencyGradient" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.8} />
                  <stop offset="50%" stopColor="#10b981" stopOpacity={1} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.8} />
                </linearGradient>
                <filter id="barShadowComp" x="-50%" y="-50%" width="200%" height="200%">
                  <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.15"/>
                </filter>
                <filter id="lineGlow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                  <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
              </defs>
              
              <CartesianGrid 
                strokeDasharray="0" 
                stroke="#f3f4f6" 
                vertical={false}
              />
              
              <XAxis 
                dataKey="date" 
                stroke="#9ca3af"
                tick={{ fontSize: 11, fill: '#000' }}
                axisLine={{ stroke: '#e5e7eb', strokeWidth: 1 }}
                tickLine={{ stroke: '#e5e7eb' }}
              />
              
              <YAxis 
                yAxisId="left" 
                stroke="#9ca3af"
                tick={{ fontSize: 11, fill: '#000' }}
                axisLine={{ stroke: '#e5e7eb', strokeWidth: 1 }}
                tickLine={{ stroke: '#e5e7eb' }}
                tickFormatter={(value) => value.toLocaleString()}
                label={{ 
                  value: 'Production Units', 
                  angle: -90, 
                  position: 'insideLeft',
                  style: { fill: '#000', fontWeight: 600, fontSize: 12 }
                }}
              />
              
              <YAxis 
                yAxisId="right" 
                orientation="right" 
                stroke="#9ca3af"
                tick={{ fontSize: 11, fill: '#000' }}
                axisLine={{ stroke: '#e5e7eb', strokeWidth: 1 }}
                tickLine={{ stroke: '#e5e7eb' }}
                domain={[Math.min(80, minEfficiency - 5), Math.max(100, maxEfficiency + 5)]}
                label={{ 
                  value: 'Efficiency %', 
                  angle: 90, 
                  position: 'insideRight',
                  style: { fill: '#000', fontWeight: 600, fontSize: 12 }
                }}
              />
              
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'rgba(255, 255, 255, 0.98)',
                  border: 'none',
                  borderRadius: '12px',
                  boxShadow: '0 10px 40px rgba(0, 0, 0, 0.12)'
                }}
                labelStyle={{ color: '#000', fontWeight: 600, marginBottom: 8 }}
                itemStyle={{ color: '#000', fontSize: 13 }}
                cursor={{ fill: 'rgba(59, 130, 246, 0.05)' }}
                formatter={(value, name) => {
                  if (name === 'Efficiency %') return [`${value}%`, name];
                  return [value?.toLocaleString(), name];
                }}
              />
              
              <Legend 
                wrapperStyle={{ paddingTop: '30px' }}
                iconType="rect"
                iconSize={12}
                formatter={(v) => <span style={{ color: '#000', fontWeight: 600, fontSize: 13 }}>{v}</span>}
              />
              
              {/* 效率目標參考線 */}
              <ReferenceLine 
                yAxisId="right"
                y={95} 
                stroke="#ef4444" 
                strokeDasharray="8 4" 
                strokeWidth={1.5}
                label={{ 
                  value: 'Target 95%', 
                  position: 'right',
                  style: { fill: '#ef4444', fontWeight: 600, fontSize: 10 }
                }}
              />
              
              <Bar 
                yAxisId="left" 
                dataKey="module" 
                name="Module" 
                fill="url(#moduleGradientComp)"
                radius={[6, 6, 0, 0]}
                filter="url(#barShadowComp)"
                barSize={35}
              />
              
              <Bar 
                yAxisId="left" 
                dataKey="assembly" 
                name="Assembly" 
                fill="url(#assemblyGradientComp)"
                radius={[6, 6, 0, 0]}
                filter="url(#barShadowComp)"
                barSize={35}
              />
              
              <Line 
                yAxisId="right" 
                type="monotone" 
                dataKey="efficiency" 
                name="Efficiency %" 
                stroke="url(#efficiencyGradient)" 
                strokeWidth={3}
                filter="url(#lineGlow)"
                dot={{ r: 5, fill: "#10b981", strokeWidth: 2, stroke: '#fff' }}
                activeDot={{ r: 7, stroke: '#10b981', strokeWidth: 2, fill: '#fff' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
          
          {/* 圖表底部洞察 */}
          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div className="text-sm">
                  <span className="text-gray-500">Sync Rate:</span>
                  <span className="ml-2 font-bold text-black">
                    {Math.round(Math.abs(statistics.correlation) * 100)}%
                  </span>
                </div>
                <div className="text-sm">
                  <span className="text-gray-500">Gap:</span>
                  <span className="ml-2 font-bold text-black">
                    {Math.abs(moduleAvg - assemblyAvg).toLocaleString()} units
                  </span>
                </div>
              </div>
              <div className={`px-3 py-1 rounded-full text-xs font-semibold ${
                statistics.correlation > 0.8 ? 'bg-green-100 text-green-700' :
                statistics.correlation > 0.5 ? 'bg-yellow-100 text-yellow-700' :
                'bg-red-100 text-red-700'
              }`}>
                {statistics.correlation > 0.8 ? 'Excellent Sync' :
                 statistics.correlation > 0.5 ? 'Good Sync' :
                 'Needs Improvement'}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <motion.header initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
        <h1 className="text-4xl font-bold text-gray-800 mb-2 flex items-center justify-center gap-3">
          <BarChart3 className="w-10 h-10 text-blue-600"/>
          Production Analytics Dashboard
        </h1>
      </motion.header>

      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }} className="bg-white border border-gray-200 rounded-xl p-6 mb-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-gray-700">Production Line</label>
            <div className="relative flex gap-2 bg-gray-100 p-1 rounded-lg">
              <motion.div className="absolute inset-y-1 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-md" initial={false} animate={{ x: activeLine === "module" ? 0 : "100%", width: "50%" }} transition={{ type: "spring", stiffness: 300, damping: 30 }} />
              <button className={`relative z-10 px-4 py-2 rounded-md flex items-center gap-2 transition-colors ${activeLine === "module" ? "text-white" : "text-gray-600 hover:text-gray-800"}`} onClick={() => setActiveLine("module")}><Factory size={16}/> Module</button>
              <button className={`relative z-10 px-4 py-2 rounded-md flex items-center gap-2 transition-colors ${activeLine === "assembly" ? "text-white" : "text-gray-600 hover:text-gray-800"}`} onClick={() => setActiveLine("assembly")}><Package size={16}/> Assembly</button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-gray-700">Time Period</label>
            <div className="flex gap-2">
              {["daily", "weekly", "monthly"].map((p) => (
                <motion.button key={p} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                  className={`px-4 py-2 rounded-md transition-all ${period === p ? "bg-blue-600 text-white shadow-md" : "bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200"}`}
                  onClick={() => setPeriod(p)}>
                  {p === "daily" ? "Daily" : p === "weekly" ? "Weekly" : "Monthly"}
                </motion.button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-gray-700 flex items-center gap-1"><Calendar size={16}/> Target Date</label>
            <motion.input whileFocus={{ scale: 1.02 }} type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)}
              className="px-4 py-2 bg-gray-50 border border-gray-300 rounded-md text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              max={format(new Date(), "yyyy-MM-dd")}
            />
          </div>

          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            className="ml-auto px-6 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-md shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            onClick={loadProductionData} disabled={loading}>
            {loading ? (
              <>
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full" />
                <span>Loading...</span>
              </>
            ) : (
              <>
                <Activity size={16}/> <span>Refresh Data</span>
              </>
            )}
          </motion.button>
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

      <AnimatePresence mode="wait">
        {!loading && !error && (
          <motion.div key="content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
            {activeLine === "module" ? renderModuleCharts() : renderAssemblyCharts()}
            <div className="grid grid-cols-1 gap-6">
              {renderTrendAnalysis()}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {renderHourlyDistribution()}
                {renderComparisonAnalysis()}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {loading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center min-h-[400px]">
            <motion.div animate={{ scale: [1, 1.2, 1], rotate: [0, 180, 360] }} transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              className="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full" />
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="mt-4 text-gray-600">
              Loading production data...
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
