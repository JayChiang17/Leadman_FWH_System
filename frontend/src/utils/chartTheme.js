// src/utils/chartTheme.js — Shared dark-mode chart configurations

/* ── Semantic chart colors ──────────────────────────────────────────── */
export const CHART_COLORS = {
  primary:   '#22d3ee',   // cyan-400
  secondary: '#10b981',   // emerald-500
  tertiary:  '#f59e0b',   // amber-500
  danger:    '#ef4444',   // red-500
  series: [
    '#22d3ee',  // cyan
    '#10b981',  // emerald
    '#f59e0b',  // amber
    '#ef4444',  // red
    '#818cf8',  // indigo
    '#fb923c',  // orange
    '#34d399',  // green
    '#38bdf8',  // sky
  ],
};

/* ── Chart.js dark theme defaults ──────────────────────────────────── */
export const CHARTJS_DARK_DEFAULTS = {
  backgroundColor: '#1e2437',
  borderColor:     '#2e3650',
  color:           '#8d93a5',
  gridColor:       '#2e3650',
  tickColor:       '#565e74',
};

/**
 * Apply global Chart.js dark theme defaults.
 * Call once at app startup or per-chart in useEffect.
 */
export function applyChartJSDarkTheme(ChartJS) {
  if (!ChartJS) return;
  ChartJS.defaults.color           = '#8d93a5';
  ChartJS.defaults.borderColor     = '#2e3650';
  ChartJS.defaults.backgroundColor = '#1e2437';

  // Scale defaults
  if (ChartJS.defaults.scales) {
    const scaleDefaults = {
      grid:   { color: '#2e3650', borderColor: '#2e3650' },
      ticks:  { color: '#8d93a5' },
      border: { color: '#2e3650' },
    };
    ChartJS.defaults.scales.linear    = { ...(ChartJS.defaults.scales.linear    || {}), ...scaleDefaults };
    ChartJS.defaults.scales.category  = { ...(ChartJS.defaults.scales.category  || {}), ...scaleDefaults };
  }

  // Plugin defaults
  if (ChartJS.defaults.plugins) {
    ChartJS.defaults.plugins.legend = {
      ...ChartJS.defaults.plugins.legend,
      labels: { color: '#8d93a5', boxWidth: 12, padding: 12 },
    };
    ChartJS.defaults.plugins.tooltip = {
      ...ChartJS.defaults.plugins.tooltip,
      backgroundColor: '#262d42',
      borderColor:     '#2e3650',
      borderWidth:     1,
      titleColor:      '#c8cedc',
      bodyColor:       '#8d93a5',
      padding:         10,
    };
  }
}

/* ── Recharts dark props ────────────────────────────────────────────── */
export const RECHARTS_DARK = {
  cartesianGrid: {
    stroke: '#2e3650',
    strokeDasharray: '3 3',
  },
  xAxis: {
    stroke: '#565e74',
    tick:   { fill: '#8d93a5', fontSize: 11 },
  },
  yAxis: {
    stroke: '#565e74',
    tick:   { fill: '#8d93a5', fontSize: 11 },
  },
  tooltip: {
    contentStyle: {
      background:   '#262d42',
      border:       '1px solid #2e3650',
      borderRadius: '6px',
      color:        '#c8cedc',
      fontSize:     '12px',
    },
    labelStyle: { color: '#c8cedc', fontWeight: 600 },
    itemStyle:  { color: '#8d93a5' },
  },
  legend: {
    wrapperStyle: { color: '#8d93a5', fontSize: '12px' },
  },
};

/* ── Plotly dark layout ─────────────────────────────────────────────── */
export const PLOTLY_DARK_LAYOUT = {
  paper_bgcolor: '#1e2437',
  plot_bgcolor:  '#1e2437',
  font: {
    color:  '#c8cedc',
    family: 'Inter, ui-sans-serif, sans-serif',
    size:   12,
  },
  xaxis: {
    gridcolor:    '#2e3650',
    linecolor:    '#2e3650',
    tickcolor:    '#565e74',
    tickfont:     { color: '#8d93a5', size: 11 },
    zerolinecolor: '#2e3650',
  },
  yaxis: {
    gridcolor:    '#2e3650',
    linecolor:    '#2e3650',
    tickcolor:    '#565e74',
    tickfont:     { color: '#8d93a5', size: 11 },
    zerolinecolor: '#2e3650',
  },
  zaxis: {
    gridcolor:    '#2e3650',
    linecolor:    '#2e3650',
    tickfont:     { color: '#8d93a5', size: 11 },
  },
  scene: {
    bgcolor: '#1e2437',
    xaxis: { gridcolor: '#2e3650', tickfont: { color: '#8d93a5' }, backgroundcolor: '#1e2437' },
    yaxis: { gridcolor: '#2e3650', tickfont: { color: '#8d93a5' }, backgroundcolor: '#1e2437' },
    zaxis: { gridcolor: '#2e3650', tickfont: { color: '#8d93a5' }, backgroundcolor: '#1e2437' },
  },
  legend: {
    bgcolor:    '#1e2437',
    bordercolor: '#2e3650',
    borderwidth: 1,
    font:       { color: '#8d93a5', size: 11 },
  },
  colorway: [
    '#22d3ee', '#10b981', '#f59e0b', '#ef4444',
    '#818cf8', '#fb923c', '#34d399', '#38bdf8',
  ],
};

/* ── Chart.js dataset helpers ──────────────────────────────────────── */
/**
 * Returns dark-themed Chart.js dataset properties for a given series index.
 */
export function chartDatasetStyle(index = 0, options = {}) {
  const color = CHART_COLORS.series[index % CHART_COLORS.series.length];
  return {
    borderColor:     color,
    backgroundColor: color + '33',   // ~20% opacity fill
    pointBackgroundColor: color,
    pointBorderColor:    '#1e2437',
    pointHoverBackgroundColor: color,
    borderWidth: 2,
    tension: 0.35,
    ...options,
  };
}
