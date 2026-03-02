import React, {
  useState, useRef, useEffect, useCallback, useMemo,
} from "react";
import {
  Package, AlertCircle, Download, X,
  CheckCircle, XCircle, RefreshCw, Search,
  Edit3, Save, Filter, Play, Clock, Timer
} from "lucide-react";

import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, Tooltip,
} from "chart.js";
import api from "../../services/api";
import useWs from "../../utils/wsConnect";
import ErrorModal from "../../components/ErrorModal";
import "./AssemblyProduction.css";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

// Tab Component - Memoized for performance (Unified control-group pattern)
const TabButton = React.memo(({ active, onClick, icon: Icon, label, badge }) => (
  <button
    onClick={onClick}
    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3
               font-medium text-sm rounded-md transition-colors duration-150
               ${active
                 ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                 : 'text-slate-500 hover:text-slate-700'
               }`}
  >
    <Icon className="w-4 h-4" />
    <span>{label}</span>
    {badge !== undefined && badge > 0 && (
      <span className={`px-2 py-0.5 text-xs font-bold rounded
                       ${active ? 'bg-teal-100 text-teal-700' : 'bg-slate-200 text-slate-600'}`}>
        {badge}
      </span>
    )}
  </button>
));

// Format seconds to readable time
const formatDuration = (seconds) => {
  if (!seconds || seconds < 0) return '--';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
};


// Constants
const MIN_SCAN_LEN = 6;
const SCAN_TIME_LIMIT = 1000;
const fields = ["china_sn", "us_sn", "module_a", "module_b", "pcba_au8", "pcba_am7"];
const labels = ["China SN", "US SN", "Module A", "Module B", "PCBA AU8", "PCBA AM7"];
const boardFs = ["module_a", "module_b", "pcba_au8", "pcba_am7"];

// Helper: unwrap common API shapes to an array
const pickArray = (d) => {
  if (Array.isArray(d)) return d;
  if (Array.isArray(d?.data)) return d.data;
  if (Array.isArray(d?.rows)) return d.rows;
  return [];
};

export default function AssemblyProduction() {
  // Tab state: 'start' for first station, 'complete' for last station
  const [activeTab, setActiveTab] = useState('complete');

  // Start Timer state
  const [startTimerSn, setStartTimerSn] = useState('');
  const [startTimerBusy, setStartTimerBusy] = useState(false);
  const [startTimerMsg, setStartTimerMsg] = useState('');
  const [startTimerFlash, setStartTimerFlash] = useState('');
  const [activeTimers, setActiveTimers] = useState([]);
  const [lastProductionTime, setLastProductionTime] = useState(null);
  const startTimerInputRef = useRef(null);

  // Production time statistics
  const [prodStats, setProdStats] = useState({
    total_with_time: 0,
    avg_seconds: 0,
    min_seconds: 0,
    max_seconds: 0
  });
  const [prodTimes, setProdTimes] = useState([]);

  // Core form state
  const emptyForm = useMemo(
    () => Object.fromEntries(fields.map(k => [k, ""])),
    [],
  );

  const [form, setForm] = useState(emptyForm);
  const [curIdx, setCurIdx] = useState(0);
  const [flash, setFlash] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoSubmit, setAutoSubmit] = useState(false);
  const [scannedCount, setScannedCount] = useState(0);
  const [lastProductLine, setLastProductLine] = useState(""); // "apower2" or "apowers"

  // Stats state
  const [daily, setDaily] = useState({ count: 0, ng: 0, fixed: 0 });

  // View states
  const [showExport, setShowExport] = useState(false);
  const [showNgList, setShowNgList] = useState(false);
  const [ngRows, setNgRows] = useState([]);
  const [showNg, setShowNg] = useState(false);

  // NG workflow state
  const [ngStep, setNgStep] = useState(1);
  const [ngSn, setNgSn] = useState("");
  const [ngRec, setNgRec] = useState(null);
  const [ngReason, setNgReason] = useState("");

  // Filter states
  const [filters, setFilters] = useState({
    status: 'all',
    fromDate: new Date().toISOString().slice(0, 10),
    toDate: new Date().toISOString().slice(0, 10),
    includeFixed: true
  });

  // Batch operation states
  const [selectedRecords, setSelectedRecords] = useState(new Set());

  // Error handling
  const [errorMsg, setErrorMsg] = useState("");

  // Today for defaults
  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // ==== Export (client-side CSV) states & helpers ====
  const [exportMode, setExportMode] = useState("raw"); // 'raw' | 'hourly' | 'daily'
  const [exportRange, setExportRange] = useState({ from: todayISO, to: todayISO }); // used for all modes
  const [exportLimit, setExportLimit] = useState(5000); // limit to protect client memory

  const csvEscape = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const downloadCSV = (filename, rows, headers) => {
    const headerLine = headers.map(csvEscape).join(",");
    const lines = rows.map(r => headers.map(h => csvEscape(r[h])).join(","));
    const csv = [headerLine, ...lines].join("\n");
    // Add BOM so Excel recognizes UTF-8
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const fetchRowsInRange = async (fromDate, toDate, limit = 5000) => {
    const params = new URLSearchParams();
    if (filters.status && filters.status !== 'all') {
      params.append('status_filter', filters.status);
    }
    params.append("from_date", fromDate);
    params.append("to_date", toDate);
    params.append("limit", String(limit));
    const url = `/assembly_inventory/list/all?${params.toString()}`;
    const { data } = await api.get(url);
    return pickArray(data);
  };

  const buildDailySummary = (rows) => {
    // key = 'YYYY-MM-DD'
    const map = {};
    rows.forEach(r => {
      const d = (r.timestamp || "").slice(0, 10);
      if (!d) return;
      if (!map[d]) map[d] = { date: d, total: 0, ng_count: 0, fixed_count: 0 };
      map[d].total += 1;
      const st = (r.status || "").toUpperCase();
      if (st === "NG" || st === "FIXED") map[d].ng_count += 1;
      if (st === "FIXED") map[d].fixed_count += 1;
    });
    const arr = Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
    return arr.map(x => ({ ...x, ok_count: x.total - x.ng_count }));
  };

  // Hourly summary over a DATE RANGE (groups by Date + Hour)
  const buildHourlySummaryForRange = (rows) => {
    // key = 'YYYY-MM-DD|HH'
    const map = {};
    rows.forEach(r => {
      const ts = r.timestamp || "";
      const d = ts.slice(0, 10);
      const hh = ts.slice(11, 13);
      if (!d || !hh) return;
      const key = `${d}|${hh}`;
      if (!map[key]) map[key] = { total: 0, ng_count: 0, fixed_count: 0 };
      map[key].total += 1;
      const st = (r.status || "").toUpperCase();
      if (st === "NG" || st === "FIXED") map[key].ng_count += 1;
      if (st === "FIXED") map[key].fixed_count += 1;
    });

    const arr = Object.entries(map)
      .map(([key, v]) => {
        const [date, hour] = key.split("|");
        return {
          date,
          hour,
          total: v.total,
          ng_count: v.ng_count,
          fixed_count: v.fixed_count,
          ok_count: v.total - v.ng_count,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.hour.localeCompare(b.hour));

    return arr;
  };

  const exportClientCSV = async () => {
    try {
      if (exportMode === "raw") {
        const rows = await fetchRowsInRange(exportRange.from, exportRange.to, exportLimit);
        const headers = [
          "Timestamp", "China SN", "US SN", "Module A", "Module B", "PCBA AU8", "PCBA AM7", "Status", "NG Reason"
        ];
        const mapped = rows.map(r => ({
          "Timestamp": r.timestamp,
          "China SN": r.china_sn || "",
          "US SN": r.us_sn || "",
          "Module A": r.module_a || "",
          "Module B": r.module_b || "",
          "PCBA AU8": r.pcba_au8 || "",
          "PCBA AM7": r.pcba_am7 || "",
          "Status": r.status || "",
          "NG Reason": r.ng_reason || ""
        }));
        downloadCSV(`assembly_raw_${exportRange.from}_to_${exportRange.to}.csv`, mapped, headers);
        setMsg("CSV downloaded (all records)");
        return;
      }

      if (exportMode === "daily") {
        const rows = await fetchRowsInRange(exportRange.from, exportRange.to, exportLimit);
        const daily = buildDailySummary(rows);
        const headers = ["Date", "Total", "OK", "NG (incl Fixed)", "Fixed"];
        const mapped = daily.map(x => ({
          "Date": x.date,
          "Total": x.total,
          "OK": x.ok_count,
          "NG (incl Fixed)": x.ng_count,
          "Fixed": x.fixed_count
        }));
        downloadCSV(`assembly_daily_${exportRange.from}_to_${exportRange.to}.csv`, mapped, headers);
        setMsg("CSV downloaded (daily summary)");
        return;
      }

      if (exportMode === "hourly") {
        const rows = await fetchRowsInRange(exportRange.from, exportRange.to, exportLimit);
        const hourly = buildHourlySummaryForRange(rows);
        const headers = ["Date", "Hour", "Total", "OK", "NG (incl Fixed)", "Fixed"];
        const mapped = hourly.map(x => ({
          "Date": x.date,
          "Hour": `${x.hour}:00`,
          "Total": x.total,
          "OK": x.ok_count,
          "NG (incl Fixed)": x.ng_count,
          "Fixed": x.fixed_count
        }));
        downloadCSV(`assembly_hourly_${exportRange.from}_to_${exportRange.to}.csv`, mapped, headers);
        setMsg("CSV downloaded (hourly summary by date range)");
        return;
      }
    } catch (err) {
      console.error("Export error:", err);
      setErrorMsg(err?.response?.data?.message || err.message || "Export failed.");
    }
  };
  // ==== END Export helpers ====

  // Refs
  const inputs = useRef([]);
  const firstKeyTime = useRef({});
  const timers = useRef({});
  const ngInputRef = useRef(null);
  const submittingRef = useRef(false); 
  // API Calls
  // Fetch active timers
  const fetchActiveTimers = useCallback(async () => {
    try {
      const { data } = await api.get("assembly/active-timers");
      if (data?.status === "success") {
        setActiveTimers(data.timers || []);
      }
    } catch (error) {
      console.error("Error fetching active timers:", error);
    }
  }, []);

  // Fetch production time statistics + individual times
  const fetchProdStats = useCallback(async () => {
    try {
      const [statsRes, timesRes] = await Promise.all([
        api.get("assembly/production-stats"),
        api.get("assembly/production-times?limit=50"),
      ]);
      if (statsRes.data?.status === "success") {
        setProdStats({
          total_with_time: statsRes.data.total_with_time || 0,
          avg_seconds: statsRes.data.avg_seconds || 0,
          min_seconds: statsRes.data.min_seconds || 0,
          max_seconds: statsRes.data.max_seconds || 0
        });
      }
      if (timesRes.data?.status === "success") {
        setProdTimes(timesRes.data.items || []);
      }
    } catch (error) {
      console.error("Error fetching production stats:", error);
    }
  }, []);

  // Delete Timer function
  const handleDeleteTimer = useCallback(async (sn) => {
    if (!window.confirm(`Delete timer for "${sn}"?`)) return;
    try {
      const { data } = await api.delete(`assembly/timer/${encodeURIComponent(sn)}`);
      if (data?.status === "success") {
        setStartTimerMsg(`Deleted: ${sn}`);
        setStartTimerFlash('success');
        fetchActiveTimers();
      } else {
        setStartTimerMsg(data?.message || 'Not found');
        setStartTimerFlash('error');
      }
    } catch (e) {
      setStartTimerMsg(e.response?.data?.message || 'Failed to delete');
      setStartTimerFlash('error');
    }
    setTimeout(() => setStartTimerFlash(''), 2500);
  }, [fetchActiveTimers]);

  // Start Timer function
  const handleStartTimer = useCallback(async () => {
    if (startTimerBusy) return;
    const sn = startTimerSn.trim();
    if (!sn) {
      setStartTimerFlash('error');
      setStartTimerMsg('Please scan or enter US SN');
      setTimeout(() => setStartTimerFlash(''), 2500);
      return;
    }

    setStartTimerBusy(true);
    setStartTimerMsg('Starting timer...');

    try {
      const { data } = await api.post("assembly/start-timer", { us_sn: sn });

      if (data?.status === "success") {
        setStartTimerFlash('success');
        setStartTimerMsg(`Started: ${sn}`);
        setStartTimerSn('');
        fetchActiveTimers();
        setTimeout(() => startTimerInputRef.current?.focus(), 100);
      } else {
        setStartTimerFlash('error');
        setStartTimerMsg(data?.message || 'Failed to start timer');
      }
    } catch (e) {
      setStartTimerFlash('error');
      if (e.response?.status === 403) {
        setErrorMsg("You don't have permission to start timer");
      } else {
        setStartTimerMsg(e.response?.data?.message || e.message || 'Failed to start timer');
      }
    } finally {
      setStartTimerBusy(false);
      setTimeout(() => setStartTimerFlash(''), 2500);
    }
  }, [startTimerSn, startTimerBusy, fetchActiveTimers]);

  // FIX: make fetchDaily resilient to response shapes
  const fetchDaily = useCallback(async () => {
    try {
      const { data } = await api.get("assembly_inventory_daily_count");

      // Accept {count,ng,fixed} OR {status:'success', data:{...}}
      const payload =
        (data && typeof data === "object" && "status" in data)
          ? (data.status === "success" ? (data.data ?? data) : null)
          : data;

      if (!payload) return;

      setDaily({
        count: Number(payload.count ?? 0),
        ng: Number(payload.ng ?? 0),
        fixed: Number(payload.fixed ?? 0),
      });
    } catch (error) {
      console.error("Error fetching daily count:", error);
    }
  }, []);

  // Composite refresh function for all stats
  const refreshAllStats = useCallback(() => {
    return Promise.all([fetchDaily(), fetchActiveTimers(), fetchProdStats()]);
  }, [fetchDaily, fetchActiveTimers, fetchProdStats]);

  const fetchNgRows = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.append('include_fixed', filters.includeFixed);
      if (filters.fromDate) params.append('from_date', filters.fromDate);
      if (filters.toDate) params.append('to_date', filters.toDate);

      const url = `/assembly_inventory/list/ng?${params.toString()}`;
      const { data } = await api.get(url);
      setNgRows(pickArray(data));
    } catch (error) {
      console.error("Error fetching NG rows:", error);
    }
  }, [filters]);

  // Submit function（含防重複送出）
  const submit = useCallback(async () => {
    // 防重：若已在送出中或 busy，直接忽略
    if (submittingRef.current || busy) return;
    submittingRef.current = true;

    // Validation
    for (let i = 0; i < fields.length; i += 1) {
      if (!form[fields[i]].trim()) {
        setFlash("error");
        setMsg(`${labels[i]} cannot be empty`);
        submittingRef.current = false;
        return;
      }
    }

    try {
      setBusy(true);
      setMsg("Submitting...");

      // Use client-side local time for timestamp
      const tzOffsetMs = -new Date().getTimezoneOffset() * 60000;
      const localISO = new Date(Date.now() + tzOffsetMs)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");

      const submitData = { ...form, timestamp: localISO };

      // API
      const { data } = await api.post("assembly_inventory", submitData);

      if (!data?.status || data.status === "success") {
        setFlash("success");

        // Check if production_seconds is included
        const prodSeconds = data?.production_seconds;
        if (prodSeconds !== undefined && prodSeconds !== null) {
          setLastProductionTime(prodSeconds);
          setMsg(`Submitted! Production time: ${formatDuration(prodSeconds)}`);
        } else {
          setMsg("Submitted successfully!");
          setLastProductionTime(null);
        }

        // Detect product line from US SN
        const usSn = form.us_sn || "";
        if (usSn.startsWith("10050018") || usSn.startsWith("10050028") || usSn.startsWith("10050030")) {
          setLastProductLine("apower2");
        } else if (usSn.startsWith("10050019") || usSn.startsWith("10050022")) {
          setLastProductLine("apowers");
        } else {
          setLastProductLine("");
        }

        // Refresh stats in parallel
        await Promise.all([fetchDaily(), fetchActiveTimers()]);
        setForm(emptyForm);
        setCurIdx(0);
        setScannedCount(0);
        firstKeyTime.current = {};
        setTimeout(() => inputs.current[0]?.focus(), 60);
      } else {
        setFlash("error");
        setMsg(data.message || "Submit failed");
      }
    } catch (e) {
      setFlash("error");
      if (e.response?.status === 403) {
        setErrorMsg("You don't have permission to add records");
      } else {
        setMsg(e.response?.data?.message || e.message);
      }
    } finally {
      setBusy(false);
      submittingRef.current = false;
      setTimeout(() => setFlash(""), 2500);
    }
  }, [form, emptyForm, fetchDaily, fetchActiveTimers, busy]);


  // Auto-advance with barcode detection
  const isBarcode = (idx, val) =>
    firstKeyTime.current[idx] &&
    val.length >= MIN_SCAN_LEN &&
    Date.now() - firstKeyTime.current[idx] <= SCAN_TIME_LIMIT;

  const onChange = (e, idx) => {
    const v = e.target.value;
    if (!form[fields[idx]] && v) firstKeyTime.current[idx] = Date.now();
    setForm(p => ({ ...p, [fields[idx]]: v }));

    clearTimeout(timers.current[idx]);
    timers.current[idx] = setTimeout(() => {
      if (!v.trim()) return;
      if (isBarcode(idx, v)) {
        setScannedCount(idx + 1);

        if (idx === fields.length - 1) {
          setAutoSubmit(true);
        } else {
          setCurIdx(idx + 1);
          setTimeout(() => {
            inputs.current[idx + 1]?.focus();
          }, 50);
        }
      }
    }, 60);
  };

  useEffect(() => {
    if (autoSubmit) {
      submit();
      setAutoSubmit(false);
    }
  }, [autoSubmit, submit]);

  // WebSocket connection
  const handleWsMessage = useCallback((d) => {
    if (d.event === "assembly_updated") {
      let changed = false;
      setDaily(prev => {
        const next = {
          count: d.count ?? prev.count,
          ng: d.ng ?? prev.ng,
          fixed: d.fixed ?? prev.fixed,
        };
        changed = (d.count !== undefined) || (d.ng !== undefined) || (d.fixed !== undefined);
        return next;
      });
      if (!changed) {
        fetchDaily();
      }
      if (d.production_seconds !== undefined) {
        setLastProductionTime(d.production_seconds);
      }
      fetchActiveTimers();
    }
    if (d.event === "timer_started") {
      fetchActiveTimers();
    }
  }, [fetchDaily, fetchActiveTimers]);
  useWs("/realtime/dashboard", handleWsMessage);

  useEffect(() => {
    refreshAllStats();
  }, [refreshAllStats]);

  // Auto-focus start timer input when tab is active
  useEffect(() => {
    if (activeTab === 'start') {
      setTimeout(() => startTimerInputRef.current?.focus(), 150);
    }
  }, [activeTab]);

  // NG workflow helpers
  const fetchNgRecord = async (sn) => {
    if (!sn) return;
    try {
      const { data } = await api.get(`/assembly_inventory/${sn}`);
      const rec = (data && typeof data === "object" && "status" in data)
        ? (data.data ?? data)
        : data;
      setNgRec(rec);
      setNgSn(rec?.us_sn || sn); // ensure we have a usable US SN
      setNgStep(2);
    } catch (e) {
      if (e.response?.status === 403) {
        setErrorMsg("You don't have permission to view records");
      } else {
        setErrorMsg(e.response?.data?.message || "Record not found");
      }
    }
  };

  const getTargetSn = () => (ngRec?.us_sn || ngSn || "").trim();

  const markNg = async () => {
    if (!ngReason.trim()) {
      setErrorMsg("Please enter NG reason");
      return;
    }
    const us_sn = getTargetSn();
    if (!us_sn) {
      setErrorMsg("No US SN loaded");
      return;
    }
    try {
      const { data } = await api.post("assembly_inventory/mark_ng", {
        us_sn,
        reason: ngReason.trim(),
      });
      if (data?.status && data.status !== "success") {
        throw new Error(data?.message || "mark_ng failed");
      }
      setMsg("NG marked: " + (data?.message || "Operation completed"));
      setShowNg(false);
      setNgReason("");
      await Promise.all([fetchNgRows(), fetchDaily()]);
    } catch (e) {
      if (e.response?.status === 403) {
        setErrorMsg(e.response.data.message || "You don't have permission to perform this action");
      } else {
        setErrorMsg(e.response?.data?.message || e.message || "Failed to mark as NG");
      }
    }
  };

  const clearNg = async () => {
    const us_sn = getTargetSn();
    if (!us_sn) {
      setErrorMsg("No US SN loaded");
      return;
    }
    try {
      const { data } = await api.post("assembly_inventory/clear_ng", { us_sn });
      if (data?.status && data.status !== "success") {
        throw new Error(data?.message || "clear_ng failed");
      }
      setMsg("NG cleared: " + (data?.message || "Operation completed"));
      setShowNg(false);
      setNgReason("");
      await Promise.all([fetchNgRows(), fetchDaily()]);
    } catch (e) {
      if (e.response?.status === 403) {
        setErrorMsg(e.response.data.message || "You don't have permission to perform this action");
      } else {
        setErrorMsg(e.response?.data?.message || e.message || "Failed to clear NG");
      }
    }
  };

  const updateBoards = async () => {
    const us_sn = getTargetSn();
    if (!us_sn) {
      setErrorMsg("No US SN loaded");
      return;
    }
    try {
      const body = {};
      boardFs.forEach(f => { body[f] = ngRec?.[f] ?? ""; });
      const { data } = await api.put(`/assembly_inventory/${us_sn}`, body);
      if (data?.status && data.status !== "success") {
        throw new Error(data?.message || "update failed");
      }
      setMsg("Record updated successfully");
      setShowNg(false);
      setNgReason("");
      await Promise.all([fetchNgRows(), fetchDaily()]);
    } catch (e) {
      if (e.response?.status === 403) {
        setErrorMsg(e.response.data.message || "You don't have permission to perform this action");
      } else {
        setErrorMsg(e.response?.data?.message || e.message || "Update failed");
      }
    }
  };

  // Batch operations
  const batchMarkNg = async () => {
    if (selectedRecords.size === 0) {
      setErrorMsg("Please select records to mark as NG");
      return;
    }

    const reason = window.prompt("Enter NG reason:");
    if (!reason || !reason.trim()) return;

    try {
      const { data } = await api.post("assembly_inventory/batch_mark_ng", {
        us_sns: Array.from(selectedRecords),
        reason: reason.trim()
      });

      if (data?.status && data.status !== "success") {
        throw new Error(data?.message || "batch mark NG failed");
      }

      setMsg(`Batch operation completed: ${data.message || "OK"}`);
      setSelectedRecords(new Set());
      await Promise.all([fetchNgRows(), fetchDaily()]);
    } catch (e) {
      setErrorMsg(e.response?.data?.message || e.message || "Batch operation failed");
    }
  };

  const batchClearNg = async () => {
    if (selectedRecords.size === 0) {
      setErrorMsg("Please select records to clear NG");
      return;
    }

    if (!window.confirm(`Clear NG status for ${selectedRecords.size} records?`)) return;

    try {
      const { data } = await api.post("assembly_inventory/batch_clear_ng", {
        us_sns: Array.from(selectedRecords)
      });

      if (data?.status && data.status !== "success") {
        throw new Error(data?.message || "batch clear NG failed");
      }

      setMsg(`Batch operation completed: ${data.message || "OK"}`);
      setSelectedRecords(new Set());
      await Promise.all([fetchNgRows(), fetchDaily()]);
    } catch (e) {
      setErrorMsg(e.response?.data?.message || e.message || "Batch operation failed");
    }
  };

  const FilterPanel = ({ onApply, onReset }) => (
    <div className="bg-slate-100 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Filter className="w-4 h-4 text-slate-500" />
        <span className="font-medium text-slate-700 text-sm">Filters</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Status</label>
          <select
            value={filters.status}
            onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-slate-700"
          >
            <option value="all">All Status</option>
            <option value="ok">OK</option>
            <option value="NG">NG</option>
            <option value="Fixed">Fixed</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">From Date</label>
          <input
            type="date"
            value={filters.fromDate}
            onChange={(e) => setFilters(prev => ({ ...prev, fromDate: e.target.value }))}
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">To Date</label>
          <input
            type="date"
            value={filters.toDate}
            onChange={(e) => setFilters(prev => ({ ...prev, toDate: e.target.value }))}
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          />
        </div>

        <div className="flex items-end gap-2">
          <button
            onClick={() => {
              onApply();
              fetchNgRows();
            }}
            className="flex-1 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-md transition-colors duration-150"
          >
            Apply
          </button>
          <button
            onClick={() => {
              setFilters({
                status: 'all',
                fromDate: todayISO,
                toDate: todayISO,
                includeFixed: true
              });
              onReset();
            }}
            className="px-4 py-2 bg-slate-500 hover:bg-slate-600 text-white font-medium rounded-md transition-colors duration-150"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );

  const totalIssues = (daily?.ng || 0) + (daily?.fixed || 0);

  return (
    <div className="assembly-container">
      <ErrorModal message={errorMsg} onClose={() => setErrorMsg("")} />

      <div className="max-w-[1800px] mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl border border-slate-200/80 p-5 md:p-6 mb-5">
          {/* Title Bar */}
          <div className="flex flex-wrap justify-between items-center gap-3 pb-4 mb-4 border-b border-slate-100">
            <h1 className="text-xl font-semibold text-slate-800 flex items-center gap-3">
              <div className="p-2.5 bg-teal-50 rounded-lg">
                <Package className="w-5 h-5 text-teal-600" />
              </div>
              Assembly Line Production
            </h1>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  setShowNg(true);
                  setNgStep(1);
                  setNgSn("");
                  setNgReason("");
                  setTimeout(() => ngInputRef.current?.focus(), 60);
                }}
                className="btn-secondary btn-ng flex items-center gap-2"
              >
                <XCircle size={18} />
                NG
              </button>

              <button
                onClick={() => {
                  if (!showNgList) fetchNgRows();
                  setShowNgList(!showNgList);
                }}
                className="btn-secondary flex items-center gap-2"
              >
                <AlertCircle size={18} />
                NG List
              </button>

              <button
                onClick={() => setShowExport(!showExport)}
                className="btn-secondary btn-export flex items-center gap-2"
              >
                <Download size={18} />
                Export
              </button>
            </div>
          </div>

          {/* Tab Navigation - Control Group Pattern */}
          <div className="flex gap-1 p-1 bg-slate-100 rounded-lg mb-4">
            <TabButton
              active={activeTab === 'start'}
              onClick={() => {
                setActiveTab('start');
                setTimeout(() => startTimerInputRef.current?.focus(), 100);
              }}
              icon={Play}
              label="Start Assembly"
              badge={activeTimers.length}
            />
            <TabButton
              active={activeTab === 'complete'}
              onClick={() => {
                setActiveTab('complete');
                setTimeout(() => inputs.current[0]?.focus(), 100);
              }}
              icon={CheckCircle}
              label="Complete Assembly"
            />
          </div>

          {/* Export Panel (client-side CSV) */}
          {showExport && (
            <div className="mb-4 p-4 bg-slate-100 rounded-lg space-y-3">
              <div className="flex items-center gap-2 text-slate-700">
                <Download className="w-4 h-4" />
                <span className="font-medium text-sm">Export Options</span>
              </div>

              {/* Modes */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="flex items-center gap-2 p-3 bg-white border border-slate-200 rounded-lg cursor-pointer hover:border-slate-300 transition-colors duration-150">
                  <input
                    type="radio"
                    name="exportMode"
                    value="raw"
                    checked={exportMode === "raw"}
                    onChange={() => setExportMode("raw")}
                    className="text-teal-600 focus:ring-teal-500"
                  />
                  <span className="text-slate-700 text-sm">All details</span>
                </label>
                <label className="flex items-center gap-2 p-3 bg-white border border-slate-200 rounded-lg cursor-pointer hover:border-slate-300 transition-colors duration-150">
                  <input
                    type="radio"
                    name="exportMode"
                    value="daily"
                    checked={exportMode === "daily"}
                    onChange={() => setExportMode("daily")}
                    className="text-teal-600 focus:ring-teal-500"
                  />
                  <span className="text-slate-700 text-sm">Units per day</span>
                </label>
                <label className="flex items-center gap-2 p-3 bg-white border border-slate-200 rounded-lg cursor-pointer hover:border-slate-300 transition-colors duration-150">
                  <input
                    type="radio"
                    name="exportMode"
                    value="hourly"
                    checked={exportMode === "hourly"}
                    onChange={() => setExportMode("hourly")}
                    className="text-teal-600 focus:ring-teal-500"
                  />
                  <span className="text-slate-700 text-sm">Units per hour</span>
                </label>
              </div>

              {/* Conditions (range for all modes) */}
              <div className="flex flex-wrap items-center gap-3 text-slate-600 text-sm">
                <span className="font-medium">Range:</span>
                <input
                  type="date"
                  value={exportRange.from}
                  onChange={(e) => setExportRange(prev => ({ ...prev, from: e.target.value }))}
                  className="px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
                <span className="text-slate-400">to</span>
                <input
                  type="date"
                  value={exportRange.to}
                  onChange={(e) => setExportRange(prev => ({ ...prev, to: e.target.value }))}
                  className="px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
                <div className="ml-auto flex items-center gap-2">
                  <span className="font-medium">Max rows:</span>
                  <input
                    type="number"
                    min={1}
                    value={exportLimit}
                    onChange={(e) => setExportLimit(parseInt(e.target.value || "1", 10))}
                    className="w-24 px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="pt-2 flex gap-2">
                <button
                  onClick={exportClientCSV}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-md transition-colors duration-150"
                >
                  Download CSV
                </button>
                <button
                  onClick={() => setShowExport(false)}
                  className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-600 font-medium rounded-md transition-colors duration-150 border border-slate-200"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {/* ========== START TIMER TAB ========== */}
          {activeTab === 'start' && (
            <div className="space-y-4">
              {/* Start Timer Form */}
              <div
                className="bg-gradient-to-br from-teal-50 via-white to-cyan-50 rounded-xl p-5 border border-teal-100"
                onClick={() => { if (activeTab === 'start' && !startTimerBusy) startTimerInputRef.current?.focus(); }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2.5 bg-teal-100 rounded-lg">
                    <Play className="w-6 h-6 text-teal-700" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-stone-800">Start Assembly</h2>
                    <p className="text-sm text-stone-500">First station: Scan US SN to begin</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-2">
                      US Serial Number
                    </label>
                    <input
                      ref={startTimerInputRef}
                      value={startTimerSn}
                      onChange={(e) => {
                        // Strip leading non-digit chars (IME/autocorrect artifacts like "I'm")
                        // US SNs always start with digits (e.g. 1005...)
                        const raw = e.target.value.replace(/[^a-zA-Z0-9]/g, '');
                        setStartTimerSn(raw.replace(/^[a-zA-Z]+/, ''));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleStartTimer();
                        }
                      }}
                      disabled={startTimerBusy}
                      autoFocus={activeTab === 'start'}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck="false"
                      inputMode="text"
                      placeholder="Scan or enter US SN"
                      className={`w-full px-4 py-4 md:py-3 bg-white border-2 rounded-lg text-lg
                               focus:ring-2 focus:ring-teal-500 focus:border-teal-500
                               disabled:opacity-50 disabled:cursor-not-allowed
                               transition-colors duration-150
                               ${startTimerFlash === 'success' ? 'border-emerald-400 bg-emerald-50' : ''}
                               ${startTimerFlash === 'error' ? 'border-red-400 bg-red-50' : 'border-stone-300'}`}
                    />
                  </div>

                  <button
                    onClick={handleStartTimer}
                    disabled={startTimerBusy}
                    className="w-full px-6 py-4 md:py-3 bg-teal-600 hover:bg-teal-700 active:bg-teal-800
                             text-white font-bold text-base rounded-lg transition-colors duration-150
                             disabled:opacity-50 disabled:cursor-not-allowed shadow-lg active:scale-95
                             flex items-center justify-center gap-2"
                  >
                    {startTimerBusy ? (
                      <>
                        <RefreshCw className="w-5 h-5 animate-spin" />
                        Starting...
                      </>
                    ) : (
                      <>
                        <Play className="w-5 h-5" />
                        Start
                      </>
                    )}
                  </button>

                  {/* Message */}
                  {startTimerMsg && (
                    <div className={`p-3 rounded-lg text-center text-sm font-medium
                      ${startTimerFlash === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : ''}
                      ${startTimerFlash === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : ''}`}>
                      {startTimerMsg}
                    </div>
                  )}
                </div>
              </div>

              {/* Active Timers List */}
              <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
                <div className="px-4 py-3 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-stone-500" />
                    <span className="font-semibold text-stone-700 text-sm uppercase tracking-wide">
                      In Progress
                    </span>
                    <span className="px-2 py-0.5 bg-teal-100 text-teal-700 text-xs font-bold rounded-md">
                      {activeTimers.length}
                    </span>
                  </div>
                  <button
                    onClick={fetchActiveTimers}
                    className="p-1.5 hover:bg-stone-200 rounded-md transition-colors"
                    title="Refresh"
                  >
                    <RefreshCw className="w-4 h-4 text-stone-500" />
                  </button>
                </div>

                <div className="divide-y divide-stone-100 max-h-[300px] overflow-y-auto">
                  {activeTimers.length > 0 ? (
                    activeTimers.map((timer, idx) => (
                      <div key={timer.us_sn || idx} className="px-4 py-3 flex items-center justify-between hover:bg-stone-50">
                        <div>
                          <span className="font-medium text-stone-800">{timer.us_sn}</span>
                          <p className="text-xs text-stone-500 mt-0.5">Started: {timer.start_time}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-md">
                            In Progress
                          </span>
                          <button
                            onClick={() => handleDeleteTimer(timer.us_sn)}
                            className="p-1.5 text-stone-300 hover:text-red-600 transition-colors"
                            title="Delete timer"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="px-4 py-8 text-center text-stone-500">
                      <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p>No items in progress</p>
                      <p className="text-xs mt-1">Scan a US SN to start</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Today's Stats Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-white rounded-lg border border-stone-200 p-4 text-center">
                  <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Today's Total</p>
                  <p className="text-2xl font-bold text-stone-800 mt-1">{daily.count}</p>
                </div>
                <div className="bg-white rounded-lg border border-stone-200 p-4 text-center">
                  <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide">In Progress</p>
                  <p className="text-2xl font-bold text-teal-600 mt-1">{activeTimers.length}</p>
                </div>
                <div className="bg-white rounded-lg border border-amber-200 p-4 text-center">
                  <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide">NG Records</p>
                  <p className="text-2xl font-bold text-amber-600 mt-1">{daily.ng}</p>
                </div>
                <div className="bg-white rounded-lg border border-emerald-200 p-4 text-center">
                  <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide">Fixed</p>
                  <p className="text-2xl font-bold text-emerald-600 mt-1">{daily.fixed}</p>
                </div>
              </div>
            </div>
          )}

          {/* ========== COMPLETE ASSEMBLY TAB ========== */}
          {activeTab === 'complete' && (
            <>
          {/* Production Stats - Professional Design */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {/* Main Production Card */}
            <div className="stat-card-assembly relative overflow-hidden col-span-1 md:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-bold uppercase tracking-widest opacity-90">Today's Production</span>
                <div className="p-2.5 bg-white/20 rounded-lg backdrop-blur-sm">
                  <Package className="w-6 h-6" />
                </div>
              </div>
              <div className="text-7xl font-black mb-3">{daily.count}</div>
              <div className="text-sm opacity-90 font-medium">units assembled</div>
            </div>

            {/* Quality & Progress Card */}
            <div className="bg-gradient-to-br from-cyan-50 via-white to-emerald-50 rounded-xl p-4 border border-cyan-100 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide text-cyan-700 bg-white border border-cyan-100">
                    Quality
                  </span>
                  <span className="text-xs text-stone-500">Assembly Line</span>
                </div>
                <div className="p-2 bg-white/70 rounded-lg border border-cyan-100">
                  <AlertCircle className="w-4 h-4 text-cyan-700" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="bg-white/80 border border-amber-100 rounded-lg p-3">
                  <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">NG Records</p>
                  <p className="text-2xl font-bold text-amber-700 mt-1">{daily.ng}</p>
                </div>
                <div className="bg-white/80 border border-emerald-100 rounded-lg p-3">
                  <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Fixed</p>
                  <p className="text-2xl font-bold text-emerald-700 mt-1">{daily.fixed}</p>
                </div>
              </div>

              <div className="bg-white/80 border border-cyan-100 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-stone-600 uppercase tracking-wide">Scan Progress</p>
                  <span className="text-xs font-bold text-stone-700">{scannedCount}/6</span>
                </div>
                <div className="w-full bg-stone-200 rounded-full h-1.5">
                  <div
                    className="bg-cyan-600 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${(scannedCount / 6) * 100}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-stone-600">
                  <span>Pass rate</span>
                  <span className="font-semibold text-emerald-700">{totalIssues ? `${Math.round((daily.fixed / totalIssues) * 100)}%` : "100%"}</span>
                </div>
              </div>
            </div>
          </div>


          {/* Scan Form */}
          <form onSubmit={(e) => e.preventDefault()} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {fields.map((field, i) => (
                <div key={field} className="relative">
                  <label className="block text-sm font-medium text-stone-600 mb-1.5">
                    {labels[i]}
                    {form[field] && (
                      <CheckCircle className="inline-block ml-2 w-3.5 h-3.5 text-emerald-600" />
                    )}
                  </label>
                  <input
                    ref={(el) => (inputs.current[i] = el)}
                    value={form[field]}
                    disabled={busy}
                    onChange={(e) => onChange(e, i)}
                    onKeyDown={
                      i === fields.length - 1
                        ? (e) => {
                            if (e.key !== "Enter") return;
                            const v = form[fields[i]];
                            if (isBarcode(i, v)) {
                              e.preventDefault();
                              return;
                            }
                            submit();
                          }
                        : undefined
                    }

                    autoFocus={i === curIdx}
                    className={`w-full px-3 py-3.5 bg-white border rounded-md text-stone-800 text-lg
                             focus:ring-2 focus:ring-teal-500 focus:border-teal-500
                             disabled:opacity-50 disabled:cursor-not-allowed
                             transition-colors duration-150
                             ${flash === 'success' && form[field] ? 'border-emerald-400 bg-emerald-50' : 'border-stone-300'}
                             ${flash === 'error' && !form[field] ? 'border-red-400 bg-red-50' : ''}
                             ${i === curIdx ? 'ring-2 ring-teal-400 border-teal-400' : ''}`}
                    placeholder={`Scan or enter ${labels[i]}`}
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-center pt-1">
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="btn-primary w-full md:w-auto px-10
                         transition-colors duration-150 flex items-center gap-2"
              >
                {busy ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Save className="w-5 h-5" />
                    Submit Production
                  </>
                )}
              </button>
            </div>

            {/* Messages */}
            {msg && (
              <div className={`mt-4 p-3 rounded-md text-center text-sm font-medium
                ${flash === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : ''}
                ${flash === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : ''}`}>
                {msg}
              </div>
            )}

            {/* Product Line Display */}
            {lastProductLine && (
              <div className="mt-3 text-center">
                <div className={`product-line-badge inline-flex ${lastProductLine === 'apower2' ? 'badge-apower2' : 'badge-apowers'}`}>
                  {lastProductLine === 'apower2' ? '✓ Apower 2' : '✓ Apower S'}
                </div>
              </div>
            )}

            {/* Last Production Time Display */}
            {lastProductionTime !== null && (
              <div className="mt-3 text-center">
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-50 border border-cyan-200 rounded-lg">
                  <Timer className="w-4 h-4 text-cyan-600" />
                  <span className="text-sm font-medium text-cyan-700">
                    Production Time: {formatDuration(lastProductionTime)}
                  </span>
                </div>
              </div>
            )}
          </form>

          {/* Production Time Bar Chart + Stats */}
          {prodStats.total_with_time > 0 && (
            <div className="mt-4 bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
              {/* Header */}
              <div className="px-4 pt-4 pb-3 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-cyan-50 flex items-center justify-center">
                    <Timer className="w-3.5 h-3.5 text-cyan-600" />
                  </div>
                  <div>
                    <span className="font-semibold text-slate-800 text-sm uppercase tracking-wide">
                      Production Time
                    </span>
                    <span className="text-[11px] text-slate-400 ml-2">Today</span>
                  </div>
                </div>
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                  {prodStats.total_with_time} units
                </span>
              </div>

              {/* Mini stats row */}
              <div className="grid grid-cols-3 divide-x divide-slate-100 bg-slate-50/60">
                <div className="px-3 py-2.5 text-center">
                  <p className="text-[10px] font-semibold text-cyan-600 uppercase tracking-wider">Avg</p>
                  <p className="text-sm font-bold text-cyan-700 tabular-nums">{formatDuration(Math.round(prodStats.avg_seconds))}</p>
                </div>
                <div className="px-3 py-2.5 text-center">
                  <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider">Fastest</p>
                  <p className="text-sm font-bold text-emerald-700 tabular-nums">{formatDuration(prodStats.min_seconds)}</p>
                </div>
                <div className="px-3 py-2.5 text-center">
                  <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wider">Slowest</p>
                  <p className="text-sm font-bold text-amber-700 tabular-nums">{formatDuration(prodStats.max_seconds)}</p>
                </div>
              </div>

              {/* Bar Chart */}
              {prodTimes.length > 0 && (
                <div className="px-3 pt-3 pb-2" style={{ height: Math.max(180, Math.min(260, prodTimes.length * 6 + 80)) }}>
                  <Bar
                    data={{
                      labels: prodTimes.map((_, i) => `#${i + 1}`),
                      datasets: [{
                        data: prodTimes.map(t => t.seconds),
                        backgroundColor: prodTimes.map(t => {
                          const avg = prodStats.avg_seconds;
                          if (t.seconds <= avg * 0.8) return 'rgba(16, 185, 129, 0.7)';   // fast → emerald
                          if (t.seconds >= avg * 1.3) return 'rgba(245, 158, 11, 0.7)';   // slow → amber
                          return 'rgba(8, 145, 178, 0.65)';                                 // normal → cyan
                        }),
                        borderRadius: 2,
                        barPercentage: 0.85,
                        categoryPercentage: 0.92,
                      }],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      animation: { duration: 400 },
                      plugins: {
                        legend: { display: false },
                        tooltip: {
                          backgroundColor: '#1e293b',
                          titleFont: { size: 11, weight: 'bold' },
                          bodyFont: { size: 12, family: "'Inter', sans-serif" },
                          padding: { x: 10, y: 8 },
                          cornerRadius: 8,
                          displayColors: false,
                          callbacks: {
                            title: (items) => {
                              const idx = items[0].dataIndex;
                              const t = prodTimes[idx];
                              return t?.sn ? `SN: ${t.sn}` : `Unit #${idx + 1}`;
                            },
                            label: (item) => {
                              const secs = item.raw;
                              const m = Math.floor(secs / 60);
                              const s = secs % 60;
                              return m > 0 ? `${m}m ${s}s` : `${s}s`;
                            },
                          },
                        },
                      },
                      scales: {
                        x: {
                          display: false,
                        },
                        y: {
                          beginAtZero: true,
                          grid: { color: '#f1f5f9', drawBorder: false },
                          border: { display: false },
                          ticks: {
                            font: { size: 10, family: "'Inter', sans-serif" },
                            color: '#94a3b8',
                            callback: (v) => {
                              const m = Math.floor(v / 60);
                              return m > 0 ? `${m}m` : `${v}s`;
                            },
                            maxTicksLimit: 5,
                          },
                        },
                      },
                    }}
                  />
                </div>
              )}

              {/* Last production footer */}
              {lastProductionTime !== null && (
                <div className="px-4 py-2.5 border-t border-slate-100 flex items-center justify-between bg-slate-50/40">
                  <span className="text-xs text-slate-500">Last Completed</span>
                  <span className="text-xs font-bold text-cyan-700 tabular-nums">{formatDuration(lastProductionTime)}</span>
                </div>
              )}
            </div>
          )}
            </>
          )}
        </div>
      </div>

      {/* NG Modal */}
      {showNg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/40">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full overflow-hidden border border-stone-200">
            <div className="px-5 py-4 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-amber-100 text-amber-700">
                  <AlertCircle className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-base font-semibold text-stone-800">
                    {ngStep === 1 ? "Scan Serial Number" : "Edit & Mark NG"}
                  </div>
                  <div className="text-xs text-stone-500">Quick mark for NG items</div>
                </div>
              </div>
              <button
                onClick={() => setShowNg(false)}
                className="p-1.5 rounded-md hover:bg-stone-200 transition-colors"
                aria-label="Close"
              >
                <X size={16} className="text-stone-500" />
              </button>
            </div>

            <div className="p-5 bg-white">
              {/* Step 1: Scan SN */}
              {ngStep === 1 && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1.5">
                      Scan or type US-SN
                    </label>
                    <div className="relative">
                      <input
                        ref={ngInputRef}
                        value={ngSn}
                        onChange={(e) => setNgSn(e.target.value)}
                        onKeyDown={(e) =>
                          e.key === "Enter" && fetchNgRecord(e.target.value.trim())
                        }
                        className="w-full px-3 py-2.5 bg-stone-50 border border-stone-300 rounded-md
                                 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-colors"
                        placeholder="e.g. US123456789"
                      />
                      <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => fetchNgRecord(ngSn.trim())}
                      className="flex-1 px-4 py-2.5 bg-stone-700 hover:bg-stone-800 text-white
                             font-medium rounded-md transition-colors flex items-center justify-center gap-2"
                    >
                      <Search size={16} />
                      Search
                    </button>
                    <button
                      onClick={() => setShowNg(false)}
                      className="flex-1 px-4 py-2.5 bg-white hover:bg-stone-50 text-stone-600
                             font-medium rounded-md transition-colors border border-stone-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Edit & Mark */}
              {ngStep === 2 && ngRec && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      ["Module A", "module_a"],
                      ["Module B", "module_b"],
                      ["PCBA AU8", "pcba_au8"],
                      ["PCBA AM7", "pcba_am7"],
                    ].map(([label, key]) => (
                      <div key={key}>
                        <label className="block text-sm font-medium text-stone-600 mb-1">
                          {label}
                        </label>
                      <input
                        value={ngRec[key] || ""}
                        onChange={(e) =>
                          setNgRec((r) => ({ ...r, [key]: e.target.value }))
                        }
                        className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-md
                                   focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      />
                    </div>
                  ))}
                </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-600 mb-1">
                      NG Reason
                    </label>
                    <input
                      value={ngReason}
                      onChange={(e) => setNgReason(e.target.value)}
                      className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-md
                               focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      placeholder="Enter reason for NG"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-2">
                    <button
                      onClick={markNg}
                      className="px-3 py-2.5 bg-red-600 hover:bg-red-700 text-white
                             font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 text-sm"
                    >
                      <XCircle size={14} />
                      NG
                    </button>
                    <button
                      onClick={updateBoards}
                      className="px-3 py-2.5 bg-stone-700 hover:bg-stone-800 text-white
                             font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 text-sm"
                    >
                      <Edit3 size={14} />
                      Update
                    </button>
                    <button
                      onClick={clearNg}
                      className="px-3 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white
                             font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 text-sm"
                    >
                      <CheckCircle size={14} />
                      Fixed
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* NG List Modal */}
      {showNgList && (
        <div className="fixed inset-0 bg-stone-900/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[85vh] flex flex-col border border-stone-200">
            <div className="p-5 border-b border-stone-200 flex-shrink-0">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-stone-800 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-amber-600" />
                  NG Records Management
                </h3>
                <button
                  onClick={() => setShowNgList(false)}
                  className="p-1.5 hover:bg-stone-100 rounded-md transition-colors"
                >
                  <X size={18} className="text-stone-500" />
                </button>
              </div>

              {/* NG List Filters */}
              <FilterPanel
                onApply={() => fetchNgRows()}
                onReset={() => fetchNgRows()}
              />

              {/* Batch Actions */}
              {selectedRecords.size > 0 && (
                <div className="mt-4 p-3 bg-stone-50 rounded-md border border-stone-200">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-stone-700">
                      {selectedRecords.size} records selected
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={batchMarkNg}
                        className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white
                                font-medium rounded-md text-sm transition-colors"
                      >
                        Batch Mark NG
                      </button>
                      <button
                        onClick={batchClearNg}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white
                                font-medium rounded-md text-sm transition-colors"
                      >
                        Batch Clear NG
                      </button>
                      <button
                        onClick={() => setSelectedRecords(new Set())}
                        className="px-3 py-1.5 bg-stone-500 hover:bg-stone-600 text-white
                                font-medium rounded-md text-sm transition-colors"
                      >
                        Clear Selection
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-auto p-5">
              <div className="bg-white rounded-md border border-stone-200 overflow-hidden">
                <table className="w-full">
                  <thead className="sticky top-0 bg-stone-50 z-10">
                    <tr className="border-b border-stone-200">
                      <th className="px-4 py-3 w-12">
                        <input
                          type="checkbox"
                          checked={selectedRecords.size === ngRows.length && ngRows.length > 0}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedRecords(new Set(ngRows.map(r => r.us_sn)));
                            } else {
                              setSelectedRecords(new Set());
                            }
                          }}
                          className="rounded border-stone-300 text-teal-600 focus:ring-teal-500"
                        />
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold text-stone-600 uppercase tracking-wide">
                        US SN
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold text-stone-600 uppercase tracking-wide">
                        China SN
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold text-stone-600 uppercase tracking-wide">
                        Status
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold text-stone-600 uppercase tracking-wide">
                        NG Reason
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold text-stone-600 uppercase tracking-wide">
                        Timestamp
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {ngRows.length ? (
                      ngRows.map((r) => (
                        <tr
                          key={r.id}
                          className={`hover:bg-stone-50 transition-colors
                            ${((r.status || "").toLowerCase() === "fixed") ? "bg-emerald-50/50" : "bg-red-50/50"}`}
                        >
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={selectedRecords.has(r.us_sn)}
                              onChange={(e) => {
                                const newSelected = new Set(selectedRecords);
                                if (e.target.checked) {
                                  newSelected.add(r.us_sn);
                                } else {
                                  newSelected.delete(r.us_sn);
                                }
                                setSelectedRecords(newSelected);
                              }}
                              className="rounded border-stone-300 text-teal-600 focus:ring-teal-500"
                            />
                          </td>
                          <td className="px-5 py-3 text-sm text-stone-800 font-medium">{r.us_sn}</td>
                          <td className="px-5 py-3 text-sm text-stone-700">{r.china_sn || '-'}</td>
                          <td className="px-5 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium
                              ${((r.status || "").toLowerCase() === "fixed")
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-red-100 text-red-700"}`}
                          >
                            {r.status}
                          </span>
                          </td>
                          <td className="px-5 py-3 text-sm text-stone-600 max-w-xs truncate" title={r.ng_reason}>
                            {r.ng_reason || '-'}
                          </td>
                          <td className="px-5 py-3 text-sm text-stone-500">{r.timestamp}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="px-5 py-8 text-center text-stone-500">
                          No NG records found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
