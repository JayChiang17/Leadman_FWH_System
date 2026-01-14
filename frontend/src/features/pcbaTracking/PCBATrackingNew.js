// src/features/pcbaTracking/PCBATrackingNew.js - Clean Professional Design
import React, { useEffect, useState, useMemo, useCallback, useContext, useRef } from "react";
import {
  Wifi, WifiOff, Download, Search, Database, Activity,
  Filter, Calendar, BarChart3, Clock, CheckCircle, Package, AlertCircle, X,
  Tag, ArrowRight, TrendingUp, Layers, Eye, FileText, AlertTriangle
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList
} from "recharts";

import usePCBAWebSocket from "../../utils/usePCBAWebSocket";
import { AuthCtx } from "../../auth/AuthContext";

// Components
import PCBAEnhancedScannerPanel from "./components/PCBAEnhancedScannerPanel";
import PCBAModernBoardCard from "./components/PCBAModernBoardCard";
import PCBAAdminEditModal from "./components/PCBAAdminEditModal";
import PCBASlipModal from "./components/PCBASlipModal";

// Utils
import { labelOf } from "./PCBAConstants";
import {
  decodeJWT, getToken, useDebounced, inferModel,
  fmtElapsed, toCaliTime, toCAISODate, shortMMDD, authFetch
} from "./PCBAUtils";

export default function PCBATrackingNew() {
  const PAGE_SIZE = 50;

  // State
  const [data, setData] = useState([]);
  const [stats, setStats] = useState({ total: 0, aging: 0, coating: 0, completed: 0, efficiency: 0, byModel: {} });
  const [loadingList, setLoadingList] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // Modals
  const [showActiveBoardsModal, setShowActiveBoardsModal] = useState(false);
  const [showNGAlertsModal, setShowNGAlertsModal] = useState(false);
  const [showDailyOutputModal, setShowDailyOutputModal] = useState(false);
  const [showConsumptionModal, setShowConsumptionModal] = useState(false);

  // Slip
  const [slipOpen, setSlipOpen] = useState(false);
  const [slip, setSlip] = useState(() => {
    try { return JSON.parse(localStorage.getItem("pcba_slip") || "null") || { slipNumber: "", targetPairs: 0 }; }
    catch { return { slipNumber: "", targetPairs: 0 }; }
  });
  const [useSlipFilter, setUseSlipFilter] = useState(() => localStorage.getItem("pcba_slip_filter") === "1");
  const [slipFilterApplied, setSlipFilterApplied] = useState(() => localStorage.getItem("pcba_slip_filter_value") || "");
  const [savingSlip, setSavingSlip] = useState(false);
  const [slipStatus, setSlipStatus] = useState(null);

  // Scanner
  const [scan, setScan] = useState("");
  const [stage, setStage] = useState("aging");

  // Detail & Edit
  const [pick, setPick] = useState(null);
  const [editBoard, setEditBoard] = useState(null);
  const [newSlip, setNewSlip] = useState("");
  useEffect(() => { setNewSlip(pick?.slipNumber || ""); }, [pick]);

  // Filters
  const [fStage, setFStage] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [ngFilter, setNgFilter] = useState("all");
  const [q, setQ] = useState("");
  const [filterSlip, setFilterSlip] = useState("");
  const [filterDate, setFilterDate] = useState("");

  const debouncedQ = useDebounced(q, 350);
  const debouncedSlip = useDebounced(filterSlip, 350);

  // Toast & Blink
  const [log, setLog] = useState([]);
  const [blink, setBlink] = useState(new Set());
  const toastTimersRef = useRef(new Set());
  const blinkTimersRef = useRef(new Map());

  // Daily Stats
  const [rangeDays, setRangeDays] = useState(7);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [dailyRows, setDailyRows] = useState([]);
  const [dailyAvg, setDailyAvg] = useState(0);
  const [dailyConsumption, setDailyConsumption] = useState([]);
  const [consumptionAvg, setConsumptionAvg] = useState(0);
  const [todayRow, setTodayRow] = useState(null);

  // NG Data
  const [ngList, setNgList] = useState([]);

  // WebSocket
  const { connected, statistics: wsStats, lastUpdate } = usePCBAWebSocket(getToken());
  const { user } = useContext(AuthCtx) || {};
  const isAdmin = user?.role === "admin";
  const isEditor = isAdmin || user?.role === "operator";

  // Toast helper
  const toast = useCallback((msg, level = "info") => {
    if (!msg) return;
    const id = Date.now() + Math.random();
    setLog((l) => [...l, { id, msg, level }]);
    const timer = setTimeout(() => {
      setLog((l) => l.filter((x) => x.id !== id));
      toastTimersRef.current.delete(timer);
    }, 3200);
    toastTimersRef.current.add(timer);
  }, []);

  // Cleanup timers
  useEffect(() => {
    return () => {
      toastTimersRef.current.forEach(timer => clearTimeout(timer));
      toastTimersRef.current.clear();
      blinkTimersRef.current.forEach((timer) => clearTimeout(timer));
      blinkTimersRef.current.clear();
    };
  }, []);

  // Update stats from WebSocket
  useEffect(() => {
    if (wsStats) setStats(wsStats);
  }, [wsStats]);

  // Fetch functions
  const fetchList = useCallback(async () => {
    try {
      setLoadingList(true);
      const params = new URLSearchParams();
      if (fStage !== "all") params.set("stage", fStage);
      if (modelFilter !== "all") params.set("model", modelFilter);
      if (debouncedQ) params.set("search", debouncedQ);
      if (debouncedSlip) params.set("slip", debouncedSlip);
      params.set("limit", "100000");
      params.set("offset", "0");

      const resp = await authFetch(`/api/pcba/boards?${params.toString()}`);
      const json = await resp.json();
      setData(Array.isArray(json) ? json : []);
    } catch (err) {
      console.error("fetchList error:", err);
      toast("Failed to load boards", "error");
    } finally {
      setLoadingList(false);
    }
  }, [fStage, modelFilter, debouncedQ, debouncedSlip, toast]);

  const fetchStats = useCallback(async () => {
    try {
      const resp = await authFetch("/api/pcba/statistics");
      const json = await resp.json();
      setStats(json);
    } catch (err) {
      console.error("fetchStats error:", err);
    }
  }, []);

  const fetchDailyStats = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (customFrom) params.set("start", customFrom);
      if (customTo) params.set("end", customTo);
      if (!customFrom && !customTo) params.set("days", String(rangeDays));

      const resp = await authFetch(`/api/pcba/statistics/daily?${params.toString()}`);
      const json = await resp.json();
      setDailyRows(json.rows || []);
      setDailyAvg(json.avg_pairs || 0);
    } catch (err) {
      console.error("fetchDailyStats error:", err);
    }
  }, [rangeDays, customFrom, customTo]);

  const fetchConsumptionStats = useCallback(async () => {
    try {
      const params = new URLSearchParams({ days: String(rangeDays) });
      const resp = await authFetch(`/api/pcba/statistics/consumption?${params.toString()}`);
      const json = await resp.json();
      setDailyConsumption(json.rows || []);
      setConsumptionAvg(json.avg_consumed || 0);
    } catch (err) {
      console.error("fetchConsumptionStats error:", err);
    }
  }, [rangeDays]);

  const fetchTodayStats = useCallback(async () => {
    try {
      const resp = await authFetch("/api/pcba/statistics/today");
      const json = await resp.json();
      setTodayRow(json);
    } catch (err) {
      console.error("fetchTodayStats error:", err);
    }
  }, []);

  const fetchNGList = useCallback(async () => {
    try {
      const resp = await authFetch("/api/pcba/ng/active");
      const json = await resp.json();
      setNgList(Array.isArray(json) ? json : []);
    } catch (err) {
      console.error("fetchNGList error:", err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchList();
    fetchStats();
    fetchDailyStats();
    fetchConsumptionStats();
    fetchTodayStats();
    fetchNGList();
  }, [fetchList, fetchStats, fetchDailyStats, fetchConsumptionStats, fetchTodayStats, fetchNGList]);

  // Filter list
  const list = useMemo(() => {
    let arr = [...data];
    if (ngFilter === "ng") arr = arr.filter(b => b.ngFlag);
    if (ngFilter === "ok") arr = arr.filter(b => !b.ngFlag);
    if (filterDate) {
      arr = arr.filter(b => {
        const d = toCAISODate(b.startTime);
        return d === filterDate;
      });
    }
    return arr;
  }, [data, ngFilter, filterDate]);

  // Dashboard metrics
  const totalWIP = stats.total || 0;
  const agingCount = stats.aging || 0;
  const coatingCount = stats.coating || 0;
  const completedCount = stats.completed || 0;
  const ngCount = ngList.length;
  const todayPairs = todayRow?.pairs || 0;
  const todayConsumed = todayRow?.consumed || 0;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <Database className="w-8 h-8 text-gray-700" />
              <h1 className="text-xl font-semibold text-gray-900">PCBA Production Tracking</h1>
            </div>
            <div className="flex items-center gap-3">
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
                connected ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-gray-100 text-gray-600 border border-gray-300"
              }`}>
                {connected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                {connected ? "Connected" : "Disconnected"}
              </div>
              {lastUpdate && (
                <span className="text-xs text-gray-500">
                  Last update: {new Date(lastUpdate).toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        {/* Hero Section - Dashboard Overview */}
        <section className="rounded-3xl border border-gray-200 bg-white shadow-sm p-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-600">Production Control Center</p>
              <h2 className="text-3xl font-bold text-gray-900">PCBA Work in Process</h2>
              <p className="text-gray-600 max-w-2xl">
                Real-time tracking of boards through aging, coating, and completion stages. Monitor quality, output, and consumption metrics.
              </p>
              <div className="flex flex-wrap gap-3 mt-4">
                <button
                  onClick={() => {
                    fetchList();
                    setShowActiveBoardsModal(true);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-gray-300 bg-white text-gray-800 font-medium hover:bg-gray-50 transition-colors"
                >
                  <Eye className="w-4 h-4" />
                  View Active Boards
                </button>
                <button
                  onClick={() => {
                    fetchNGList();
                    setShowNGAlertsModal(true);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-gray-300 bg-white text-gray-800 font-medium hover:bg-gray-50 transition-colors"
                >
                  <AlertTriangle className="w-4 h-4" />
                  Quality Alerts
                </button>
                <button
                  onClick={() => {
                    fetchDailyStats();
                    setShowDailyOutputModal(true);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-gray-300 bg-white text-gray-800 font-medium hover:bg-gray-50 transition-colors"
                >
                  <BarChart3 className="w-4 h-4" />
                  Daily Output
                </button>
                <button
                  onClick={() => {
                    fetchConsumptionStats();
                    setShowConsumptionModal(true);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-gray-300 bg-white text-gray-800 font-medium hover:bg-gray-50 transition-colors"
                >
                  <Package className="w-4 h-4" />
                  Consumption Data
                </button>
              </div>
            </div>

            {/* Quick Metrics Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 w-full lg:w-auto">
              <div className="rounded-2xl bg-white border border-amber-200 p-4 shadow-sm">
                <p className="text-xs font-semibold text-amber-700 mb-1">Aging</p>
                <div className="flex items-end gap-2">
                  <span className="text-3xl font-bold text-gray-900">{agingCount}</span>
                  <Clock className="w-5 h-5 text-amber-600" />
                </div>
              </div>
              <div className="rounded-2xl bg-white border border-sky-200 p-4 shadow-sm">
                <p className="text-xs font-semibold text-sky-700 mb-1">Coating</p>
                <div className="flex items-end gap-2">
                  <span className="text-3xl font-bold text-gray-900">{coatingCount}</span>
                  <Layers className="w-5 h-5 text-sky-600" />
                </div>
              </div>
              <div className="rounded-2xl bg-white border border-emerald-200 p-4 shadow-sm">
                <p className="text-xs font-semibold text-emerald-700 mb-1">Inventory</p>
                <div className="flex items-end gap-2">
                  <span className="text-3xl font-bold text-gray-900">{completedCount}</span>
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                </div>
              </div>
              <div className="rounded-2xl bg-white border border-red-200 p-4 shadow-sm">
                <p className="text-xs font-semibold text-red-700 mb-1">NG Alerts</p>
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-red-600" />
                  <span className="text-2xl font-semibold text-gray-900">{ngCount}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Scanner Section */}
        <section className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6">
          <PCBAEnhancedScannerPanel
            scan={scan}
            setScan={setScan}
            stage={stage}
            setStage={setStage}
            onScanSubmit={async (sn, st) => {
              // Handle scan logic here
              toast(`Scanned ${sn} for ${labelOf(st)}`, "success");
              await fetchList();
              await fetchStats();
            }}
            disabled={!isEditor}
          />
        </section>

        {/* Today's Activity */}
        <section className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-gray-700" />
              <h3 className="text-lg font-semibold text-gray-900">Today's Activity</h3>
            </div>
            <span className="text-xs text-gray-500">{new Date().toLocaleDateString()}</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4">
              <p className="text-sm font-semibold text-emerald-700 mb-2">Output Pairs</p>
              <p className="text-3xl font-bold text-gray-900">{todayPairs}</p>
              <p className="text-xs text-gray-600 mt-1">Matched AM7 + AU8</p>
            </div>
            <div className="rounded-xl bg-rose-50 border border-rose-100 p-4">
              <p className="text-sm font-semibold text-rose-700 mb-2">Consumed</p>
              <p className="text-3xl font-bold text-gray-900">{todayConsumed}</p>
              <p className="text-xs text-gray-600 mt-1">Used by assembly</p>
            </div>
            <div className="rounded-xl bg-gray-50 border border-gray-100 p-4">
              <p className="text-sm font-semibold text-gray-700 mb-2">Total WIP</p>
              <p className="text-3xl font-bold text-gray-900">{totalWIP}</p>
              <p className="text-xs text-gray-600 mt-1">In production</p>
            </div>
          </div>
        </section>
      </main>

      {/* Toast Messages */}
      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {log.map((item) => (
          <div
            key={item.id}
            className={`px-4 py-3 rounded-lg shadow-lg border flex items-center gap-2 animate-in slide-in-from-bottom-5 ${
              item.level === "success"
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : item.level === "error"
                ? "bg-red-50 text-red-800 border-red-200"
                : "bg-sky-50 text-sky-800 border-sky-200"
            }`}
          >
            {item.level === "success" ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            <span className="text-sm font-medium">{item.msg}</span>
          </div>
        ))}
      </div>

      {/* Modals - To be implemented */}
      {showActiveBoardsModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h3 className="text-xl font-semibold text-gray-900">Active Boards ({list.length})</h3>
              <button onClick={() => setShowActiveBoardsModal(false)} className="p-2 hover:bg-gray-100 rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
              <p className="text-gray-600">Active boards list will be displayed here...</p>
              {/* TODO: Implement active boards list */}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
