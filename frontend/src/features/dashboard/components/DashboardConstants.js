// Dashboard shared constants, colors, and helper functions
import api from "../../../services/api";

/* ---------- Downtime Types Configuration ---------- */
export const DOWNTIME_TYPES = {
  'Breakdown': {
    color: '#EF4444',
    bgColor: 'rgba(239, 68, 68, 0.18)',
    label: '機台故障',
    icon: '🔴'
  },
  'Changeover': {
    color: '#F59E0B',
    bgColor: 'rgba(245, 158, 11, 0.18)',
    label: '換線',
    icon: '🟠'
  },
  'Material Shortage': {
    color: '#8B5CF6',
    bgColor: 'rgba(139, 92, 246, 0.18)',
    label: '缺料',
    icon: '🟣'
  },
  'Maintenance': {
    color: '#10B981',
    bgColor: 'rgba(16, 185, 129, 0.18)',
    label: '保養',
    icon: '🟢'
  },
  'Other': {
    color: '#6B7280',
    bgColor: 'rgba(107, 114, 128, 0.18)',
    label: '其他',
    icon: '⚫'
  }
};

/* ---------- 創建停線背景 Annotations ---------- */
export const createDowntimeAnnotations = (downtimes, labels) => {
  if (!downtimes || downtimes.length === 0) return {};

  const annotations = {};

  downtimes.forEach((downtime, index) => {
    const typeConfig = DOWNTIME_TYPES[downtime.downtime_type] || DOWNTIME_TYPES['Other'];

    const startTime = downtime.start_local.substring(11, 16);
    const endTime = downtime.end_local.substring(11, 16);

    let xMin = labels.findIndex(label => label >= startTime);
    let xMax = labels.findIndex(label => label >= endTime);

    if (xMin === -1) xMin = 0;
    if (xMax === -1) xMax = labels.length - 1;
    if (xMax < xMin) xMax = xMin;

    annotations[`downtime_${index}`] = {
      type: 'box',
      drawTime: 'beforeDatasetsDraw',
      xMin: xMin,
      xMax: xMax,
      yMin: 0,
      yMax: 'max',
      backgroundColor: typeConfig.bgColor,
      borderWidth: 0,
      z: -1,
      label: {
        display: true,
        content: `${downtime.duration_min}m`,
        position: { x: 'center', y: 'end' },
        font: { size: 10, weight: 'bold' },
        color: '#ffffff',
        backgroundColor: typeConfig.color,
        borderRadius: 6,
        padding: { top: 4, bottom: 4, left: 8, right: 8 }
      }
    };
  });

  return annotations;
};

/* ---------- Risk badge styles ---------- */
export const badgeBox = {
  position: "absolute",
  top: "2px",
  left: "50%",
  transform: "translateX(-50%)",
  padding: "4px 10px",
  borderRadius: "16px",
  color: "white",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  fontSize: "10px",
  fontWeight: "bold",
  boxShadow: "0 2px 8px rgba(0,0,0,.2)",
  zIndex: 5
};

export const getRiskColor = (level) => {
  switch (level) {
    case 'red': return '#ef4444';
    case 'orange': return '#f97316';
    case 'yellow': return '#eab308';
    case 'green': return '#22c55e';
    default: return 'transparent';
  }
};

/* ───────────────── CSS 變數取色 ───────────────── */
const css = (v, d) =>
  (getComputedStyle(document.documentElement).getPropertyValue(v) || d).trim();

export const COL_A       = css("--kpi-a", "#0ea5e9");
export const COL_B       = css("--kpi-b", "#f97316");
export const COL_A_BG    = css("--kpi-a-bg", COL_A + "33");
export const COL_B_BG    = css("--kpi-b-bg", COL_B + "33");
export const COL_PLAN_BG = css("--kpi-plan", "#90a4ae55");
export const COL_PLAN    = COL_PLAN_BG.replace(/([0-9A-Fa-f]{2})$/, "");
export const WK_A        = css("--week-a", COL_A);
export const WK_B        = css("--week-b", COL_B);
export const COL_APOWER2    = "#41c7af";
export const COL_APOWER2_BG = "#41c7af33";
export const COL_APOWERS    = "#e0b875";
export const COL_APOWERS_BG = "#e0b87533";

/* ───────────────── 共用抓 JSON ───────────────── */
export const fetchJSON = async (url, signal = null) => {
  try {
    const config = signal ? { signal } : {};
    const { data } = await api.get(url, config);
    return data.status === "success" ? data : null;
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'CanceledError') {
      return null;
    }
    return null;
  }
};

/* ───────────────── 計算哪些天達標 ───────────────── */
export const getAchievedDays = (actualA, actualB, plan) => {
  const achieved = [];
  for (let i = 0; i < actualA.length; i++) {
    const totalActual = (actualA[i] || 0) + (actualB[i] || 0);
    const plannedValue = plan[i] || 0;
    if (totalActual >= plannedValue && plannedValue > 0) {
      achieved.push(i);
    }
  }
  return achieved;
};

export const getAssyAchievedDays = (actual, plan) => {
  const achieved = [];
  for (let i = 0; i < actual.length; i++) {
    const actualValue = actual[i] || 0;
    const plannedValue = plan[i] || 0;
    if (actualValue >= plannedValue && plannedValue > 0) {
      achieved.push(i);
    }
  }
  return achieved;
};

export const getOverallAchievement = (actualA, actualB, plan) => {
  const totalActual = actualA.reduce((sum, val, i) => sum + (val || 0) + (actualB[i] || 0), 0);
  const totalPlanned = plan.reduce((sum, val) => sum + (val || 0), 0);
  return totalActual >= totalPlanned && totalPlanned > 0;
};

export const getAssyOverallAchievement = (actual, plan) => {
  const totalActual = actual.reduce((sum, val) => sum + (val || 0), 0);
  const totalPlanned = plan.reduce((sum, val) => sum + (val || 0), 0);
  return totalActual >= totalPlanned && totalPlanned > 0;
};
