import React, { useEffect, useState, useCallback } from "react";
import { X, RefreshCw, AlertTriangle, Calendar, Tag, Layers } from "lucide-react";
import api from "../../services/api";

/* ── tiny inline bar ─────────────────────────────────────────────────── */
function MiniBar({ pct, color = "bg-red-400" }) {
  return (
    <div className="flex-1 h-2 bg-stone-100 rounded-sm overflow-hidden">
      <div
        className={`h-2 rounded-sm transition-all duration-500 ${color}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

/* ── day histogram ───────────────────────────────────────────────────── */
function DayHistogram({ byDay }) {
  const [hovered, setHovered] = useState(null);
  if (!byDay?.length) return null;

  const max   = Math.max(...byDay.map((d) => d.count), 1);
  const total = byDay.reduce((s, d) => s + d.count, 0);
  const n     = byDay.length;

  const peakIdx = byDay.reduce(
    (best, d, i) => (d.count > byDay[best].count ? i : best),
    0
  );
  const peakDay  = byDay[peakIdx];
  const firstDay = byDay[0];
  const lastDay  = byDay[n - 1];

  /* show a label every N bars depending on density */
  const labelEvery = n <= 10 ? 1 : n <= 21 ? 3 : n <= 45 ? 7 : 14;

  const H     = 92;   /* bar area height px  */
  const LBL_H = 22;   /* x-axis label height */
  const BAR_W = 20;
  const GAP   = 2;

  /* 4-step colour ramp: lighter = fewer cases */
  const barColor = (count) => {
    const r = count / max;
    if (r >= 0.75) return "#ef4444"; /* red-500 */
    if (r >= 0.5)  return "#f87171"; /* red-400 */
    if (r >= 0.25) return "#fca5a5"; /* red-300 */
    return "#fecaca";                /* red-200 */
  };

  const hovD = hovered !== null ? byDay[hovered] : null;

  return (
    <div className="space-y-3">

      {/* ── summary pills ──────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 bg-white border border-stone-200 rounded-lg px-2.5 py-1.5">
          <span className="text-[8px] uppercase tracking-wider font-bold text-stone-400">First</span>
          <span className="text-[11px] font-semibold text-stone-600">{firstDay.day.slice(5)}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
          <span className="text-[8px] uppercase tracking-wider font-bold text-red-400">Peak</span>
          <span className="text-[11px] font-bold text-red-600">{peakDay.day.slice(5)}</span>
          <span className="text-[10px] font-mono font-bold text-red-500 bg-red-100 rounded px-1.5 py-px">
            {peakDay.count}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5 bg-white border border-stone-200 rounded-lg px-2.5 py-1.5">
          <span className="text-[8px] uppercase tracking-wider font-bold text-stone-400">Last</span>
          <span className="text-[11px] font-semibold text-stone-600">{lastDay.day.slice(5)}</span>
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5">
          <span className="text-[8px] uppercase tracking-wider font-bold text-stone-400">Span</span>
          <span className="text-[11px] font-semibold text-stone-600">{n}d</span>
        </span>
      </div>

      {/* ── bar chart ─────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <div
          className="relative select-none"
          style={{ minWidth: n * (BAR_W + GAP), height: H + LBL_H }}
          onMouseLeave={() => setHovered(null)}
        >
          {/* grid lines (inside bar area only) */}
          {[0.25, 0.5, 0.75, 1].map((r) => (
            <div
              key={r}
              className="absolute inset-x-0 border-t border-stone-100 pointer-events-none"
              style={{ top: Math.round((1 - r) * H) }}
            />
          ))}

          {/* bars */}
          {byDay.map((d, i) => {
            const barH   = Math.max(3, Math.round((d.count / max) * H));
            const isPeak = i === peakIdx;
            const isHov  = hovered === i;
            const showLabel = i % labelEvery === 0 || i === n - 1;
            const x = i * (BAR_W + GAP);

            return (
              <div
                key={d.day}
                className="absolute"
                style={{ left: x, width: BAR_W, top: 0, height: H + LBL_H }}
                onMouseEnter={() => setHovered(i)}
              >
                {/* peak ring dot */}
                {isPeak && (
                  <div
                    className="absolute w-2 h-2 rounded-full bg-red-500 ring-2 ring-white left-1/2 -translate-x-1/2"
                    style={{ top: H - barH - 8 }}
                  />
                )}

                {/* bar fill */}
                <div
                  className="absolute bottom-0 w-full rounded-t transition-opacity duration-100"
                  style={{
                    height: barH + LBL_H,       /* include label space so bar sits at correct bottom */
                    paddingBottom: LBL_H,
                    backgroundColor: "transparent",
                  }}
                >
                  <div
                    className="w-full rounded-t"
                    style={{
                      height: barH,
                      backgroundColor: barColor(d.count),
                      opacity: hovered !== null && !isHov ? 0.28 : 1,
                      transition: "opacity 0.1s, background-color 0.15s",
                    }}
                  />
                </div>

                {/* x-axis label */}
                {showLabel && (
                  <div
                    className="absolute text-stone-400 pointer-events-none"
                    style={{
                      bottom: 0,
                      left: 1,
                      fontSize: 9,
                      lineHeight: "12px",
                      transform: "rotate(-38deg)",
                      transformOrigin: "top left",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {d.day.slice(5)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── hover info strip ──────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg min-h-[34px]">
        {hovD ? (
          <>
            <span className="text-[11px] font-mono font-semibold text-stone-600">{hovD.day}</span>
            <span className="flex-1 border-t border-dashed border-stone-300" />
            <span className="text-[11px] font-mono font-bold text-red-600">
              {hovD.count} case{hovD.count !== 1 ? "s" : ""}
            </span>
            <span className="text-[10px] text-stone-400 font-medium">
              ({Math.round((hovD.count / total) * 100)}% of total)
            </span>
          </>
        ) : (
          <span className="text-[10px] text-stone-400 italic">Hover a bar to inspect</span>
        )}
      </div>

    </div>
  );
}

/* ── shared content body ─────────────────────────────────────────────── */
function DetailBody({ data, loading, error }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 text-stone-400 py-16">
        <RefreshCw size={16} className="animate-spin" />
        <span className="text-sm">Loading...</span>
      </div>
    );
  }

  if (!loading && error) {
    return (
      <div className="m-4 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
        <AlertTriangle size={14} />
        {error}
      </div>
    );
  }

  if (!loading && data && !data.records?.length && !data.by_reason?.length) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 px-6 text-center text-stone-400">
        <RefreshCw size={24} className="text-stone-300" />
        <p className="text-sm font-medium text-stone-500">No member data</p>
        <p className="text-xs leading-relaxed">
          This cluster was created before member tracking was added.
          Press <span className="font-semibold text-red-500">Run Clustering</span> on the main page to regenerate.
        </p>
      </div>
    );
  }

  if (!loading && data && (data.records?.length > 0 || data.by_reason?.length > 0)) {
    return (
      <div className="p-5 space-y-6">

        {/* Timeline */}
        {data.by_day?.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Calendar size={13} className="text-stone-400" />
              <span className="text-xs uppercase tracking-widest text-stone-400 font-semibold">
                Occurrence timeline
              </span>
            </div>
            <DayHistogram byDay={data.by_day} />
          </section>
        )}

        {/* Reason breakdown */}
        {data.by_reason?.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Tag size={13} className="text-stone-400" />
              <span className="text-xs uppercase tracking-widest text-stone-400 font-semibold">
                Exact reasons ({data.by_reason.length} variants)
              </span>
            </div>
            <div className="space-y-2">
              {data.by_reason.map((r, i) => {
                const pct = Math.round((r.count / (data.count || 1)) * 100);
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="shrink-0 w-5 h-5 rounded bg-stone-100 text-[9px] font-bold text-stone-500 flex items-center justify-center">
                      {i + 1}
                    </span>
                    <span className="flex-1 text-xs text-stone-700 truncate" title={r.reason}>
                      {r.reason}
                    </span>
                    <MiniBar pct={pct} color={i === 0 ? "bg-red-400" : "bg-stone-300"} />
                    <span className="shrink-0 w-8 text-right text-xs font-mono font-semibold text-stone-600">
                      {r.count}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Product line breakdown */}
        {data.by_product_line?.length > 1 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Layers size={13} className="text-stone-400" />
              <span className="text-xs uppercase tracking-widest text-stone-400 font-semibold">
                By product line
              </span>
            </div>
            <div className="space-y-2">
              {data.by_product_line.map((p, i) => {
                const pct = Math.round((p.count / (data.count || 1)) * 100);
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="flex-1 text-xs text-stone-700 truncate">{p.product_line}</span>
                    <MiniBar pct={pct} color="bg-amber-400" />
                    <span className="shrink-0 w-14 text-right text-xs text-stone-500">
                      {p.count} ({pct}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* All records */}
        {data.records?.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs uppercase tracking-widest text-stone-400 font-semibold">
                All records
              </span>
              <span className="text-xs text-stone-400">{data.records.length} shown</span>
            </div>
            <div className="border border-stone-200 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-stone-50 border-b border-stone-200">
                  <tr>
                    <th className="text-left px-3 py-2 text-stone-500 font-semibold">SN</th>
                    <th className="text-left px-3 py-2 text-stone-500 font-semibold">NG Reason</th>
                    <th className="text-left px-3 py-2 text-stone-500 font-semibold whitespace-nowrap">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {data.records.map((r, i) => (
                    <tr key={i} className="hover:bg-stone-50 transition-colors">
                      <td className="px-3 py-2 font-mono text-stone-700 whitespace-nowrap">{r.us_sn}</td>
                      <td className="px-3 py-2 text-stone-600 max-w-[200px] truncate" title={r.ng_reason}>
                        {r.ng_reason || "—"}
                      </td>
                      <td className="px-3 py-2 text-stone-400 whitespace-nowrap">
                        {r.scanned_at ? r.scanned_at.slice(0, 10) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    );
  }

  return null;
}

/* ── main detail panel ───────────────────────────────────────────────── */
export default function NGClusterDetail({
  clusterId,
  representative,
  totalCount,
  onClose,
  inline = false,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: d } = await api.get(`ml/ng-clusters/${clusterId}/detail`);
      setData(d);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load detail");
    } finally {
      setLoading(false);
    }
  }, [clusterId]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  /* ── shared header ── */
  const header = (
    <div className="flex-shrink-0 border-b border-stone-200 bg-stone-50 px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-widest text-red-500 font-semibold mb-1">
            Cluster · Root Cause Analysis
          </p>
          <h2 className="text-stone-900 font-bold text-base leading-tight truncate">
            {representative}
          </h2>
          <p className="text-stone-500 text-xs mt-0.5">{totalCount} total cases</p>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 p-1.5 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );

  /* ── inline mode (desktop right panel) ── */
  if (inline) {
    return (
      <div
        className="bg-white border border-stone-200 rounded-xl shadow-sm flex flex-col overflow-hidden"
        style={{ maxHeight: "calc(100vh - 160px)" }}
      >
        {header}
        <div className="flex-1 overflow-y-auto">
          <DetailBody data={data} loading={loading} error={error} />
        </div>
      </div>
    );
  }

  /* ── overlay mode (mobile slide-over) ── */
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[1px]" />
      <div
        className="relative w-full max-w-xl h-full bg-white shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {header}
        <div className="flex-1 overflow-y-auto">
          <DetailBody data={data} loading={loading} error={error} />
        </div>
      </div>
    </div>
  );
}
