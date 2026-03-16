import React, { useContext, useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  RefreshCw, Cpu, AlertTriangle, BarChart2,
  ChevronRight, TrendingUp, MousePointerClick,
  Search, X, Box,
} from "lucide-react";

import useNGClusters from "../wipTracking/hooks/useNGClusters";
import NGClusterDetail from "./NGClusterDetail";
import { AuthCtx } from "../../auth/AuthContext";
import api from "../../services/api";
import Plot3D from "../../components/Plot3D";

/* ── Pareto bar ─────────────────────────────────────────────────────── */
function ParetoBar({ pct, color }) {
  return (
    <div className="relative w-full h-2.5 bg-stone-100 rounded-sm overflow-hidden">
      <div
        className={`absolute inset-y-0 left-0 rounded-sm transition-all duration-700 ${color}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

/* ── Cluster row ─────────────────────────────────────────────────────── */
function ClusterRow({ cluster, rank, cumPct, isActive, onClick, searchTerm }) {
  const barColor =
    rank === 0 ? "bg-red-500"
    : rank === 1 ? "bg-amber-500"
    : rank <= 3  ? "bg-amber-400"
    : rank <= 5  ? "bg-stone-400"
    : "bg-stone-300";

  const rankBg =
    rank === 0 ? "bg-red-100 text-red-700"
    : rank === 1 ? "bg-amber-100 text-amber-700"
    : rank <= 3  ? "bg-amber-50 text-amber-600"
    : "bg-stone-100 text-stone-500";

  // Highlight matched search term
  const label = cluster.representative;
  const highlighted = useMemo(() => {
    if (!searchTerm) return label;
    const idx = label.toLowerCase().indexOf(searchTerm.toLowerCase());
    if (idx === -1) return label;
    return (
      <>
        {label.slice(0, idx)}
        <mark className="bg-amber-200 text-amber-900 rounded-sm px-0.5">
          {label.slice(idx, idx + searchTerm.length)}
        </mark>
        {label.slice(idx + searchTerm.length)}
      </>
    );
  }, [label, searchTerm]);

  return (
    <button
      className={`w-full text-left border rounded-lg overflow-hidden bg-white shadow-sm transition-colors group
        ${isActive
          ? "border-teal-400 ring-2 ring-teal-200 shadow-md"
          : "border-stone-200 hover:border-stone-300 hover:shadow-md"
        }`}
      onClick={onClick}
    >
      <div className="px-4 py-3">
        <div className="flex items-center gap-3 mb-2">
          <span className={`shrink-0 w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center ${rankBg}`}>
            {rank + 1}
          </span>
          <span className="flex-1 text-sm font-semibold text-stone-800 truncate">
            {highlighted}
          </span>
          <div className="shrink-0 flex items-center gap-3 text-right">
            <div>
              <div className="text-lg font-black font-mono text-stone-800 leading-none">{cluster.count}</div>
              <div className="text-[10px] text-stone-400 uppercase tracking-wide">cases</div>
            </div>
            <div className="w-16">
              <div className="text-sm font-bold text-stone-600 leading-none">{cluster.pct}%</div>
              <div className="text-[10px] text-stone-400 leading-none mt-0.5">cum {cumPct}%</div>
            </div>
            <ChevronRight
              size={14}
              className={`transition-colors ${isActive ? "text-teal-500" : "text-stone-300 group-hover:text-stone-500"}`}
            />
          </div>
        </div>
        <ParetoBar pct={cluster.pct} color={barColor} />
      </div>
    </button>
  );
}

/* ── SVG Pareto chart ───────────────────────────────────────────────── */
function ParetoChart({ clusters, onSelect, activeId }) {
  const items = clusters.slice(0, 10);
  const CW = 520, CH = 260;
  const PAD = { top: 24, right: 44, bottom: 64, left: 40 };
  const W = CW - PAD.left - PAD.right;
  const H = CH - PAD.top - PAD.bottom;
  const maxCount = Math.max(...items.map((c) => c.count), 1);
  const barW = W / items.length;
  const GAP = 5;

  const fillColor = (i, id) => {
    if (id === activeId) return "#0d9488"; // teal for active
    return i === 0 ? "#ef4444" : i === 1 ? "#f59e0b" : i <= 3 ? "#fbbf24" : i <= 5 ? "#a8a29e" : "#d6d3d1";
  };

  const ref80Y = PAD.top + H * 0.2;

  return (
    <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full h-auto select-none" style={{ fontFamily: "Inter, sans-serif" }}>
      {[0, 25, 50, 75, 100].map((pct) => {
        const y = PAD.top + H - (pct / 100) * H;
        return (
          <g key={pct}>
            <line x1={PAD.left} y1={y} x2={CW - PAD.right} y2={y} stroke="#e7e5e4" strokeWidth="1" />
            <text x={PAD.left - 5} y={y + 4} fontSize="9" fill="#a8a29e" textAnchor="end">{pct}%</text>
          </g>
        );
      })}
      <line x1={PAD.left} y1={ref80Y} x2={CW - PAD.right} y2={ref80Y}
        stroke="#d97706" strokeWidth="1.5" strokeDasharray="5 3" />
      <text x={CW - PAD.right + 4} y={ref80Y + 4} fontSize="9" fill="#d97706" fontWeight="700">80%</text>

      {items.map((c, i) => {
        const bx = PAD.left + i * barW + GAP / 2;
        const bw = barW - GAP;
        const bh = Math.max(2, (c.count / maxCount) * H);
        const by = PAD.top + H - bh;
        const isActive = c.cluster_id === activeId;
        return (
          <g key={c.cluster_id} style={{ cursor: "pointer" }} onClick={() => onSelect(c)}>
            <rect x={bx} y={by} width={bw} height={bh} fill={fillColor(i, c.cluster_id)} rx="3"
              opacity={isActive ? 1 : 0.85}
              style={{ transition: "all .2s" }}
            />
            {isActive && <rect x={bx - 1} y={by - 1} width={bw + 2} height={bh + 2} fill="none" stroke="#0d9488" strokeWidth="2" rx="4" />}
            {bh > 16 && (
              <text x={bx + bw / 2} y={by - 4} fontSize="9" fill="#44403c" textAnchor="middle" fontWeight="700">
                {c.count}
              </text>
            )}
            {/* invisible larger hit area */}
            <rect x={bx} y={PAD.top} width={bw} height={H} fill="transparent" />
          </g>
        );
      })}

      <polyline
        points={items.map((c, i) => {
          const x = PAD.left + (i + 0.5) * barW;
          const y = PAD.top + H - (c.cumPct / 100) * H;
          return `${x},${y}`;
        }).join(" ")}
        fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinejoin="round"
      />
      {items.map((c, i) => {
        const x = PAD.left + (i + 0.5) * barW;
        const y = PAD.top + H - (c.cumPct / 100) * H;
        return (
          <g key={i} style={{ cursor: "pointer" }} onClick={() => onSelect(c)}>
            <circle cx={x} cy={y} r="5" fill="white" stroke="#f59e0b" strokeWidth="2" />
            <circle cx={x} cy={y} r="10" fill="transparent" />
          </g>
        );
      })}

      {items.map((c, i) => {
        const x = PAD.left + (i + 0.5) * barW;
        const label = c.representative.length > 14 ? c.representative.slice(0, 13) + "…" : c.representative;
        return (
          <text key={i} x={x} y={PAD.top + H + 10} fontSize="8.5" fill="#78716c"
            textAnchor="end" transform={`rotate(-38, ${x}, ${PAD.top + H + 10})`}
            style={{ cursor: "pointer" }} onClick={() => onSelect(c)}
          >
            {label}
          </text>
        );
      })}

      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + H} stroke="#d6d3d1" strokeWidth="1" />
      <line x1={PAD.left} y1={PAD.top + H} x2={CW - PAD.right} y2={PAD.top + H} stroke="#d6d3d1" strokeWidth="1" />
      <rect x={CW - PAD.right - 60} y={PAD.top} width={10} height={10} fill="#ef4444" rx="2" opacity="0.85" />
      <text x={CW - PAD.right - 47} y={PAD.top + 9} fontSize="8.5" fill="#78716c">Count</text>
      <line x1={CW - PAD.right - 60} y1={PAD.top + 22} x2={CW - PAD.right - 50} y2={PAD.top + 22} stroke="#f59e0b" strokeWidth="2.5" />
      <circle cx={CW - PAD.right - 55} cy={PAD.top + 22} r="3" fill="white" stroke="#f59e0b" strokeWidth="2" />
      <text x={CW - PAD.right - 47} y={PAD.top + 26} fontSize="8.5" fill="#78716c">Cum %</text>
    </svg>
  );
}

/* ── NG 3D Scatter panel ─────────────────────────────────────────────── */
function NG3DPanel() {
  const [data3d, setData3d] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get("ml/ng-3d", { params: { days: 60 } })
      .then((r) => setData3d(r.data))
      .catch(() => setData3d(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="bg-white border border-stone-200 rounded-lg shadow-sm flex items-center justify-center" style={{ height: 480 }}>
        <div className="text-center text-stone-400">
          <div className="animate-spin w-8 h-8 border-2 border-stone-200 border-t-teal-500 rounded-full mx-auto mb-2" />
          <p className="text-sm font-medium">Loading 3D data…</p>
        </div>
      </div>
    );
  }

  const points = data3d?.data || [];
  const clusters = data3d?.clusters || [];
  const dates = data3d?.dates || [];

  if (!points.length || !clusters.length) {
    return (
      <div className="bg-white border border-stone-200 rounded-lg shadow-sm flex flex-col items-center justify-center py-24 text-center px-8">
        <Box size={44} className="text-stone-200 mb-4" />
        <p className="text-stone-500 font-semibold">No 3D data yet</p>
        <p className="text-stone-400 text-sm mt-1">Run Clustering first, then data will appear here</p>
      </div>
    );
  }

  // Build one scatter3d trace per cluster
  const palette = ["#ef4444","#f59e0b","#fbbf24","#0d9488","#0891b2","#6366f1","#ec4899","#10b981","#8b5cf6","#f97316","#14b8a6","#3b82f6"];
  const traces = clusters.map((clusterName, ci) => {
    const pts = points.filter((p) => p.cluster === clusterName);
    return {
      type: "scatter3d",
      mode: "markers",
      name: clusterName.length > 18 ? clusterName.slice(0, 17) + "…" : clusterName,
      x: pts.map((p) => dates.indexOf(p.date)),
      y: pts.map(() => ci),
      z: pts.map((p) => p.count),
      text: pts.map((p) => `${p.cluster}<br>Date: ${p.date}<br>Count: ${p.count}`),
      hovertemplate: "%{text}<extra></extra>",
      marker: {
        size: pts.map((p) => Math.min(4 + p.count * 1.5, 18)),
        color: palette[ci % palette.length],
        opacity: 0.85,
        line: { width: 0.5, color: "white" },
      },
    };
  });

  return (
    <div className="bg-white border border-stone-200 rounded-lg shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-stone-100">
        <p className="text-[10px] uppercase tracking-[0.28em] text-stone-400 font-semibold mb-0.5">3D Scatter</p>
        <h3 className="text-stone-800 font-semibold text-base leading-tight">NG Cluster × Date × Count</h3>
        <p className="text-xs text-stone-400 mt-0.5">Past 60 days · drag to rotate · bubble size = count</p>
      </div>
      <Plot3D
        title=""
        xTitle="Date (index)"
        yTitle="Cluster"
        zTitle="Count"
        height={440}
        data={traces}
        layout={{
          scene: {
            camera: { eye: { x: 1.6, y: 1.6, z: 1.0 } },
            xaxis: { backgroundcolor: "#fafafa", gridcolor: "#e5e7eb", title: "Day", tickmode: "array", tickvals: dates.map((_, i) => i), ticktext: dates.map((d) => d.slice(5)) },
            yaxis: { backgroundcolor: "#fafafa", gridcolor: "#e5e7eb", title: "Cluster", tickmode: "array", tickvals: clusters.map((_, i) => i), ticktext: clusters.map((c) => c.length > 10 ? c.slice(0, 9) + "…" : c) },
            zaxis: { backgroundcolor: "#f0fdf4", gridcolor: "#bbf7d0", title: "Count" },
          },
          legend: { x: 0, y: 1, font: { size: 9 } },
          margin: { l: 0, r: 0, t: 10, b: 0 },
          paper_bgcolor: "white",
        }}
      />
    </div>
  );
}

/* ── Right idle panel ────────────────────────────────────────────────── */
function RightIdlePanel({ clusters, onSelect, activeId }) {
  if (!clusters?.length) {
    return (
      <div className="bg-white border border-stone-200 rounded-lg shadow-sm flex flex-col items-center justify-center py-24 text-center px-8">
        <BarChart2 size={44} className="text-stone-200 mb-4" />
        <p className="text-stone-500 font-semibold text-base">No cluster data yet</p>
        <p className="text-stone-400 text-sm mt-1">Press "Run Clustering" to analyse NG reasons</p>
      </div>
    );
  }

  const insightIdx = clusters.findIndex((c) => c.cumPct >= 80);
  const topN = insightIdx >= 0 ? insightIdx + 1 : clusters.length;
  const topCumPct = clusters[insightIdx >= 0 ? insightIdx : clusters.length - 1]?.cumPct ?? 0;
  const topCluster = clusters[0];

  return (
    <div className="bg-white border border-stone-200 rounded-lg shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.28em] text-stone-400 font-semibold mb-0.5">Pareto Chart</p>
          <h3 className="text-stone-800 font-semibold text-base leading-tight">Failure Frequency Distribution</h3>
        </div>
        <p className="text-[11px] text-stone-400 flex items-center gap-1">
          <MousePointerClick size={11} />
          click bar to explore
        </p>
      </div>
      <div className="px-4 pt-4 pb-2">
        <ParetoChart clusters={clusters} onSelect={onSelect} activeId={activeId} />
      </div>
      <div className="px-5 pb-5 pt-1 flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <TrendingUp size={12} className="shrink-0" />
          <span>
            Top <strong>{topN}</strong> cluster{topN > 1 ? "s" : ""} →{" "}
            <strong>{topCumPct}%</strong> of all failures (80/20 rule)
          </span>
        </div>
        {topCluster && (
          <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <span className="shrink-0 w-4 h-4 bg-red-200 rounded text-[9px] font-bold flex items-center justify-center">1</span>
            <span>Biggest issue: <strong>{topCluster.representative}</strong> ({topCluster.pct}% of NGs)</span>
          </div>
        )}
        <p className="text-[11px] text-stone-400 text-center pt-1">
          Select a cluster on the left to see root-cause details →
        </p>
      </div>
    </div>
  );
}

/* ── Mobile bottom sheet ─────────────────────────────────────────────── */
function BottomSheet({ cluster, onClose }) {
  const sheetRef = useRef(null);

  // Prevent body scroll when open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return (
    <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" />
      <div
        ref={sheetRef}
        className="relative bg-white rounded-t-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: "88vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-stone-300 rounded-full" />
        </div>
        <NGClusterDetail
          clusterId={cluster.cluster_id}
          representative={cluster.representative}
          totalCount={cluster.count}
          onClose={onClose}
          inline
        />
      </div>
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────────────────── */
export default function NGAnalysis() {
  const { role } = useContext(AuthCtx);
  const isAdmin = role === "admin";

  const [selectedCluster, setSelectedCluster] = useState(null);
  const [search, setSearch] = useState("");
  const [showRetrainBanner, setShowRetrainBanner] = useState(false);
  const [rightView, setRightView] = useState("pareto"); // "pareto" | "3d"
  const searchRef = useRef(null);
  const listRef = useRef(null);

  const {
    clusters, totalNG, loading, error,
    refresh, triggerRetrain, retraining, retrainMsg,
  } = useNGClusters();

  // Initial load
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cumulative %
  const withCum = useMemo(() => {
    let acc = 0;
    return (clusters || []).map((c) => {
      acc += c.pct;
      return { ...c, cumPct: Math.min(Math.round(acc), 100) };
    });
  }, [clusters]);

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return withCum;
    const q = search.toLowerCase();
    return withCum.filter((c) => c.representative.toLowerCase().includes(q));
  }, [withCum, search]);

  // Auto-select top cluster when data loads
  useEffect(() => {
    if (withCum.length > 0 && !selectedCluster) {
      setSelectedCluster(withCum[0]);
    }
  }, [withCum]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-dismiss retrainMsg
  useEffect(() => {
    if (retrainMsg) {
      setShowRetrainBanner(true);
      const id = setTimeout(() => setShowRetrainBanner(false), 10_000);
      return () => clearTimeout(id);
    }
  }, [retrainMsg]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e) => {
      // Don't intercept when typing in search box
      if (document.activeElement === searchRef.current) return;

      if (e.key === "Escape") {
        setSelectedCluster(null);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setSelectedCluster((prev) => {
          const idx = prev ? filtered.findIndex((c) => c.cluster_id === prev.cluster_id) : -1;
          return filtered[Math.min(idx + 1, filtered.length - 1)] ?? prev;
        });
      }
      if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setSelectedCluster((prev) => {
          const idx = prev ? filtered.findIndex((c) => c.cluster_id === prev.cluster_id) : 0;
          return filtered[Math.max(idx - 1, 0)] ?? prev;
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filtered]);

  // Scroll selected cluster into view in the list
  useEffect(() => {
    if (!selectedCluster || !listRef.current) return;
    const activeBtn = listRef.current.querySelector("[data-active='true']");
    activeBtn?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedCluster]);

  // Derived stats
  const topPct = withCum[0]?.pct ?? 0;
  const clusteredTotal = withCum.reduce((s, c) => s + c.count, 0);
  const noiseCount = Math.max(0, totalNG - clusteredTotal);
  const coveragePct = totalNG > 0 ? Math.round((clusteredTotal / totalNG) * 100) : 0;

  const handleSelect = (c) => {
    setSelectedCluster((prev) => prev?.cluster_id === c.cluster_id ? null : c);
  };

  return (
    <div className="min-h-screen bg-stone-50 pb-20 md:pb-8">

      {/* ── sticky header ──────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-white border-b border-stone-200 shadow-sm">
        <div className="px-4 md:px-6 py-3 md:py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 rounded-lg">
              <BarChart2 className="w-5 h-5 md:w-6 md:h-6 text-red-600" />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-bold text-stone-900 leading-tight">ATE NG Analysis</h1>
              <p className="text-xs text-stone-400 font-medium hidden md:block">
                ML · Pareto cluster analysis
                <span className="ml-2 text-stone-300">·</span>
                <span className="ml-2">↑↓ to navigate · ESC to close</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button
                onClick={triggerRetrain}
                disabled={retraining}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs font-semibold hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Cpu size={13} className={retraining ? "animate-pulse" : ""} />
                <span className="hidden sm:inline">{retraining ? "Running..." : "Run Clustering"}</span>
                <span className="sm:hidden">{retraining ? "…" : "Cluster"}</span>
              </button>
            )}
            <button
              onClick={refresh}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-200 bg-white text-stone-600 text-xs font-semibold hover:bg-stone-50 disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        {/* retrain banner — auto-dismisses */}
        {showRetrainBanner && retrainMsg && (
          <div className="px-4 md:px-6 pb-3 flex items-center gap-2">
            <div className="flex-1 text-xs text-teal-700 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2">
              {retrainMsg} — clustering runs in background, results appear in ~10s
            </div>
            <button
              onClick={() => setShowRetrainBanner(false)}
              className="p-1 text-stone-400 hover:text-stone-600 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </header>

      <main className="px-4 py-4 md:px-6 md:py-5 space-y-4 md:space-y-5">

        {/* ── stats cards ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <div className="bg-white rounded-lg border border-stone-200 p-3 md:p-4 shadow-sm">
            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Total NG</p>
            <p className="text-2xl md:text-3xl font-bold text-stone-800 mt-1">{totalNG.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-lg border border-red-200 p-3 md:p-4 shadow-sm">
            <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">Clusters</p>
            <p className="text-2xl md:text-3xl font-bold text-red-700 mt-1">{clusters?.length ?? 0}</p>
          </div>
          <div className="bg-white rounded-lg border border-amber-200 p-3 md:p-4 shadow-sm">
            <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Top Issue</p>
            <p className="text-2xl md:text-3xl font-bold text-amber-700 mt-1">{topPct > 0 ? `${topPct}%` : "—"}</p>
          </div>
          <div className="bg-white rounded-lg border border-stone-200 p-3 md:p-4 shadow-sm">
            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Coverage</p>
            <p className="text-2xl md:text-3xl font-bold text-stone-700 mt-1">{totalNG > 0 ? `${coveragePct}%` : "—"}</p>
            {noiseCount > 0 && (
              <p className="text-[10px] text-stone-400 mt-0.5">{noiseCount} unclustered</p>
            )}
          </div>
        </div>

        {/* ── error state ──────────────────────────────────────────── */}
        {!loading && error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <AlertTriangle size={16} className="shrink-0" />
            {error}
          </div>
        )}

        {/* ── split layout ─────────────────────────────────────────── */}
        <div className="lg:flex lg:gap-5 lg:items-start">

          {/* Left: cluster list */}
          <div className="lg:w-[460px] xl:w-[520px] shrink-0">

            {/* search bar */}
            {withCum.length > 3 && (
              <div className="relative mb-3">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter clusters..."
                  className="w-full pl-8 pr-8 py-2 text-sm bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-teal-400 transition-colors"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            )}

            {/* list */}
            <div ref={listRef} className="space-y-3">

              {loading && !clusters?.length && (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-[76px] bg-white border border-stone-200 rounded-lg animate-pulse" />
                  ))}
                </div>
              )}

              {!loading && !error && clusters?.length === 0 && (
                <div className="flex flex-col items-center gap-3 py-20 bg-white border border-stone-200 rounded-lg">
                  <BarChart2 size={40} className="text-stone-200" />
                  <p className="text-base font-semibold text-stone-500">No clusters yet</p>
                  <p className="text-sm text-stone-400 text-center px-8">
                    {isAdmin
                      ? 'Press "Run Clustering" above to analyse existing NG reasons.'
                      : "Ask an admin to run clustering."}
                  </p>
                </div>
              )}

              {search && filtered.length === 0 && withCum.length > 0 && (
                <div className="flex flex-col items-center gap-2 py-12 bg-white border border-stone-200 rounded-lg">
                  <Search size={28} className="text-stone-200" />
                  <p className="text-sm text-stone-400">No clusters match "{search}"</p>
                  <button onClick={() => setSearch("")} className="text-xs text-teal-600 hover:underline">Clear search</button>
                </div>
              )}

              {!error && (() => {
                const list = filtered;
                if (!list.length) return null;
                const eightyIdx = list.findIndex((c) => c.cumPct >= 80);
                return (
                  <>
                    {list.slice(0, eightyIdx + 1).map((c, i) => (
                      <div key={c.cluster_id} data-active={selectedCluster?.cluster_id === c.cluster_id ? "true" : "false"}>
                        <ClusterRow
                          cluster={c} rank={c._origRank ?? i} cumPct={c.cumPct}
                          isActive={selectedCluster?.cluster_id === c.cluster_id}
                          onClick={() => handleSelect(c)}
                          searchTerm={search}
                        />
                      </div>
                    ))}

                    {!search && eightyIdx >= 0 && eightyIdx < list.length - 1 && (
                      <div className="flex items-center gap-3 py-1">
                        <div className="flex-1 border-t border-dashed border-amber-300" />
                        <div className="flex items-center gap-1.5 text-xs text-amber-600 font-semibold bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
                          <TrendingUp size={11} />
                          80% of failures above
                        </div>
                        <div className="flex-1 border-t border-dashed border-amber-300" />
                      </div>
                    )}

                    {list.slice(eightyIdx + 1).map((c, i) => (
                      <div key={c.cluster_id} data-active={selectedCluster?.cluster_id === c.cluster_id ? "true" : "false"}>
                        <ClusterRow
                          cluster={c} rank={c._origRank ?? (eightyIdx + 1 + i)} cumPct={c.cumPct}
                          isActive={selectedCluster?.cluster_id === c.cluster_id}
                          onClick={() => handleSelect(c)}
                          searchTerm={search}
                        />
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>
          </div>

          {/* Right: detail or Pareto/3D (desktop) */}
          <div className="hidden lg:block flex-1 min-w-0 sticky top-[69px]">
            {selectedCluster ? (
              <NGClusterDetail
                clusterId={selectedCluster.cluster_id}
                representative={selectedCluster.representative}
                totalCount={selectedCluster.count}
                onClose={() => setSelectedCluster(null)}
                inline
              />
            ) : (
              <div className="space-y-3">
                {/* Tab toggle */}
                <div className="flex gap-1 bg-stone-100 rounded-lg p-1 w-fit">
                  <button
                    onClick={() => setRightView("pareto")}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${rightView === "pareto" ? "bg-white text-stone-800 shadow-sm" : "text-stone-500 hover:text-stone-700"}`}
                  >
                    <span className="flex items-center gap-1.5"><BarChart2 size={11} />Pareto</span>
                  </button>
                  <button
                    onClick={() => setRightView("3d")}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${rightView === "3d" ? "bg-white text-stone-800 shadow-sm" : "text-stone-500 hover:text-stone-700"}`}
                  >
                    <span className="flex items-center gap-1.5"><Box size={11} />3D Scatter</span>
                  </button>
                </div>
                {rightView === "pareto" ? (
                  <RightIdlePanel
                    clusters={withCum}
                    onSelect={setSelectedCluster}
                    activeId={selectedCluster?.cluster_id}
                  />
                ) : (
                  <NG3DPanel />
                )}
              </div>
            )}
          </div>

        </div>
      </main>

      {/* Mobile bottom sheet */}
      {selectedCluster && (
        <BottomSheet cluster={selectedCluster} onClose={() => setSelectedCluster(null)} />
      )}

    </div>
  );
}
