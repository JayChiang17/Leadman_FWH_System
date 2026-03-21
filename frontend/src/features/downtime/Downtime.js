/*  Downtime – features/downtime  */
import React, { useState, useEffect, useCallback, useRef } from "react";
import api from "../../services/api";
import FlipClockTimer from "../../components/FlipClockTimer";
import { useVirtualizer } from '@tanstack/react-virtual';
import * as XLSX from 'xlsx';

import Plot3D, { buildStationHourMatrix } from "../../components/Plot3D";
import { Bar, Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import DataLabels from "chartjs-plugin-datalabels";
import "./Downtime.css";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler, DataLabels);

// ===== Timezone & Date Utilities (Pacific locked) ====================
const PACIFIC_TZ = "America/Los_Angeles";

const partsFromDate = (date, timeZone = PACIFIC_TZ) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return map;
};

const toPacificLocalIsoSeconds = (msOrDate) => {
  const d = msOrDate instanceof Date ? msOrDate : new Date(msOrDate);
  const p = partsFromDate(d);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
};

const pacificTodayISODate = () => {
  const p = partsFromDate(new Date());
  return `${p.year}-${p.month}-${p.day}`;
};

const prevDayISO = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
};

const pacificLastNDaysISO = (n = 7) => {
  const days = new Array(n);
  let cur = pacificTodayISODate();
  for (let i = n - 1; i >= 0; i--) {
    days[i] = cur;
    cur = prevDayISO(cur);
  }
  return days;
};

// ===== Station Lists =================================================
const cellPositions = [
  "Battery Loading",
  "OSV",
  "Insulator Installation",
  "Cell Stacking",
  "End Plate and Steel Frame install",
  "Cell Pole/Laser Cleaning",
  "CCS Installation",
  "Busbar/laser Welding",
  "Weld Inspection and Cleaning",
  "EOL Inspection & Testing",
  "Install Heating Film",
  "Module Line Crane Lift",
];

const assemblyPositions = [
  "Remove Carton Cover",
  "Remove Front Cover",
  "Module Gluing",
  "Module Installation",
  "Install Single Boards",
  "Install Copper Bars",
  "Cable Organization",
  "Install Crossover Copper Bars",
  "Inspection Area",
  "AOI Inspection",
  "Install Front Cover",
  "Safety Test",
  "Function Test",
  "Pre-Box QC",
  "Install Carton Cover",
  "Final Packing",
];

const DOWNTIME_TYPES = ["Equipment", "Material", "Quality", "Personnel", "Other"];

const TYPE_COLORS = {
  Equipment: { bg: "rgba(239,68,68,0.1)",   color: "#dc2626", border: "rgba(239,68,68,0.3)"   },
  Material:  { bg: "rgba(245,158,11,0.1)",  color: "#d97706", border: "rgba(245,158,11,0.3)"  },
  Quality:   { bg: "rgba(8,145,178,0.1)",   color: "#0891b2", border: "rgba(8,145,178,0.3)"   },
  Personnel: { bg: "rgba(13,148,136,0.1)",  color: "#0d9488", border: "rgba(13,148,136,0.3)"  },
  Other:     { bg: "rgba(100,116,139,0.1)", color: "#64748b", border: "rgba(100,116,139,0.3)" },
};

const minToHHMM = (m) => {
  const mm = Math.round(m);
  return `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
};

const roundValue = (value) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.round(numberValue) : 0;
};

// ===== TypeBadge =======================================================
function TypeBadge({ type }) {
  const t = type || "Other";
  const c = TYPE_COLORS[t] || TYPE_COLORS.Other;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "0.28rem 0.6rem", borderRadius: "6px",
      fontSize: "0.72rem", fontWeight: 700,
      background: c.bg, color: c.color,
      border: `1.5px solid ${c.border}`,
      whiteSpace: "nowrap", letterSpacing: "0.02em",
    }}>
      {t}
    </span>
  );
}

// ===== DowntimeTimer ===================================================
const DowntimeTimer = React.memo(function DowntimeTimer({ line, station, startTs, onStart, onSubmit, onAlert }) {
  const [elapsed, setElapsed] = useState(0);
  const alertedRef = useRef(false);

  useEffect(() => {
    if (!startTs) { setElapsed(0); alertedRef.current = false; return; }
    const tick = () => {
      const sec = Math.floor((Date.now() - startTs) / 1000);
      setElapsed(sec);
      if (sec >= 600 && !alertedRef.current) { alertedRef.current = true; if (onAlert) onAlert(); }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startTs, onAlert]);

  return (
    <div className="dt-timer">
      <div className="dt-info">
        <p><strong>Line:</strong> {line === "cell" ? "Cell Line" : "Assembly Line"}</p>
        <p><strong>Station:</strong> {station}</p>
      </div>
      {startTs && (
        <div className="flip-timer-wrapper">
          <FlipClockTimer seconds={elapsed} />
        </div>
      )}
      <div className="dt-timer-btns">
        {startTs ? (
          <button className="dt-end-btn" onClick={onSubmit}>End &amp; Submit</button>
        ) : (
          <button onClick={onStart}>Start Timer</button>
        )}
      </div>
    </div>
  );
});

// ===== Chart data builders ============================================
const buildUPHVsDowntimeChartData = (production, downtimes, lineName) => {
  const safeProduction = Array.isArray(production) ? production : [];
  const safeDowntimes = Array.isArray(downtimes) ? downtimes : [];
  const targetLine = String(lineName || "").toLowerCase();
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00');

  const hourlyUPH = hours.map(hour => {
    const h = hour.substring(0, 2);
    const prodData = safeProduction.find(p => {
      const rawHour = p.hour ?? p.hr;
      if (rawHour === undefined || rawHour === null) return false;
      return String(rawHour).padStart(2, "0") === h;
    });
    return prodData ? roundValue(prodData.total) : 0;
  });

  const hourlyDowntime = hours.map(hour => {
    const h = parseInt(hour.substring(0, 2), 10);
    let totalMinutes = 0;
    safeDowntimes.forEach(dt => {
      if (String(dt.line || "").toLowerCase() !== targetLine) return;
      const startStr = dt.start_local || "";
      const endStr = dt.end_local || "";
      const startHour = parseInt(startStr.substring(11, 13), 10);
      const endHour = parseInt(endStr.substring(11, 13), 10);
      if (Number.isNaN(startHour) || Number.isNaN(endHour)) return;
      if (startHour <= h && h <= endHour) {
        if (startHour === endHour) {
          totalMinutes += Number(dt.duration_min) || 0;
        } else if (startHour === h) {
          const sm = parseInt(startStr.substring(14, 16), 10);
          if (!Number.isNaN(sm)) totalMinutes += (60 - sm);
        } else if (endHour === h) {
          const em = parseInt(endStr.substring(14, 16), 10);
          if (!Number.isNaN(em)) totalMinutes += em;
        } else {
          totalMinutes += 60;
        }
      }
    });
    return roundValue(totalMinutes);
  });

  return {
    labels: hours,
    datasets: [
      {
        type: 'line', label: 'UPH (pcs/h)', data: hourlyUPH,
        borderColor: '#0d9488', backgroundColor: 'rgba(13,148,136,0.08)',
        borderWidth: 2, tension: 0.4, fill: true,
        pointRadius: 3, pointHoverRadius: 5,
        pointBackgroundColor: '#0d9488', pointBorderColor: '#fff', pointBorderWidth: 2,
        yAxisID: 'y',
      },
      {
        type: 'bar', label: 'Downtime (min)', data: hourlyDowntime,
        backgroundColor: 'rgba(245,158,11,0.75)', borderColor: '#f59e0b',
        borderWidth: 1, borderRadius: 6, yAxisID: 'y1',
      },
    ],
  };
};

const processWeekDataByLine = (records) => {
  const days = pacificLastNDaysISO(7);
  const dailyData = {};
  days.forEach((d) => (dailyData[d] = { cell: 0, assembly: 0 }));
  records.forEach((r) => {
    const recordDate = r.start_local?.split(" ")[0];
    if (dailyData[recordDate]) {
      if (r.line === "cell") dailyData[recordDate].cell += r.duration_min;
      else if (r.line === "assembly") dailyData[recordDate].assembly += r.duration_min;
    }
  });
  const labels = days.map((d) => d.substring(5));
  const cellMinutes = days.map((d) => Math.round(dailyData[d].cell));
  const assemblyMinutes = days.map((d) => Math.round(dailyData[d].assembly));
  return {
    labels,
    datasets: [
      { label: "Cell Line", data: cellMinutes, backgroundColor: "rgba(239,68,68,0.8)", borderColor: "rgba(239,68,68,1)", borderWidth: 2, borderRadius: 6, barThickness: 28 },
      { label: "Assembly Line", data: assemblyMinutes, backgroundColor: "rgba(59,130,246,0.8)", borderColor: "rgba(59,130,246,1)", borderWidth: 2, borderRadius: 6, barThickness: 28 },
    ],
    hhmm: { cell: cellMinutes.map(minToHHMM), assembly: assemblyMinutes.map(minToHHMM) },
  };
};

const exportToExcel = (records) => {
  const exportData = records.map((r) => ({
    'ID': r.id,
    'Line': r.line === 'cell' ? 'Cell Line' : 'Assembly Line',
    'Station': r.station,
    'Type': r.downtime_type || 'Other',
    'Start Time': r.start_local,
    'End Time': r.end_local,
    'Duration (HH:MM)': minToHHMM(r.duration_min),
    'Duration (Minutes)': r.duration_min,
    'Modified By': r.modified_by || r.created_by || '-',
  }));
  const ws = XLSX.utils.json_to_sheet(exportData);
  ws['!cols'] = [{ wch: 8 }, { wch: 15 }, { wch: 30 }, { wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Downtime Records');
  XLSX.writeFile(wb, `Downtime_Records_${new Date().toISOString().split('T')[0]}.xlsx`);
};

// ============================================================================
export default function Downtime() {
  const [step, setStep] = useState(1);
  const [line, setLine] = useState("");
  const [station, setStation] = useState("");
  const [startTs, setStartTs] = useState(null);
  const [alert, setAlert] = useState(false);
  const [msg, setMsg] = useState("");

  // New UX state
  const [downtype, setDowntype] = useState("Other");
  const [stationSearch, setStationSearch] = useState("");
  const [todaySummary, setTodaySummary] = useState(null);
  const [chartsLoading, setChartsLoading] = useState(false);
  const [confirm, setConfirm] = useState({ open: false, title: "", body: "", onConfirm: null });

  // Chart state
  const [today, setToday] = useState({ labels: [], datasets: [], hhmm: [], lineInfo: [] });
  const [week, setWeek] = useState({ labels: [], datasets: [], hhmm: {} });
  const [uphVsDowntime, setUphVsDowntime] = useState({ labels: [], datasets: [] });
  const [uphVsDowntimeAssembly, setUphVsDowntimeAssembly] = useState({ labels: [], datasets: [] });
  const [uphEnabled, setUphEnabled] = useState(false);
  const [uphLoading, setUphLoading] = useState(false);
  const [maxDowntime, setMaxDowntime] = useState(0);
  const [surface3dData, setSurface3dData] = useState([]);
  const [surface3dLoading, setSurface3dLoading] = useState(false);

  const [records, setRecords] = useState([]);
  const [filteredRecords, setFilteredRecords] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [lineFilter, setLineFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");

  const parentRef = useRef(null);
  const uphCardRef = useRef(null);
  const uphLoadingRef = useRef(false);
  const handleTimerAlert = useCallback(() => setAlert(true), []);

  // ── Confirm helpers ───────────────────────────────────────────────
  const openConfirm = useCallback((title, body, onConfirm) => {
    setConfirm({ open: true, title, body, onConfirm });
  }, []);
  const closeConfirm = useCallback(() => {
    setConfirm({ open: false, title: "", body: "", onConfirm: null });
  }, []);

  // ── Auto-dismiss msg ──────────────────────────────────────────────
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(""), 4000);
    return () => clearTimeout(t);
  }, [msg]);

  // ── Data loaders ──────────────────────────────────────────────────
  const loadSummaries = useCallback(() => {
    api.get("downtime/summary/today").then((r) => {
      if (r.data.status === "success") {
        const stations = r.data.data || [];
        const labels = stations.map(s => s.station);
        const minutes = stations.map(s => s.total_minutes);
        const hhmm = stations.map(s => s.total_hhmm);
        const lineInfo = stations.map(s => s.line);
        setToday({
          labels, hhmm, lineInfo,
          datasets: [{
            label: "Downtime",
            data: minutes,
            backgroundColor: lineInfo.map(l => l === "cell" ? "rgba(239,68,68,0.8)" : "rgba(59,130,246,0.8)"),
            borderColor: lineInfo.map(l => l === "cell" ? "rgba(239,68,68,1)" : "rgba(59,130,246,1)"),
            borderWidth: 2, borderRadius: 6, barThickness: 28,
          }],
        });

        // KPI cards
        if (r.data.summary) {
          const s = r.data.summary;
          const maxSingle = stations.reduce((acc, st) => Math.max(acc, st.max_duration || 0), 0);
          const top = stations[0];
          setTodaySummary({
            total: s.total_downtime_hhmm || "00:00",
            totalMin: s.total_downtime || 0,
            events: s.total_events || 0,
            longest: minToHHMM(maxSingle),
            topStation: top ? top.station : "—",
            topTime: top ? top.total_hhmm : "",
            topLine: top ? top.line : null,
          });
        }
      }
    }).catch(err => console.error("Error loading today summary:", err));

    api.get("downtime/summary/week").then((r) => {
      if (r.data.status === "success") setWeek(processWeekDataByLine(r.data.records || []));
    }).catch(err => console.error("Error loading week summary:", err));
  }, []);

  const loadRecords = useCallback(() => {
    api.get("downtime/list").then((r) => {
      if (r.data.status === "success") {
        setRecords(r.data.records || []);
        setFilteredRecords(r.data.records || []);
      }
    }).catch(err => console.error("Error loading records:", err));
  }, []);

  const loadSurface3D = useCallback(() => {
    setSurface3dLoading(true);
    api.get("downtime/3d/surface", { params: { days: 30 } })
      .then((r) => {
        if (r.data.status === "success") setSurface3dData(r.data.data || []);
      })
      .catch((e) => console.error("3D surface load error:", e))
      .finally(() => setSurface3dLoading(false));
  }, []);

  useEffect(() => {
    if (uphEnabled) return;
    const node = uphCardRef.current;
    if (!node || typeof IntersectionObserver === "undefined") { setUphEnabled(true); return; }
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) { setUphEnabled(true); observer.disconnect(); } },
      { rootMargin: "200px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [uphEnabled]);

  const loadUPHVsDowntime = useCallback(async () => {
    if (!uphEnabled || uphLoadingRef.current) return;
    uphLoadingRef.current = true;
    setUphLoading(true);
    try {
      const todayDate = pacificTodayISODate();
      const [moduleRes, assemblyRes, downtimeRes] = await Promise.all([
        api.get("production-charts/module/production", { params: { period: "daily", target_date: todayDate } }),
        api.get("production-charts/assembly/production", { params: { period: "daily", target_date: todayDate } }),
        api.get("downtime/events/today"),
      ]);
      const moduleData = moduleRes?.data || {};
      const assemblyData = assemblyRes?.data || {};
      const downtimeData = downtimeRes?.data || {};
      const moduleProduction = moduleData.production_data || moduleData.production || moduleData.productionData || moduleData.data || [];
      const assemblyProduction = assemblyData.production_data || assemblyData.production || assemblyData.productionData || assemblyData.data || [];
      const downtimes = downtimeData.records || downtimeData.data || [];
      const downtimeOk = downtimeData.status ? downtimeData.status === "success" : Array.isArray(downtimes);
      if (!downtimeOk) return;
      const moduleOk = moduleData.status ? moduleData.status === "success" : Array.isArray(moduleProduction);
      const cellChartData = moduleOk ? buildUPHVsDowntimeChartData(moduleProduction, downtimes, "cell") : null;
      const assemblyOk = assemblyData.status ? assemblyData.status === "success" : Array.isArray(assemblyProduction);
      const assemblyChartData = assemblyOk ? buildUPHVsDowntimeChartData(assemblyProduction, downtimes, "assembly") : null;
      let globalMax = 0;
      [cellChartData, assemblyChartData].forEach(cd => {
        const d = cd?.datasets?.find(ds => ds.label === 'Downtime (min)');
        if (d?.data) globalMax = Math.max(globalMax, ...d.data);
      });
      setMaxDowntime(Math.max(60, Math.ceil(globalMax / 10) * 10));
      if (cellChartData) setUphVsDowntime(cellChartData);
      if (assemblyChartData) setUphVsDowntimeAssembly(assemblyChartData);
    } catch (err) {
      console.error("Failed to load UPH vs Downtime data:", err);
    } finally {
      uphLoadingRef.current = false;
      setUphLoading(false);
    }
  }, [uphEnabled]);

  useEffect(() => { loadSummaries(); loadRecords(); loadSurface3D(); }, [loadSummaries, loadRecords, loadSurface3D]);
  useEffect(() => { if (uphEnabled) loadUPHVsDowntime(); }, [uphEnabled, loadUPHVsDowntime]);

  // Filter logic
  useEffect(() => {
    let filtered = [...records];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(r => r.id.toString().includes(q) || r.station.toLowerCase().includes(q) || r.line.toLowerCase().includes(q));
    }
    if (lineFilter !== "all") filtered = filtered.filter(r => r.line === lineFilter);
    if (dateFilter !== "all") {
      const todayStr = pacificTodayISODate();
      if (dateFilter === "today") filtered = filtered.filter(r => r.start_local?.startsWith(todayStr));
      else if (dateFilter === "week") {
        const weekDays = pacificLastNDaysISO(7);
        filtered = filtered.filter(r => weekDays.includes(r.start_local?.split(" ")[0]));
      }
    }
    setFilteredRecords(filtered);
  }, [searchQuery, lineFilter, dateFilter, records]);

  // Virtual scrolling
  const rowVirtualizer = useVirtualizer({
    count: filteredRecords.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 5,
  });

  // ── Chart options ──────────────────────────────────────────────────
  const TICK_FS = 11;
  const LEGEND_FS = 11;
  const GRID_COLOR = "#f1f5f9";

  const getTodayChartOptions = () => ({
    responsive: true, maintainAspectRatio: false,
    plugins: {
      datalabels: { anchor: 'end', align: 'top', formatter: (v) => v > 0 ? minToHHMM(v) : '', font: { size: 10, weight: '600', family: "'Inter', sans-serif" }, color: '#334155' },
      legend: {
        display: true, position: "top", align: 'end',
        labels: {
          generateLabels: () => [
            { text: "Cell Line", fillStyle: "rgba(239,68,68,0.85)", strokeStyle: "rgba(239,68,68,1)", pointStyle: "rectRounded", lineWidth: 0, borderRadius: 4 },
            { text: "Assembly Line", fillStyle: "rgba(59,130,246,0.85)", strokeStyle: "rgba(59,130,246,1)", pointStyle: "rectRounded", lineWidth: 0, borderRadius: 4 },
          ],
          usePointStyle: true, padding: 16,
          font: { size: LEGEND_FS, weight: '500', family: "'Inter', sans-serif" }, color: '#64748b',
        },
      },
      tooltip: {
        enabled: true, backgroundColor: 'rgba(15,23,42,0.95)',
        titleFont: { size: 12, weight: '600', family: "'Inter', sans-serif" },
        bodyFont: { size: 11, family: "'Inter', sans-serif" },
        padding: 12, cornerRadius: 8, displayColors: true,
        borderColor: 'rgba(148,163,184,0.2)', borderWidth: 1, boxPadding: 4, usePointStyle: true,
        callbacks: {
          title: (ctx) => ctx[0].label,
          label: (ctx) => {
            const ln = today.lineInfo?.[ctx.dataIndex] === "cell" ? "Cell Line" : "Assembly Line";
            return `${ln}: ${today.hhmm?.[ctx.dataIndex] || minToHHMM(ctx.parsed.y)}`;
          },
          afterLabel: (ctx) => {
            const m = Math.round(ctx.parsed.y);
            const tot = ctx.dataset.data.reduce((a, b) => a + b, 0);
            if (tot === 0) return `${m} minutes`;
            return [`${m} minutes`, `${((ctx.parsed.y / tot) * 100).toFixed(1)}% of total`];
          },
        },
      },
    },
    scales: {
      y: { beginAtZero: true, grid: { color: GRID_COLOR, lineWidth: 1, drawTicks: false }, border: { display: false }, ticks: { callback: minToHHMM, font: { size: TICK_FS, weight: '500', family: "'Inter', sans-serif" }, color: '#64748b', padding: 8 } },
      x: { grid: { display: false }, border: { display: false }, ticks: { padding: 8, font: { size: TICK_FS, weight: '500', family: "'Inter', sans-serif" }, color: '#64748b', maxRotation: 45, minRotation: 0 } },
    },
    interaction: { mode: 'index', intersect: false },
    elements: { bar: { borderRadius: 6, borderSkipped: false } },
  });

  const getWeekChartOptions = () => ({
    responsive: true, maintainAspectRatio: false,
    plugins: {
      datalabels: { anchor: 'end', align: 'top', formatter: (v) => v > 0 ? minToHHMM(v) : '', font: { size: 10, weight: '600', family: "'Inter', sans-serif" }, color: '#334155' },
      legend: { display: true, position: "top", align: 'end', labels: { usePointStyle: true, pointStyle: 'rectRounded', padding: 16, font: { size: LEGEND_FS, weight: '500', family: "'Inter', sans-serif" }, color: '#64748b', boxWidth: 10, boxHeight: 10 } },
      tooltip: {
        enabled: true, backgroundColor: 'rgba(15,23,42,0.95)',
        titleFont: { size: 12, weight: '600', family: "'Inter', sans-serif" },
        bodyFont: { size: 11, family: "'Inter', sans-serif" },
        padding: 12, cornerRadius: 8, displayColors: true,
        borderColor: 'rgba(148,163,184,0.2)', borderWidth: 1, boxPadding: 4, usePointStyle: true,
        callbacks: {
          title: (ctx) => `Date: ${ctx[0].label}`,
          label: (ctx) => {
            const isCell = ctx.dataset.label.includes("Cell");
            const hhmm = isCell ? week.hhmm?.cell?.[ctx.dataIndex] : week.hhmm?.assembly?.[ctx.dataIndex];
            const m = Math.round(ctx.parsed.y);
            return [`${ctx.dataset.label}: ${hhmm || minToHHMM(ctx.parsed.y)}`, `${m} minutes`];
          },
        },
      },
    },
    scales: {
      y: { beginAtZero: true, stacked: false, grid: { color: GRID_COLOR, lineWidth: 1, drawTicks: false }, border: { display: false }, ticks: { callback: minToHHMM, font: { size: TICK_FS, weight: '500', family: "'Inter', sans-serif" }, color: '#64748b', padding: 8 } },
      x: { stacked: false, grid: { display: false }, border: { display: false }, ticks: { padding: 8, font: { size: TICK_FS, weight: '500', family: "'Inter', sans-serif" }, color: '#64748b' }, categoryPercentage: 0.7, barPercentage: 0.85 },
    },
    interaction: { mode: 'index', intersect: false },
    elements: { bar: { borderRadius: 6, borderSkipped: false } },
  });

  const getUPHVsDowntimeChartOptions = () => ({
    responsive: true, maintainAspectRatio: false,
    plugins: {
      datalabels: { display: false },
      legend: { display: true, position: "top", align: 'end', labels: { usePointStyle: true, pointStyle: 'circle', padding: 16, font: { size: LEGEND_FS, weight: '500', family: "'Inter', sans-serif" }, color: '#64748b', boxWidth: 10, boxHeight: 10 } },
      tooltip: {
        enabled: true, backgroundColor: 'rgba(15,23,42,0.95)',
        titleFont: { size: 12, weight: '600', family: "'Inter', sans-serif" },
        bodyFont: { size: 11, family: "'Inter', sans-serif" },
        padding: 12, cornerRadius: 8, displayColors: true,
        borderColor: 'rgba(148,163,184,0.2)', borderWidth: 1, boxPadding: 4, usePointStyle: true,
        callbacks: {
          title: (ctx) => `Time: ${ctx[0].label}`,
          label: (ctx) => {
            const label = ctx.dataset.label || '';
            const rv = roundValue(ctx.parsed.y);
            if (label.includes('UPH')) return `${label}: ${rv} pcs/h`;
            if (label.includes('Downtime')) return `${label}: ${rv} min (${minToHHMM(rv)})`;
            return `${label}: ${rv}`;
          },
        },
      },
    },
    scales: {
      y: { type: 'linear', display: true, position: 'left', beginAtZero: true, title: { display: true, text: 'UPH (pcs/h)', font: { size: 10, weight: '600', family: "'Inter', sans-serif" }, color: '#0d9488' }, grid: { color: GRID_COLOR, lineWidth: 1, drawTicks: false }, border: { display: false }, ticks: { callback: roundValue, font: { size: TICK_FS, weight: '500', family: "'Inter', sans-serif" }, color: '#0d9488', padding: 8 } },
      y1: { type: 'linear', display: true, position: 'right', beginAtZero: true, max: maxDowntime || 60, title: { display: true, text: 'Downtime (min)', font: { size: 10, weight: '600', family: "'Inter', sans-serif" }, color: '#f59e0b' }, grid: { drawOnChartArea: false }, border: { display: false }, ticks: { callback: minToHHMM, font: { size: TICK_FS, weight: '500', family: "'Inter', sans-serif" }, color: '#f59e0b', padding: 8, stepSize: maxDowntime > 120 ? 30 : (maxDowntime > 60 ? 20 : 10) } },
      x: { grid: { display: false }, border: { display: false }, ticks: { padding: 8, font: { size: TICK_FS, weight: '500', family: "'Inter', sans-serif" }, color: '#64748b', maxRotation: 45, minRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
    },
    interaction: { mode: 'index', intersect: false },
  });

  // ── Flow handlers ──────────────────────────────────────────────────
  const reset = () => {
    setStep(1); setLine(""); setStation(""); setStartTs(null);
    setAlert(false); setDowntype("Other"); setStationSearch("");
  };

  const chooseLine = (l) => { setLine(l); setStep(2); setStationSearch(""); };

  const chooseStation = (s) => { setStation(s); setStep(3); setStartTs(null); setAlert(false); };

  const startTimer = () => { setAlert(false); setStartTs(Date.now()); };

  const handleBackFromTimer = () => {
    if (startTs) {
      openConfirm(
        "Cancel Timer?",
        "The timer is running. Going back will discard this downtime session.",
        () => { closeConfirm(); setStep(2); setStation(""); setStartTs(null); setAlert(false); }
      );
    } else {
      setStep(2); setStation("");
    }
  };

  const refreshCharts = () => {
    setChartsLoading(true);
    loadSummaries();
    loadRecords();
    loadUPHVsDowntime();
    loadSurface3D();
    setTimeout(() => setChartsLoading(false), 1500);
  };

  const submit = async () => {
    if (!startTs) return;
    try {
      const endTime = Date.now();
      const durationMin = Math.round((endTime - startTs) / 1000 / 60);
      await api.post("downtime", {
        line, station,
        start_time: toPacificLocalIsoSeconds(startTs),
        end_time: toPacificLocalIsoSeconds(endTime),
        downtime_type: downtype,
      });
      setMsg(`✅ ${line === "cell" ? "Cell Line" : "Assembly Line"} – ${station} – ${durationMin} min`);
      reset();
      refreshCharts();
    } catch (e) {
      setMsg(`❌ ${e.response?.data?.message || e.message}`);
    }
  };

  const saveEdit = (u) => {
    openConfirm(
      "Save Changes",
      `Update Record #${u.id}?\n${u.line === "cell" ? "Cell Line" : "Assembly Line"} — ${u.station}`,
      async () => {
        closeConfirm();
        try {
          const response = await api.put(`downtime/${u.id}`, {
            line: u.line, station: u.station,
            start_time: u.start_local, end_time: u.end_local,
            downtime_type: u.downtime_type || "Other",
          });
          if (response.data.status === 'success') {
            setMsg(`✅ Record #${u.id} updated — ${minToHHMM(response.data.duration_min || 0)}`);
          }
          setEditing(null);
          refreshCharts();
        } catch (e) {
          setMsg(`❌ ${e.response?.data?.message || e.message}`);
        }
      }
    );
  };

  const del = (id) => {
    const record = records.find(r => r.id === id);
    openConfirm(
      "Delete Record",
      record
        ? `Delete Record #${id}?\n${record.line === "cell" ? "Cell Line" : "Assembly Line"} — ${record.station}\nStart: ${record.start_local}\n\nThis cannot be undone.`
        : `Delete Record #${id}? This cannot be undone.`,
      async () => {
        closeConfirm();
        try {
          await api.delete(`downtime/${id}`);
          setMsg(`✅ Record #${id} deleted`);
          refreshCharts();
        } catch (e) {
          setMsg(`❌ ${e.response?.data?.message || e.message}`);
        }
      }
    );
  };

  // ─────────────────────────────────────────────────────────────────
  return (
    <div className={`dt-container ${alert ? "dt-flash" : ""}`}>
      <h1 className="text-xl md:text-2xl font-semibold text-ink-primary mb-3">Downtime Log</h1>

      {/* ── Step Breadcrumb ── */}
      <div className="dt-breadcrumb">
        {["Select Line", "Select Station", "Timer"].map((label, i) => (
          <React.Fragment key={label}>
            <div className={`dt-bc-step${step === i + 1 ? " dt-bc-active" : step > i + 1 ? " dt-bc-done" : ""}`}>
              <span className="dt-bc-num">{i + 1}</span>
              <span className="dt-bc-label">{label}</span>
            </div>
            {i < 2 && <span className="dt-bc-sep">›</span>}
          </React.Fragment>
        ))}
      </div>

      {/* ── Step 1: Line ── */}
      {step === 1 && (
        <div className="dt-line-select">
          <button onClick={() => chooseLine("cell")}>Cell Line</button>
          <button onClick={() => chooseLine("assembly")}>Assembly Line</button>
        </div>
      )}

      {/* ── Step 2: Station ── */}
      {step === 2 && (
        <div className="dt-step-wrapper">
          <div className="dt-step-nav">
            <button className="dt-back-btn" onClick={() => { setStep(1); setLine(""); setStationSearch(""); }}>
              ← Back
            </button>
            <input
              className="dt-station-search"
              type="text"
              placeholder={`Search ${(line === "cell" ? cellPositions : assemblyPositions).length} stations…`}
              value={stationSearch}
              onChange={e => setStationSearch(e.target.value)}
              autoFocus
            />
          </div>
          <div className="dt-station-btns">
            {(line === "cell" ? cellPositions : assemblyPositions)
              .filter(p => p.toLowerCase().includes(stationSearch.toLowerCase()))
              .map((p) => (
                <button key={p} onClick={() => chooseStation(p)}>{p}</button>
              ))}
            {(line === "cell" ? cellPositions : assemblyPositions)
              .filter(p => p.toLowerCase().includes(stationSearch.toLowerCase())).length === 0 && (
              <p className="dt-search-empty">No stations match "{stationSearch}"</p>
            )}
          </div>
        </div>
      )}

      {/* ── Step 3: Timer ── */}
      {step === 3 && (
        <div className="dt-step-wrapper">
          <button className="dt-back-btn" onClick={handleBackFromTimer}>← Back</button>
          <div className="dt-type-selector">
            <span className="dt-type-label">Downtime Type</span>
            {DOWNTIME_TYPES.map(t => (
              <button
                key={t}
                className={`dt-type-chip${downtype === t ? " dt-type-chip-active" : ""}`}
                style={downtype === t ? { background: TYPE_COLORS[t].bg, color: TYPE_COLORS[t].color, borderColor: TYPE_COLORS[t].border } : {}}
                onClick={() => setDowntype(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <DowntimeTimer
            line={line} station={station} startTs={startTs}
            onStart={startTimer} onSubmit={submit} onAlert={handleTimerAlert}
          />
        </div>
      )}

      {/* ── Notification ── */}
      {msg && (
        <div className={`dt-msg${msg.startsWith("✅") ? " dt-msg-ok" : " dt-msg-err"}`}>
          {msg}
        </div>
      )}

      {/* ── KPI Summary Cards ── */}
      {todaySummary && (
        <div className="dt-kpi-grid">
          <div className="dt-kpi-card">
            <p className="dt-kpi-label">Total Downtime Today</p>
            <p className="dt-kpi-value">{todaySummary.total}</p>
            <p className="dt-kpi-sub">{Math.round(todaySummary.totalMin)} min total</p>
          </div>
          <div className="dt-kpi-card">
            <p className="dt-kpi-label">Incidents</p>
            <p className="dt-kpi-value">{todaySummary.events}</p>
            <p className="dt-kpi-sub">events today</p>
          </div>
          <div className="dt-kpi-card">
            <p className="dt-kpi-label">Longest Single</p>
            <p className="dt-kpi-value">{todaySummary.longest}</p>
            <p className="dt-kpi-sub">HH:MM</p>
          </div>
          <div className="dt-kpi-card">
            <p className="dt-kpi-label">Top Station</p>
            <p className="dt-kpi-value dt-kpi-station" title={todaySummary.topStation}>
              {todaySummary.topStation}
            </p>
            <p className="dt-kpi-sub">
              {todaySummary.topTime && <span>{todaySummary.topTime} · </span>}
              <span className={`dt-kpi-line-tag ${todaySummary.topLine || ""}`}>
                {todaySummary.topLine === "cell" ? "Cell" : todaySummary.topLine === "assembly" ? "Assembly" : ""}
              </span>
            </p>
          </div>
        </div>
      )}

      {/* ── Charts Section ── */}
      <div className="downtime-charts-section">
        <div className={`downtime-charts-grid${chartsLoading ? " charts-refreshing" : ""}`}>

          {/* Today's Downtime Chart */}
          <div className="downtime-card">
            <div className="downtime-card-header">
              <div className="downtime-header-content">
                <h3>Today's Downtime</h3>
                <p>By station</p>
              </div>
              <button onClick={() => setModalOpen(true)} className="downtime-edit-btn">
                Edit Records
              </button>
            </div>
            <div className="downtime-chart-container">
              <Bar data={today} options={getTodayChartOptions()} />
            </div>
          </div>

          {/* Past 7 Days Chart */}
          <div className="downtime-card">
            <div className="downtime-card-header">
              <div className="downtime-header-content">
                <h3>Past 7 Days</h3>
                <p>Trend analysis</p>
              </div>
            </div>
            <div className="downtime-chart-container">
              {week.datasets && week.datasets.length > 0 ? (
                <Bar data={week} options={getWeekChartOptions()} />
              ) : (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                  <p>No downtime data for the past 7 days</p>
                </div>
              )}
            </div>
          </div>

          {/* UPH vs Downtime Correlation */}
          <div className="downtime-card downtime-card-full uph-correlation-card" ref={uphCardRef}>
            <div className="downtime-card-header">
              <div className="downtime-header-content" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(16,185,129,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0d9488" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                  </svg>
                </div>
                <div>
                  <h3>UPH vs Downtime Correlation</h3>
                  <p>Production rate vs downtime analysis — Today</p>
                </div>
              </div>
            </div>
            <div className="uph-dual-charts">
              <div className="uph-chart-block">
                <div className="uph-chart-label">
                  <span className="uph-label-dot cell-dot"></span>
                  <span className="uph-label-text">Cell Line</span>
                  <span style={{ marginLeft: 'auto', fontSize: '0.6875rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Hourly</span>
                </div>
                <div className="uph-chart-wrapper">
                  {uphVsDowntime.datasets?.length > 0 && !uphLoading ? (
                    <Line data={uphVsDowntime} options={getUPHVsDowntimeChartOptions()} />
                  ) : (
                    <div className="chart-skeleton">
                      <div className="skeleton-header"></div>
                      <div className="skeleton-bars">
                        {[...Array(5)].map((_, i) => <div key={i} className="skeleton-bar"></div>)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="uph-chart-block">
                <div className="uph-chart-label">
                  <span className="uph-label-dot assembly-dot"></span>
                  <span className="uph-label-text">Assembly Line</span>
                  <span style={{ marginLeft: 'auto', fontSize: '0.6875rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Hourly</span>
                </div>
                <div className="uph-chart-wrapper">
                  {uphVsDowntimeAssembly.datasets?.length > 0 && !uphLoading ? (
                    <Line data={uphVsDowntimeAssembly} options={getUPHVsDowntimeChartOptions()} />
                  ) : (
                    <div className="chart-skeleton">
                      <div className="skeleton-header"></div>
                      <div className="skeleton-bars">
                        {[...Array(5)].map((_, i) => <div key={i} className="skeleton-bar"></div>)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 3D Downtime Heat Map */}
          <div className="downtime-card downtime-card-full">
            <div className="downtime-card-header">
              <div className="downtime-header-content" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(16,185,129,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0d9488" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                  </svg>
                </div>
                <div>
                  <h3>3D Downtime Heat Map</h3>
                  <p>Station × Hour-of-Day — past 30 days · drag to rotate</p>
                </div>
              </div>
            </div>
            <div style={{ padding: '0 1rem 1rem' }}>
              {surface3dLoading ? (
                <div style={{ height: 460, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1e2437', borderRadius: 8, border: '1px solid #2e3650' }}>
                  <div style={{ textAlign: 'center', color: '#94a3b8' }}>
                    <div className="animate-spin" style={{ width: 28, height: 28, border: '3px solid #2e3650', borderTopColor: '#0d9488', borderRadius: '50%', margin: '0 auto 0.5rem' }} />
                    <p style={{ fontSize: '0.8125rem' }}>Building 3D surface…</p>
                  </div>
                </div>
              ) : surface3dData.length === 0 ? (
                <div style={{ height: 460, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1e2437', borderRadius: 8, border: '1px solid #2e3650', color: '#94a3b8', flexDirection: 'column', gap: '0.5rem' }}>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                  <p style={{ fontSize: '0.875rem', fontWeight: 600 }}>No downtime data in the past 30 days</p>
                </div>
              ) : (() => {
                const { z, x, y } = buildStationHourMatrix(surface3dData);
                return (
                  <Plot3D
                    title="Downtime Minutes: Station × Hour (Past 30 Days)"
                    xTitle="Hour of Day"
                    yTitle="Station"
                    zTitle="Total Min"
                    height={460}
                    data={[{
                      type: "surface",
                      z, x, y,
                      colorscale: [
                        [0,   "#f0fdf4"],
                        [0.2, "#6ee7b7"],
                        [0.5, "#0d9488"],
                        [0.8, "#f59e0b"],
                        [1,   "#ef4444"],
                      ],
                      contours: {
                        z: { show: true, usecolormap: true, highlightcolor: "#0d9488", project: { z: true } }
                      },
                      hovertemplate: "<b>%{y}</b><br>Hour: %{x}<br>Total: <b>%{z} min</b><extra></extra>",
                    }]}
                  />
                );
              })()}
            </div>
          </div>

        </div>
      </div>

      {/* ── Records Modal ── */}
      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 className="modal-title">Downtime Records</h2>
                <p className="modal-subtitle">View, edit, and export all downtime entries</p>
              </div>
              <button className="modal-close-btn" onClick={() => setModalOpen(false)} aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            <div className="modal-controls">
              <div className="modal-controls-left">
                <input type="text" className="modal-search-input" placeholder="Search by ID, Station, or Line"
                  value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                <select className="modal-filter-select" value={lineFilter} onChange={(e) => setLineFilter(e.target.value)}>
                  <option value="all">All Lines</option>
                  <option value="cell">Cell Line</option>
                  <option value="assembly">Assembly Line</option>
                </select>
                <select className="modal-filter-select" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
                  <option value="all">All Time</option>
                  <option value="today">Today</option>
                  <option value="week">Past 7 Days</option>
                </select>
              </div>
              <div className="modal-controls-right">
                <span className="modal-count-badge">{filteredRecords.length} / {records.length}</span>
                <button className="modal-export-btn" onClick={() => exportToExcel(filteredRecords)}>
                  Export Excel
                </button>
              </div>
            </div>

            <div ref={parentRef} className="modal-table-wrapper">
              <table className="modal-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Line</th>
                    <th>Station</th>
                    <th>Type</th>
                    <th>Start Time</th>
                    <th>End Time</th>
                    <th>Duration</th>
                    <th>Modified By</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="modal-table-spacer" aria-hidden="true">
                    <td colSpan={9} style={{ height: `${rowVirtualizer.getTotalSize()}px` }}></td>
                  </tr>
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const record = filteredRecords[virtualRow.index];
                    const isEditing = editing?.id === record.id;
                    return (
                      <tr
                        key={virtualRow.key}
                        className={isEditing ? 'editing-row' : ''}
                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}
                      >
                        {isEditing ? (
                          <>
                            <td className="td-id">{record.id}</td>
                            <td>
                              <select className="modal-select" value={editing.line}
                                onChange={(e) => setEditing({ ...editing, line: e.target.value })}>
                                <option value="cell">Cell Line</option>
                                <option value="assembly">Assembly Line</option>
                              </select>
                            </td>
                            <td>
                              <input type="text" className="modal-input" value={editing.station}
                                onChange={(e) => setEditing({ ...editing, station: e.target.value })} />
                            </td>
                            <td>
                              <select className="modal-select" value={editing.downtime_type || "Other"}
                                onChange={(e) => setEditing({ ...editing, downtime_type: e.target.value })}>
                                {DOWNTIME_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </td>
                            <td>
                              <input type="datetime-local" className="modal-input" value={editing.start_local}
                                onChange={(e) => setEditing({ ...editing, start_local: e.target.value })} />
                            </td>
                            <td>
                              <input type="datetime-local" className="modal-input" value={editing.end_local}
                                onChange={(e) => setEditing({ ...editing, end_local: e.target.value })} />
                            </td>
                            <td><span className="duration-badge">{minToHHMM(record.duration_min)}</span></td>
                            <td className="user-text">{record.modified_by || record.created_by || '-'}</td>
                            <td className="td-actions">
                              <div className="action-buttons">
                                <button className="btn-save" onClick={() => saveEdit(editing)}>Save</button>
                                <button className="btn-cancel" onClick={() => setEditing(null)}>Cancel</button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="td-id">{record.id}</td>
                            <td>
                              <span className={`line-badge ${record.line}`}>
                                {record.line === 'cell' ? 'Cell Line' : 'Assembly Line'}
                              </span>
                            </td>
                            <td className="station-name">{record.station}</td>
                            <td><TypeBadge type={record.downtime_type} /></td>
                            <td className="datetime-text">{record.start_local}</td>
                            <td className="datetime-text">{record.end_local}</td>
                            <td><span className="duration-badge">{minToHHMM(record.duration_min)}</span></td>
                            <td className="user-text">{record.modified_by || record.created_by || '-'}</td>
                            <td className="td-actions">
                              <div className="action-buttons">
                                <button className="btn-edit" onClick={() => setEditing({
                                  id: record.id, line: record.line, station: record.station,
                                  downtime_type: record.downtime_type || "Other",
                                  start_local: record.start_local_edit, end_local: record.end_local_edit,
                                })}>Edit</button>
                                <button className="btn-delete" onClick={() => del(record.id)}>Delete</button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {filteredRecords.length === 0 && (
              <div className="modal-empty-state">
                <p className="modal-empty-title">No Records Found</p>
                <p className="modal-empty-text">Try adjusting your search or filter criteria</p>
              </div>
            )}

            <div className="modal-footer">
              <p className="modal-footer-text">
                Click <strong>Edit</strong> to modify a record · Total {records.length} record{records.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm Dialog ── */}
      {confirm.open && (
        <div className="modal-overlay dt-confirm-overlay" onClick={closeConfirm}>
          <div className="dt-confirm-dialog" onClick={e => e.stopPropagation()}>
            <div className="dt-confirm-icon">⚠️</div>
            <h3 className="dt-confirm-title">{confirm.title}</h3>
            <p className="dt-confirm-body" style={{ whiteSpace: "pre-line" }}>{confirm.body}</p>
            <div className="dt-confirm-actions">
              <button className="dt-confirm-cancel" onClick={closeConfirm}>Cancel</button>
              <button className="dt-confirm-ok" onClick={confirm.onConfirm}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
