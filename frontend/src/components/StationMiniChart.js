// src/features/equipment/components/StationMiniChart.js
import React, { useMemo } from "react";
import { Line } from "react-chartjs-2";

const round1 = (x) => Math.round(Number(x || 0) * 10) / 10;
const fmtShort = (sec) => {
  sec = Number(sec || 0);
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
};
// 日期 chip：固定用 UTC，避免時區位移
const fmtChip = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const md = d.toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" }); // Sep 03
  const wd = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });               // Tue
  return `${md} ${wd}`;
};

export default function StationMiniChart({ name, rows }) {
  // rows: [{date, count, avgProcessTime}]  已由父層保證為選定區間（UTC）
  const labels = rows.map((r) => r.date);

  const data = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: "Avg Time (s)",
          data: rows.map((r) => round1(r.avgProcessTime)), // 每日平均秒數（非總和）
          borderColor: "rgba(14,165,233,.9)",
          backgroundColor: "rgba(14,165,233,.08)",
          borderWidth: 2,
          fill: true,
          tension: 0.35,
          pointRadius: 0,
        },
      ],
    }),
    [rows, labels]
  );

  // 區間加權平均（按每日件數權重）
  const avgSec =
    rows.length > 0
      ? round1(
          rows.reduce((s, r) => s + round1(r.avgProcessTime) * Number(r.count || 0), 0) /
            Math.max(rows.reduce((s, r) => s + Number(r.count || 0), 0), 1)
        )
      : 0;

  // 日期 chips：Sep 03 Tue • 56.0s（或 1m 37s）
  const legendChips = rows
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r, i) => (
      <span
        className="chip"
        key={`${name}-${i}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          borderRadius: 999,
          fontSize: 12,
          background: "rgba(248,250,252,.8)",
          border: "1px solid rgba(203,213,225,.35)",
          color: "#475569",
        }}
      >
        <span className="date" style={{ fontWeight: 600 }}>{fmtChip(r.date)}</span>
        <span className="dot" style={{ width: 4, height: 4, borderRadius: "50%", background: "rgba(148,163,184,.9)" }} />
        <span className="val">{fmtShort(round1(r.avgProcessTime))}</span>
      </span>
    ));

  return (
    <div className="liquid-glass station-card">
      <div className="chart-header" style={{ borderBottom: "none", paddingBottom: 0 }}>
        <h4 className="chart-title" style={{ marginBottom: 6 }}>{name}</h4>
        <div className="chart-subtitle">7-day average: {avgSec ? fmtShort(avgSec) : "—"}</div>
      </div>

      <div className="chart-container" style={{ height: 140 }}>
        <Line
          data={data}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { display: false },
              y: {
                beginAtZero: true,
                grid: { color: "rgba(148,163,184,.12)", drawBorder: false },
                ticks: { color: "#94a3b8", font: { size: 10 } },
              },
            },
            elements: { line: { tension: 0.35 } },
          }}
        />
      </div>

      <div className="mini-legend">{legendChips}</div>
    </div>
  );
}
