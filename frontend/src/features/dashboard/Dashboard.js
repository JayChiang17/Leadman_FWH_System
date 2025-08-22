import React, { useEffect, useState, useRef, useCallback } from "react";
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

import api                     from "../../services/api";
import { openDashboardSocket } from "../../utils/wsConnect";

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
  Filler
);

/* ---------- Risk badge 共用 ---------- */
const badgeBox = {
  position: "absolute",
  top: "20px",
  left: "60%",
  transform: "translateX(-50%)",
  padding: "6px 12px",
  borderRadius: "20px",
  color: "white",
  display: "flex",
  flexDirection: "column",          // ← 可以塞第 3 行小字
  alignItems: "center",
  fontSize: "12px",
  fontWeight: "bold",
  boxShadow: "0 2px 8px rgba(0,0,0,.2)",
  zIndex: 5
};

/* ───────────────── API base (僅用於字串拼接) ───────────────── */
const API =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_API_BASE) ||
  process.env.REACT_APP_API_BASE ||
  "/api";

/* ───────────────── CSS 變數取色 ───────────────── */
const css = (v, d) =>
  (getComputedStyle(document.documentElement).getPropertyValue(v) || d).trim();

const COL_A       = css("--kpi-a", "#e91e63");
const COL_B       = css("--kpi-b", "#9c27b0");
const COL_A_BG    = css("--kpi-a-bg", COL_A + "33");
const COL_B_BG    = css("--kpi-b-bg", COL_B + "33");
const COL_ASSEMB  = css("--kpi-assembly", "#0097a7");
const COL_AS_BG   = css("--kpi-assembly-bg", COL_ASSEMB + "33");
const COL_PLAN_BG = css("--kpi-plan", "#90a4ae55");
const COL_PLAN    = COL_PLAN_BG.replace(/([0-9A-Fa-f]{2})$/, "");
const WK_A        = css("--week-a", COL_A);
const WK_B        = css("--week-b", COL_B);

/* ───────────────── 共用抓 JSON ───────────────── */
const fetchJSON = async (url) => {
  try {
    const { data } = await api.get(url);
    return data.status === "success" ? data : null;
  } catch {
    return null;
  }
};

/* ───────────────── 計算哪些天達標 ───────────────── */
const getAchievedDays = (actualA, actualB, plan) => {
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

const getAssyAchievedDays = (actual, plan) => {
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
  /* ① ────────── State ────────── */
  const [mod, setMod]   = useState({ A:0, B:0, ngA:0, ngB:0, labels:[], a:[], b:[] });
  const [assy, setAssy] = useState({ cnt:0, ng:0, labels:[], data:[] });
  const [week, setWeek] = useState({ labels:[], a:[], b:[], plan:[180,180,180,180,180] });
  const [assyWeek, setAssyWeek] = useState({ labels:[], total:[], plan:[80,80,80,80,80] });

  const [planOpen,     setPlanOpen]     = useState(false);
  const [planEdit,     setPlanEdit]     = useState([120,120,120,120,120]);
  const [assyPlanOpen, setAssyPlanOpen] = useState(false);
  const [assyPlanEdit, setAssyPlanEdit] = useState([60,60,60,60,60]);

  // 記錄是否有週六活動
  const [hasSaturdayActivity, setHasSaturdayActivity] = useState(false);

  // 風險預警相關 state
  const [riskData, setRiskData] = useState(null);
  const [, setShowRiskAlert] = useState(true);
  const [riskAlertDismissed, setRiskAlertDismissed] = useState(false);

  // 用於追蹤圖表實例，避免重複渲染造成抖動
  const weeklyChartRef = useRef(null);
  const assyWeeklyChartRef = useRef(null);

  /* ② ────────── 資料讀取 helpers ────────── */
  const loadMod = useCallback(async () => {
    const [cnt, tr] = await Promise.all([
      fetchJSON(`${API}/model_inventory_daily_count`),
      fetchJSON(`${API}/model_inventory_trend`)
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
      fetchJSON(`${API}/assembly_inventory_daily_count`),
      fetchJSON(`${API}/assembly_inventory_trend`)
    ]);
    if (cnt && tr) {
      setAssy({
        cnt:cnt.count, ng:cnt.ng || 0,
        labels:tr.labels, data:tr.trend
      });
    }
  }, []);

  const loadWeek = useCallback(async () => {
    const w = await fetchJSON(`${API}/weekly_kpi`);
    if (w) {
      console.log("📊 Weekly KPI 原始數據:", {
        labels: w.labels,
        count_a: w.count_a,
        count_b: w.count_b,
        plan: w.plan,
        labelsLength: w.labels?.length
      });
      
      // 檢查是否有週六數據（從 API 返回的數據判斷）
      const hasSaturdayData = w.labels.length > 5 || 
                             (w.count_a && w.count_a.length > 5 && (w.count_a[5] > 0 || w.count_b[5] > 0));
      
      // 只有當前週有週六活動記錄時才顯示 6 個柱狀圖
      if (hasSaturdayActivity || hasSaturdayData) {
        
        // 確保有6個計劃值
        const adjustedPlan = [...(w.plan || [120,120,120,120,120])];
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
          plan: (w.plan || [120,120,120,120,120]).slice(0, 5) 
        });
        setPlanEdit((w.plan || [120,120,120,120,120]).slice(0, 5));
      }
    }
  }, [hasSaturdayActivity]);

  const loadAssyWeek = useCallback(async () => {
    const w = await fetchJSON(`${API}/assembly_weekly_kpi`);
    if (w) {
      console.log("🔧 Assembly Weekly KPI 原始數據:", {
        labels: w.labels,
        total: w.total,
        plan: w.plan,
        labelsLength: w.labels?.length
      });
      
      // 檢查是否有週六數據（從 API 返回的數據判斷）
      const hasSaturdayData = w.labels.length > 5 || 
                             (w.total && w.total.length > 5 && w.total[5] > 0);
      
      // 根據當週是否有週六活動調整數據
      if (hasSaturdayActivity || hasSaturdayData) {
        
        // 確保有6個計劃值
        const adjustedPlan = [...(w.plan || [60,60,60,60,60])];
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
        while (adjustedTotal.length < 6) adjustedTotal.push(0);
        
        setAssyWeek({ 
          labels: adjustedLabels, 
          total: adjustedTotal, 
          plan: adjustedPlan 
        });
        setAssyPlanEdit(adjustedPlan);
      } else {
        // 當週沒有週六活動，只顯示週一到週五
        setAssyWeek({ 
          labels: w.labels.slice(0, 5), 
          total: (w.total || []).slice(0, 5), 
          plan: (w.plan || [60,60,60,60,60]).slice(0, 5) 
        });
        setAssyPlanEdit((w.plan || [60,60,60,60,60]).slice(0, 5));
      }
    }
  }, [hasSaturdayActivity]);

  const loadRiskData = useCallback(async () => {
    try {
      const { data } = await api.get(`${API}/risk/alerts`);
      setRiskData(data);
      
      // 如果有新的嚴重警報且未被關閉，自動顯示
      if (data.summary?.critical_count > 0 && !riskAlertDismissed) {
        setShowRiskAlert(true);
      }
    } catch (err) {
      console.error("Failed to load risk data:", err);
    }
  }, [riskAlertDismissed]);

  const refresh = useCallback(() => {
    loadMod(); loadAssy(); loadWeek(); loadAssyWeek(); loadRiskData();
  }, [loadMod, loadAssy, loadWeek, loadAssyWeek, loadRiskData]);

  /* ③ ────────── 處理風險更新 ────────── */
  const handleRiskUpdate = useCallback((data) => {
    console.log("⚠️ Risk update received:", data);
    
    // 更新風險數據
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
      
      // 如果有嚴重警報，顯示通知
      if (data.module?.risk_level === "red" || data.assembly?.risk_level === "red") {
        setShowRiskAlert(true);
        setRiskAlertDismissed(false);
        
        // 瀏覽器通知
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('⚠️ Critical Production Alert', {
            body: `Production is critically behind schedule!`,
            icon: '/favicon.ico'
          });
        }
      }
    }
  }, []);

  /* ④ ────────── 首次載入 & WebSocket ────────── */
  useEffect(() => {
    refresh();

    /* Dashboard WS - 加入風險更新處理 */
    const ws = openDashboardSocket(
    (m) => {
      // 處理系統事件
      if (m.type === "system") {
        if (m.event === "connected") {
          console.log("Dashboard WS connected");
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
      console.warn("🛑 dashboard WS error:", err);
      // 處理認證錯誤
      if (err.type === "auth") {
        console.error("WebSocket authentication failed");
        // 可能需要重新登入
      }
    }
  );
    return () => ws.destroy();
  }, [refresh, loadWeek, handleRiskUpdate]);

  /* ⑤ ────────── 請求瀏覽器通知權限 ────────── */
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

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
          console.log("🔄 auto refreshed");
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
      await api.post(`${API}/weekly_plan`, planEdit);
      setWeek(w => ({ ...w, plan: planEdit }));
      setPlanOpen(false);
    } catch { alert("❌ save error"); }
  };

  const saveAssyPlan = async () => {
    try {
      await api.post(`${API}/assembly_weekly_plan`, assyPlanEdit);
      setAssyWeek(w => ({ ...w, plan: assyPlanEdit }));
      setAssyPlanOpen(false);
    } catch { alert("❌ save error"); }
  };

  /* ⑩ ────────── Chart 組態 ────────── */
  const optsBar  = { 
    responsive:true, 
    maintainAspectRatio: true,
    animation: {
      duration: 0  // 關閉動畫以防止抖動
    },
    scales:{ 
      x:{ stacked:true }, 
      y:{ stacked:true, beginAtZero:true } 
    }, 
    plugins:{ 
      legend:{ position:"bottom" },
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
    plugins:{ 
      legend:{ position:"bottom" }
    },
    scales:{ y:{ beginAtZero:true } } 
  };

  // 計算達標狀態
  const achievedDays = getAchievedDays(week.a, week.b, week.plan);
  const assyAchievedDays = getAssyAchievedDays(assyWeek.total, assyWeek.plan);
  const moduleOverallAchieved = getOverallAchievement(week.a, week.b, week.plan);
  const assyOverallAchieved = getAssyOverallAchievement(assyWeek.total, assyWeek.plan);


  // 計算 Module A + B 的總和趨勢
  const totalTrend = mod.a.map((valA, i) => (valA || 0) + (mod.b[i] || 0));

  /* ⑪ ────────── 專業達標指示器組件 ────────── */
  const AchievementIndicator = ({ achieved, type = "module" }) => {
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

      {/* 2. now / need  → 同一行 */}
      <span style={{ fontSize: "11px", opacity: 0.9 }}>
        {data.current_rate?.toFixed(1) ?? "--"} pcs/h&nbsp;
        {!data.frozen && (
          <>
            ·&nbsp;need&nbsp;
            {data.need_rate?.toFixed(1) ?? "--"} pcs/h
          </>
        )}
      </span>
    </div>
  );
};






/* ⑬ ────────── JSX ────────── */
const dashboardRef = useRef(null);

const toggleFullscreen = () => {
  if (!document.fullscreenElement) {
    dashboardRef.current?.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
};

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
        <div className="module-overlay">A {mod.A} / B {mod.B}</div>
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
              { label:"Units/hr", data:assy.data, backgroundColor:COL_AS_BG, borderColor:COL_ASSEMB, tension:.3, fill:true, pointRadius:2 }
            ]
          }}
          options={optsLine}
          className="chart"
        />
        {assy.ng > 0 && (
          <div className="ng-badge assy">
            <span className="ng-icon">⚠</span>
            <span className="ng-text">NG {assy.ng}</span>
            <span className="ng-rate">({(assy.ng / assy.cnt * 100).toFixed(1)}%)</span>
          </div>
        )}
      </div>

      {/* ----- Module weekly KPI ----- */}
      <div className={`dashboard-card ${moduleOverallAchieved ? 'achieved' : ''}`}>
        <h2 className="card-title">
          Module – Weekly Production Target
          <span className="plan-toggle" onClick={e => { e.stopPropagation(); setPlanOpen(!planOpen); }}>⚙ Planned</span>
        </h2>
        
        {/* 專業達標指示器 */}
        <AchievementIndicator achieved={moduleOverallAchieved} type="module" />
        
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
                    color: '#666'
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
                    formatter: function(value, context) {
                      const index = context.dataIndex;
                      const baseText = value || '';
                      // 如果當日達標，顯示星星符號
                      if (achievedDays.includes(index)) {
                        return '⭐ ' + baseText;
                      }
                      return baseText;
                    },
                    font: {
                      size: 12,
                      weight: 'bold'
                    },
                    color: function(context) {
                      const index = context.dataIndex;
                      return achievedDays.includes(index) ? '#FFD700' : '#666';
                    }
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
      <div className={`dashboard-card ${assyOverallAchieved ? 'achieved assy' : ''}`}>
        <h2 className="card-title">
          Assembly – Weekly Production Target
          <span className="plan-toggle" onClick={e => { e.stopPropagation(); setAssyPlanOpen(!assyPlanOpen); }}>⚙ Planned</span>
        </h2>
        
        {/* 專業達標指示器 */}
        <AchievementIndicator achieved={assyOverallAchieved} type="assy" />
        
        <div className="chart-wrapper">
          <Bar
            ref={assyWeeklyChartRef}
            data={{
              labels:assyWeek.labels,
              datasets:[
                { 
                  label:"Actual",  
                  data:assyWeek.total.map(v=>v||null), 
                  backgroundColor:COL_AS_BG, 
                  borderColor:COL_ASSEMB, 
                  stack:"act", 
                  order:1,
                  datalabels: {
                    display: true,
                    anchor: 'center',
                    align: 'center',
                    formatter: function(value, context) {
                      const index = context.dataIndex;
                      const baseText = value || '';
                      // 如果當日達標，顯示星星符號
                      if (assyAchievedDays.includes(index)) {
                        return '⭐ ' + baseText;
                      }
                      return baseText;
                    },
                    font: {
                      size: 12,
                      weight: 'bold'
                    },
                    color: function(context) {
                      const index = context.dataIndex;
                      return assyAchievedDays.includes(index) ? '#FFD700' : '#666';
                    }
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