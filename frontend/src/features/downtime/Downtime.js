/*  Downtime – features/downtime  */
import React, { useState, useEffect, useCallback, useRef } from "react";
import api from "../../services/api";
import FlipClockTimer from "../../components/FlipClockTimer";
import { useVirtualizer } from '@tanstack/react-virtual';
import * as XLSX from 'xlsx';

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

// ===== 時區與日期工具（鎖 Pacific） ==========================================
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
  return map; // {year,month,day,hour,minute,second}
};

// 用於提交 API：回傳「YYYY-MM-DDTHH:mm:ss」(Pacific local, 無時區資訊)
const toPacificLocalIsoSeconds = (msOrDate) => {
  const d = msOrDate instanceof Date ? msOrDate : new Date(msOrDate);
  const p = partsFromDate(d);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
};

// 取「今天」(Pacific) 的 YYYY-MM-DD
const pacificTodayISODate = () => {
  const p = partsFromDate(new Date());
  return `${p.year}-${p.month}-${p.day}`;
};

// 從某個 ISO(YYYY-MM-DD) 算前一天（純曆法）
const prevDayISO = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
};

// 取最近 n 天（含今天, Pacific）陣列：最舊→最新
const pacificLastNDaysISO = (n = 7) => {
  const days = new Array(n);
  let cur = pacificTodayISODate();
  for (let i = n - 1; i >= 0; i--) {
    days[i] = cur;
    cur = prevDayISO(cur);
  }
  return days;
};

// ===== 小工具 ===============================================================
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

const minToHHMM = (m) => {
  const mm = Math.round(m);
  return `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
};

const roundValue = (value) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.round(numberValue) : 0;
};

const DowntimeTimer = React.memo(function DowntimeTimer({
  line,
  station,
  startTs,
  onStart,
  onSubmit,
  onAlert,
}) {
  const [elapsed, setElapsed] = useState(0);
  const alertedRef = useRef(false);

  useEffect(() => {
    if (!startTs) {
      setElapsed(0);
      alertedRef.current = false;
      return;
    }

    const tick = () => {
      const sec = Math.floor((Date.now() - startTs) / 1000);
      setElapsed(sec);
      if (sec >= 600 && !alertedRef.current) {
        alertedRef.current = true;
        if (onAlert) onAlert();
      }
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startTs, onAlert]);

  return (
    <div className="dt-timer">
      <div className="dt-info">
        <p>
          <strong>Line:</strong> {line}
        </p>
        <p>
          <strong>Station:</strong> {station}
        </p>
      </div>
      {startTs && (
        <div className="flip-timer-wrapper">
          <FlipClockTimer seconds={elapsed} />
        </div>
      )}
      <div className="dt-timer-btns">
        {startTs ? (
          <button className="dt-end-btn" onClick={onSubmit}>
            End &amp; Submit
          </button>
        ) : (
          <button onClick={onStart}>Start</button>
        )}
      </div>
    </div>
  );
});

// ===== Downtime Types Configuration ==========================================
const _DOWNTIME_TYPES = {
  'Breakdown': { color: '#EF4444', label: 'Breakdown' },
  'Changeover': { color: '#F59E0B', label: 'Changeover' },
  'Material Shortage': { color: '#0891B2', label: 'Material Shortage' },
  'Maintenance': { color: '#10B981', label: 'Maintenance' },
  'Other': { color: '#6B7280', label: 'Other' }
};

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
      const key = String(rawHour).padStart(2, "0");
      return key === h;
    });
    return prodData ? roundValue(prodData.total) : 0;
  });

  const hourlyDowntime = hours.map(hour => {
    const h = parseInt(hour.substring(0, 2), 10);
    let totalMinutes = 0;

    safeDowntimes.forEach(dt => {
      const lineValue = String(dt.line || "").toLowerCase();
      if (lineValue !== targetLine) return;

      const startStr = dt.start_local || "";
      const endStr = dt.end_local || "";
      const startHour = parseInt(startStr.substring(11, 13), 10);
      const endHour = parseInt(endStr.substring(11, 13), 10);

      if (Number.isNaN(startHour) || Number.isNaN(endHour)) return;

      if (startHour <= h && h <= endHour) {
        if (startHour === endHour) {
          totalMinutes += Number(dt.duration_min) || 0;
        } else if (startHour === h) {
          const startMin = parseInt(startStr.substring(14, 16), 10);
          if (!Number.isNaN(startMin)) totalMinutes += (60 - startMin);
        } else if (endHour === h) {
          const endMin = parseInt(endStr.substring(14, 16), 10);
          if (!Number.isNaN(endMin)) totalMinutes += endMin;
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
        type: 'line',
        label: 'UPH (pcs/h)',
        data: hourlyUPH,
        borderColor: '#0d9488',
        backgroundColor: 'rgba(13, 148, 136, 0.08)',
        borderWidth: 2,
        tension: 0.4,
        fill: true,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: '#0d9488',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointHoverBackgroundColor: '#0f766e',
        pointHoverBorderColor: '#ffffff',
        yAxisID: 'y',
      },
      {
        type: 'bar',
        label: 'Downtime (min)',
        data: hourlyDowntime,
        backgroundColor: 'rgba(245, 158, 11, 0.75)',
        borderColor: '#f59e0b',
        borderWidth: 1,
        borderRadius: 6,
        yAxisID: 'y1',
      }
    ]
  };
};

// ===== 最近 7 天（依 Pacific 曆法天） ========================================
const processWeekDataByLine = (records) => {
  const days = pacificLastNDaysISO(7); // oldest → newest (YYYY-MM-DD in Pacific)

  const dailyData = {};
  days.forEach((d) => (dailyData[d] = { cell: 0, assembly: 0 }));

  records.forEach((r) => {
    const recordDate = r.start_local?.split(" ")[0]; // DB 已存 Pacific local "YYYY-MM-DD HH:MM:SS"
    if (dailyData[recordDate]) {
      if (r.line === "cell") dailyData[recordDate].cell += r.duration_min;
      else if (r.line === "assembly") dailyData[recordDate].assembly += r.duration_min;
    } else {
    }
  });


  const labels = days.map((d) => d.substring(5));
  const cellMinutes = days.map((d) => Math.round(dailyData[d].cell));
  const assemblyMinutes = days.map((d) => Math.round(dailyData[d].assembly));


  return {
    labels,
    datasets: [
      {
        label: "Cell Line",
        data: cellMinutes,
        backgroundColor: "rgba(239, 68, 68, 0.8)",
        borderColor: "rgba(239, 68, 68, 1)",
        borderWidth: 2,
        borderRadius: 6,
        barThickness: 28,
      },
      {
        label: "Assembly Line",
        data: assemblyMinutes,
        backgroundColor: "rgba(59, 130, 246, 0.8)",
        borderColor: "rgba(59, 130, 246, 1)",
        borderWidth: 2,
        borderRadius: 6,
        barThickness: 28,
      },
    ],
    hhmm: {
      cell: cellMinutes.map((m) => minToHHMM(m)),
      assembly: assemblyMinutes.map((m) => minToHHMM(m)),
    },
  };
};

// ===== Excel Export Function ========================================
const exportToExcel = (records) => {
  const exportData = records.map((r) => ({
    'ID': r.id,
    'Line': r.line === 'cell' ? 'Cell Line' : 'Assembly Line',
    'Station': r.station,
    'Start Time': r.start_local,
    'End Time': r.end_local,
    'Duration (HH:MM)': minToHHMM(r.duration_min),
    'Duration (Minutes)': r.duration_min,
    'Modified By': r.modified_by || r.created_by || '-',
  }));

  const ws = XLSX.utils.json_to_sheet(exportData);

  const colWidths = [
    { wch: 8 },
    { wch: 15 },
    { wch: 30 },
    { wch: 20 },
    { wch: 20 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
  ];
  ws['!cols'] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Downtime Records');

  const filename = `Downtime_Records_${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(wb, filename);
};

// ============================================================================

export default function Downtime() {
  const [step, setStep] = useState(1);
  const [line, setLine] = useState("");
  const [station, setStation] = useState("");
  const [startTs, setStartTs] = useState(null);
  const [alert, setAlert] = useState(false);
  const [msg, setMsg] = useState("");

  // 圖表狀態
  const [today, setToday] = useState({ labels: [], datasets: [], hhmm: [], lineInfo: [] });
  const [week, setWeek] = useState({ labels: [], datasets: [], hhmm: {} });
  const [uphVsDowntime, setUphVsDowntime] = useState({ labels: [], datasets: [] });
  const [uphVsDowntimeAssembly, setUphVsDowntimeAssembly] = useState({ labels: [], datasets: [] });
  const [uphEnabled, setUphEnabled] = useState(false);
  const [uphLoading, setUphLoading] = useState(false);
  const [maxDowntime, setMaxDowntime] = useState(0); // 用於統一兩個圖表的 downtime 刻度

  const [records, setRecords] = useState([]);
  const [filteredRecords, setFilteredRecords] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [lineFilter, setLineFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");

  // Virtual scrolling
  const parentRef = useRef(null);
  const uphCardRef = useRef(null);
  const uphLoadingRef = useRef(false);
  const handleTimerAlert = useCallback(() => setAlert(true), []);

  const loadSummaries = useCallback(() => {
    // Load today's summary
    api.get("downtime/summary/today").then((r) => {
      if (r.data.status === "success") {
        const stations = r.data.data || [];
        const labels = stations.map(s => s.station);
        const minutes = stations.map(s => s.total_minutes);
        const hhmm = stations.map(s => s.total_hhmm);
        const lineInfo = stations.map(s => s.line);

        const backgroundColors = lineInfo.map(l =>
          l === "cell" ? "rgba(239, 68, 68, 0.8)" : "rgba(59, 130, 246, 0.8)"
        );
        const borderColors = lineInfo.map(l =>
          l === "cell" ? "rgba(239, 68, 68, 1)" : "rgba(59, 130, 246, 1)"
        );

        setToday({
          labels,
          datasets: [{
            label: "Downtime",
            data: minutes,
            backgroundColor: backgroundColors,
            borderColor: borderColors,
            borderWidth: 2,
            borderRadius: 6,
            barThickness: 28,
          }],
          hhmm,
          lineInfo
        });
      }
    }).catch(err => {
      console.error("Error loading today summary:", err);
    });

    // Load week summary
    api.get("downtime/summary/week").then((r) => {
      if (r.data.status === "success") {
        const weekData = processWeekDataByLine(r.data.records || []);
        setWeek(weekData);
      }
    }).catch(err => {
      console.error("Error loading week summary:", err);
    });
  }, []);

  const loadRecords = useCallback(() => {
    api.get("downtime/list").then((r) => {
      if (r.data.status === "success") {
        setRecords(r.data.records || []);
        setFilteredRecords(r.data.records || []);
      }
    }).catch(err => {
      console.error("Error loading records:", err);
    });
  }, []);

  useEffect(() => {
    if (uphEnabled) return;
    const node = uphCardRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setUphEnabled(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0] && entries[0].isIntersecting) {
          setUphEnabled(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [uphEnabled]);

  // Load UPH vs Downtime integrated data
  const loadUPHVsDowntime = useCallback(async () => {
    if (!uphEnabled || uphLoadingRef.current) return;
    uphLoadingRef.current = true;
    setUphLoading(true);
    try {
      const today = pacificTodayISODate();

      const [moduleRes, assemblyRes, downtimeRes] = await Promise.all([
        api.get("production-charts/module/production", {
          params: { period: "daily", target_date: today }
        }),
        api.get("production-charts/assembly/production", {
          params: { period: "daily", target_date: today }
        }),
        api.get("downtime/events/today")
      ]);

      const moduleData = moduleRes?.data || {};
      const assemblyData = assemblyRes?.data || {};
      const downtimeData = downtimeRes?.data || {};

      const moduleProduction =
        moduleData.production_data ||
        moduleData.production ||
        moduleData.productionData ||
        moduleData.data ||
        [];

      const assemblyProduction =
        assemblyData.production_data ||
        assemblyData.production ||
        assemblyData.productionData ||
        assemblyData.data ||
        [];

      const downtimes = downtimeData.records || downtimeData.data || [];

      const downtimeOk = downtimeData.status ? downtimeData.status === "success" : Array.isArray(downtimes);
      if (!downtimeOk) {
        console.warn("UPH vs Downtime: unexpected downtime response", { downtimeData });
        return;
      }

      const moduleOk = moduleData.status ? moduleData.status === "success" : Array.isArray(moduleProduction);
      const cellChartData = moduleOk ? buildUPHVsDowntimeChartData(moduleProduction, downtimes, "cell") : null;

      const assemblyOk = assemblyData.status ? assemblyData.status === "success" : Array.isArray(assemblyProduction);
      const assemblyChartData = assemblyOk ? buildUPHVsDowntimeChartData(assemblyProduction, downtimes, "assembly") : null;

      // 計算兩個圖表中的最大 downtime 值，用於統一刻度
      let globalMaxDowntime = 0;
      if (cellChartData?.datasets) {
        const cellDowntimeData = cellChartData.datasets.find(ds => ds.label === 'Downtime (min)');
        if (cellDowntimeData?.data) {
          globalMaxDowntime = Math.max(globalMaxDowntime, ...cellDowntimeData.data);
        }
      }
      if (assemblyChartData?.datasets) {
        const assemblyDowntimeData = assemblyChartData.datasets.find(ds => ds.label === 'Downtime (min)');
        if (assemblyDowntimeData?.data) {
          globalMaxDowntime = Math.max(globalMaxDowntime, ...assemblyDowntimeData.data);
        }
      }

      // 設置最大值（至少為 60，並向上取整到 10 的倍數）
      setMaxDowntime(Math.max(60, Math.ceil(globalMaxDowntime / 10) * 10));

      if (cellChartData) {
        setUphVsDowntime(cellChartData);
      } else {
        console.warn("UPH vs Downtime: unexpected module response", { moduleData });
      }

      if (assemblyChartData) {
        setUphVsDowntimeAssembly(assemblyChartData);
      } else {
        console.warn("UPH vs Downtime: unexpected assembly response", { assemblyData });
      }
    } catch (err) {
      console.error("Failed to load UPH vs Downtime data:", err);
    } finally {
      uphLoadingRef.current = false;
      setUphLoading(false);
    }
  }, [uphEnabled]);

  useEffect(() => {
    loadSummaries();
    loadRecords();
  }, [loadSummaries, loadRecords]);

  useEffect(() => {
    if (uphEnabled) {
      loadUPHVsDowntime();
    }
  }, [uphEnabled, loadUPHVsDowntime]);

  // Debug: log week state changes
  useEffect(() => {
  }, [week]);

  // Filter logic
  useEffect(() => {
    let filtered = [...records];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(r =>
        r.id.toString().includes(query) ||
        r.station.toLowerCase().includes(query) ||
        r.line.toLowerCase().includes(query)
      );
    }

    if (lineFilter !== "all") {
      filtered = filtered.filter(r => r.line === lineFilter);
    }

    if (dateFilter !== "all") {
      const today = pacificTodayISODate();
      if (dateFilter === "today") {
        filtered = filtered.filter(r => r.start_local?.startsWith(today));
      } else if (dateFilter === "week") {
        const weekDays = pacificLastNDaysISO(7);
        filtered = filtered.filter(r => {
          const recordDate = r.start_local?.split(" ")[0];
          return weekDays.includes(recordDate);
        });
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

  // Chart options - Production Charts style (TICK_FS=11, LEGEND_FS=11, LABEL_FS=10)
  const TICK_FS = 11;
  const LEGEND_FS = 11;
  const GRID_COLOR = "#f1f5f9";

  const getTodayChartOptions = () => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      datalabels: {
        anchor: 'end',
        align: 'top',
        formatter: (v) => v > 0 ? minToHHMM(v) : '',
        font: { size: 10, weight: '600', family: "'Inter', sans-serif" },
        color: '#334155',
      },
      legend: {
        display: true,
        position: "top",
        align: 'end',
        labels: {
          generateLabels: () => [
            {
              text: "Cell Line",
              fillStyle: "rgba(239, 68, 68, 0.85)",
              strokeStyle: "rgba(239, 68, 68, 1)",
              pointStyle: "rectRounded",
              lineWidth: 0,
              borderRadius: 4
            },
            {
              text: "Assembly Line",
              fillStyle: "rgba(59, 130, 246, 0.85)",
              strokeStyle: "rgba(59, 130, 246, 1)",
              pointStyle: "rectRounded",
              lineWidth: 0,
              borderRadius: 4
            },
          ],
          usePointStyle: true,
          padding: 16,
          font: { size: LEGEND_FS, weight: '500', family: "'Inter', sans-serif" },
          color: '#64748b'
        },
      },
      tooltip: {
        enabled: true,
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        titleFont: { size: 12, weight: '600', family: "'Inter', sans-serif" },
        bodyFont: { size: 11, family: "'Inter', sans-serif" },
        padding: 12,
        cornerRadius: 8,
        displayColors: true,
        borderColor: 'rgba(148, 163, 184, 0.2)',
        borderWidth: 1,
        boxPadding: 4,
        usePointStyle: true,
        callbacks: {
          title: (context) => context[0].label,
          label: (context) => {
            const lineName = today.lineInfo?.[context.dataIndex] === "cell" ? "Cell Line" : "Assembly Line";
            const duration = today.hhmm?.[context.dataIndex] || minToHHMM(context.parsed.y);
            return `${lineName}: ${duration}`;
          },
          afterLabel: (context) => {
            const minutes = Math.round(context.parsed.y);
            const total = context.dataset.data.reduce((a, b) => a + b, 0);
            if (total === 0) return `${minutes} minutes`;
            const percent = ((context.parsed.y / total) * 100).toFixed(1);
            return [`${minutes} minutes`, `${percent}% of total`];
          }
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: {
          color: GRID_COLOR,
          lineWidth: 1,
          drawTicks: false
        },
        border: {
          display: false
        },
        ticks: {
          callback: (v) => minToHHMM(v),
          font: { size: TICK_FS, weight: '500', family: "'Inter', sans-serif" },
          color: '#64748b',
          padding: 8
        }
      },
      x: {
        grid: { display: false },
        border: {
          display: false
        },
        ticks: {
          padding: 8,
          font: { size: TICK_FS, weight: '500', family: "'Inter', sans-serif" },
          color: '#64748b',
          maxRotation: 45,
          minRotation: 0
        }
      },
    },
    interaction: {
      mode: 'index',
      intersect: false
    },
    elements: {
      bar: {
        borderRadius: 6,
        borderSkipped: false
      }
    }
  });

  const getWeekChartOptions = () => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      datalabels: {
        anchor: 'end',
        align: 'top',
        formatter: (v) => v > 0 ? minToHHMM(v) : '',
        font: { size: 10, weight: '600', family: "'Inter', sans-serif" },
        color: '#334155',
      },
      legend: {
        display: true,
        position: "top",
        align: 'end',
        labels: {
          usePointStyle: true,
          pointStyle: 'rectRounded',
          padding: 16,
          font: { size: LEGEND_FS, weight: '500', family: "'Inter', sans-serif" },
          color: '#64748b',
          boxWidth: 10,
          boxHeight: 10
        }
      },
      tooltip: {
        enabled: true,
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        titleFont: { size: 12, weight: '600', family: "'Inter', sans-serif" },
        bodyFont: { size: 11, family: "'Inter', sans-serif" },
        padding: 12,
        cornerRadius: 8,
        displayColors: true,
        borderColor: 'rgba(148, 163, 184, 0.2)',
        borderWidth: 1,
        boxPadding: 4,
        usePointStyle: true,
        callbacks: {
          title: (context) => `Date: ${context[0].label}`,
          label: (context) => {
            const isCell = context.dataset.label.includes("Cell");
            const hhmm = isCell ? week.hhmm?.cell?.[context.dataIndex] : week.hhmm?.assembly?.[context.dataIndex];
            const minutes = Math.round(context.parsed.y);
            return [`${context.dataset.label}: ${hhmm || minToHHMM(context.parsed.y)}`, `${minutes} minutes`];
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        stacked: false,
        grid: {
          color: GRID_COLOR,
          lineWidth: 1,
          drawTicks: false
        },
        border: {
          display: false
        },
        ticks: {
          callback: (v) => minToHHMM(v),
          font: { size: TICK_FS, weight: '500', family: "'Inter', sans-serif" },
          color: '#64748b',
          padding: 8
        }
      },
      x: {
        stacked: false,
        grid: { display: false },
        border: {
          display: false
        },
        ticks: {
          padding: 8,
          font: { size: TICK_FS, weight: '500', family: "'Inter', sans-serif" },
          color: '#64748b'
        },
        categoryPercentage: 0.7,
        barPercentage: 0.85
      },
    },
    interaction: {
      mode: 'index',
      intersect: false
    },
    elements: {
      bar: {
        borderRadius: 6,
        borderSkipped: false
      }
    }
  });

  // UPH vs Downtime Chart Options (使用統一的 downtime 刻度)
  const getUPHVsDowntimeChartOptions = () => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      datalabels: { display: false },
      legend: {
        display: true,
        position: "top",
        align: 'end',
        labels: {
          usePointStyle: true,
          pointStyle: 'circle',
          padding: 16,
          font: { size: LEGEND_FS, weight: '500', family: "'Inter', sans-serif" },
          color: '#64748b',
          boxWidth: 10,
          boxHeight: 10
        }
      },
      tooltip: {
        enabled: true,
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        titleFont: { size: 12, weight: '600', family: "'Inter', sans-serif" },
        bodyFont: { size: 11, family: "'Inter', sans-serif" },
        padding: 12,
        cornerRadius: 8,
        displayColors: true,
        borderColor: 'rgba(148, 163, 184, 0.2)',
        borderWidth: 1,
        boxPadding: 4,
        usePointStyle: true,
        callbacks: {
          title: (context) => `Time: ${context[0].label}`,
          label: (context) => {
            const label = context.dataset.label || '';
            const value = context.parsed.y;
            const roundedValue = roundValue(value);
            if (label.includes('UPH')) {
              return `${label}: ${roundedValue} pcs/h`;
            } else if (label.includes('Downtime')) {
              return `${label}: ${roundedValue} min (${minToHHMM(roundedValue)})`;
            }
            return `${label}: ${roundedValue}`;
          },
        },
      },
    },
    scales: {
      y: {
        type: 'linear',
        display: true,
        position: 'left',
        beginAtZero: true,
        title: {
          display: true,
          text: 'UPH (pcs/h)',
          font: { size: 10, weight: '600', family: "'Inter', sans-serif" },
          color: '#0d9488'
        },
        grid: {
          color: GRID_COLOR,
          lineWidth: 1,
          drawTicks: false
        },
        border: {
          display: false
        },
        ticks: {
          callback: (v) => roundValue(v),
          font: { size: TICK_FS, weight: '500', family: "'Inter', sans-serif" },
          color: '#0d9488',
          padding: 8
        }
      },
      y1: {
        type: 'linear',
        display: true,
        position: 'right',
        beginAtZero: true,
        max: maxDowntime || 60,
        title: {
          display: true,
          text: 'Downtime (min)',
          font: { size: 10, weight: '600', family: "'Inter', sans-serif" },
          color: '#f59e0b'
        },
        grid: {
          drawOnChartArea: false,
        },
        border: {
          display: false
        },
        ticks: {
          callback: (v) => minToHHMM(v),
          font: { size: TICK_FS, weight: '500', family: "'Inter', sans-serif" },
          color: '#f59e0b',
          padding: 8,
          stepSize: maxDowntime > 120 ? 30 : (maxDowntime > 60 ? 20 : 10),
        }
      },
      x: {
        grid: { display: false },
        border: {
          display: false
        },
        ticks: {
          padding: 8,
          font: { size: TICK_FS, weight: '500', family: "'Inter', sans-serif" },
          color: '#64748b',
          maxRotation: 45,
          minRotation: 0,
          autoSkip: true,
          maxTicksLimit: 12
        }
      },
    },
    interaction: {
      mode: 'index',
      intersect: false
    },
  });

  // Flow
  const reset = () => {
    setStep(1);
    setLine("");
    setStation("");
    setStartTs(null);
    setAlert(false);
  };
  const chooseLine = (l) => {
    setLine(l);
    setStep(2);
  };
  const chooseStation = (s) => {
    setStation(s);
    setStep(3);
    setStartTs(null);
    setAlert(false);
  };
  const startTimer = () => {
    setAlert(false);
    setStartTs(Date.now());
  };

  // 送出（送「Pacific local 無時區字串」）
  const submit = async () => {
    try {
      const endTime = Date.now();
      const durationMin = Math.round((endTime - startTs) / 1000 / 60);

      await api.post("downtime", {
        line,
        station,
        start_time: toPacificLocalIsoSeconds(startTs), // ← 關鍵：不要用 toISOString()
        end_time: toPacificLocalIsoSeconds(endTime),
      });

      setMsg(`✅${line === "cell" ? "Cell Line" : "Assembly Line"} – ${station} – ${durationMin} min`);

      reset();
      loadSummaries();
      loadRecords();
      loadUPHVsDowntime();
    } catch (e) {
      setMsg(`❌ ${e.response?.data?.message || e.message}`);
    }
  };

  // 編輯（用後端提供的 *_edit，送 naive Pacific）
  const saveEdit = async (u) => {
    if (!window.confirm(`Save changes to Record #${u.id}?\n\nLine: ${u.line}\nStation: ${u.station}\nStart: ${u.start_local}\nEnd: ${u.end_local}`)) {
      return;
    }

    try {
      const response = await api.put(`downtime/${u.id}`, {
        line: u.line,
        station: u.station,
        // 直接送 "YYYY-MM-DDTHH:mm"（無時區），後端會當 Pacific
        start_time: u.start_local,
        end_time: u.end_local,
      });

      if (response.data.status === 'success') {
        setMsg(`✅ Record #${u.id} updated successfully - Duration: ${minToHHMM(response.data.duration_min || 0)}`);
      }

      setEditing(null);
      loadRecords();
      loadSummaries();
      loadUPHVsDowntime();
    } catch (e) {
      setMsg(`❌ ${e.response?.data?.message || e.message}`);
    }
  };

  const del = async (id) => {
    const record = records.find(r => r.id === id);
    const recordInfo = record ? `\n\nLine: ${record.line}\nStation: ${record.station}\nStart: ${record.start_local}\nDuration: ${minToHHMM(record.duration_min)}` : '';

    if (!window.confirm(`⚠️ Delete Record #${id}?${recordInfo}\n\nThis action cannot be undone.`)) return;
    try {
      await api.delete(`downtime/${id}`);
      setMsg(`✅ Record #${id} deleted successfully`);
      loadRecords();
      loadSummaries();
      loadUPHVsDowntime();
    } catch (e) {
      setMsg(`❌ ${e.response?.data?.message || e.message}`);
    }
  };

  return (
    <div className={`dt-container ${alert ? "dt-flash" : ""}`}>
      <h1 className="text-xl md:text-2xl font-semibold text-slate-800 mb-5">Downtime Log</h1>

      {step === 1 && (
        <div className="dt-line-select">
          <button onClick={() => chooseLine("cell")}>Cell Line</button>
          <button onClick={() => chooseLine("assembly")}>Assembly Line</button>
        </div>
      )}

      {step === 2 && (
        <div className="dt-station-btns">
          {(line === "cell" ? cellPositions : assemblyPositions).map((p) => (
            <button key={p} onClick={() => chooseStation(p)}>
              {p}
            </button>
          ))}
        </div>
      )}

      {step === 3 && (
        <DowntimeTimer
          line={line}
          station={station}
          startTs={startTs}
          onStart={startTimer}
          onSubmit={submit}
          onAlert={handleTimerAlert}
        />
      )}

      {msg && <div className="dt-msg">{msg}</div>}

      {/* === DASHBOARD-STYLE CHART CARDS === */}
      <div className="downtime-charts-section">
        <div className="downtime-charts-grid">

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
                <div style={{padding: '2rem', textAlign: 'center', color: '#666'}}>
                  <p>Debug Info:</p>
                  <pre style={{fontSize: '11px', textAlign: 'left', background: '#f5f5f5', padding: '1rem', borderRadius: '8px', overflow: 'auto'}}>
                    {JSON.stringify(week, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>

          {/* UPH vs Downtime Correlation */}
          <div
            className="downtime-card downtime-card-full uph-correlation-card"
            ref={uphCardRef}
          >
            <div className="downtime-card-header">
              <div className="downtime-header-content" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: '#f0fdfa', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
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
              {/* Cell Line Chart */}
              <div className="uph-chart-block">
                <div className="uph-chart-label">
                  <span className="uph-label-dot cell-dot"></span>
                  <span className="uph-label-text">Cell Line</span>
                  <span style={{ marginLeft: 'auto', fontSize: '0.6875rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Hourly</span>
                </div>
                <div className="uph-chart-wrapper">
                  {uphVsDowntime.datasets && uphVsDowntime.datasets.length > 0 && !uphLoading ? (
                    <Line data={uphVsDowntime} options={getUPHVsDowntimeChartOptions()} />
                  ) : (
                    <div className="chart-skeleton">
                      <div className="skeleton-header"></div>
                      <div className="skeleton-bars">
                        <div className="skeleton-bar"></div>
                        <div className="skeleton-bar"></div>
                        <div className="skeleton-bar"></div>
                        <div className="skeleton-bar"></div>
                        <div className="skeleton-bar"></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Assembly Line Chart */}
              <div className="uph-chart-block">
                <div className="uph-chart-label">
                  <span className="uph-label-dot assembly-dot"></span>
                  <span className="uph-label-text">Assembly Line</span>
                  <span style={{ marginLeft: 'auto', fontSize: '0.6875rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Hourly</span>
                </div>
                <div className="uph-chart-wrapper">
                  {uphVsDowntimeAssembly.datasets && uphVsDowntimeAssembly.datasets.length > 0 && !uphLoading ? (
                    <Line data={uphVsDowntimeAssembly} options={getUPHVsDowntimeChartOptions()} />
                  ) : (
                    <div className="chart-skeleton">
                      <div className="skeleton-header"></div>
                      <div className="skeleton-bars">
                        <div className="skeleton-bar"></div>
                        <div className="skeleton-bar"></div>
                        <div className="skeleton-bar"></div>
                        <div className="skeleton-bar"></div>
                        <div className="skeleton-bar"></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* === DOWNTIME RECORDS MODAL === */}
      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()}>

            {/* Modal Header */}
            <div className="modal-header">
              <div>
                <h2 className="modal-title">Downtime Records</h2>
                <p className="modal-subtitle">View, edit, and export all downtime entries</p>
              </div>
              <button className="modal-close-btn" onClick={() => setModalOpen(false)}>
                X
              </button>
            </div>

            {/* Search and Filter Controls */}
            <div className="modal-controls">
              <div className="modal-controls-left">
                <input
                  type="text"
                  className="modal-search-input"
                  placeholder="Search by ID, Station, or Line"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
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
                  Export to Excel
                </button>
              </div>
            </div>

            {/* Table Wrapper with Virtual Scrolling */}
            <div ref={parentRef} className="modal-table-wrapper">
              <table className="modal-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Line</th>
                    <th>Station</th>
                    <th>Start Time</th>
                    <th>End Time</th>
                    <th>Duration</th>
                    <th>Modified By</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="modal-table-spacer" aria-hidden="true">
                    <td colSpan={8} style={{ height: `${rowVirtualizer.getTotalSize()}px` }}></td>
                  </tr>
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const record = filteredRecords[virtualRow.index];
                    const isEditing = editing?.id === record.id;

                    return (
                      <tr
                        key={virtualRow.key}
                        className={isEditing ? 'editing-row' : ''}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                          {isEditing ? (
                            <>
                              <td className="td-id">{record.id}</td>
                              <td>
                                <select
                                  className="modal-select"
                                  value={editing.line}
                                  onChange={(e) => setEditing({ ...editing, line: e.target.value })}
                                >
                                  <option value="cell">Cell Line</option>
                                  <option value="assembly">Assembly Line</option>
                                </select>
                              </td>
                              <td>
                                <input
                                  type="text"
                                  className="modal-input"
                                  value={editing.station}
                                  onChange={(e) => setEditing({ ...editing, station: e.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  type="datetime-local"
                                  className="modal-input"
                                  value={editing.start_local}
                                  onChange={(e) => setEditing({ ...editing, start_local: e.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  type="datetime-local"
                                  className="modal-input"
                                  value={editing.end_local}
                                  onChange={(e) => setEditing({ ...editing, end_local: e.target.value })}
                                />
                              </td>
                              <td>
                                <span className="duration-badge">{minToHHMM(record.duration_min)}</span>
                              </td>
                              <td className="user-text">{record.modified_by || record.created_by || '-'}</td>
                              <td className="td-actions">
                                <div className="action-buttons">
                                  <button className="btn-save" onClick={() => saveEdit(editing)}>
                                    Save
                                  </button>
                                  <button className="btn-cancel" onClick={() => setEditing(null)}>
                                    Cancel
                                  </button>
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
                              <td className="datetime-text">{record.start_local}</td>
                              <td className="datetime-text">{record.end_local}</td>
                              <td>
                                <span className="duration-badge">{minToHHMM(record.duration_min)}</span>
                              </td>
                              <td className="user-text">{record.modified_by || record.created_by || '-'}</td>
                              <td className="td-actions">
                                <div className="action-buttons">
                                  <button
                                    className="btn-edit"
                                    onClick={() => setEditing({
                                      id: record.id,
                                      line: record.line,
                                      station: record.station,
                                      start_local: record.start_local_edit,
                                      end_local: record.end_local_edit,
                                    })}
                                    title="Edit Record"
                                  >
                                    Edit
                                  </button>
                                  <button className="btn-delete" onClick={() => del(record.id)} title="Delete Record">
                                    Delete
                                  </button>
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
                Double-click any row to edit • Total {records.length} record{records.length !== 1 ? 's' : ''}
              </p>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
