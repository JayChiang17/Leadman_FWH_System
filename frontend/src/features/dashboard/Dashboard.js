import React, { useEffect, useState, useRef, useCallback, useContext } from "react";
import { Line, Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  BarElement,
  LineElement,
  Tooltip,
  Legend,
  Title,
  Filler,
} from "chart.js";
import DataLabels from "chartjs-plugin-datalabels";
import annotationPlugin from 'chartjs-plugin-annotation';

import api                     from "../../services/api";
import { openDashboardSocket } from "../../utils/wsConnect";
import { AuthCtx }            from "../../auth/AuthContext";

import "./Dashboard.css";

/* ───────────────── Chart.js plugins ───────────────── */
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  BarElement,
  LineElement,
  Tooltip,
  Legend,
  Title,
  DataLabels,
  Filler,
  annotationPlugin
);

/* ---------- Downtime Types Configuration ---------- */
const DOWNTIME_TYPES = {
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
const _createDowntimeAnnotations = (downtimes, labels) => {
  if (!downtimes || downtimes.length === 0) return {};

  const annotations = {};

  downtimes.forEach((downtime, index) => {
    const typeConfig = DOWNTIME_TYPES[downtime.downtime_type] || DOWNTIME_TYPES['Other'];

    // 提取時間 "HH:MM"
    const startTime = downtime.start_local.substring(11, 16);
    const endTime = downtime.end_local.substring(11, 16);

    // 找到對應的 label index
    let xMin = labels.findIndex(label => label >= startTime);
    let xMax = labels.findIndex(label => label >= endTime);

    // 處理邊界情況
    if (xMin === -1) xMin = 0;
    if (xMax === -1) xMax = labels.length - 1;
    if (xMax < xMin) xMax = xMin;

    annotations[`downtime_${index}`] = {
      type: 'box',
      drawTime: 'beforeDatasetsDraw',  // 在曲線之前繪製（背景）
      xMin: xMin,
      xMax: xMax,
      yMin: 0,
      yMax: 'max',
      backgroundColor: typeConfig.bgColor,
      borderWidth: 0,
      z: -1,  // 最底層

      // 底部標籤：只顯示停機時長
      label: {
        display: true,
        content: `${downtime.duration_min}m`,
        position: {
          x: 'center',
          y: 'end'
        },
        font: {
          size: 10,
          weight: 'bold'
        },
        color: '#ffffff',
        backgroundColor: typeConfig.color,
        borderRadius: 6,
        padding: { top: 4, bottom: 4, left: 8, right: 8 }
      }
    };
  });

  return annotations;
};

/* ---------- Risk badge 共用 ---------- */
const badgeBox = {
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

/* ───────────────── API base (僅用於字串拼接) ───────────────── */
// NOTE: Even though api.js has baseURL="/api", we need to keep this as ""
// because api.js interceptor strips leading "/" from URLs
// So we use relative paths like "model_inventory_daily_count" (no leading slash)
const API = "";

/* ───────────────── CSS 變數取色 ───────────────── */
const css = (v, d) =>
  (getComputedStyle(document.documentElement).getPropertyValue(v) || d).trim();

const COL_A       = css("--kpi-a", "#0ea5e9");
const COL_B       = css("--kpi-b", "#f97316");
const COL_A_BG    = css("--kpi-a-bg", COL_A + "33");
const COL_B_BG    = css("--kpi-b-bg", COL_B + "33");
const COL_PLAN_BG = css("--kpi-plan", "#90a4ae55");
const COL_PLAN    = COL_PLAN_BG.replace(/([0-9A-Fa-f]{2})$/, "");
const WK_A        = css("--week-a", COL_A);
const WK_B        = css("--week-b", COL_B);
// Assembly product line colors
// Assembly product line colors (distinct, brighter, no purple)
const COL_APOWER2    = "#41c7af";   // mint teal
const COL_APOWER2_BG = "#41c7af33";
const COL_APOWERS    = "#e0b875";   // champagne gold
const COL_APOWERS_BG = "#e0b87533";

/* ───────────────── 共用抓 JSON（支援取消請求） ───────────────── */
const fetchJSON = async (url, signal = null) => {
  try {
    const config = signal ? { signal } : {};
    const { data } = await api.get(url, config);
    return data.status === "success" ? data : null;
  } catch (error) {
    // 如果是取消請求，不記錄錯誤
    if (error.name === 'AbortError' || error.name === 'CanceledError') {
      return null;
    }
    return null;
  }
};

/* ───────────────── 計算哪些天達標 ───────────────── */
const _getAchievedDays = (actualA, actualB, plan) => {
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

const _getAssyAchievedDays = (actual, plan) => {
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

/* ───────────────── 計算整體達標狀態 ───────────────── */
const getOverallAchievement = (actualA, actualB, plan) => {
  const totalActual = actualA.reduce((sum, val, i) => sum + (val || 0) + (actualB[i] || 0), 0);
  const totalPlanned = plan.reduce((sum, val) => sum + (val || 0), 0);
  return totalActual >= totalPlanned && totalPlanned > 0;
};

const getAssyOverallAchievement = (actual, plan) => {
  const totalActual = actual.reduce((sum, val) => sum + (val || 0), 0);
  const totalPlanned = plan.reduce((sum, val) => sum + (val || 0), 0);
  return totalActual >= totalPlanned && totalPlanned > 0;
};

/* ===================================================================== */
export default function Dashboard() {
  /* ① ────────── Auth Context ────────── */
  const { getValidToken } = useContext(AuthCtx);

  /* ② ────────── State ────────── */
  const [mod, setMod]   = useState({ A:0, B:0, ngA:0, ngB:0, labels:[], a:[], b:[] });
  const [assy, setAssy] = useState({
    cnt:0, ng:0,
    apower:0, apower2:0, apowerS:0,
    labels:[], data:[],
    apowerData:[], apower2Data:[], apowerSData:[]
  });
  const [week, setWeek] = useState({ labels:[], a:[], b:[], plan:[200,200,200,200,200] });
  const [assyWeek, setAssyWeek] = useState({ labels:[], total:[], apower:[], apower2:[], apowerS:[], plan:[95,95,95,95,95] });

  const [planOpen,     setPlanOpen]     = useState(false);
  const [planEdit,     setPlanEdit]     = useState([200,200,200,200,200]);
  const [assyPlanOpen, setAssyPlanOpen] = useState(false);
  const [assyPlanEdit, setAssyPlanEdit] = useState([95,95,95,95,95]);

  // 記錄是否有週六活動
  const [hasSaturdayActivity, setHasSaturdayActivity] = useState(false);

  // 風險預警相關 state
  const [riskData, setRiskData] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Downtime 數據
  const [_downtimeData, setDowntimeData] = useState({
    module: [],
    assembly: []
  });

  // 用於追蹤圖表實例，避免重複渲染造成抖動
  const weeklyChartRef = useRef(null);
  const assyWeeklyChartRef = useRef(null);
  const dashboardRef = useRef(null);

  // 用於追蹤組件是否已掛載，防止卸載後的狀態更新
  const isMountedRef = useRef(true);
  const abortControllerRef = useRef(null);

  /* ② ────────── 資料讀取 helpers ────────── */
  const loadMod = useCallback(async () => {
    const [cnt, tr] = await Promise.all([
      fetchJSON(`model_inventory_daily_count`),
      fetchJSON(`model_inventory_trend`)
    ]);
    if (cnt && tr) {
      setMod({
        A:cnt.count_a, B:cnt.count_b,
        ngA:cnt.ng_a || 0, ngB:cnt.ng_b || 0,
        labels:tr.labels, a:tr.trend_a, b:tr.trend_b
      });
    }
  }, []);

  const loadAssy = useCallback(async () => {
    const [cnt, tr] = await Promise.all([
      fetchJSON(`assembly_inventory_daily_count`),
      fetchJSON(`assembly_inventory_trend`)
    ]);
    if (cnt && tr) {
      setAssy({
        cnt:cnt.count, ng:cnt.ng || 0,
        apower:cnt.apower || 0, apower2:cnt.apower2 || 0, apowerS:cnt.apower_s || 0,
        labels:tr.labels, data:tr.trend,
        apowerData:tr.apower || [], apower2Data:tr.apower2 || [], apowerSData:tr.apower_s || []
      });
    }
  }, []);

  const loadWeek = useCallback(async () => {
    const w = await fetchJSON(`weekly_kpi`);
    if (w) {
      
      // 檢查是否有週六數據（從 API 返回的數據判斷）
      const hasSaturdayData = w.labels.length > 5 || 
                             (w.count_a && w.count_a.length > 5 && (w.count_a[5] > 0 || w.count_b[5] > 0));
      
      // 只有當前週有週六活動記錄時才顯示 6 個柱狀圖
      if (hasSaturdayActivity || hasSaturdayData) {
        
        // 確保有6個計劃值
        const adjustedPlan = [...(w.plan || [200,200,200,200,200])];
        if (adjustedPlan.length < 6) {
          adjustedPlan.push(0); // 週六預設計劃為0
        }
        
        // 確保有6個標籤
        const adjustedLabels = [...(w.labels || [])];
        if (adjustedLabels.length < 6) {
          // 根據最後一個日期推算週六日期
          if (adjustedLabels.length > 0) {
            const lastDate = adjustedLabels[adjustedLabels.length - 1];
            const dateParts = lastDate.split('-');
            if (dateParts.length === 2) {
              const month = dateParts[0];
              const day = parseInt(dateParts[1]);
              adjustedLabels.push(`${month}-${String(day + 1).padStart(2, '0')}`);
            } else {
              adjustedLabels.push("Sat");
            }
          } else {
            adjustedLabels.push("Sat");
          }
        }
        
        // 確保有6個數據點
        const adjustedA = [...(w.count_a || [])];
        const adjustedB = [...(w.count_b || [])];
        while (adjustedA.length < 6) adjustedA.push(0);
        while (adjustedB.length < 6) adjustedB.push(0);
        
        setWeek({ 
          labels: adjustedLabels, 
          a: adjustedA, 
          b: adjustedB, 
          plan: adjustedPlan 
        });
        setPlanEdit(adjustedPlan);
      } else {
        // 當週沒有週六活動，只顯示週一到週五
        setWeek({ 
          labels: w.labels.slice(0, 5), 
          a: (w.count_a || []).slice(0, 5), 
          b: (w.count_b || []).slice(0, 5), 
          plan: (w.plan || [200,200,200,200,200]).slice(0, 5)
        });
        setPlanEdit((w.plan || [200,200,200,200,200]).slice(0, 5));
      }
    }
  }, [hasSaturdayActivity]);

  const loadAssyWeek = useCallback(async () => {
    const w = await fetchJSON(`assembly_weekly_kpi`);
    if (w) {
      
      // 檢查是否有週六數據（從 API 返回的數據判斷）
      const hasSaturdayData = w.labels.length > 5 || 
                             (w.total && w.total.length > 5 && w.total[5] > 0);
      
      // 根據當週是否有週六活動調整數據
      if (hasSaturdayActivity || hasSaturdayData) {
        
        // 確保有6個計劃值
        const adjustedPlan = [...(w.plan || [95,95,95,95,95])];
        if (adjustedPlan.length < 6) {
          adjustedPlan.push(0); // 週六預設計劃為0
        }
        
        // 確保有6個標籤
        const adjustedLabels = [...(w.labels || [])];
        if (adjustedLabels.length < 6) {
          // 根據最後一個日期推算週六日期
          if (adjustedLabels.length > 0) {
            const lastDate = adjustedLabels[adjustedLabels.length - 1];
            const dateParts = lastDate.split('-');
            if (dateParts.length === 2) {
              const month = dateParts[0];
              const day = parseInt(dateParts[1]);
              adjustedLabels.push(`${month}-${String(day + 1).padStart(2, '0')}`);
            } else {
              adjustedLabels.push("Sat");
            }
          } else {
            adjustedLabels.push("Sat");
          }
        }
        
        // 確保有6個數據點
        const adjustedTotal = [...(w.total || [])];
        const adjustedApower = [...(w.apower || [])];
        const adjustedApower2 = [...(w.apower2 || [])];
        const adjustedApowerS = [...(w.apower_s || [])];
        while (adjustedTotal.length < 6) adjustedTotal.push(0);
        while (adjustedApower.length < 6) adjustedApower.push(0);
        while (adjustedApower2.length < 6) adjustedApower2.push(0);
        while (adjustedApowerS.length < 6) adjustedApowerS.push(0);

        setAssyWeek({
          labels: adjustedLabels,
          total: adjustedTotal,
          apower: adjustedApower,
          apower2: adjustedApower2,
          apowerS: adjustedApowerS,
          plan: adjustedPlan
        });
        setAssyPlanEdit(adjustedPlan);
      } else {
        // 當週沒有週六活動，只顯示週一到週五
        setAssyWeek({
          labels: w.labels.slice(0, 5),
          total: (w.total || []).slice(0, 5),
          apower: (w.apower || []).slice(0, 5),
          apower2: (w.apower2 || []).slice(0, 5),
          apowerS: (w.apower_s || []).slice(0, 5),
          plan: (w.plan || [95,95,95,95,95]).slice(0, 5)
        });
        setAssyPlanEdit((w.plan || [95,95,95,95,95]).slice(0, 5));
      }
    }
  }, [hasSaturdayActivity]);

  const loadRiskData = useCallback(async () => {
    try {
      const { data } = await api.get(`risk/alerts`);
      setRiskData(data);
    } catch (err) {
      console.error("Failed to load risk data:", err);
    }
  }, []);

  // 載入停線數據
  const loadDowntimeData = useCallback(async () => {
    try {
      const { data } = await api.get(`downtime/events/today`);
      if (data.status === 'success' && data.records) {
        // 按產線分組
        const moduleDowntimes = data.records.filter(r => r.line === 'cell');
        const assemblyDowntimes = data.records.filter(r => r.line === 'assembly');

        setDowntimeData({
          module: moduleDowntimes,
          assembly: assemblyDowntimes
        });
      }
    } catch (err) {
      console.error("Failed to load downtime data:", err);
    }
  }, []);

  const refresh = useCallback(() => {
    loadMod(); loadAssy(); loadWeek(); loadAssyWeek(); loadRiskData(); loadDowntimeData();
  }, [loadMod, loadAssy, loadWeek, loadAssyWeek, loadRiskData, loadDowntimeData]);

  /* ③ ────────── 處理風險更新 ────────── */
  const handleRiskUpdate = useCallback((data) => {

    if (data.module && data.assembly) {
      setRiskData(prevData => ({
        ...prevData,
        module: data.module,
        assembly: data.assembly,
        summary: {
          ...prevData?.summary,
          timestamp: data.timestamp,
          has_alerts: data.has_alerts
        }
      }));
    }
  }, []);

  /* ③.5 ────────── 全屏切換 ────────── */
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      dashboardRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }, []);

  /* ④ ────────── 首次載入 & WebSocket ────────── */
  useEffect(() => {
    // 設置組件已掛載
    isMountedRef.current = true;

    refresh();

    /* Dashboard WS - 加入風險更新處理 */
    const ws = openDashboardSocket(
    (m) => {
      // 檢查組件是否仍然掛載
      if (!isMountedRef.current) return;

      // 處理系統事件
      if (m.type === "system") {
        if (m.event === "connected") {
          // 可以在這裡訂閱需要的主題
          ws.subscribe?.("dashboard:updates");
        }
      }

      // 處理資料更新
      if (m.event === "module_updated")   refresh();
      if (m.event === "assembly_updated") refresh();
      if (m.event === "weekly_plan_updated") loadWeek();

      // 處理風險更新事件
      if (m.event === "risk_update") {
        handleRiskUpdate(m.data);
      }
    },
    (err) => {
      if (!isMountedRef.current) return;
      console.warn("🛑 dashboard WS error:", err);
      // 處理認證錯誤
      if (err.type === "auth") {
        console.error("WebSocket authentication failed");
        // 可能需要重新登入
      }
    },
    30_000,
    getValidToken
  );

    // 清理函數
    return () => {
      isMountedRef.current = false;
      // 取消進行中的請求
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      ws.destroy();
    };
  }, [refresh, loadWeek, handleRiskUpdate, getValidToken]);

  /* ⑤ ────────── 請求瀏覽器通知權限 ────────── */
/* ⑥ ────────── 定期檢查風險 ────────── */
  useEffect(() => {
    const interval = setInterval(() => {
      loadRiskData();
    }, 300000); // 每5分鐘檢查一次
    
    return () => clearInterval(interval);
  }, [loadRiskData]);

  /* ⑦ ────────── 週一自動重置檢查 ────────── */
  useEffect(() => {
    // 取得週的開始日期（週一）
    const getWeekStart = (date) => {
      const d = new Date(date);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1); // 調整到週一
      return new Date(d.setDate(diff));
    };

    // 檢查是否需要重置（新的一週）
    const checkWeekReset = () => {
      const now = new Date();
      const currentWeekStart = getWeekStart(now).toISOString().split("T")[0];
      const lastCheckedWeek = localStorage.getItem("last_checked_week");
      
      // 如果是新的一週
      if (currentWeekStart !== lastCheckedWeek) {
        localStorage.setItem("last_checked_week", currentWeekStart);
        
        // 檢查當前週是否有週六活動
        const weekKey = `saturday_activity_${currentWeekStart}`;
        const hasSaturdayThisWeek = localStorage.getItem(weekKey);
        
        if (!hasSaturdayThisWeek) {
          // 新的一週且沒有週六活動記錄，重置為5天顯示
          setHasSaturdayActivity(false);
          refresh(); // 重新載入數據
        }
      }
    };

    // 初始檢查
    checkWeekReset();

    // 設定定時檢查（每小時檢查一次是否跨週）
    const intervalId = setInterval(checkWeekReset, 3600000); // 每小時

    // 特別針對週一凌晨的檢查（更頻繁）
    const now = new Date();
    if (now.getDay() === 1 && now.getHours() < 6) {
      // 如果是週一凌晨，每5分鐘檢查一次
      const earlyMondayInterval = setInterval(checkWeekReset, 300000); // 5分鐘
      
      // 6小時後停止頻繁檢查
      setTimeout(() => clearInterval(earlyMondayInterval), 21600000);
    }

    return () => clearInterval(intervalId);
  }, [refresh]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    handleFullscreenChange();
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  /* ⑧ ────────── 自動偵測掃碼 → 強制 reload 今日資料一次 ────────── */
  useEffect(() => {
    const todayStr          = () => new Date().toISOString().split("T")[0];
    const hasRefreshedToday = () => localStorage.getItem("dashboard_ref") === todayStr();
    const setRefToday       = () => localStorage.setItem("dashboard_ref", todayStr());

    // 取得加州時間
    const getCaliforniaTime = () => {
      const now = new Date();
      // 轉換為加州時間 (Pacific Time)
      const californiaTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));
      return californiaTime;
    };

    // 取得週的開始日期（週一） - 使用加州時間
    const getWeekStart = (date) => {
      const d = new Date(date);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1); // 調整到週一
      return new Date(d.setDate(diff)).toISOString().split("T")[0];
    };

    // 檢查是否為同一週
    const isSameWeek = (date1, date2) => {
      return getWeekStart(date1) === getWeekStart(date2);
    };

    const interceptor = api.interceptors.response.use((resp) => {
      const { method, url } = resp.config;
      const isScan = method === "post" &&
        (url.includes("/model_inventory") || url.includes("/assembly_inventory"));

      if (isScan) {
        // 使用加州時間檢查是否為週六
        const californiaTime = getCaliforniaTime();
        const isSaturday = californiaTime.getDay() === 6;
        
        if (isSaturday) {
          // 週六掃碼時，標記有週六活動並重新載入
          setHasSaturdayActivity(true);
          const weekKey = `saturday_activity_${getWeekStart(californiaTime)}`;
          localStorage.setItem(weekKey, californiaTime.toISOString().split("T")[0]);
        }
        
        if (!hasRefreshedToday()) {
          refresh(); 
          setRefToday(); 
        }
      }
      return resp;
    }, (err) => Promise.reject(err));

    // 檢查當週是否有週六活動記錄或今天是週六
    const checkCurrentWeekSaturday = () => {
      const californiaTime = getCaliforniaTime();
      const currentWeekStart = getWeekStart(californiaTime);
      const weekKey = `saturday_activity_${currentWeekStart}`;
      const saturdayRecord = localStorage.getItem(weekKey);
      
      // 檢查今天是否為週一或週六（加州時間）
      const dayOfWeek = californiaTime.getDay();
      const isMonday = dayOfWeek === 1;
      const isSaturday = dayOfWeek === 6;
      
      // 如果今天是週六，直接顯示6個柱狀圖
      if (isSaturday) {
        setHasSaturdayActivity(true);
        // 記錄週六，即使還沒有掃碼
        if (!saturdayRecord) {
          localStorage.setItem(weekKey, californiaTime.toISOString().split("T")[0]);
        }
        return;
      }
      
      if (saturdayRecord) {
        const recordDate = new Date(saturdayRecord);
        // 確認是同一週的週六
        if (isSameWeek(californiaTime, recordDate)) {
          setHasSaturdayActivity(true);
        } else {
          // 不是同一週，清除該記錄
          localStorage.removeItem(weekKey);
          setHasSaturdayActivity(false);
          if (isMonday) {
            refresh(); // 週一時強制重新載入
          }
        }
      } else {
        setHasSaturdayActivity(false);
        if (isMonday && localStorage.getItem("was_saturday_last_week")) {
          localStorage.removeItem("was_saturday_last_week");
          refresh(); // 強制重新載入數據
        }
      }
      
      // 記錄上週是否有週六活動
      const lastWeekStart = new Date(currentWeekStart);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      const lastWeekKey = `saturday_activity_${lastWeekStart.toISOString().split("T")[0]}`;
      if (localStorage.getItem(lastWeekKey)) {
        localStorage.setItem("was_saturday_last_week", "true");
      }
    };

    // 清理過期的週六活動記錄（保留最近 4 週）
    const cleanupOldRecords = () => {
      const californiaTime = getCaliforniaTime();
      const keys = Object.keys(localStorage);
      
      keys.forEach(key => {
        if (key.startsWith("saturday_activity_")) {
          const weekStart = key.replace("saturday_activity_", "");
          const weekStartDate = new Date(weekStart);
          const diffDays = Math.floor((californiaTime - weekStartDate) / (1000 * 60 * 60 * 24));
          
          // 超過 28 天（4週）的記錄刪除
          if (diffDays > 28) {
            localStorage.removeItem(key);
          }
        }
      });
    };

    // 初始化時檢查
    checkCurrentWeekSaturday();
    cleanupOldRecords();

    // 每次切換到新的一天時重新檢查（處理跨週的情況）
    const checkInterval = setInterval(() => {
      const currentDate = getCaliforniaTime().toISOString().split("T")[0];
      const lastCheck = localStorage.getItem("last_week_check");
      
      if (currentDate !== lastCheck) {
        localStorage.setItem("last_week_check", currentDate);
        checkCurrentWeekSaturday();
      }
    }, 60000); // 每分鐘檢查一次

    return () => {
      api.interceptors.response.eject(interceptor);
      clearInterval(checkInterval);
    };
  }, [refresh]);

  /* ⑨ ────────── Plan 儲存 ────────── */
  const savePlan = async () => {
    try {
      await api.post(`weekly_plan`, planEdit);
      setWeek(w => ({ ...w, plan: planEdit }));
      setPlanOpen(false);
      // 重新載入風險數據以反映新的計劃值
      await loadRiskData();
    } catch (err) { console.warn("save error", err); }
  };

  const saveAssyPlan = async () => {
    try {
      await api.post(`assembly_weekly_plan`, assyPlanEdit);
      setAssyWeek(w => ({ ...w, plan: assyPlanEdit }));
      setAssyPlanOpen(false);
      // 重新載入風險數據以反映新的計劃值
      await loadRiskData();
    } catch (err) { console.warn("save error", err); }
  };

  /* ⑩ ────────── Chart 組態 ────────── */
  const legendLabelStyle = {
    boxWidth: isFullscreen ? 10 : 12,
    boxHeight: isFullscreen ? 8 : 10,
    padding: isFullscreen ? 6 : 8,
    font: {
      size: isFullscreen ? 9 : 10
    }
  };

  const optsBar  = {
    responsive:true,
    maintainAspectRatio: true,
    aspectRatio: 1.1,
    animation: {
      duration: 0  // 關閉動畫以防止抖動
    },
    scales:{
      x:{ stacked:true },
      y:{ stacked:true, beginAtZero:true }
    },
    plugins:{
      legend:{ position:"bottom", labels: legendLabelStyle },
      datalabels: {
        display: true,
        anchor: 'center',
        align: 'center',
        formatter: (value) => value || '',
        font: {
          size: 11,
          weight: 'bold'
        },
        color: '#444'
      }
    }
  };
  
  const optsLine = {
    responsive:true,
    maintainAspectRatio: true,
    aspectRatio: 1.6,
    plugins:{
      legend:{ position:"bottom", labels: legendLabelStyle }
    },
    scales:{
      y:{
        beginAtZero:true,
        ticks: { maxTicksLimit: 8 }
      }
    }
  };

  // 計算達標狀態
  const _moduleOverallAchieved = getOverallAchievement(week.a, week.b, week.plan);
  const _assyOverallAchieved = getAssyOverallAchievement(assyWeek.total, assyWeek.plan);


  // 計算 Module A + B 的總和趨勢
  const totalTrend = mod.a.map((valA, i) => (valA || 0) + (mod.b[i] || 0));

  /* ⑪ ────────── 專業達標指示器組件 ────────── */
  const _AchievementIndicator = ({ achieved, type = "module" }) => {
    if (!achieved) return null;
    
    return (
      <div className={`achievement-indicator ${type === "assy" ? "assy" : ""}`}>
        <div className="achievement-icon"></div>
        <div className="achievement-badge">
        </div>
      </div>
    );
  };
/* ⑫ ────────── 風險等級樣式函數 ────────── */
const getRiskColor = (level) => {
  switch (level) {
    case 'red': return '#ef4444';
    case 'orange': return '#f97316';
    case 'yellow': return '#eab308';
    case 'green': return '#22c55e';
    default: return 'transparent';
  }
};

/* 共用外框不變 ─ badgeBox 與 getRiskColor 已在檔案上方定義 */

const RiskBadge = ({ data }) => {
  if (!data?.risk_level || data.risk_level === "none") return null;

  const flash = data.risk_level === "red" ? "pulse 2s infinite" : "none";
  const isZeroRate = (data.current_rate ?? 0) === 0;

  return (
    <div
      style={{
        ...badgeBox,
        backgroundColor: getRiskColor(data.risk_level),
        animation: flash,
      }}
    >
      {/* 1. Status */}
      <span
        style={{
          padding: "2px 8px",
          background: "rgba(255,255,255,.2)",
          borderRadius: "12px",
        }}
      >
        {data.frozen ? "ACHIEVED" : data.risk.toUpperCase()}
      </span>

      {/* 2. 速率顯示 - 當速率為 0 時改變顯示方式 */}
      {!data.frozen && (
        <span style={{ fontSize: "10px", opacity: 0.9 }}>
          {!isZeroRate ? (
            <>
              {data.current_rate?.toFixed(1) ?? "--"} pcs/h&nbsp;
              ·&nbsp;need&nbsp;
              {data.need_rate?.toFixed(1) ?? "--"} pcs/h
            </>
          ) : (
            <>Need {data.need_rate?.toFixed(1) ?? "--"} pcs/h to start</>
          )}
        </span>
      )}

      {/* ACHIEVED 狀態只顯示當前速率（非 0 時） */}
      {data.frozen && !isZeroRate && (
        <span style={{ fontSize: "10px", opacity: 0.9 }}>
          {data.current_rate?.toFixed(1) ?? "--"} pcs/h
        </span>
      )}
    </div>
  );
};






/* ⑬ ────────── JSX ────────── */
return (
  <div
  ref={dashboardRef}
  className="dashboard-screen"
  onDoubleClick={toggleFullscreen}
  >

    <div className="dashboard-grid">
      {/* ----- Module today ----- */}
      <div className="dashboard-card">
        <h2 className="card-title">Module A/B – Today</h2>
        <h1 className="card-big right">{mod.A + mod.B}</h1>
        
        <RiskBadge data={riskData?.module} />

        <Line
          data={{
            labels:mod.labels,
            datasets:[
              { label:"A", data:mod.a, backgroundColor:COL_A_BG, borderColor:COL_A, tension:.3, fill:true, pointRadius:2 },
              { label:"B", data:mod.b, backgroundColor:COL_B_BG, borderColor:COL_B, tension:.3, fill:true, pointRadius:2 },
              {
                label:"Total",
                data:totalTrend,
                backgroundColor:"rgba(96, 125, 139, 0.1)",
                borderColor:"rgba(96, 125, 139, 0.4)",
                borderWidth:2,
                borderDash:[5, 5],
                tension:.3,
                fill:false,
                pointRadius:0,
                pointHoverRadius:3
              }
            ]
          }}
          options={optsLine}
          className="chart"
        />
        {(mod.ngA > 0 || mod.ngB > 0) && (
          <div className="ng-badge">
            <span className="ng-icon">⚠</span>
            <span className="ng-text">NG: A {mod.ngA} / B {mod.ngB}</span>
            <span className="ng-rate">({((mod.ngA + mod.ngB) / (mod.A + mod.B) * 100).toFixed(1)}%)</span>
          </div>
        )}
      </div>

      {/* ----- Assembly today ----- */}
      <div className="dashboard-card">
        <h2 className="card-title">Assembly – Today</h2>
        <h1 className="card-big right">{assy.cnt}</h1>

        <RiskBadge data={riskData?.assembly} />

        <Line
          data={{
            labels:assy.labels,
            datasets:[
              { label:"Total", data:assy.data, backgroundColor:"rgba(156, 163, 175, 0.1)", borderColor:"rgb(156, 163, 175)", tension:.3, fill:true, pointRadius:2, borderWidth:1, borderDash:[5,5] },
              { label:"Apower 2", data:assy.apower2Data, backgroundColor:COL_APOWER2_BG, borderColor:COL_APOWER2, tension:.3, fill:true, pointRadius:2 },
              { label:"Apower S", data:assy.apowerSData, backgroundColor:COL_APOWERS_BG, borderColor:COL_APOWERS, tension:.3, fill:true, pointRadius:2 }
            ]
          }}
          options={optsLine}
          className="chart"
        />
      </div>

      {/* ----- Module weekly KPI ----- */}
      <div className="dashboard-card">
        <h2 className="card-title">
          Module – Weekly Production Target
          <span className="plan-toggle" onClick={e => { e.stopPropagation(); setPlanOpen(!planOpen); }}>⚙ Planned</span>
        </h2>

        {/* 達標指示器已移除 - 不顯示綠色效果 */}
        
        <div className="chart-wrapper">
          <Bar
            ref={weeklyChartRef}
            data={{
              labels:week.labels,
              datasets:[
                { 
                  label:"Actual A", 
                  data:week.a.map(v=>v||null), 
                  backgroundColor:WK_A, 
                  stack:"act", 
                  order:1,
                  datalabels: {
                    display: true,
                    anchor: 'center',
                    align: 'center',
                    formatter: (value) => value || '',
                    font: {
                      size: 12,
                      weight: 'bold'
                    },
                    color: '#333'
                  }
                },
                {
                  label:"Actual B",
                  data:week.b.map(v=>v||null),
                  backgroundColor:WK_B,
                  stack:"act",
                  order:2,
                  datalabels: {
                    display: true,
                    anchor: 'center',
                    align: 'center',
                    formatter: (value) => value || '',
                    font: {
                      size: 12,
                      weight: 'bold'
                    },
                    color: '#333'
                  }
                },
                { 
                  label:"Planned",  
                  data:week.plan.slice(0,week.labels.length), 
                  backgroundColor:COL_PLAN_BG,
                  borderColor:COL_PLAN, 
                  borderWidth:1, 
                  stack:"plan", 
                  order:99,
                  datalabels: {
                    display: true,
                    anchor: 'center',
                    align: 'center',
                    formatter: (value) => value || '',
                    font: {
                      size: 12,
                      weight: 'bold'
                    },
                    color: '#666'
                  }
                },
              ]
            }}
            options={optsBar}
            className="chart"
          />
        </div>
        {planOpen && (
          <div className="plan-inputs" onKeyDown={e => e.key==="Enter" && savePlan()}>
            {week.labels.map((d,i)=>(
              <div className="plan-row" key={d}>
                <span>{d}</span>
                <input
                  type="number"
                  value={planEdit[i]}
                  onChange={e => {
                    const n = Number(e.target.value); if(!isNaN(n))
                      setPlanEdit(p => p.map((x,idx)=>(idx===i?n:x)));
                  }}
                />
              </div>
            ))}
            <button className="save-btn" onClick={savePlan}>Save</button>
          </div>
        )}
      </div>

      {/* ----- Assembly weekly KPI ----- */}
      <div className="dashboard-card">
        <h2 className="card-title">
          Assembly – Weekly Production Target
          <span className="plan-toggle" onClick={e => { e.stopPropagation(); setAssyPlanOpen(!assyPlanOpen); }}>⚙ Planned</span>
        </h2>

        {/* 達標指示器已移除 - 不顯示綠色效果 */}
        
        <div className="chart-wrapper">
          <Bar
            ref={assyWeeklyChartRef}
            data={{
              labels:assyWeek.labels,
              datasets:[
                {
                  label:"Apower 2",
                  data:assyWeek.apower2.map(v=>v||null),
                  backgroundColor:COL_APOWER2,
                  stack:"act",
                  order:2,
              datalabels: {
                display: true,
                anchor: 'center',
                align: 'center',
                formatter: (value) => value || '',
                font: {
                  size: 12,
                  weight: 'bold'
                },
                color: '#333'
              }
            },
                {
                  label:"Apower S",
                  data:assyWeek.apowerS.map(v=>v||null),
                  backgroundColor:COL_APOWERS,
                  stack:"act",
                  order:3,
              datalabels: {
                display: true,
                anchor: 'center',
                align: 'center',
                formatter: (value) => value || '',
                font: {
                  size: 12,
                  weight: 'bold'
                },
                color: '#333'
              }
            },
                {
              label:"Planned",
              data:assyWeek.plan.slice(0,assyWeek.labels.length),
              backgroundColor:COL_PLAN_BG,
              borderColor:COL_PLAN,
              borderWidth:1,
                  stack:"plan",
                  order:99,
                  datalabels: {
                    display: true,
                    anchor: 'center',
                    align: 'center',
                    formatter: (value) => value || '',
                    font: {
                      size: 12,
                      weight: 'bold'
                    },
                    color: '#666'
                  }
                },
              ]
            }}
            options={optsBar}
            className="chart"
          />
        </div>
        {assyPlanOpen && (
          <div className="plan-inputs" onKeyDown={e => e.key==="Enter" && saveAssyPlan()}>
            {assyWeek.labels.map((d,i)=>(
              <div className="plan-row" key={d}>
                <span>{d}</span>
                <input
                  type="number"
                  value={assyPlanEdit[i]}
                  onChange={e => {
                    const n=Number(e.target.value); if(!isNaN(n))
                      setAssyPlanEdit(p=>p.map((x,idx)=>(idx===i?n:x)));
                  }}
                />
              </div>
            ))}
            <button className="save-btn" onClick={saveAssyPlan}>Save</button>
          </div>
        )}
      </div>
    </div>
  </div>
);
}
