import React, { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { Line, Pie } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement,
  ArcElement, Tooltip, Legend, Filler,
} from 'chart.js';
import api from '../../services/api';
import {
  RefreshCw, AlertTriangle, CheckCircle, Activity,
  Maximize2, Minimize2, Clock,
} from 'lucide-react';
import { openDashboardSocket } from '../../utils/wsConnect';
import { AuthCtx } from '../../auth/AuthContext';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  ArcElement, Tooltip, Legend, Filler,
);

// ── helpers ───────────────────────────────────────────────────────────
const getMonthStart = () => {
  const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
};

const formatTime = (ts) => {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('en-US', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch { return ts; }
};

// no purple
const PIE_COLORS = [
  '#ef4444', '#f97316', '#eab308',
  '#84cc16', '#14b8a6', '#0ea5e9',
  '#f43f5e', '#a16207', '#6b7280',
];

const getRisk = (n) => {
  if (n >= 100) return { label: 'CRITICAL', textCls: 'text-red-400',    bgCls: 'bg-signal-error/10 border-red-300',      dot: 'bg-signal-error',     lineColor: '#ef4444' };
  if (n >= 50)  return { label: 'WARNING',  textCls: 'text-amber-400',  bgCls: 'bg-signal-warn/10 border-amber-300',   dot: 'bg-signal-warn',   lineColor: '#f59e0b' };
  if (n >= 20)  return { label: 'CAUTION',  textCls: 'text-yellow-400', bgCls: 'bg-signal-warn/10 border-yellow-300', dot: 'bg-signal-warn',  lineColor: '#eab308' };
  return              { label: 'GOOD',     textCls: 'text-emerald-400',bgCls: 'bg-signal-ok/10 border-emerald-300',dot: 'bg-signal-ok', lineColor: '#10b981' };
};

// ── component ─────────────────────────────────────────────────────────
export default function NGDashboard() {
  const { getValidToken } = useContext(AuthCtx);
  const [all, setAll]         = useState([]);
  const [loading, setLoading] = useState(true);
  const [trend, setTrend]     = useState({ labels: [], data: [] });
  const [filter, setFilter]   = useState('all');   // 'all' | 'active' | 'fixed'
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const dashRef   = useRef(null);
  const wsRef     = useRef(null);
  const scrollRef = useRef(null);

  // ── trend ──────────────────────────────────────────────────────────
  const buildTrend = useCallback((items) => {
    const start = getMonthStart();
    const days  = Math.floor((Date.now() - start) / 86_400_000) + 1;
    const labels = [], data = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      labels.push(d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }));
      const s = new Date(d); s.setHours(0,0,0,0);
      const e = new Date(d); e.setHours(23,59,59,999);
      data.push(items.filter(x => { const t = new Date(x.timestamp); return t >= s && t <= e; }).length);
    }
    setTrend({ labels, data });
  }, []);

  // ── fetch ──────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get('assembly_inventory/list/ng', {
        params: { limit: 2000, include_fixed: true },
      });
      const unique = Array.from(
        new Map((data || []).map(x => [x.us_sn || x.id, x])).values()
      );
      const start = getMonthStart();
      const month = unique.filter(x => x.timestamp && new Date(x.timestamp) >= start);
      setAll(month);
      buildTrend(month);
      setLastUpdated(new Date());
    } catch (e) {
      console.error('NGDashboard fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [buildTrend]);

  // ── websocket ──────────────────────────────────────────────────────
  useEffect(() => {
    fetchData();
    const { destroy } = openDashboardSocket(
      (msg) => {
        if (['assembly_status_updated','assembly_updated'].includes(msg.event)) fetchData();
      },
      () => {}, 30_000, getValidToken,
    );
    wsRef.current = { destroy };
    return () => wsRef.current?.destroy?.();
  }, [fetchData, getValidToken]);

  // ── auto-scroll ────────────────────────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const id = setInterval(() => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) el.scrollTop = 0;
      else el.scrollTop += 1;
    }, 50);
    return () => clearInterval(id);
  }, [all]);

  // ── fullscreen ─────────────────────────────────────────────────────
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) dashRef.current?.requestFullscreen?.();
    else document.exitFullscreen?.();
  }, []);

  // ── derived ────────────────────────────────────────────────────────
  const totalNG    = all.length;
  const fixedCount = all.filter(x => ['FIXED','OK'].includes((x.status||'').toUpperCase()) || x.fixed).length;
  const activeCount = totalNG - fixedCount;
  const passRate   = totalNG > 0 ? ((fixedCount / totalNG) * 100).toFixed(1) : '—';
  const risk = getRisk(activeCount);

  const displayed = filter === 'active' ? all.filter(x => !['FIXED','OK'].includes((x.status||'').toUpperCase()) && !x.fixed)
                  : filter === 'fixed'  ? all.filter(x => ['FIXED','OK'].includes((x.status||'').toUpperCase()) || x.fixed)
                  : all;

  // ── pie data ───────────────────────────────────────────────────────
  const pieData = React.useMemo(() => {
    const counts = {};
    all.forEach(x => {
      const r = (x.ng_reason || 'Unknown').trim() || 'Unknown';
      counts[r] = (counts[r] || 0) + 1;
    });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const shown  = sorted.reduce((s, [,v]) => s + v, 0);
    if (totalNG - shown > 0) sorted.push(['Others', totalNG - shown]);
    return {
      labels: sorted.map(([k]) => k),
      datasets: [{
        data: sorted.map(([,v]) => v),
        backgroundColor: PIE_COLORS.slice(0, sorted.length),
        borderColor: '#fff', borderWidth: 2,
      }],
    };
  }, [all, totalNG]);

  // ── render ─────────────────────────────────────────────────────────
  return (
    <div
      ref={dashRef}
      className="h-screen bg-surface-base flex flex-col overflow-hidden"
      onDoubleClick={toggleFullscreen}
    >
      {/* ── header ──────────────────────────────────────────────── */}
      <header className="flex-shrink-0 bg-surface-panel border-b border-stroke shadow-sm z-40">
        <div className="px-5 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-signal-error/15 rounded-lg">
              <Activity className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-ink-primary leading-tight">NG Dashboard</h1>
              <p className="text-xs text-stone-400">Assembly NG · This Month</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {lastUpdated && (
              <div className="hidden md:flex items-center gap-1.5 text-xs text-stone-400">
                <Clock size={11} />
                {lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
              </div>
            )}
            <div className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md border ${risk.bgCls} ${risk.textCls}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${risk.dot}`} />
              {risk.label}
            </div>
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stroke bg-surface-panel text-ink-secondary text-xs font-semibold hover:bg-surface-base disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              onClick={toggleFullscreen}
              className="p-1.5 rounded-lg border border-stroke text-ink-muted hover:bg-surface-base transition-colors"
              title="Toggle fullscreen"
            >
              {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          </div>
        </div>
      </header>

      {/* ── body ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col gap-4 px-5 py-4 min-h-0 overflow-hidden">

        {/* stats row */}
        <div className="flex-shrink-0 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-surface-panel rounded-lg border border-stroke px-4 py-3 shadow-sm">
            <p className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide">Total NG</p>
            <p className="text-3xl font-black font-mono text-ink-primary mt-0.5">{totalNG}</p>
          </div>
          <div className="bg-surface-panel rounded-lg border border-red-500/30 px-4 py-3 shadow-sm">
            <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wide">Active NG</p>
            <p className="text-3xl font-black font-mono text-red-400 mt-0.5">{activeCount}</p>
          </div>
          <div className="bg-surface-panel rounded-lg border border-emerald-500/30 px-4 py-3 shadow-sm">
            <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wide">Fixed</p>
            <p className="text-3xl font-black font-mono text-emerald-400 mt-0.5">{fixedCount}</p>
          </div>
          <div className="bg-surface-panel rounded-lg border border-teal-500/30 px-4 py-3 shadow-sm">
            <p className="text-[10px] font-semibold text-teal-400 uppercase tracking-wide">Fix Rate</p>
            <p className="text-3xl font-black font-mono text-teal-400 mt-0.5">
              {passRate === '—' ? '—' : `${passRate}%`}
            </p>
          </div>
        </div>

        {/* main split — fills remaining height */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[380px_1fr] xl:grid-cols-[420px_1fr] gap-4 min-h-0">

          {/* left: charts */}
          <div className="flex flex-col gap-4 min-h-0 overflow-y-auto">

            {/* trend chart */}
            <div className="bg-surface-panel rounded-lg border border-stroke shadow-sm flex-shrink-0">
              <div className="px-4 py-3 border-b border-stroke-subtle">
                <p className="text-[10px] uppercase tracking-widest text-stone-400 font-semibold">Daily Trend</p>
                <h3 className="text-sm font-semibold text-ink-primary mt-0.5">NG Count — This Month</h3>
              </div>
              <div className="p-4" style={{ height: 200 }}>
                {trend.labels.length > 0 ? (
                  <Line
                    data={{
                      labels: trend.labels,
                      datasets: [{
                        label: 'NG',
                        data: trend.data,
                        borderColor: risk.lineColor,
                        backgroundColor: risk.lineColor + '18',
                        tension: 0.4, fill: true,
                        pointRadius: 3,
                        pointBackgroundColor: risk.lineColor,
                        pointBorderColor: '#fff', pointBorderWidth: 2,
                      }],
                    }}
                    options={{
                      responsive: true, maintainAspectRatio: false,
                      plugins: {
                        legend: { display: false },
                        tooltip: { backgroundColor: 'rgba(28,28,30,0.9)', padding: 10, cornerRadius: 6 },
                      },
                      scales: {
                        y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 10 } } },
                        x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
                      },
                    }}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-stone-300 text-sm">No data</div>
                )}
              </div>
            </div>

            {/* pie chart */}
            <div className="bg-surface-panel rounded-lg border border-stroke shadow-sm flex-shrink-0">
              <div className="px-4 py-3 border-b border-stroke-subtle">
                <p className="text-[10px] uppercase tracking-widest text-stone-400 font-semibold">Breakdown</p>
                <h3 className="text-sm font-semibold text-ink-primary mt-0.5">NG Reason Distribution</h3>
              </div>
              <div className="p-4" style={{ height: 220 }}>
                {totalNG > 0 ? (
                  <Pie
                    data={pieData}
                    options={{
                      responsive: true, maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          position: 'right',
                          labels: { font: { size: 9, weight: '600' }, padding: 8, color: '#525252', boxWidth: 8, usePointStyle: true },
                        },
                        tooltip: {
                          backgroundColor: 'rgba(28,28,30,0.9)', padding: 10, cornerRadius: 6,
                          callbacks: {
                            label: (ctx) => {
                              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                              return `${ctx.label}: ${ctx.parsed} (${((ctx.parsed / total) * 100).toFixed(1)}%)`;
                            },
                          },
                        },
                      },
                    }}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-stone-300 text-sm">No NG data</div>
                )}
              </div>
            </div>
          </div>

          {/* right: NG list */}
          <div className="bg-surface-panel rounded-lg border border-stroke shadow-sm flex flex-col min-h-0 overflow-hidden">

            {/* list header */}
            <div className="flex-shrink-0 px-5 py-3 border-b border-stroke-subtle flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-stone-400 font-semibold">Assembly Line</p>
                <h3 className="text-sm font-semibold text-ink-primary mt-0.5">
                  NG Units
                  <span className="ml-2 text-xs font-normal text-stone-400">({displayed.length} shown)</span>
                </h3>
              </div>

              {/* filter tabs */}
              <div className="flex rounded-lg border border-stroke overflow-hidden text-xs font-semibold">
                {[
                  { key: 'all',    label: `All (${totalNG})` },
                  { key: 'active', label: `Active (${activeCount})` },
                  { key: 'fixed',  label: `Fixed (${fixedCount})` },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    className={`px-3 py-1.5 transition-colors ${
                      filter === key
                        ? 'bg-stone-800 text-white'
                        : 'bg-surface-panel text-ink-secondary hover:bg-surface-base'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* column headers */}
            <div className="flex-shrink-0 grid grid-cols-[2rem_1.6fr_2fr_1.2fr] gap-3 px-5 py-2 bg-surface-base border-b border-stroke-subtle">
              <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide">#</span>
              <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide">Serial No.</span>
              <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide">NG Reason</span>
              <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide">Time</span>
            </div>

            {/* scrolling rows */}
            {loading && all.length === 0 ? (
              <div className="flex-1 flex items-center justify-center gap-2 text-stone-400">
                <RefreshCw size={16} className="animate-spin" />
                <span className="text-sm">Loading...</span>
              </div>
            ) : displayed.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-stone-400">
                <CheckCircle size={28} className="text-emerald-400" />
                <p className="text-sm font-medium text-ink-muted">
                  {filter === 'active' ? 'No active NG — all cleared!' : 'No records found'}
                </p>
              </div>
            ) : (
              <div ref={scrollRef} className="flex-1 overflow-y-auto divide-y divide-stone-50">
                {displayed.map((item, i) => {
                  const isFixed = ['FIXED','OK'].includes((item.status||'').toUpperCase()) || item.fixed;
                  return (
                    <div
                      key={item.id || i}
                      className={`grid grid-cols-[2rem_1.6fr_2fr_1.2fr] gap-3 px-5 py-3 transition-colors
                        ${isFixed ? 'hover:bg-signal-ok/10' : 'hover:bg-signal-error/10'}`}
                    >
                      <span className="text-xs font-mono text-stone-300 self-center">{i + 1}</span>
                      <span className="font-mono text-xs font-semibold text-ink-secondary self-center break-all">
                        {item.us_sn || item.id || '—'}
                      </span>
                      <span className={`text-sm font-medium leading-snug self-center ${isFixed ? 'text-emerald-400' : 'text-red-400'}`}>
                        <span>{item.ng_reason || 'No reason'}</span>
                        {isFixed && (
                          <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-400 bg-signal-ok/10 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                            <CheckCircle size={9} /> FIXED
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-stone-400 self-center">{formatTime(item.timestamp)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
