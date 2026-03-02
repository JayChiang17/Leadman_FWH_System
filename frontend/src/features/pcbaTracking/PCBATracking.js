// src/features/pcbaTracking/PCBATracking.js
import React, { useEffect, useState, useMemo, useCallback, useContext, useRef } from "react";
import {
  Wifi, WifiOff, Download, Search, Bell, Database, Settings,
  BarChart3, Clock, Activity, CheckCircle, Package, AlertCircle, X, Tag, ArrowRight,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList
} from "recharts";
import { List as VirtualList } from "react-window";

import usePCBAWebSocket from "../../utils/usePCBAWebSocket";
import { AuthCtx } from "../../auth/AuthContext";

// 拆分後的 UI 元件
import PCBANGListPanel from "./components/PCBANGListPanel";
import PCBAEnhancedScannerPanel from "./components/PCBAEnhancedScannerPanel";
import PCBASlipModal from "./components/PCBASlipModal";
import PCBAPackingSlipPanel from "./components/PCBAPackingSlipPanel";
import PCBASlipLibrary from "./components/PCBASlipLibrary";
import PCBAModernBoardCard from "./components/PCBAModernBoardCard";
import PCBAAdminEditModal from "./components/PCBAAdminEditModal";

// 共用常數與工具
import { labelOf } from "./PCBAConstants";
import {
  decodeJWT, getToken, useDebounced, inferModel,
  fmtElapsed, toCaliTime, toCAISODate, shortMMDD, authFetch
} from "./PCBAUtils";

function ActiveBoardRow({
  index,
  style,
  boards,
  blinkSet,
  isEditor,
  onViewDetails,
  onEditBoard,
  onDeleteBoard,
  onToggleNGBoard,
}) {
  const board = boards[index];
  if (!board) return null;

  return (
    <div style={style}>
      <div className="pb-3">
        <PCBAModernBoardCard
          board={board}
          onViewDetails={() => onViewDetails(board)}
          isBlink={blinkSet.has(board.serialNumber)}
          isEditor={isEditor}
          onEdit={() => onEditBoard(board)}
          onDelete={onDeleteBoard}
          onToggleNG={onToggleNGBoard}
        />
      </div>
    </div>
  );
}

/* ----------------------- 主頁 ----------------------- */
export default function PCBATracking() {
  const PAGE_SIZE = 50;

  // boards 與統計
  const [data, setData] = useState([]);
  const [stats, setStats] = useState({ total: 0, aging: 0, coating: 0, completed: 0, efficiency: 0, byModel: {} });
  const [loadingList, setLoadingList] = useState(false);

  // slip 相關
  // Fixes issue #24: Use sessionStorage instead of localStorage for slip filter (session-level persistence)
  const [slipOpen, setSlipOpen] = useState(false);
  const [slip, setSlip] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem("pcba_slip") || "null") || { slipNumber: "", targetPairs: 0 }; }
    catch { return { slipNumber: "", targetPairs: 0 }; }
  });
  const [useSlipFilter, setUseSlipFilter] = useState(() => sessionStorage.getItem("pcba_slip_filter") === "1");
  const [slipFilterApplied, setSlipFilterApplied] = useState(() => sessionStorage.getItem("pcba_slip_filter_value") || "");
  const [savingSlip, setSavingSlip] = useState(false);
  const [slipStatus, setSlipStatus] = useState(null);

  // Slip library
  const [slipList, setSlipList] = useState([]);
  const [loadingSlipList, setLoadingSlipList] = useState(false);

  // 掃碼/面板
  const [scan, setScan] = useState("");
  const [stage, setStage] = useState("aging");

  // 詳情與編輯
  const [pick, setPick] = useState(null);
  const [editBoard, setEditBoard] = useState(null);
  const [newSlip, setNewSlip] = useState("");
  useEffect(() => { setNewSlip(pick?.slipNumber || ""); }, [pick]);

  // Modal states
  const [showActiveBoardsModal, setShowActiveBoardsModal] = useState(false);
  const [showNGModal, setShowNGModal] = useState(false);
  const [showDailyOutputModal, setShowDailyOutputModal] = useState(false);
  const [showConsumptionModal, setShowConsumptionModal] = useState(false);

  // 篩選
  const [fStage, setFStage] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [ngFilter, setNgFilter] = useState("all");
  const [q, setQ] = useState("");
  const [filterSlip, setFilterSlip] = useState("");
  const [filterDate, setFilterDate] = useState("");

  const debouncedQ = useDebounced(q, 350);
  const debouncedSlip = useDebounced(filterSlip, 350);

  // toast 與 blink
  const [log, setLog] = useState([]);
  const [blink, setBlink] = useState(new Set());

  // 日輸出(圖)
  const [rangeDays, setRangeDays] = useState(7);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [dailyRows, setDailyRows] = useState([]);
  const [dailyAvg, setDailyAvg] = useState(0);

  // 每日消耗(圖)
  const [dailyConsumption, setDailyConsumption] = useState([]);
  const [consumptionAvg, setConsumptionAvg] = useState(0);

  // 今日分佈
  const [todayRow, setTodayRow] = useState(null);

  // 全域 NG
  const [ngActive, setNgActive] = useState([]);

  // auth
  const auth = useContext(AuthCtx) || {};
  const token = getToken();
  const claims = token ? decodeJWT(token) : null;
  const roleLower = String(claims?.role || auth?.user?.role || "").toLowerCase();
  const isEditor = roleLower === "admin" || roleLower === "operator";
  const roleBadge = roleLower === "admin" ? "Admin" : roleLower === "operator" ? "Operator" : "Viewer";
  const operatorName = claims?.sub || auth?.user?.username || "User";

  const toastTimersRef = useRef(new Set());
  // Fixes issue #19: Add mounted ref to prevent state updates after unmount
  const isMountedRef = useRef(true);

  const toast = useCallback((msg, level = "info") => {
    if (!msg || !isMountedRef.current) return;
    const id = Date.now() + Math.random();
    setLog((l) => [...l, { id, msg, level }]);
    const timer = setTimeout(() => {
      if (isMountedRef.current) {
        setLog((l) => l.filter((x) => x.id !== id));
      }
      toastTimersRef.current.delete(timer);
    }, 3200);
    toastTimersRef.current.add(timer);
  }, []);

  // Cleanup toast timers on unmount
  useEffect(() => {
    const timers = toastTimersRef.current;
    return () => {
      isMountedRef.current = false;
      timers.forEach(timer => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const guardEdit = useCallback(() => {
    if (!isEditor) {
      toast("Viewer role cannot modify. Please sign in as Operator or Admin.", "warning");
      return false;
    }
    return true;
  }, [isEditor, toast]);

  const blinkTimersRef = useRef(new Map());

  const upsertLocal = useCallback((b) => {
    if (!isMountedRef.current) return;

    setData((p) => {
      const i = p.findIndex((x) => x.serialNumber === b.serialNumber);
      if (i >= 0) { const cp = [...p]; cp[i] = { ...cp[i], ...b }; return cp; }
      return [b, ...p];
    });
    setBlink((s) => new Set(s).add(b.serialNumber));

    // Clear existing timer for this serial
    if (blinkTimersRef.current.has(b.serialNumber)) {
      clearTimeout(blinkTimersRef.current.get(b.serialNumber));
    }

    // Fixes issue #19: Check mounted status before state updates in timer
    const timer = setTimeout(() => {
      if (isMountedRef.current) {
        setBlink((s) => { const n = new Set(s); n.delete(b.serialNumber); return n; });
      }
      blinkTimersRef.current.delete(b.serialNumber);
    }, 700);
    blinkTimersRef.current.set(b.serialNumber, timer);
  }, []);

  // Cleanup blink timers on unmount
  useEffect(() => {
    const timers = blinkTimersRef.current;
    return () => {
      isMountedRef.current = false;
      timers.forEach(timer => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  /* KPI breakdowns */
  const stageBreakdown = useMemo(() => {
    const bm = stats?.byModel ?? {};
    const safe = (m, k) => Number(bm?.[m]?.[k] ?? 0);
    return {
      aging:     { AM7: safe("AM7", "aging"),     AU8: safe("AU8", "aging") },
      coating:   { AM7: safe("AM7", "coating"),   AU8: safe("AU8", "coating") },
      completed: { AM7: safe("AM7", "completed"), AU8: safe("AU8", "completed") },
    };
  }, [stats.byModel]);

  const available = useMemo(() => {
    // Use backend-computed available values (completed non-NG minus consumed by assembly).
    // Do NOT fall back to stageBreakdown.completed (which includes consumed boards).
    const a7    = Number(stats.availableAM7    ?? 0);
    const a8    = Number(stats.availableAU8    ?? 0);
    const total = Number(stats.availableTotal  ?? (a7 + a8));
    return { AM7: a7, AU8: a8, total };
  }, [stats.availableAM7, stats.availableAU8, stats.availableTotal]);

  /* -------- Slip handlers -------- */
  const refreshSlip = useCallback(async (sn) => {
    if (!sn) { setSlipStatus(null); return; }
    try {
      // Use query parameter instead of path parameter to avoid URL encoding issues with "/" in slip numbers
      const r = await authFetch(`/pcba/slips/status?slip_number=${encodeURIComponent(sn)}`);
      if (r.ok) setSlipStatus(await r.json());
    } catch { /* ignore */ }
  }, []);

  const fetchSlipListRef = useRef();
  fetchSlipListRef.current = async () => {
    setLoadingSlipList(true);
    try {
      const r = await authFetch(`/pcba/slips`);
      if (r.ok) {
        const arr = await r.json();
        arr.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        setSlipList(arr);
      }
    } catch { /* ignore */ }
    finally { setLoadingSlipList(false); }
  };
  const fetchSlipList = useCallback(() => fetchSlipListRef.current(), []);

  const saveSlip = useCallback(async () => {
    if (!guardEdit()) return;
    if (!slip?.slipNumber?.trim()) return;
    setSavingSlip(true);
    try {
      const res = await authFetch(`/pcba/slips`, {
        method: "POST",
        body: JSON.stringify({ slipNumber: slip.slipNumber.trim(), targetPairs: Number(slip.targetPairs || 0) }),
      });
      if (!res.ok) {
        const t = await res.json().catch(() => ({ detail: "" }));
        throw new Error(t.detail || `Save failed (${res.status})`);
      }
      sessionStorage.setItem("pcba_slip", JSON.stringify({ slipNumber: slip.slipNumber.trim(), targetPairs: Number(slip.targetPairs || 0) }));
      sessionStorage.setItem("pcba_slip_filter_value", slip.slipNumber.trim());
      setSlipFilterApplied(slip.slipNumber.trim());
      toast(`Slip saved: ${slip.slipNumber} (${slip.targetPairs || 0})`, "success");
      refreshSlip(slip.slipNumber.trim());
      await fetchSlipList();
    } catch (e) {
      toast(e.message || "Save slip failed", "error");
    } finally { setSavingSlip(false); }
  }, [guardEdit, slip, toast, refreshSlip, fetchSlipList]);

  useEffect(() => { sessionStorage.setItem("pcba_slip_filter", useSlipFilter ? "1" : "0"); }, [useSlipFilter]);

  /* -------- Global NG -------- */
  const fetchNGActiveRef = useRef();
  fetchNGActiveRef.current = async () => {
    try {
      const r = await authFetch(`/pcba/ng/active?limit=2000`);
      if (r.ok) setNgActive(await r.json());
    } catch { /* ignore */ }
  };
  const fetchNGActive = useCallback(() => fetchNGActiveRef.current(), []);

  useEffect(() => { fetchNGActive(); }, [fetchNGActive]);

  /* 今日統計 */
  const fetchTodayStatsRef = useRef();
  fetchTodayStatsRef.current = async () => {
    try {
      const r = await authFetch(`/pcba/statistics/today`);
      if (r.ok) setTodayRow(await r.json());
    } catch { /* ignore */ }
  };
  const fetchTodayStats = useCallback(() => fetchTodayStatsRef.current(), []);

  /* WebSocket */
  // Fixes issue #15: Use refs to avoid race conditions with frequently changing dependencies
  const wsHandlerRefs = useRef({
    slipFilterApplied: null,
    rangeDays: 7,
    customFrom: "",
    customTo: "",
    dataLength: 0
  });

  // Update refs whenever values change
  useEffect(() => {
    wsHandlerRefs.current.slipFilterApplied = slipFilterApplied;
    wsHandlerRefs.current.rangeDays = rangeDays;
    wsHandlerRefs.current.customFrom = customFrom;
    wsHandlerRefs.current.customTo = customTo;
    wsHandlerRefs.current.dataLength = data.length;
  }, [slipFilterApplied, rangeDays, customFrom, customTo, data.length]);

  // Forward declare refs for functions used in onWSMessage
  const debouncedStatsRefreshRef = useRef();
  const fetchDashboardDailyRef = useRef();

  const onWSMessage = useCallback((msg) => {
    const refs = wsHandlerRefs.current;

    switch (msg.type) {
      case "initial_data":
        if (!refs.dataLength && Array.isArray(msg.boards)) setData(msg.boards);
        if (msg.statistics) setStats((s) => ({ ...s, ...msg.statistics }));
        // Use debounced refresh (fixes issue #22)
        if (debouncedStatsRefreshRef.current) debouncedStatsRefreshRef.current();
        break;
      case "board_update":
        if (msg.board?.serialNumber) {
          upsertLocal(msg.board);
          setPick((p) => (p && p.serialNumber === msg.board.serialNumber ? { ...p, ...msg.board } : p));
        }
        if (refs.slipFilterApplied) refreshSlip(refs.slipFilterApplied);
        // Use ref to avoid initialization order issue
        if (fetchDashboardDailyRef.current) {
          fetchDashboardDailyRef.current(refs.rangeDays, refs.customFrom, refs.customTo);
        }
        // Use debounced refresh (fixes issue #22)
        if (debouncedStatsRefreshRef.current) debouncedStatsRefreshRef.current();
        break;
      case "board_deleted":
        if (msg.serialNumber) setData((p) => p.filter((x) => x.serialNumber !== msg.serialNumber));
        if (refs.slipFilterApplied) refreshSlip(refs.slipFilterApplied);
        // Use ref to avoid initialization order issue
        if (fetchDashboardDailyRef.current) {
          fetchDashboardDailyRef.current(refs.rangeDays, refs.customFrom, refs.customTo);
        }
        // Use debounced refresh (fixes issue #22)
        if (debouncedStatsRefreshRef.current) debouncedStatsRefreshRef.current();
        break;
      case "statistics_update":
        if (msg.statistics) setStats((s) => ({ ...s, ...msg.statistics }));
        break;
      case "notification": toast(msg.message, msg.level || "info"); break;
      case "error": toast(msg.message || "Server error", "error"); break;
      default: break;
    }
  }, [upsertLocal, toast, refreshSlip]);

  const { isConnected, isConnecting, reconnect } = usePCBAWebSocket(onWSMessage);

  // Fixes issue #22: Debounce statistics refresh to avoid excessive API calls
  const statsRefreshTimerRef = useRef(null);
  const debouncedStatsRefresh = useCallback(() => {
    if (statsRefreshTimerRef.current) {
      clearTimeout(statsRefreshTimerRef.current);
    }
    statsRefreshTimerRef.current = setTimeout(() => {
      fetchNGActive();
      fetchTodayStats();
      statsRefreshTimerRef.current = null;
    }, 300); // 300ms debounce
  }, [fetchNGActive, fetchTodayStats]);

  // Store in ref for WebSocket handler
  debouncedStatsRefreshRef.current = debouncedStatsRefresh;

  // Cleanup stats refresh timer on unmount
  useEffect(() => {
    return () => {
      if (statsRefreshTimerRef.current) {
        clearTimeout(statsRefreshTimerRef.current);
      }
    };
  }, []);

  /* 初始抓資料 */
  useEffect(() => {
    (async () => {
      try {
        const [rStats, rDash] = await Promise.all([
          authFetch(`/pcba/statistics`),
          authFetch(`/pcba/dashboard/summary`),
        ]);

        const statsJson  = rStats.ok  ? await rStats.json()  : null;
        const dashJson   = rDash.ok   ? await rDash.json()   : null;

        if (statsJson)  setStats((v) => ({ ...v, ...statsJson }));
        if (dashJson) {
          const inv = dashJson.inventory || {};
          setStats((v) => ({
            ...v,
            availableAM7:   inv.availableAM7  ?? v.availableAM7  ?? 0,
            availableAU8:   inv.availableAU8  ?? v.availableAU8  ?? 0,
            availableTotal: inv.availableTotal ?? v.availableTotal ?? 0,
            consumedAM7:    inv.usedAM7       ?? v.consumedAM7   ?? 0,
            consumedAU8:    inv.usedAU8       ?? v.consumedAU8   ?? 0,
            consumedTotal:  inv.usedTotal     ?? v.consumedTotal ?? 0,
          }));

          const daily = dashJson.daily || {};
          const rows = (daily.rows || []).map((r) => ({
            date: r.date,
            dateShort: shortMMDD(r.date),
            pairs: Number(r.pairsOK || 0),
          }));
          setDailyRows(rows);
          setDailyAvg(Number(daily.avgPairsOKPerDay || 0));

          setTodayRow(dashJson.today || null);
        } else {
          fetchDashboardDaily(rangeDays, customFrom, customTo);
          fetchTodayStats();
        }
      } catch { /* ignore */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* boards 分頁/查詢 */
  const buildListQueryRef = useRef();
  buildListQueryRef.current = (offset = 0, limit = PAGE_SIZE) => {
    const qs = new URLSearchParams();
    // Fixes issue #18: Validate URL parameters before sending to API
    const validStages = ["all", "aging", "coating", "completed"];
    const validModels = ["all", "AM7", "AU8"];

    if (fStage !== "all" && validStages.includes(fStage)) qs.set("stage", fStage);
    if (modelFilter !== "all" && validModels.includes(modelFilter)) qs.set("model", modelFilter);
    // Limit search query length and sanitize
    if (debouncedQ && debouncedQ.length <= 100) qs.set("search", debouncedQ.slice(0, 100));
    const effectiveSlip = (useSlipFilter && slipFilterApplied) ? slipFilterApplied : debouncedSlip;
    if (effectiveSlip) qs.set("slip", effectiveSlip);
    qs.set("limit", String(limit));
    qs.set("offset", String(offset));
    return `/pcba/boards?${qs.toString()}`;
  };

  // AbortController for cancelling ongoing requests (fixes issue #14)
  const abortControllerRef = useRef(null);

  const fetchBoardsRef = useRef();
  fetchBoardsRef.current = async ({ reset = false, offset: offsetOverride } = {}) => {
    // Cancel any ongoing fetch requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new AbortController for this fetch
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setLoadingList(true);
    try {
      const effectiveSlip = (useSlipFilter && slipFilterApplied) ? slipFilterApplied : debouncedSlip;
      const usingSlip = Boolean(effectiveSlip);

      if (usingSlip) {
        const ALL = [];
        let offset = 0;
        const perPage = 100;
        const hardCap = 10000;
        let loops = 0;
        while (offset < hardCap) {
          // Check if aborted before each request
          if (signal.aborted) {
            break;
          }

          const url = buildListQueryRef.current(offset, perPage);
          const r = await authFetch(url, { signal });
          if (!r.ok) break;
          const batch = await r.json();
          if (!Array.isArray(batch) || batch.length === 0) break;
          ALL.push(...batch);
          offset += batch.length;
          loops += 1;
          if (batch.length < perPage) break;
          if (loops > 200) break;
        }

        // Only update state if not aborted
        if (!signal.aborted) {
          setData(ALL);
        }
      } else {
        const offset = reset ? 0 : (Number.isFinite(offsetOverride) ? offsetOverride : 0);
        const url = buildListQueryRef.current(offset, PAGE_SIZE);
        const r = await authFetch(url, { signal });
        if (r.ok) {
          const arr = await r.json();
          if (!signal.aborted) {
            setData((prev) => (reset ? arr : [...prev, ...arr]));
          }
        }
      }
    } catch (err) {
      // Don't log AbortError as error
      if (err.name !== 'AbortError') {
        console.error('Fetch error:', err);
      }
    }
    finally {
      if (!signal.aborted) {
        setLoadingList(false);
      }
    }
  };
  const fetchBoards = useCallback((params) => fetchBoardsRef.current(params), []);

  // Cleanup: abort ongoing requests on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Trigger fetch when filters change
  useEffect(() => {
    fetchBoards({ reset: true });
  }, [fStage, modelFilter, debouncedQ, debouncedSlip, useSlipFilter, slipFilterApplied]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 套用 slip filter */
  const applySlip = useCallback((val) => {
    setSlipFilterApplied(val);
    sessionStorage.setItem("pcba_slip_filter_value", val || "");
    if (val) refreshSlip(val);
    else setSlipStatus(null);
    fetchBoards({ reset: true });
  }, [refreshSlip, fetchBoards]);

  const editSlipTarget = useCallback(async (sn, tp) => {
    if (!guardEdit()) return;
    try {
      const r = await authFetch(`/pcba/slips/${encodeURIComponent(sn)}`, {
        method: "PATCH",
        body: JSON.stringify({ targetPairs: Number(tp || 0) })
      });
      if (!r.ok) {
        const t = await r.json().catch(() => ({ detail: "" }));
        throw new Error(t.detail || `Update failed (${r.status})`);
      }
      toast(`Updated ${sn} → ${tp}`, "success");
      await fetchSlipList();
      if (slipStatus?.slipNumber === sn) refreshSlip(sn);
    } catch (e) { toast(e.message || "Update slip failed", "error"); }
  }, [guardEdit, fetchSlipList, toast, slipStatus, refreshSlip]);

  const deleteSlip = useCallback(async (sn) => {
    if (!guardEdit()) return;
    const ok = window.confirm(`Delete slip ${sn}? (Only allowed when no boards use it)`);
    if (!ok) return;
    try {
      const r = await authFetch(`/pcba/slips/${encodeURIComponent(sn)}`, { method: "DELETE" });
      if (r.status === 409) {
        const t = await r.json().catch(() => ({ detail: "Cannot delete: related boards exist" }));
        throw new Error(t.detail);
      }
      if (!r.ok) {
        const t = await r.json().catch(() => ({ detail: "" }));
        throw new Error(t.detail || `Delete failed (${r.status})`);
      }
      toast(`Deleted slip ${sn}`, "success");
      await fetchSlipList();
      if (slipFilterApplied === sn) { applySlip(""); }
    } catch (e) { toast(e.message || "Delete slip failed", "error"); }
  }, [guardEdit, fetchSlipList, toast, slipFilterApplied, applySlip]);

  /* 變更 slip（明確檢查配對上限） */
  const changeSlip = useCallback(async (serialNumber, newSlip, targetPairs) => {
    if (!guardEdit()) return;
    try {
      let boardInfo = null;
      try {
        const r0 = await authFetch(`/pcba/boards/${encodeURIComponent(serialNumber)}`);
        if (r0.ok) boardInfo = await r0.json();
      } catch { /* ignore */ }

      const normalizedNew = (newSlip || "").trim();
      if (boardInfo && boardInfo.stage === "completed" && !boardInfo.ngFlag && normalizedNew) {
        const rs = await authFetch(`/pcba/slips/${encodeURIComponent(normalizedNew)}/status`);
        if (rs.ok) {
          const s = await rs.json();
          const mdl = (boardInfo.model || "").toUpperCase();
          const am7 = Number(s.completedAM7 || 0) + (mdl === "AM7" ? 1 : 0);
          const au8 = Number(s.completedAU8 || 0) + (mdl === "AU8" ? 1 : 0);
          const nextPairs = Math.min(am7, au8);
          const tgt = Number(s.targetPairs || 0);
          if (tgt > 0 && nextPairs > tgt) {
            toast(`Slip ${normalizedNew} target ${tgt} reached; cannot move more pairs in`, "error");
            throw new Error("Slip target would be exceeded");
          }
        }
      }

      const res = await authFetch(`/pcba/boards/${encodeURIComponent(serialNumber)}/slip`, {
        method: "PATCH",
        body: JSON.stringify({ slipNumber: normalizedNew || null, targetPairs }),
      });
      if (!res.ok) {
        const t = await res.json().catch(() => ({ detail: "" }));
        throw new Error(t.detail || `Update slip failed (${res.status})`);
      }
      const updated = await res.json();
      upsertLocal(updated);
      toast(`Slip updated: ${serialNumber} → ${normalizedNew || "(removed)"}`, "success");
      if (slipFilterApplied) refreshSlip(slipFilterApplied);
      fetchBoards({ reset: true });
      fetchNGActive();
      return updated;
    } catch (e) {
      toast(e.message || "Update slip failed", "error");
      throw e;
    }
  }, [guardEdit, upsertLocal, toast, slipFilterApplied, refreshSlip, fetchBoards, fetchNGActive]);

  /* Admin 編輯/刪除/NG */
  const handleAdminEdit = async (serialNumber, formData) => {
    if (!guardEdit()) return;
    try {
      const current = data.find(b => b.serialNumber === serialNumber) || {};
      const slipChanged = (formData.slipNumber ?? "") !== (current.slipNumber ?? "");

      if (slipChanged) await changeSlip(serialNumber, formData.slipNumber, formData.targetPairs);

      const { slipNumber, targetPairs, ...rest } = formData;
      const payload = Object.fromEntries(Object.entries(rest).filter(([_, v]) => v !== undefined));

      const res = await authFetch(`/pcba/boards/${encodeURIComponent(serialNumber)}/admin`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const t = await res.json().catch(() => ({ detail: "" }));
        throw new Error(t.detail || `Edit failed (${res.status})`);
      }
      const updatedBoard = await res.json();

      if (formData.newSerialNumber && formData.newSerialNumber !== serialNumber) {
        setData((p) => p.filter((x) => x.serialNumber !== serialNumber));
        upsertLocal(updatedBoard);
      } else {
        upsertLocal(updatedBoard);
      }
      setEditBoard(null);
      toast("Board updated successfully", "success");

      if (slipFilterApplied && (slipChanged || payload.stage)) refreshSlip(slipFilterApplied);
      fetchNGActive();
      setPick((p)=> p && p.serialNumber === updatedBoard.serialNumber ? { ...p, ...updatedBoard } : p);
    } catch (e) { toast(e.message || "Edit failed", "error"); }
  };

  const handleDelete = useCallback(async (board) => {
    if (!guardEdit()) return;
    const yes = window.confirm(`Delete ${board.serialNumber}?`);
    if (!yes) return;
    try {
      const res = await authFetch(`/pcba/boards/${encodeURIComponent(board.serialNumber)}`, { method: "DELETE" });
      if (res.status === 404) return toast(`Board ${board.serialNumber} not found`, "warning");
      if (!res.ok) {
        const t = await res.json().catch(() => ({ detail: "" }));
        throw new Error(t.detail || `Delete failed (${res.status})`);
      }
      setData((p) => p.filter((x) => x.serialNumber !== board.serialNumber));
      setPick(null);
      toast(`Deleted ${board.serialNumber}`, "success");
      if (slipFilterApplied) refreshSlip(slipFilterApplied);
      fetchBoards({ reset: true });
      fetchNGActive();
    } catch (e) { toast(e.message || "Delete failed", "error"); }
  }, [guardEdit, toast, slipFilterApplied, refreshSlip, fetchBoards, fetchNGActive]);

  const toggleNG = useCallback(async (board, setToNG) => {
    if (!guardEdit()) return;
    try {
      let reason = "";
      if (setToNG) reason = prompt("Enter NG reason (optional):") || "";
      else { const ok = window.confirm("Clear NG flag?"); if (!ok) return; }

      const res = await authFetch(`/pcba/boards/${encodeURIComponent(board.serialNumber)}/ng`, {
        method: "PATCH",
        body: JSON.stringify({ ng: !!setToNG, reason }),
      });
      if (!res.ok) {
        const t = await res.json().catch(() => ({ detail: "" }));
        throw new Error(t.detail || `NG update failed (${res.status})`);
      }
      const updated = await res.json();
      upsertLocal(updated);
      setPick((p) => (p && p.serialNumber === updated.serialNumber ? { ...p, ...updated } : p));
      toast(setToNG ? "Marked NG" : "Cleared NG", "success");
      if (slipFilterApplied) refreshSlip(slipFilterApplied);
      fetchBoards({ reset: true });
      fetchNGActive();
    } catch (e) { toast(e.message || "NG update failed", "error"); }
  }, [guardEdit, upsertLocal, toast, slipFilterApplied, refreshSlip, fetchBoards, fetchNGActive]);

  /* --------- Daily chart --------- */
  // fetchDashboardDailyRef already declared above for use in onWSMessage
  fetchDashboardDailyRef.current = async (days, fromC = "", toC = "") => {
    try {
      let url = `/pcba/statistics/daily`;
      if (days && days > 0) {
        url += `?days=${days}`;
      } else if (fromC && toC) {
        url += `?start=${encodeURIComponent(fromC)}&end=${encodeURIComponent(toC)}`;
      }
      const r = await authFetch(url);
      if (r.ok) {
        const body = await r.json();
        const rowsRaw = body?.rows || [];
        const rows = rowsRaw.map(rw => ({
          date: rw.date,
          dateShort: shortMMDD(rw.date),
          pairs: Number(rw.pairsOK || 0)
        }));
        setDailyRows(rows);
        setDailyAvg(Number(body?.avgPairsOKPerDay || 0));
      }
    } catch { /* ignore */ }
  };
  const fetchDashboardDaily = useCallback((days, fromC, toC) =>
    fetchDashboardDailyRef.current(days, fromC, toC), []);

  useEffect(() => {
    fetchDashboardDaily(rangeDays, customFrom, customTo);
  }, [rangeDays, customFrom, customTo]); // eslint-disable-line react-hooks/exhaustive-deps

  /* --------- Daily consumption chart --------- */
  const fetchDailyConsumptionRef = useRef();
  fetchDailyConsumptionRef.current = async (days, fromC = "", toC = "") => {
    try {
      let url = `/pcba/statistics/consumption`;
      if (days && days > 0) {
        url += `?days=${days}`;
      } else if (fromC && toC) {
        url += `?start=${encodeURIComponent(fromC)}&end=${encodeURIComponent(toC)}`;
      }
      const r = await authFetch(url);
      if (r.ok) {
        const body = await r.json();
        const rowsRaw = body?.rows || [];
        const rows = rowsRaw.map(rw => ({
          date: rw.date,
          dateShort: shortMMDD(rw.date),
          consumed: Number(rw.consumed || 0),
          consumedPairs: Number(rw.consumedPairs || 0)
        }));
        setDailyConsumption(rows);
        setConsumptionAvg(Number(body?.avgConsumedPerDay || 0));
      }
    } catch { /* ignore */ }
  };
  const fetchDailyConsumption = useCallback((days, fromC, toC) =>
    fetchDailyConsumptionRef.current(days, fromC, toC), []);

  useEffect(() => {
    fetchDailyConsumption(rangeDays, customFrom, customTo);
  }, [rangeDays, customFrom, customTo]); // eslint-disable-line react-hooks/exhaustive-deps

  /* client 端額外篩（Slip / SN 查詢時忽略日期） */
  const list = useMemo(() => {
    const effectiveSlip = (useSlipFilter && slipFilterApplied) ? slipFilterApplied : debouncedSlip;
    const ignoreDate = Boolean(effectiveSlip || debouncedQ);
    return data.filter((b) => {
      const matchDate = ignoreDate ? true : (!filterDate ? true : toCAISODate(b.lastUpdate || b.startTime) === filterDate);
      const matchNG = ngFilter === "all" ? true : (ngFilter === "ng" ? !!b.ngFlag : !b.ngFlag);
      return matchDate && matchNG;
    });
  }, [data, filterDate, ngFilter, useSlipFilter, slipFilterApplied, debouncedSlip, debouncedQ]);

  /* 匯出 */
  const exportCsv = () => {
    const rows = [
      ["Serial", "Batch", "Slip", "Model", "Stage", "Start (CA Time)", "Last Update (CA Time)", "Duration", "Operator", "NG Flag", "NG Reason"],
      ...list.map((b) => [
        b.serialNumber, b.batchNumber, b.slipNumber || "",
        b.model, labelOf(b.stage),
        toCaliTime(b.startTime), toCaliTime(b.lastUpdate), fmtElapsed(b.startTime, b.lastUpdate, b.stage),
        b.operator || "User",
        b.ngFlag ? "NG" : "",
        (b.ngReason || "").replace(/\n/g, " "),
      ]),
    ];
    const blob = new Blob([rows.map((r) => r.map((cell) => {
      const str = String(cell ?? "");
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    }).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `PCBA_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    // Revoke the blob URL to prevent memory leak
    setTimeout(() => URL.revokeObjectURL(url), 100);
    toast("Report exported", "success");
  };

  useEffect(() => { if (slipOpen) fetchSlipList(); }, [slipOpen, fetchSlipList]);

  const submit = async (selectedStageFromPanel) => {
    if (!guardEdit()) return;

    const chosenStage = selectedStageFromPanel;
    if (!chosenStage) return toast("請先選擇階段（Aging / Coating / Inventory）", "warning");

    const raw = scan.trim();
    if (!raw) return toast("Please scan a barcode", "warning");

    const mdlPreview = inferModel(raw);
    if (!mdlPreview) return toast("Only AU8/AM7 models accepted", "error");

    const serial = raw;

    let preBoard = data.find(b => b.serialNumber === serial);
    try {
      if (!preBoard) {
        const r0 = await authFetch(`/pcba/boards/${encodeURIComponent(serial)}`);
        if (r0.ok) preBoard = await r0.json();
      }
    } catch { /* ignore */ }
    const preSlip = preBoard?.slipNumber || null;
    const _effectiveModel = (preBoard?.model || mdlPreview || "").toUpperCase();

    // Fixes issue #20: Remove client-side slip validation to avoid race conditions
    // Backend will enforce slip target atomically
    // (Removed client-side check that could race with other concurrent requests)

    const payload = {
      serialNumber: serial,
      stage: chosenStage,
      model: "AUTO-DETECT",
      operator: operatorName,
    };

    if (chosenStage === "aging" && !preSlip) {
      const picked = (slipFilterApplied || slip?.slipNumber || "").trim();
      if (picked) {
        payload.slipNumber = picked;
        if (slip?.targetPairs != null) payload.targetPairs = slip.targetPairs;
      }
    }

    try {
      const res = await authFetch(`/pcba/scan`, { method: "POST", body: JSON.stringify(payload) });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        // revert protection
        try {
          const rCheck = await authFetch(`/pcba/boards/${encodeURIComponent(serial)}`);
          if (rCheck.ok) {
            const fresh = await rCheck.json();
            const changedUnexpectedly =
              preSlip !== undefined && preSlip !== null && fresh?.slipNumber !== preSlip;
            if (changedUnexpectedly) {
              await changeSlip(serial, preSlip || "", undefined);
              toast("Reverted slip due to scan error", "warning");
            }
          }
        } catch {}
        throw new Error(errJson.detail || `Scan failed (${res.status})`);
      }

      const updated = await res.json();
      upsertLocal(updated);
      toast(`${serial} → ${labelOf(chosenStage)}`, "success");
      if (slipFilterApplied) refreshSlip(slipFilterApplied);
      fetchBoards({ reset: true });
      fetchNGActive();
      fetchTodayStats();
    } catch (e) {
      toast(e.message || "Submit failed", "error");
    } finally {
      setScan("");
    }
  };

  const ngCount = useMemo(() => ngActive.filter((b) => b.ngFlag).length, [ngActive]);

  /* ---------------- UI ---------------- */
  return (
    <div className="min-h-screen bg-gray-50 text-[15px]">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 lg:px-6">
          <div className="flex items-center justify-between h-16">
            {/* Left: Brand */}
            <div className="flex items-center gap-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-center">
                  <Package className="text-gray-700" size={20} />
                </div>
                <div>
                  <h1 className="text-lg font-bold text-gray-900 leading-tight">PCBA Tracker</h1>
                  <p className="text-xs text-gray-500 leading-tight">Production Control</p>
                </div>
              </div>

              <div className="hidden md:flex items-center gap-2.5">
                <span className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                  isEditor ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-gray-50 text-gray-600 border-gray-200"
                }`}>{roleBadge}</span>

                {slipStatus?.slipNumber && (
                  <span className="px-3 py-1.5 bg-teal-50 text-teal-700 rounded-lg text-xs font-semibold border border-teal-200">
                    Slip: {slipStatus.slipNumber} • {slipStatus.completedPairs}/{slipStatus.targetPairs}
                  </span>
                )}
              </div>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2.5">
              {/* Connection Status */}
              <div className={`hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                isConnected
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-red-50 text-red-700 border-red-200"
              }`}>
                {isConnected ? <Wifi size={16} /> : <WifiOff size={16} />}
                <span>{isConnected ? "Live" : isConnecting ? "Connecting..." : "Offline"}</span>
              </div>

              {/* Slip Button */}
              <button
                onClick={() => setSlipOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-white border-2 border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all text-sm font-semibold"
                title="Packing Slip Tracker"
              >
                <Tag size={16} />
                <span className="hidden sm:inline">Slip</span>
              </button>

              {/* Export Button */}
              <button
                onClick={exportCsv}
                className="hidden md:flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-xl hover:bg-gray-800 transition-all text-sm font-semibold"
              >
                <Download size={16} />
                Export
              </button>

              {/* Settings */}
              <button
                onClick={reconnect}
                className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                disabled={isConnecting}
                title="Reconnect"
              >
                <Settings size={20} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6 space-y-5">
        {/* WIP Dashboard */}
        <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">Production Control Center</p>
                <h2 className="text-xl font-bold text-gray-900">PCBA Work in Process</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => { fetchBoards({ reset: true }); setShowActiveBoardsModal(true); }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 hover:border-gray-300 transition-colors"
                >
                  <Database className="w-4 h-4" />
                  <span className="hidden sm:inline">Boards</span> ({list.length})
                </button>
                <button
                  onClick={() => { fetchNGActive(); setShowNGModal(true); }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 hover:border-gray-300 transition-colors"
                >
                  <AlertCircle className="w-4 h-4" />
                  <span className="hidden sm:inline">NG</span> ({ngCount})
                </button>
                <button
                  onClick={() => { fetchDashboardDaily(rangeDays, customFrom, customTo); setShowDailyOutputModal(true); }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 hover:border-gray-300 transition-colors"
                >
                  <BarChart3 className="w-4 h-4" />
                  <span className="hidden sm:inline">Output</span>
                </button>
                <button
                  onClick={() => { fetchDailyConsumption(rangeDays, customFrom, customTo); setShowConsumptionModal(true); }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 hover:border-gray-300 transition-colors"
                >
                  <Package className="w-4 h-4" />
                  <span className="hidden sm:inline">Consumption</span>
                </button>
              </div>
            </div>
          </div>

          {/* WIP Pipeline: Aging → Coating → Completed */}
          <div className="px-5 pt-4 pb-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">WIP Pipeline</p>
            <div className="flex items-stretch gap-2">
              {/* Aging */}
              <div className="flex-1 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">Aging</span>
                  <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                    <Clock className="w-4 h-4 text-amber-700" />
                  </div>
                </div>
                <div className="text-3xl font-bold text-gray-900 tabular-nums">{stats.aging}</div>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                  <span>AM7 <span className="font-semibold text-gray-700">{stageBreakdown.aging.AM7}</span></span>
                  <span className="text-gray-300">|</span>
                  <span>AU8 <span className="font-semibold text-gray-700">{stageBreakdown.aging.AU8}</span></span>
                </div>
              </div>

              {/* Arrow */}
              <div className="flex items-center text-gray-300">
                <ArrowRight className="w-5 h-5" />
              </div>

              {/* Coating */}
              <div className="flex-1 rounded-xl border border-cyan-200 bg-cyan-50/50 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-teal-700">Coating</span>
                  <div className="w-8 h-8 rounded-lg bg-cyan-100 flex items-center justify-center">
                    <Activity className="w-4 h-4 text-teal-700" />
                  </div>
                </div>
                <div className="text-3xl font-bold text-gray-900 tabular-nums">{stats.coating}</div>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                  <span>AM7 <span className="font-semibold text-gray-700">{stageBreakdown.coating.AM7}</span></span>
                  <span className="text-gray-300">|</span>
                  <span>AU8 <span className="font-semibold text-gray-700">{stageBreakdown.coating.AU8}</span></span>
                </div>
              </div>

              {/* Arrow */}
              <div className="flex items-center text-gray-300">
                <ArrowRight className="w-5 h-5" />
              </div>

              {/* Completed / Available Inventory */}
              <div className="flex-1 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Inventory</span>
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                    <CheckCircle className="w-4 h-4 text-emerald-700" />
                  </div>
                </div>
                <div className="text-3xl font-bold text-gray-900 tabular-nums">{available.total}</div>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                  <span>AM7 <span className="font-semibold text-gray-700">{available.AM7}</span></span>
                  <span className="text-gray-300">|</span>
                  <span>AU8 <span className="font-semibold text-gray-700">{available.AU8}</span></span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="px-5 pt-3 pb-5">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Available Pairs */}
              <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Available Pairs</span>
                <div className="text-2xl font-bold text-gray-900 tabular-nums mt-1">{stats.pairsDone ?? 0}</div>
                <p className="text-xs text-gray-500 mt-1">min(AM7, AU8)</p>
              </div>

              {/* Today's Output */}
              <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Today Output</span>
                <div className="text-2xl font-bold text-gray-900 tabular-nums mt-1">{todayRow?.pairs || 0}</div>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                  <span>Aging <span className="font-semibold text-gray-700">{todayRow?.aging || 0}</span></span>
                  <span className="text-gray-300">|</span>
                  <span>Coating <span className="font-semibold text-gray-700">{todayRow?.coating || 0}</span></span>
                </div>
              </div>

              {/* Consumed Today */}
              <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Consumed</span>
                <div className="text-2xl font-bold text-gray-900 tabular-nums mt-1">{todayRow?.consumed || 0}</div>
                <p className="text-xs text-gray-500 mt-1">Today</p>
              </div>

              {/* NG Active */}
              <div className="rounded-xl border border-red-200 bg-red-50/50 p-4">
                <span className="text-xs font-semibold uppercase tracking-wide text-red-700">NG Active</span>
                <div className="text-2xl font-bold text-gray-900 tabular-nums mt-1">{ngCount}</div>
                <p className="text-xs text-gray-500 mt-1">Quality Issues</p>
              </div>
            </div>
          </div>
        </section>

        {/* Scanner Section */}
        <section className="rounded-xl bg-white border border-gray-100 shadow-sm p-5">
          <PCBAEnhancedScannerPanel
            scanInput={scan}
            setScanInput={setScan}
            stageToAssign={stage}
            setStageToAssign={setStage}
            handleScan={submit}
            disabled={!isEditor}
          />
        </section>
      </main>

      {/* 詳情 Modal（仍保留在本檔） */}
      {pick && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-3xl lg:max-w-4xl xl:max-w-5xl w-full max-h-[90vh] overflow-hidden">
            <div className={`p-6 text-white ${pick.ngFlag ? "bg-red-600" : "bg-teal-600"}`}>
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-2xl font-bold mb-2 break-all">{pick.serialNumber}</h3>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="px-3 py-1 bg-white/20 rounded-lg text-sm font-medium backdrop-blur-sm">{pick.model}</span>
                    {pick.version === "V2" && (
                      <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-500 text-white shadow-md">
                        V2 NEW
                      </span>
                    )}
                    {pick.version === "V1" && (
                      <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-white/30 text-white backdrop-blur-sm">
                        V1
                      </span>
                    )}
                    {pick.slipNumber && <span className="px-3 py-1 bg-white/20 rounded-lg text-sm font-medium backdrop-blur-sm break-all">{pick.slipNumber}</span>}
                    {pick.ngFlag && <span className="px-3 py-1 bg-white/25 rounded-lg text-sm font-semibold text-white">NG</span>}
                  </div>
                </div>
                <button onClick={() => setPick(null)} className="p-2 hover:bg-white/20 rounded-lg transition-colors"><X size={24} /></button>
              </div>
            </div>
            <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
              <div className="bg-gray-50 rounded-xl p-4">
                <h4 className="text-sm font-semibold text-gray-600 mb-3">Current Status</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div><p className="text-xs text-gray-500 mb-1">Stage</p><p className="font-semibold text-gray-900">{labelOf(pick.stage)}</p></div>
                  <div><p className="text-xs text-gray-500 mb-1">Duration</p><p className="font-semibold text-gray-900">{fmtElapsed(pick.startTime, pick.lastUpdate, pick.stage)}</p></div>
                  <div><p className="text-xs text-gray-500 mb-1">Operator</p><p className="font-semibold text-gray-900">{pick.operator || "System"}</p></div>
                  <div><p className="text-xs text-gray-500 mb-1">Start Time (CA)</p><p className="font-semibold text-gray-900">{toCaliTime(pick.startTime)}</p></div>
                  <div><p className="text-xs text-gray-500 mb-1">Last Update (CA)</p><p className="font-semibold text-gray-900">{toCaliTime(pick.lastUpdate)}</p></div>
                  <div><p className="text-xs text-gray-500 mb-1">Serial (PK)</p><p className="font-semibold text-gray-900 break-all">{pick.serialNumber}</p></div>
                  {pick.slipNumber && <div><p className="text-xs text-gray-500 mb-1">Slip Number</p><p className="font-semibold text-gray-900 break-all">{pick.slipNumber}</p></div>}
                  {pick.ngReason && <div className="md:col-span-3"><p className="text-xs text-gray-500 mb-1">NG Reason</p><p className="font-semibold text-gray-900 break-words">{pick.ngReason}</p></div>}
                </div>
              </div>

              {/* inline change slip */}
              <div className="p-4 border border-gray-200 rounded-xl">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 text-gray-700">
                    <Tag size={16} className="text-teal-600" />
                    <span className="font-semibold">Change Slip</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      value={newSlip}
                      onChange={(e)=> setNewSlip(e.target.value)}
                      placeholder="New slip…"
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-black placeholder-gray-400"
                    />
                    <button
                      onClick={()=> changeSlip(pick.serialNumber, newSlip || "")}
                      className="px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm flex items-center gap-1"
                    >
                      Save <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-gray-600 mb-3">Production History</h4>
                <div className="space-y-3">
                  {(Array.isArray(pick.history) ? pick.history : []).map((h, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg ${h.notes?.toLowerCase().startsWith("ng ") ? "bg-red-600" : "bg-teal-600"} mt-1`}>
                        {h.notes?.toLowerCase().startsWith("ng ") ? <AlertCircle className="text-white" size={16} /> : <Activity className="text-white" size={16} />}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{h.notes?.toLowerCase().startsWith("ng ") ? "NG" : labelOf(h.stage || "")}</p>
                        <p className="text-xs text-gray-500 mt-1">{toCaliTime(h.timestamp)} • Processed by {h.operator}</p>
                        {h.notes && <p className="text-xs text-gray-400 mt-1 italic break-words">{h.notes}</p>}
                      </div>
                    </div>
                  ))}
                  {(!Array.isArray(pick.history) || pick.history.length === 0) && (
                    <p className="text-sm text-gray-400">Loading history…</p>
                  )}
                </div>
              </div>
            </div>
            <div className="border-t border-gray-200 p-6 bg-gray-50">
              <div className="flex justify-between items-center flex-wrap gap-3">
                <div className="text-xs text-gray-400">Serial: {pick.serialNumber}</div>
                <div className="flex gap-3">
                  <button
                    onClick={() => toggleNG(pick, !pick.ngFlag)}
                    className={`px-4 py-2 rounded-lg transition-colors font-medium ${
                      pick.ngFlag ? "bg-red-50 text-red-600 hover:bg-red-100"
                                  : "bg-amber-50 text-amber-700 hover:bg-amber-100"
                    }`}
                  >
                    {pick.ngFlag ? "Clear NG" : "Mark NG"}
                  </button>
                  {isEditor && (
                    <button onClick={() => handleDelete(pick)} className="px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors font-medium">
                      Delete Board
                    </button>
                  )}
                  <button onClick={() => setPick(null)} className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors font-medium">Close</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {editBoard && <PCBAAdminEditModal board={editBoard} onClose={() => setEditBoard(null)} onSave={handleAdminEdit} />}

      {/* Active Boards Modal */}
      {showActiveBoardsModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowActiveBoardsModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gray-50">
              <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                <Database size={22} />
                Active Boards
                <span className="px-3 py-1 bg-teal-50 text-teal-700 rounded-lg text-sm font-bold border border-teal-200">
                  {list.length !== data.length ? (
                    <>
                      <span className="text-teal-900">{list.length.toLocaleString()}</span>
                      <span className="text-teal-400 mx-1">/</span>
                      <span className="text-teal-600">{data.length.toLocaleString()}</span>
                    </>
                  ) : (
                    list.length.toLocaleString()
                  )} items
                </span>
              </h3>
              <button onClick={() => setShowActiveBoardsModal(false)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search and Filters */}
            <div className="p-6 border-b border-gray-200 bg-white space-y-3">
              {/* Active filters indicator */}
              {(q || filterDate || filterSlip || fStage !== "all" || modelFilter !== "all" || ngFilter !== "all") && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-gray-600">Active Filters:</span>
                  {q && <span className="px-2 py-1 bg-teal-100 text-teal-700 rounded-md text-xs font-medium">Search: {q}</span>}
                  {filterDate && <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded-md text-xs font-medium">Date: {filterDate}</span>}
                  {filterSlip && <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-md text-xs font-medium">Slip: {filterSlip}</span>}
                  {modelFilter !== "all" && <span className="px-2 py-1 bg-cyan-100 text-cyan-700 rounded-md text-xs font-medium">Model: {modelFilter}</span>}
                  {fStage !== "all" && <span className="px-2 py-1 bg-green-100 text-green-700 rounded-md text-xs font-medium">Stage: {labelOf(fStage)}</span>}
                  {ngFilter !== "all" && <span className="px-2 py-1 bg-red-100 text-red-700 rounded-md text-xs font-medium">Status: {ngFilter === "ng" ? "NG Only" : "OK Only"}</span>}
                  <button
                    onClick={() => {
                      setQ("");
                      setFilterDate("");
                      setFilterSlip("");
                      setFStage("all");
                      setModelFilter("all");
                      setNgFilter("all");
                    }}
                    className="ml-auto px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-xs font-semibold transition-colors flex items-center gap-1"
                  >
                    <X size={14} />
                    Clear All
                  </button>
                </div>
              )}

              {/* Filter inputs */}
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-12 sm:col-span-6 lg:col-span-4 min-w-0">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-teal-400" size={18} />
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Search serial or batch..."
                      className="w-full pl-10 pr-4 py-2.5 bg-white border-2 border-gray-300 rounded-xl text-sm
                                 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500
                                 text-black placeholder-gray-400 transition-all duration-200 hover:border-teal-300"
                    />
                  </div>
                </div>

                <div className="col-span-6 sm:col-span-3 lg:col-span-2 min-w-0">
                  <select
                    value={modelFilter}
                    onChange={(e) => setModelFilter(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white border-2 border-gray-300 rounded-xl text-sm
                               focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500
                               text-black transition-all duration-200 hover:border-teal-300"
                  >
                    <option value="all">All Models</option>
                    <option value="AM7">AM7</option>
                    <option value="AU8">AU8</option>
                  </select>
                </div>

                <div className="col-span-6 sm:col-span-3 lg:col-span-2 min-w-0">
                  <select
                    value={fStage}
                    onChange={(e) => setFStage(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white border-2 border-gray-300 rounded-xl text-sm
                               focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500
                               text-black transition-all duration-200 hover:border-teal-300"
                  >
                    <option value="all">All Stages</option>
                    <option value="aging">Aging</option>
                    <option value="coating">Coating</option>
                    <option value="completed">Inventory</option>
                  </select>
                </div>

                <div className="col-span-6 sm:col-span-3 lg:col-span-2 min-w-0">
                  <select
                    value={ngFilter}
                    onChange={(e) => setNgFilter(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white border-2 border-gray-300 rounded-xl text-sm
                               focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500
                               text-black transition-all duration-200 hover:border-teal-300"
                  >
                    <option value="all">All Status</option>
                    <option value="ok">OK Only</option>
                    <option value="ng">NG Only</option>
                  </select>
                </div>

                <div className="col-span-6 sm:col-span-3 lg:col-span-2 min-w-0">
                  <input
                    type="date"
                    value={filterDate}
                    onChange={(e) => setFilterDate(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white border-2 border-gray-300 rounded-xl text-sm
                               focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500
                               text-black transition-all duration-200 hover:border-teal-300"
                    title="Update Date"
                  />
                </div>
              </div>
            </div>

            {/* Board List */}
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-380px)] space-y-3">
              {loadingList && (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-lg h-8 w-8 border-2 border-teal-600 border-t-transparent"></div>
                </div>
              )}
              {!loadingList && list.length > 0 ? (
                <VirtualList
                  rowComponent={ActiveBoardRow}
                  rowCount={list.length}
                  rowHeight={152}
                  overscanCount={6}
                  rowProps={{
                    boards: list,
                    blinkSet: blink,
                    isEditor,
                    onViewDetails: (board) => {
                      setPick(board);
                      setShowActiveBoardsModal(false);
                    },
                    onEditBoard: (board) => setEditBoard(board),
                    onDeleteBoard: handleDelete,
                    onToggleNGBoard: toggleNG,
                  }}
                  style={{ height: Math.min(Math.max(list.length * 152, 152), 520) }}
                />
              ) : !loadingList ? (
                <p className="text-center text-gray-500 py-12">No active boards found</p>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* NG Alerts Modal */}
      {showNGModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowNGModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gray-50">
              <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                <AlertCircle size={22} className="text-red-600" />
                Quality Alerts (NG) ({ngCount})
              </h3>
              <button onClick={() => setShowNGModal(false)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
              <PCBANGListPanel
                data={ngActive}
                onView={(serial) => {
                  const board = ngActive.find(b => b.serialNumber === serial);
                  if (board) { setPick(board); setShowNGModal(false); }
                }}
                onClear={(board) => toggleNG(board, false)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Daily Output Modal */}
      {showDailyOutputModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowDailyOutputModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-5xl w-full max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gray-50">
              <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                <BarChart3 size={22} />
                Daily Output (Pairs)
              </h3>
              <button onClick={() => setShowDailyOutputModal(false)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Time Range:</span>
                  <div className="flex items-center bg-gray-100 rounded-lg p-1">
                    {[{k:7,label:"7d"},{k:30,label:"30d"},{k:90,label:"90d"}].map(opt => (
                      <button
                        key={opt.k}
                        onClick={() => { setRangeDays(opt.k); setCustomFrom(""); setCustomTo(""); fetchDashboardDaily(opt.k); }}
                        className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${rangeDays === opt.k && !customFrom ? "bg-white shadow-sm text-gray-900" : "text-gray-600 hover:text-gray-900"}`}
                      >{opt.label}</button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Avg:</span>
                  <span className="px-3 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-sm font-semibold">{dailyAvg.toFixed(1)}</span>
                </div>
              </div>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyRows} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="dateShort" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(v, n) => [v, n === "pairs" ? "Pairs" : n.toUpperCase()]} />
                    <Bar dataKey="pairs" name="Pairs" fill="#0d9488" radius={[6,6,0,0]} maxBarSize={50}>
                      <LabelList dataKey="pairs" position="top" formatter={(v)=> (v||0)} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Daily Consumption Modal */}
      {showConsumptionModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowConsumptionModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-5xl w-full max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gray-50">
              <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                <Package size={22} />
                Daily Consumption (Boards Used by Assembly)
              </h3>
              <button onClick={() => setShowConsumptionModal(false)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  Last 7 days consumption data
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Avg:</span>
                  <span className="px-3 py-1 rounded-lg bg-red-50 text-red-700 text-sm font-semibold">{consumptionAvg.toFixed(1)}</span>
                </div>
              </div>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyConsumption} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="dateShort" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(v, n) => [v, n === "consumed" ? "Boards" : n === "consumedPairs" ? "Pairs" : n]} />
                    <Bar dataKey="consumed" name="Boards" fill="#ef4444" radius={[6,6,0,0]} maxBarSize={50}>
                      <LabelList dataKey="consumed" position="top" formatter={(v)=> (v||0)} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                <p className="text-sm text-gray-700">
                  <strong>Note:</strong> This tracks boards removed from WIP inventory when scanned by assembly.
                  Each scan reduces the "WIP: Inventory" count in real-time.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Packing Slip Modal */}
      <PCBASlipModal open={slipOpen} onClose={() => setSlipOpen(false)}>
        <div className="grid grid-cols-1 gap-6">
          <PCBAPackingSlipPanel
            slip={slip}
            setSlip={setSlip}
            useSlipFilter={useSlipFilter}
            setUseSlipFilter={setUseSlipFilter}
            onSave={saveSlip}
            status={slipStatus}
            saving={savingSlip}
            onApplySlipFilter={applySlip}
            appliedValue={slipFilterApplied}
            disabled={!isEditor}
          />
          <PCBASlipLibrary
            items={slipList}
            loading={loadingSlipList}
            onRefresh={fetchSlipList}
            onEditTarget={editSlipTarget}
            onDelete={deleteSlip}
            onApplyFilter={(sn) => { applySlip(sn); setSlip((p) => ({ ...p, slipNumber: sn })); }}
            disabled={!isEditor}
          />
        </div>
      </PCBASlipModal>

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 space-y-2 z-50">
        {log.map((n) => (
          <div key={n.id} className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg backdrop-blur-sm animate-slide-in ${
              n.level === "error" ? "bg-red-500 text-white" :
              n.level === "warning" ? "bg-amber-500 text-white" :
              n.level === "success" ? "bg-green-500 text-white" : "bg-gray-800 text-white"}`}>
            {n.level === "error" ? <AlertCircle size={20} /> : <Bell size={20} />}
            <span className="font-medium">{n.msg}</span>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes slide-in { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        .animate-slide-in { animation: slide-in 0.3s ease-out; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
        .animate-pulse { animation: pulse 2s cubic-bezier(0.4,0,0.6,1) infinite; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 10px; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
      `}</style>
    </div>
  );
}
