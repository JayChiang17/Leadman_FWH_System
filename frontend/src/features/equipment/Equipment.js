// src/features/equipment/Equipment.js
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Bar, Doughnut } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,   // 小卡片折線圖需要
  PointElement,
  ArcElement,
  Tooltip,
  Legend,
  Title,
  Filler,
} from "chart.js";
import { Activity, Settings, AlertCircle, Calendar } from "lucide-react";
import StationMiniChart from "../../components/StationMiniChart";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Tooltip,
  Legend,
  Title,
  Filler
);

const CA_TZ = "America/Los_Angeles";

/* ===================== Date helpers (UTC, no TZ drift) ===================== */
// 將 "YYYY-MM-DD" 視為 UTC 日期，不受本地時區影響
const parseISO = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const toISO = (dUTC) => dUTC.toISOString().slice(0, 10); // YYYY-MM-DD
const addDaysISO = (iso, n) => {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
};
const todayISO = () => toISO(new Date());

/* ================================ helpers ================================ */
const n = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const fmtSec = (sec = 0) => {
  sec = n(sec);
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const remainM = m % 60;
  return `${h}h ${remainM}m`;
};
const fmtNumber = (num) =>
  num >= 1_000_000 ? `${(num / 1_000_000).toFixed(1)}M` : num >= 1_000 ? `${(num / 1_000).toFixed(1)}K` : String(num);

/* ============================ API base (ENV) ============================ */
const API_BASE = (process.env.REACT_APP_API_BASE || "/api").replace(/\/+$/, "");
const api = (p = "") => `${API_BASE}${p.startsWith("/") ? p : `/${p}`}`;

/* =================== fetch + normalize (shape guard) ==================== */
const pickArray = (j) =>
  Array.isArray(j) ? j : Array.isArray(j?.value) ? j.value : Array.isArray(j?.data) ? j.data : [];

async function getJSON(path) {
  const res = await fetch(api(path), { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} @ ${path}${text ? ` – ${text.slice(0, 200)}` : ""}`);
  }
  return res.json();
}

const normDaily = (rows = []) =>
  pickArray(rows).map((r) => ({
    processType: r.processType ?? r.station ?? r.type ?? "Unknown",
    totalCount: +((r.totalCount ?? r.count ?? r.operations ?? 0)),
    totalTime: +((r.totalTime ?? r.sumProcessTime ?? r.time ?? 0)),
    minProcessTime: +((r.minProcessTime ?? r.min ?? 0)),
    maxProcessTime: +((r.maxProcessTime ?? r.max ?? 0)),
    avgProcessTime:
      +((r.avgProcessTime ?? r.avg ?? 0)) ||
      ((+(r.totalTime ?? 0) && +(r.totalCount ?? 0)) ? +(r.totalTime) / +(r.totalCount) : 0),
  }));

const normUsers = (rows = []) =>
  pickArray(rows).map((u) => ({
    userCode: u.userCode ?? u.user ?? u.operator ?? "N/A",
    operationCount: +((u.operationCount ?? u.count ?? u.total ?? 0)),
    avgProcessTime: +((u.avgProcessTime ?? u.avg ?? 0)),
    processType: u.processType ?? u.station ?? "",
  }));

const normPerStationDaily = (rows = []) =>
  pickArray(rows).map((r) => ({
    date: r.date ?? r.recordDate ?? r.day ?? r.ds,
    station: r.station ?? r.processType ?? "Unknown",
    count: +((r.count ?? r.totalCount ?? r.operations ?? r.ops ?? 0)),
    avgProcessTime: +((r.avgProcessTime ?? r.avg ?? 0)),
  }));

async function fetchStations(fallbackDaily = [], perStationArr = []) {
  try {
    const raw = pickArray(await getJSON("/module_equipment/process_types"));
    const names = raw.map((s) => (typeof s === "string" ? s : s?.processType ?? s?.station ?? "")).filter(Boolean);
    if (names.length) return names.sort();
  } catch (_) {}
  const fromDaily = fallbackDaily.map((d) => d.processType);
  const fromPer = perStationArr.map((x) => x.station);
  return Array.from(new Set([...fromDaily, ...fromPer])).filter(Boolean).sort();
}

// 後端回 "YYYY-MM-DD HH:mm:ss.ffffff" → 轉成 Date 只用來顯示時間（不做日期運算）
const parseDT = (s) => {
  if (!s) return null;
  const t = String(s).replace(" ", "T").replace(/\.\d+$/, "");
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
};

/* ================================= styles ================================ */
function useInlineStyles() {
  useEffect(() => {
    const id = "liquid-glass-dashboard";
    if (document.getElementById(id)) return;
    const el = document.createElement("style");
    el.id = id;
    el.textContent = `
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:#f8fafc;color:#0f172a}
      .dashboard{min-height:100vh;background:linear-gradient(145deg,#f8fafc 0%,#e2e8f0 100%);padding:32px}
      .dashboard-container{max-width:1800px;margin:0 auto;display:flex;flex-direction:column;gap:32px}
      .liquid-glass{background:rgba(255,255,255,.7);backdrop-filter:blur(16px) saturate(180%);border:1px solid rgba(255,255,255,.3);border-radius:24px;box-shadow:0 8px 32px rgba(31,38,135,.1),0 2px 8px rgba(31,38,135,.05),inset 0 1px 0 rgba(255,255,255,.4);transition:.3s;position:relative;overflow:hidden}

      /* Header */
      .dashboard-header{display:flex;justify-content:space-between;align-items:center;padding:36px 44px}
      @media (max-width:900px){.dashboard-header{flex-direction:column;gap:20px;text-align:center}}
      .dashboard-title{display:flex;align-items:center;gap:14px}
      .dashboard-title h1{font-size:26px;font-weight:500;letter-spacing:-.2px}
      .dashboard-subtitle{color:#64748b;font-size:13px;margin-top:6px}

      /* Compact controls (no Range) */
      .dashboard-controls{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
      .field{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.55);border:1px solid rgba(203,213,225,.45);border-radius:14px;padding:10px 14px}
      .field .label{font-size:11px;color:#64748b;font-weight:700;letter-spacing:.8px;text-transform:uppercase}
      .field .icon{width:16px;height:16px;color:#64748b}
      .field input, .field select{border:none;outline:none;background:transparent;font-size:14px;font-weight:600;color:#0f172a}

      .refresh-btn{display:inline-flex;align-items:center;gap:10px;background:linear-gradient(135deg,#0ea5e9,#0284c7);color:#fff;border:none;border-radius:14px;padding:10px 16px;font-weight:600;cursor:pointer;
        box-shadow:0 6px 20px rgba(2,132,199,.25)}
      .refresh-btn:hover{transform:translateY(-1px)}
      .refresh-btn:active{transform:translateY(0)}

      /* Cards & charts */
      .chart-card{padding:28px}
      .chart-header{margin-bottom:16px;border-bottom:1px solid rgba(148,163,184,.22);padding-bottom:10px}
      .chart-title{font-size:18px;font-weight:500;letter-spacing:-.2px}
      .chart-subtitle{color:#64748b;font-size:13px;margin-top:4px}
      .chart-container{position:relative;height:320px}

      .charts-grid{display:grid;grid-template-columns:1.5fr 1fr;gap:24px}
      @media (max-width:1200px){.charts-grid{grid-template-columns:1fr}}

      .grid-small-multiples{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
      .station-card{padding:18px;min-height:228px}

      /* Tables */
      .data-table{width:100%;border-collapse:separate;border-spacing:0;margin-top:10px}
      .data-table th{background:rgba(248,250,252,.7);font-size:11px;padding:12px 14px;text-transform:uppercase;letter-spacing:.8px;text-align:left;color:#475569;border-bottom:1px solid rgba(148,163,184,.25)}
      .data-table td{padding:12px 14px;border-bottom:1px solid rgba(148,163,184,.15);font-size:14px;color:#334155}
      .data-table tbody tr:hover{background:rgba(248,250,252,.45)}

      /* Recent list */
      .recent-activities{display:flex;flex-direction:column;gap:12px;max-height:420px;overflow-y:auto;padding-right:8px}
      .activity-item{display:flex;justify-content:space-between;padding:10px 12px;border-radius:12px;background:rgba(248,250,252,.65)}
      .activity-info{display:flex;gap:12px}

      /* Status badges */
      .status-badge{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border-radius:14px;font-size:11px;border:1px solid rgba(203,213,225,.35)}
      .status-badge .dot{width:6px;height:6px;border-radius:50%}
      .status-badge.active{background:rgba(16,185,129,.12);color:#047857;border-color:rgba(16,185,129,.35)}
      .status-badge.warning{background:rgba(245,158,11,.12);color:#b45309;border-color:rgba(245,158,11,.35)}

      /* Mini chart chips */
      .mini-legend{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
      .mini-legend .chip{display:inline-flex;align-items:center;gap:8px;padding:5px 10px;border-radius:999px;background:rgba(241,245,249,.85);border:1px solid rgba(203,213,225,.6)}
      .mini-legend .chip .date{color:#0f172a;font-weight:700;font-size:11px;letter-spacing:.3px}
      .mini-legend .chip .dot{width:3px;height:3px;border-radius:50%;background:#94a3b8}
      .mini-legend .chip .val{color:#475569;font-weight:600;font-size:11px}

      /* Loading / error */
      .loading-card{padding:80px;text-align:center}
      .loading-spinner{width:48px;height:48px;border:2px solid rgba(148,163,184,.25);border-top:2px solid #334155;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 24px}
      @keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
      .error-card{background:rgba(239,68,68,.05);border:1px solid rgba(239,68,68,.2);border-radius:20px;padding:28px;color:#991b1b;display:flex;align-items:center;gap:12px}
    `;
    document.head.appendChild(el);
  }, []);
}

/* ============================== component =============================== */
export default function Equipment() {
  useInlineStyles();

  // 移除 Range：只保留單一日期；小卡固定顯示「所選日往前 7 天（含當天，共 8 天）」
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [maxAvailableDate, setMaxAvailableDate] = useState(todayISO()); // 數據庫裡最新有數據的日期

  // Data states
  const [stations, setStations] = useState([]);
  const [daily, setDaily] = useState([]);
  const [perStationMap, setPerStationMap] = useState({}); // {station: [{date,count,avgProcessTime}]}
  const [recent, setRecent] = useState([]);
  const [users, setUsers] = useState([]);
  const [kpiStation, setKpiStation] = useState("ALL");

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  // Load all (小卡固定「selectedDate - 7」到「selectedDate」)
  const loadAll = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const start7 = addDaysISO(selectedDate, -7); // e.g., 09-09 → 09-02

      const [dayJ, recentJ, userJ, perStationJ] = await Promise.all([
        getJSON(`/module_equipment/stats/daily?target_date=${selectedDate}`),
        getJSON(`/module_equipment/recent-records?limit=10`),
        getJSON(`/module_equipment/user-stats?target_date=${selectedDate}`),
        getJSON(`/module_equipment/stats/per-station-daily?start_date=${start7}&end_date=${selectedDate}`),
      ]);

      const dailyNorm = normDaily(dayJ);

      // 如果選擇的日期沒有數據，自動找最新有數據的日期
      if (dailyNorm.length === 0 && pickArray(recentJ).length > 0) {
        const recentRecords = pickArray(recentJ);
        if (recentRecords[0]?.recordDate) {
          const latestDate = recentRecords[0].recordDate;
          setMaxAvailableDate(latestDate);
          setSelectedDate(latestDate);
          return; // 重新載入新日期的數據
        }
      }

      setDaily(dailyNorm);

      // 嚴格保留 start7 ~ selectedDate（避免後端/快取回多）
      const perArr = normPerStationDaily(perStationJ).filter(
        (r) => r.date >= start7 && r.date <= selectedDate
      );

      // 以 UTC 逐日補齊（不經過本地時區）
      const allDays = [];
      for (let d = parseISO(start7); d <= parseISO(selectedDate); d.setUTCDate(d.getUTCDate() + 1)) {
        allDays.push(toISO(d));
      }

      const grouped = new Map();
      for (const r of perArr) {
        if (!grouped.has(r.station)) grouped.set(r.station, []);
        grouped.get(r.station).push(r);
      }
      const filled = {};
      grouped.forEach((rows, st) => {
        const m = new Map(rows.map((x) => [x.date, x]));
        filled[st] = allDays.map((ds) => m.get(ds) || { date: ds, station: st, count: 0, avgProcessTime: 0 });
      });
      setPerStationMap(filled);

      setRecent(pickArray(recentJ));
      setUsers(normUsers(userJ));
      setStations(await fetchStations(dailyNorm, perArr));
    } catch (e) {
      console.error(e);
      setErr(e.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Charts options
  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(15, 23, 42, 0.95)",
        titleColor: "#f1f5f9",
        bodyColor: "#e2e8f0",
        borderColor: "rgba(148,163,184,0.2)",
        borderWidth: 1,
        cornerRadius: 12,
        padding: 12,
        titleFont: { size: 14, weight: "500" },
        bodyFont: { size: 13, weight: "400" },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: "#64748b", font: { size: 11 } } },
      y: { beginAtZero: true, grid: { color: "rgba(148,163,184,.1)", drawBorder: false }, ticks: { color: "#64748b", font: { size: 11 } } },
    },
    elements: { bar: { borderRadius: 8 }, point: { radius: 0, hoverRadius: 6 } },
  };

  /* =================== Station Distribution (雙圈甜甜圈) =================== */
  // 1) 先放在 component 內部（render 之前）
  const stationDistribution = useMemo(() => {
    // 依當日件數排序，取前 5 名，其餘併入 Others
    const sorted = [...daily].sort((a, b) => n(b.totalCount) - n(a.totalCount));
    const head = sorted.slice(0, 5);
    const tail = sorted.slice(5);

    const labels = [...head.map((r) => r.processType)];
    const ops = [...head.map((r) => n(r.totalCount))];
    const runHr = head.map((r) => Number((n(r.totalTime) / 3600).toFixed(1))); // ← 1 位小數

    if (tail.length) {
      labels.push("Others");
      ops.push(tail.reduce((s, r) => s + n(r.totalCount), 0));
      const sumHr = tail.reduce((s, r) => s + n(r.totalTime) / 3600, 0);
      runHr.push(Number(sumHr.toFixed(1))); // ← 1 位小數
    }

    const totals = {
      ops: ops.reduce((a, b) => a + b, 0),
      hours: runHr.reduce((a, b) => a + b, 0),
    };

    // 顏色
    const palette = [
      "rgba(59,130,246,.9)",  // blue
      "rgba(16,185,129,.9)",  // green
      "rgba(245,158,11,.9)",  // amber
      "rgba(14,165,233,.9)",  // sky
      "rgba(239,68,68,.9)",   // red
      "rgba(148,163,184,.9)", // slate
    ];
    const bg = labels.map((_, i) => palette[i % palette.length]);
    const bgSoft = bg.map((c) => c.replace(".9", ".16"));

    // 表格資料（Avg 直接用當日 avgProcessTime；Others 以加權平均計）
    const byName = new Map(sorted.map((r) => [r.processType, r]));
    const table = labels.map((name, i) => {
      const row = byName.get(name);
      let avgSec;
      if (name === "Others" && tail.length) {
        const tOps = tail.reduce((s, r) => s + n(r.totalCount), 0);
        const tTime = tail.reduce((s, r) => s + n(r.totalTime), 0);
        avgSec = tOps ? tTime / tOps : 0;
      } else {
        avgSec = n(row?.avgProcessTime);
      }
      return {
        name,
        ops: ops[i],
        opsPct: totals.ops ? (ops[i] / totals.ops) * 100 : 0,
        avgSec,
        hours: runHr[i], // 已是 1 位小數
        hoursPct: totals.hours ? (runHr[i] / totals.hours) * 100 : 0,
      };
    });

    return {
      chart: {
        labels,
        datasets: [
          // 外圈：每站件數
          {
            label: "Operations",
            data: ops,
            backgroundColor: bgSoft,
            borderColor: bg,
            borderWidth: 2,
            hoverOffset: 4,
          },
          // 內圈：每站總時數（小時，1 位小數）
          {
            label: "Runtime(h)",
            data: runHr,
            backgroundColor: bg,
            borderWidth: 0,
          },
        ],
      },
      table,
    };
  }, [daily]);



  /* ============================ Employee KPI ============================= */
  const filteredUsers = useMemo(
    () => (kpiStation === "ALL" ? users : users.filter((u) => (u.processType || "") === kpiStation)),
    [users, kpiStation]
  );
  const topUsers = useMemo(
    () => [...filteredUsers].sort((a, b) => n(b.operationCount) - n(a.operationCount)).slice(0, 10),
    [filteredUsers]
  );
  const userBarData = useMemo(
    () => ({
      labels: topUsers.map((u) => u.userCode),
      datasets: [
        {
          label: "Operations",
          data: topUsers.map((u) => n(u.operationCount)),
          backgroundColor: "rgba(59,130,246,.15)",
          borderColor: "rgba(59,130,246,.9)",
          borderWidth: 2,
          borderRadius: 8,
        },
      ],
    }),
    [topUsers]
  );

  if (loading) {
    return (
      <div className="dashboard">
        <div className="dashboard-container">
          <div className="liquid-glass loading-card">
            <div className="loading-spinner" />
            <h3 style={{ fontWeight: 500, marginTop: 4 }}>Loading Dashboard</h3>
            <p className="chart-subtitle">Fetching module equipment metrics</p>
          </div>
        </div>
      </div>
    );
  }
  if (err) {
    return (
      <div className="dashboard">
        <div className="dashboard-container">
          <div className="error-card">
            <AlertCircle size={22} />
            <div>
              <div style={{ fontWeight: 600 }}>Error Loading Data</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>{err}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const start7 = addDaysISO(selectedDate, -7);

  return (
    <div className="dashboard">
      <div className="dashboard-container">
        {/* Header */}
        <div className="liquid-glass dashboard-header">
          <div className="dashboard-title">
            <div
              className="kpi-icon"
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                display: "grid",
                placeItems: "center",
                background: "rgba(248,250,252,.9)",
                color: "#475569",
              }}
            >
              <Activity size={20} />
            </div>
            <div>
              <h1>Module Equipment Dashboard</h1>
              <div className="dashboard-subtitle">Daily station performance • Employee KPI • Recent ops</div>
            </div>
          </div>

          <div className="dashboard-controls">
            <div className="field">
              <Calendar className="icon" />
              <span className="label">Date</span>
              <input
                type="date"
                value={selectedDate}
                max={maxAvailableDate}
                onChange={(e) => setSelectedDate(e.target.value)}
              />
            </div>
            {maxAvailableDate !== todayISO() && (
              <div style={{
                padding: '8px 14px',
                background: 'rgba(245,158,11,.12)',
                border: '1px solid rgba(245,158,11,.35)',
                borderRadius: '14px',
                fontSize: '12px',
                color: '#b45309',
                fontWeight: '600'
              }}>
                Latest data: {maxAvailableDate}
              </div>
            )}
            <button className="refresh-btn" onClick={loadAll} title="Refresh data">
              <Settings size={16} />
              Refresh
            </button>
          </div>
        </div>

        {/* Row 1: Station Distribution + Employee KPI */}
        <div className="charts-grid">
          {/* Station Distribution */}
          <div className="liquid-glass chart-card">
            <div className="chart-header">
              <h3 className="chart-title">Station Distribution</h3>
              <div className="chart-subtitle">Operations vs Runtime — {selectedDate}</div>
            </div>

            <div className="chart-container">
              <Doughnut
                data={stationDistribution.chart}
                options={{
                  ...baseOptions,
                  scales: undefined,
                  cutout: "55%",
                  plugins: {
                    ...baseOptions.plugins,
                    legend: {
                      display: true,
                      position: "bottom",
                      labels: {
                        padding: 18,
                        font: { size: 12 },
                        color: "#64748b",
                        usePointStyle: true,
                        pointStyle: "circle",
                      },
                    },
                    tooltip: {
                      ...baseOptions.plugins.tooltip,
                      callbacks: {
                        label(ctx) {
                          const ds = ctx.dataset.label;
                          const v = ctx.raw;
                          if (ds === "Operations") return ` Ops: ${Number(v).toLocaleString()}`;
                          return ` Runtime: ${Number(v).toFixed(1)}h`;
                        },
                      },
                    },
                  },
                }}
              />
            </div>

            <table className="data-table" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Station</th>
                  <th>Ops</th>
                  <th>Ops%</th>
                  <th>Avg</th>
                  <th>Runtime(h)</th>
                  <th>Run%</th>
                </tr>
              </thead>
              <tbody>
                {stationDistribution.table.map((r) => (
                  <tr key={r.name}>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td>{r.ops.toLocaleString()}</td>
                    <td>{r.opsPct.toFixed(1)}%</td>
                    <td>{fmtSec(r.avgSec)}</td>
                    <td>{r.hours.toFixed(1)}</td>
                    <td>{r.hoursPct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Employee KPI */}
          <div className="liquid-glass chart-card">
            <div
              className="chart-header"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <div>
                <h3 className="chart-title">Employee KPI</h3>
                <div className="chart-subtitle">Top operators — {selectedDate}</div>
              </div>
              <div className="field" style={{ padding: 8 }}>
                <span className="label">Station</span>
                <select
                  value={kpiStation}
                  onChange={(e) => setKpiStation(e.target.value)}
                  style={{ border: "none", background: "transparent", fontWeight: 600 }}
                >
                  <option value="ALL">All</option>
                  {stations.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="chart-container">
              <Bar data={userBarData} options={baseOptions} />
            </div>

            <table className="data-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Ops</th>
                  <th>Avg Time</th>
                  <th>Station</th>
                </tr>
              </thead>
              <tbody>
                {topUsers.map((u) => (
                  <tr key={`${u.userCode}-${u.processType}`}>
                    <td style={{ fontWeight: 600 }}>{u.userCode}</td>
                    <td>{fmtNumber(n(u.operationCount))}</td>
                    <td>{fmtSec(n(u.avgProcessTime))}</td>
                    <td>{u.processType || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>


        {/* Row 2: Station Performance + Recent Activities */}
        <div className="charts-grid">
          {/* Station Performance */}
          <div className="liquid-glass chart-card">
            <div className="chart-header">
              <h3 className="chart-title">Station Performance</h3>
              <div className="chart-subtitle">Today's metrics — {selectedDate}</div>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Station</th>
                  <th>Operations</th>
                  <th>Avg Time</th>
                  <th>Min Time</th>
                  <th>Max Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {[...daily].sort((a, b) => n(b.totalCount) - n(a.totalCount)).map((st) => (
                  <tr key={st.processType}>
                    <td><strong style={{ fontWeight: 600 }}>{st.processType}</strong></td>
                    <td>{fmtNumber(n(st.totalCount))}</td>
                    <td>{fmtSec(st.avgProcessTime)}</td>
                    <td>{fmtSec(st.minProcessTime)}</td>
                    <td>{fmtSec(st.maxProcessTime)}</td>
                    <td>
                      <span className={`status-badge ${n(st.totalCount) > 0 ? "active" : "warning"}`}>
                        <span className="dot" style={{ background: n(st.totalCount) > 0 ? "#22c55e" : "#f59e0b" }} />
                        {n(st.totalCount) > 0 ? "Active" : "Idle"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Recent Activities */}
          <div className="liquid-glass chart-card">
            <div className="chart-header">
              <h3 className="chart-title">Recent Activities</h3>
              <div className="chart-subtitle">Latest production operations</div>
            </div>
            <div className="recent-activities">
              {recent.map((activity) => {
                const dt = parseDT(activity.startTime);
                const timeStr = dt
                  ? dt.toLocaleTimeString("en-US", {
                      hour12: false,
                      timeZone: CA_TZ,
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })
                  : "—";
                return (
                  <div key={activity.id} className="activity-item">
                    <div className="activity-info">
                      <div className="activity-station" style={{ fontWeight: 700 }}>{activity.processType}</div>
                      <div className="activity-time" style={{ color: "#64748b" }}>{timeStr}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ color: "#475569" }}>{activity.userCode}</span>
                      <span style={{ fontWeight: 700 }}>{fmtSec(activity.processTime)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Row 3: Per-Station 小圖（近 7 天 + 當天） */}
        <div className="liquid-glass chart-card">
          <div className="chart-header">
            <h3 className="chart-title">Per-Station Trends</h3>
            <div className="chart-subtitle">Weighted avg time per day — {start7} to {selectedDate}</div>
          </div>
          <div className="grid-small-multiples">
            {Object.keys(perStationMap).sort().map((name) => (
              <StationMiniChart key={name} name={name} rows={perStationMap[name]} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
