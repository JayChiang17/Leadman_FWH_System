/**
 * Plot3D — shared Plotly wrapper for all 3-D chart features.
 * Handles lazy loading of plotly.js-dist-min to keep initial bundle small.
 */
import React, { Suspense, lazy } from "react";

// Dynamic import so Plotly only loads when a 3D chart is mounted
const Plot = lazy(() => import("react-plotly.js"));

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Build a 24×7 Z-matrix from flat {hour, dow, value} records.
 * Returns { z, x (hours 0-23), y (day labels) }.
 */
export function buildHourDowMatrix(records, valueKey = "avg_ms") {
  const z = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const r of records) {
    const d = Number(r.dow);
    const h = Number(r.hour);
    if (d >= 0 && d < 7 && h >= 0 && h < 24) {
      z[d][h] = Number(r[valueKey]) || 0;
    }
  }
  return {
    z,
    x: Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`),
    y: DOW_LABELS,
  };
}

/**
 * Build station × hour Z-matrix from flat {station, hour, total_min} records.
 * Returns { z, x (hours), y (station labels) }.
 */
export function buildStationHourMatrix(records) {
  const stations = [...new Set(records.map((r) => r.station))].sort();
  const z = stations.map(() => Array(24).fill(0));
  for (const r of records) {
    const si = stations.indexOf(r.station);
    const h = Number(r.hour);
    if (si >= 0 && h >= 0 && h < 24) {
      z[si][h] = Number(r.total_min) || 0;
    }
  }
  return {
    z,
    x: Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`),
    y: stations,
  };
}

const SCENE_DEFAULTS = {
  camera: { eye: { x: 1.4, y: 1.4, z: 1.1 } },
  xaxis: { backgroundcolor: "#f9fafb", gridcolor: "#e5e7eb" },
  yaxis: { backgroundcolor: "#f9fafb", gridcolor: "#e5e7eb" },
  zaxis: { backgroundcolor: "#f0fdf4", gridcolor: "#bbf7d0" },
};

export default function Plot3D({
  data,
  layout = {},
  title,
  xTitle,
  yTitle,
  zTitle,
  height = 460,
  colorscale = "Teal",
}) {
  const mergedLayout = {
    title: title ? { text: title, font: { size: 13, color: "#374151", family: "Inter, sans-serif" } } : undefined,
    scene: {
      ...SCENE_DEFAULTS,
      xaxis: { ...SCENE_DEFAULTS.xaxis, title: xTitle },
      yaxis: { ...SCENE_DEFAULTS.yaxis, title: yTitle },
      zaxis: { ...SCENE_DEFAULTS.zaxis, title: zTitle },
    },
    margin: { l: 0, r: 0, t: title ? 40 : 10, b: 0 },
    paper_bgcolor: "white",
    autosize: true,
    ...layout,
  };

  return (
    <Suspense fallback={<ChartSkeleton height={height} />}>
      <Plot
        data={data}
        layout={mergedLayout}
        config={{
          displayModeBar: true,
          modeBarButtonsToRemove: ["sendDataToCloud", "lasso2d", "select2d"],
          responsive: true,
          scrollZoom: true,
          displaylogo: false,
        }}
        style={{ width: "100%", height: `${height}px` }}
        useResizeHandler
      />
    </Suspense>
  );
}

function ChartSkeleton({ height }) {
  return (
    <div
      style={{ height }}
      className="flex flex-col items-center justify-center bg-gray-50 rounded-lg border border-gray-200 animate-pulse"
    >
      <div className="w-12 h-12 rounded-lg bg-gray-200 mb-3" />
      <div className="w-32 h-3 bg-gray-200 rounded" />
      <p className="text-xs text-gray-400 mt-2">Loading 3D chart…</p>
    </div>
  );
}
