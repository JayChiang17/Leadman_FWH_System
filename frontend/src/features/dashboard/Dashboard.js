import React, { useEffect, useState, useRef, useCallback, useContext } from "react";
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

import { fetchJSON } from "./components/DashboardConstants";
import ModuleTodayCard from "./components/ModuleTodayCard";
import AssemblyTodayCard from "./components/AssemblyTodayCard";
import ModuleWeeklyKPICard from "./components/ModuleWeeklyKPICard";
import AssemblyWeeklyKPICard from "./components/AssemblyWeeklyKPICard";

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

/* ===================================================================== */
export default function Dashboard() {
  /* ① ────────── Auth Context ────────── */
  const { getValidToken } = useContext(AuthCtx);
  const getValidTokenRef = useRef(getValidToken);
  useEffect(() => { getValidTokenRef.current = getValidToken; }, [getValidToken]);

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

  const [hasSaturdayActivity, setHasSaturdayActivity] = useState(false);
  const [riskData, setRiskData] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const weeklyChartRef = useRef(null);
  const assyWeeklyChartRef = useRef(null);
  const dashboardRef = useRef(null);
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
      const hasSaturdayData = w.labels.length > 5 ||
                             (w.count_a && w.count_a.length > 5 && (w.count_a[5] > 0 || w.count_b[5] > 0));

      if (hasSaturdayActivity || hasSaturdayData) {
        const adjustedPlan = [...(w.plan || [200,200,200,200,200])];
        if (adjustedPlan.length < 6) adjustedPlan.push(0);

        const adjustedLabels = [...(w.labels || [])];
        if (adjustedLabels.length < 6) {
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

        const adjustedA = [...(w.count_a || [])];
        const adjustedB = [...(w.count_b || [])];
        while (adjustedA.length < 6) adjustedA.push(0);
        while (adjustedB.length < 6) adjustedB.push(0);

        setWeek({ labels: adjustedLabels, a: adjustedA, b: adjustedB, plan: adjustedPlan });
        setPlanEdit(adjustedPlan);
      } else {
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
      const hasSaturdayData = w.labels.length > 5 ||
                             (w.total && w.total.length > 5 && w.total[5] > 0);

      if (hasSaturdayActivity || hasSaturdayData) {
        const adjustedPlan = [...(w.plan || [95,95,95,95,95])];
        if (adjustedPlan.length < 6) adjustedPlan.push(0);

        const adjustedLabels = [...(w.labels || [])];
        if (adjustedLabels.length < 6) {
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

        const adjustedTotal = [...(w.total || [])];
        const adjustedApower = [...(w.apower || [])];
        const adjustedApower2 = [...(w.apower2 || [])];
        const adjustedApowerS = [...(w.apower_s || [])];
        while (adjustedTotal.length < 6) adjustedTotal.push(0);
        while (adjustedApower.length < 6) adjustedApower.push(0);
        while (adjustedApower2.length < 6) adjustedApower2.push(0);
        while (adjustedApowerS.length < 6) adjustedApowerS.push(0);

        setAssyWeek({
          labels: adjustedLabels, total: adjustedTotal,
          apower: adjustedApower, apower2: adjustedApower2,
          apowerS: adjustedApowerS, plan: adjustedPlan
        });
        setAssyPlanEdit(adjustedPlan);
      } else {
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

  const refresh = useCallback(() => {
    loadMod(); loadAssy(); loadWeek(); loadAssyWeek(); loadRiskData();
  }, [loadMod, loadAssy, loadWeek, loadAssyWeek, loadRiskData]);

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

  // Refs for WS callbacks — prevents useEffect re-runs on reference changes
  const refreshRef = useRef(refresh);
  const loadWeekRef = useRef(loadWeek);
  const handleRiskUpdateRef = useRef(handleRiskUpdate);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useEffect(() => { loadWeekRef.current = loadWeek; }, [loadWeek]);
  useEffect(() => { handleRiskUpdateRef.current = handleRiskUpdate; }, [handleRiskUpdate]);

  /* ④ ────────── 首次載入 & WebSocket ────────── */
  useEffect(() => {
    isMountedRef.current = true;
    refreshRef.current();

    const ws = openDashboardSocket(
    (m) => {
      if (!isMountedRef.current) return;
      if (m.type === "system") {
        if (m.event === "connected") ws.subscribe?.("dashboard:updates");
      }
      if (m.event === "module_updated")   refreshRef.current();
      if (m.event === "assembly_updated") refreshRef.current();
      if (m.event === "weekly_plan_updated") loadWeekRef.current();
      if (m.event === "risk_update") handleRiskUpdateRef.current(m.data);
    },
    (err) => {
      if (!isMountedRef.current) return;
      console.warn("dashboard WS error:", err);
    },
    30_000,
    (...args) => getValidTokenRef.current(...args)
  );

    const controller = abortControllerRef.current;
    return () => {
      isMountedRef.current = false;
      if (controller) controller.abort();
      ws.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ⑥ ────────── 定期檢查風險 ────────── */
  useEffect(() => {
    const interval = setInterval(() => loadRiskData(), 300000);
    return () => clearInterval(interval);
  }, [loadRiskData]);

  /* ⑦ ────────── 週一自動重置檢查 ────────── */
  useEffect(() => {
    const getWeekStart = (date) => {
      const d = new Date(date);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      return new Date(d.setDate(diff));
    };

    const checkWeekReset = () => {
      const now = new Date();
      const currentWeekStart = getWeekStart(now).toISOString().split("T")[0];
      const lastCheckedWeek = localStorage.getItem("last_checked_week");

      if (currentWeekStart !== lastCheckedWeek) {
        localStorage.setItem("last_checked_week", currentWeekStart);
        const weekKey = `saturday_activity_${currentWeekStart}`;
        const hasSaturdayThisWeek = localStorage.getItem(weekKey);
        if (!hasSaturdayThisWeek) {
          setHasSaturdayActivity(false);
          refresh();
        }
      }
    };

    checkWeekReset();
    const intervalId = setInterval(checkWeekReset, 3600000);

    let earlyMondayInterval = null;
    let earlyMondayTimeout = null;
    const now = new Date();
    if (now.getDay() === 1 && now.getHours() < 6) {
      earlyMondayInterval = setInterval(checkWeekReset, 300000);
      earlyMondayTimeout = setTimeout(() => clearInterval(earlyMondayInterval), 21600000);
    }

    return () => {
      clearInterval(intervalId);
      if (earlyMondayInterval) clearInterval(earlyMondayInterval);
      if (earlyMondayTimeout) clearTimeout(earlyMondayTimeout);
    };
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

    const getCaliforniaTime = () => {
      const now = new Date();
      return new Date(now.toLocaleString("en-US", {timeZone: "America/Los_Angeles"}));
    };

    const getWeekStart = (date) => {
      const d = new Date(date);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      return new Date(d.setDate(diff)).toISOString().split("T")[0];
    };

    const isSameWeek = (date1, date2) => getWeekStart(date1) === getWeekStart(date2);

    const interceptor = api.interceptors.response.use((resp) => {
      const { method, url } = resp.config;
      const isScan = method === "post" &&
        (url.includes("/model_inventory") || url.includes("/assembly_inventory"));

      if (isScan) {
        const californiaTime = getCaliforniaTime();
        const isSaturday = californiaTime.getDay() === 6;

        if (isSaturday) {
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

    const checkCurrentWeekSaturday = () => {
      const californiaTime = getCaliforniaTime();
      const currentWeekStart = getWeekStart(californiaTime);
      const weekKey = `saturday_activity_${currentWeekStart}`;
      const saturdayRecord = localStorage.getItem(weekKey);

      const dayOfWeek = californiaTime.getDay();
      const isMonday = dayOfWeek === 1;
      const isSaturday = dayOfWeek === 6;

      if (isSaturday) {
        setHasSaturdayActivity(true);
        if (!saturdayRecord) {
          localStorage.setItem(weekKey, californiaTime.toISOString().split("T")[0]);
        }
        return;
      }

      if (saturdayRecord) {
        const recordDate = new Date(saturdayRecord);
        if (isSameWeek(californiaTime, recordDate)) {
          setHasSaturdayActivity(true);
        } else {
          localStorage.removeItem(weekKey);
          setHasSaturdayActivity(false);
          if (isMonday) refresh();
        }
      } else {
        setHasSaturdayActivity(false);
        if (isMonday && localStorage.getItem("was_saturday_last_week")) {
          localStorage.removeItem("was_saturday_last_week");
          refresh();
        }
      }

      const lastWeekStart = new Date(currentWeekStart);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      const lastWeekKey = `saturday_activity_${lastWeekStart.toISOString().split("T")[0]}`;
      if (localStorage.getItem(lastWeekKey)) {
        localStorage.setItem("was_saturday_last_week", "true");
      }
    };

    const cleanupOldRecords = () => {
      const californiaTime = getCaliforniaTime();
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith("saturday_activity_")) {
          const weekStart = key.replace("saturday_activity_", "");
          const weekStartDate = new Date(weekStart);
          const diffDays = Math.floor((californiaTime - weekStartDate) / (1000 * 60 * 60 * 24));
          if (diffDays > 28) localStorage.removeItem(key);
        }
      });
    };

    checkCurrentWeekSaturday();
    cleanupOldRecords();

    const checkInterval = setInterval(() => {
      const currentDate = getCaliforniaTime().toISOString().split("T")[0];
      const lastCheck = localStorage.getItem("last_week_check");
      if (currentDate !== lastCheck) {
        localStorage.setItem("last_week_check", currentDate);
        checkCurrentWeekSaturday();
      }
    }, 60000);

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
      await loadRiskData();
    } catch (err) { console.warn("save error", err); }
  };

  const saveAssyPlan = async () => {
    try {
      await api.post(`assembly_weekly_plan`, assyPlanEdit);
      setAssyWeek(w => ({ ...w, plan: assyPlanEdit }));
      setAssyPlanOpen(false);
      await loadRiskData();
    } catch (err) { console.warn("save error", err); }
  };

  /* ⑩ ────────── Chart 組態 ────────── */
  const legendLabelStyle = {
    boxWidth: isFullscreen ? 10 : 12,
    boxHeight: isFullscreen ? 8 : 10,
    padding: isFullscreen ? 6 : 8,
    font: { size: isFullscreen ? 9 : 10 }
  };

  const optsBar  = {
    responsive:true,
    maintainAspectRatio: true,
    aspectRatio: 1.1,
    animation: { duration: 0 },
    scales:{
      x:{ stacked:true },
      y:{ stacked:true, beginAtZero:true }
    },
    plugins:{
      legend:{ position:"bottom", labels: legendLabelStyle },
      datalabels: {
        display: true, anchor: 'center', align: 'center',
        formatter: (value) => value || '',
        font: { size: 11, weight: 'bold' },
        color: '#444'
      }
    }
  };

  const optsLine = {
    responsive:true,
    maintainAspectRatio: true,
    aspectRatio: 1.6,
    plugins:{ legend:{ position:"bottom", labels: legendLabelStyle } },
    scales:{ y:{ beginAtZero:true, ticks: { maxTicksLimit: 8 } } }
  };

  /* ⑬ ────────── JSX ────────── */
  return (
    <div
      ref={dashboardRef}
      className="dashboard-screen"
      onDoubleClick={toggleFullscreen}
    >
      <div className="dashboard-grid">
        <ModuleTodayCard mod={mod} riskData={riskData} optsLine={optsLine} />
        <AssemblyTodayCard assy={assy} riskData={riskData} optsLine={optsLine} />
        <ModuleWeeklyKPICard
          week={week} planOpen={planOpen} planEdit={planEdit}
          setPlanOpen={setPlanOpen} setPlanEdit={setPlanEdit} savePlan={savePlan}
          optsBar={optsBar} chartRef={weeklyChartRef}
        />
        <AssemblyWeeklyKPICard
          assyWeek={assyWeek} assyPlanOpen={assyPlanOpen} assyPlanEdit={assyPlanEdit}
          setAssyPlanOpen={setAssyPlanOpen} setAssyPlanEdit={setAssyPlanEdit} saveAssyPlan={saveAssyPlan}
          optsBar={optsBar} chartRef={assyWeeklyChartRef}
        />
      </div>
    </div>
  );
}
