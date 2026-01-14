import React, {
  useState, useRef, useEffect, useCallback, useMemo,
} from "react";
import {
  Package, AlertCircle, Download, X,
  CheckCircle, XCircle, RefreshCw, Search,
  Edit3, Save, Filter
} from "lucide-react";

import { createPortal } from "react-dom";


// Use your actual API service
import api from "../../services/api";
import useWs from "../../utils/wsConnect";
import "./AssemblyProduction.css";

// Error Modal Component
const ErrorModal = ({ message, onClose }) => {
  if (!message) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-red-100 rounded-full">
            <AlertCircle className="w-6 h-6 text-red-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">Error</h3>
        </div>
        <p className="text-gray-700 mb-6">{message}</p>
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
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
  const [, setLastTs] = useState("");
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
        setMsg("Submitted successfully!");

        // Detect product line from US SN
        const usSn = form.us_sn || "";
        if (usSn.startsWith("10050018") || usSn.startsWith("10050028")) {
          setLastProductLine("apower2");
        } else if (usSn.startsWith("10050022")) {
          setLastProductLine("apowers");
        } else {
          setLastProductLine("");
        }

        await fetchDaily();
        setLastTs(`Last submit @ ${new Date().toLocaleString()}`);
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
  }, [form, emptyForm, fetchDaily, busy]);


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
  const ws = useWs("/ws/dashboard");
  useEffect(() => {
    if (!ws) return;
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.event === "assembly_updated") {
          // FIX: update all counters if present; fallback to fetchDaily if none provided
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
            // If backend didn't include counters, re-pull them
            fetchDaily();
          }
        }
      } catch {
        /* ignore */
      }
    };
  }, [ws, fetchDaily]);

  useEffect(() => {
    fetchDaily();
  }, [fetchDaily]);

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
    <div className="bg-stone-50 rounded-lg p-3 border border-stone-200 space-y-3">
      <div className="flex items-center gap-2">
        <Filter className="w-4 h-4 text-stone-500" />
        <span className="font-medium text-stone-700 text-sm uppercase tracking-wide">Filters</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-sm font-medium text-stone-600 mb-1">Status</label>
          <select
            value={filters.status}
            onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
            className="w-full px-3 py-2 bg-white border border-stone-300 rounded-md focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-stone-700"
          >
            <option value="all">All Status</option>
            <option value="ok">OK</option>
            <option value="NG">NG</option>
            <option value="Fixed">Fixed</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-stone-600 mb-1">From Date</label>
          <input
            type="date"
            value={filters.fromDate}
            onChange={(e) => setFilters(prev => ({ ...prev, fromDate: e.target.value }))}
            className="w-full px-3 py-2 bg-white border border-stone-300 rounded-md focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-stone-600 mb-1">To Date</label>
          <input
            type="date"
            value={filters.toDate}
            onChange={(e) => setFilters(prev => ({ ...prev, toDate: e.target.value }))}
            className="w-full px-3 py-2 bg-white border border-stone-300 rounded-md focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          />
        </div>

        <div className="flex items-end gap-2">
          <button
            onClick={() => {
              onApply();
              fetchNgRows();
            }}
            className="flex-1 px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white font-medium rounded-md transition-colors"
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
            className="px-4 py-2 bg-stone-500 hover:bg-stone-600 text-white font-medium rounded-md transition-colors"
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
        <div className="bg-white rounded-lg shadow-sm border border-stone-200 p-4 mb-3">
          {/* Title Bar */}
          <div className="flex flex-wrap justify-between items-center gap-3 pb-4 mb-4 border-b border-stone-100">
            <h1 className="text-2xl font-semibold text-stone-800 flex items-center gap-3">
              <div className="p-2.5 bg-cyan-100 rounded-lg shadow-sm">
                <Package className="w-6 h-6 text-cyan-700" />
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

          {/* Export Panel (client-side CSV) */}
          {showExport && (
            <div className="mb-4 p-3 bg-stone-50 rounded-lg border border-stone-200 space-y-3">
              <div className="flex items-center gap-2 text-stone-700">
                <Download className="w-4 h-4" />
                <span className="font-medium text-sm uppercase tracking-wide">Export Options</span>
              </div>

              {/* Modes */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="flex items-center gap-2 p-3 bg-white border border-stone-200 rounded-md cursor-pointer hover:border-stone-300 transition-colors">
                  <input
                    type="radio"
                    name="exportMode"
                    value="raw"
                    checked={exportMode === "raw"}
                    onChange={() => setExportMode("raw")}
                    className="text-teal-700 focus:ring-teal-600"
                  />
                  <span className="text-stone-700 text-sm">All details</span>
                </label>
                <label className="flex items-center gap-2 p-3 bg-white border border-stone-200 rounded-md cursor-pointer hover:border-stone-300 transition-colors">
                  <input
                    type="radio"
                    name="exportMode"
                    value="daily"
                    checked={exportMode === "daily"}
                    onChange={() => setExportMode("daily")}
                    className="text-teal-700 focus:ring-teal-600"
                  />
                  <span className="text-stone-700 text-sm">Units per day</span>
                </label>
                <label className="flex items-center gap-2 p-3 bg-white border border-stone-200 rounded-md cursor-pointer hover:border-stone-300 transition-colors">
                  <input
                    type="radio"
                    name="exportMode"
                    value="hourly"
                    checked={exportMode === "hourly"}
                    onChange={() => setExportMode("hourly")}
                    className="text-teal-700 focus:ring-teal-600"
                  />
                  <span className="text-stone-700 text-sm">Units per hour</span>
                </label>
              </div>

              {/* Conditions (range for all modes) */}
              <div className="flex flex-wrap items-center gap-3 text-stone-700 text-sm">
                <span className="font-medium">Range:</span>
                <input
                  type="date"
                  value={exportRange.from}
                  onChange={(e) => setExportRange(prev => ({ ...prev, from: e.target.value }))}
                  className="px-3 py-2 bg-white border border-stone-300 rounded-md focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
                <span className="text-stone-400">to</span>
                <input
                  type="date"
                  value={exportRange.to}
                  onChange={(e) => setExportRange(prev => ({ ...prev, to: e.target.value }))}
                  className="px-3 py-2 bg-white border border-stone-300 rounded-md focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
                <div className="ml-auto flex items-center gap-2">
                  <span className="font-medium">Max rows:</span>
                  <input
                    type="number"
                    min={1}
                    value={exportLimit}
                    onChange={(e) => setExportLimit(parseInt(e.target.value || "1", 10))}
                    className="w-24 px-3 py-2 bg-white border border-stone-300 rounded-md focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="pt-2 flex gap-2">
                <button
                  onClick={exportClientCSV}
                  className="px-5 py-2 bg-teal-700 hover:bg-teal-800 text-white font-medium rounded-md transition-colors"
                >
                  Download CSV
                </button>
                <button
                  onClick={() => setShowExport(false)}
                  className="px-4 py-2 bg-white hover:bg-stone-50 text-stone-600 font-medium rounded-md transition-colors border border-stone-300"
                >
                  Close
                </button>
              </div>
            </div>
          )}

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
          </form>
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
