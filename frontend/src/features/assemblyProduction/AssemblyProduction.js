import React, {
  useState, useRef, useEffect, useCallback, useMemo,
} from "react";
import {
  Package, AlertCircle, Download, X, Trash2,
  CheckCircle, XCircle, RefreshCw, Search,
  Edit3, Save, BarChart3, Filter, Edit
} from "lucide-react";

// Use your actual API service
import api from "../../services/api";
import useWs from "../../utils/wsConnect";

// Error Modal Component
const ErrorModal = ({ message, onClose }) => {
  if (!message) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
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
    </div>
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
  const [lastTs, setLastTs] = useState("");
  const [scannedCount, setScannedCount] = useState(0);

  // Stats state
  const [daily, setDaily] = useState({ count: 0, ng: 0, fixed: 0 });

  // View states
  const [showAllRows, setShowAllRows] = useState(false);
  const [allRows, setAllRows] = useState([]);
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

  // Edit timestamp states
  const [editingTimestamp, setEditingTimestamp] = useState({});
  const [tempTimestamp, setTempTimestamp] = useState({});

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

  // API Calls
  // FIX: make fetchDaily resilient to response shapes
  const fetchDaily = useCallback(async () => {
    try {
      const { data } = await api.get("/assembly_inventory_daily_count");

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

  const fetchAllRows = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filters.status !== 'all') params.append('status_filter', filters.status);
      if (filters.fromDate) params.append('from_date', filters.fromDate);
      if (filters.toDate) params.append('to_date', filters.toDate);

      const url = `/assembly_inventory/list/all?${params.toString()}`;
      const { data } = await api.get(url);
      setAllRows(pickArray(data));
    } catch (error) {
      console.error("Error fetching all rows:", error);
      if (error.response?.status === 403) {
        setErrorMsg("You don't have permission to view all records");
      } else {
        setErrorMsg("Failed to fetch records");
      }
    }
  }, [filters]);

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

  // Submit function
  const submit = useCallback(async () => {
    // Validation
    for (let i = 0; i < fields.length; i += 1) {
      if (!form[fields[i]].trim()) {
        setFlash("error");
        setMsg(`${labels[i]} cannot be empty`);
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
      const { data } = await api.post("/assembly_inventory", submitData);

      if (!data?.status || data.status === "success") {
        setFlash("success");
        setMsg("Submitted successfully!");
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
      setTimeout(() => setFlash(""), 2500);
    }
  }, [form, emptyForm, fetchDaily]);

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
      const { data } = await api.post("/assembly_inventory/mark_ng", {
        us_sn,
        reason: ngReason.trim(),
      });
      if (data?.status && data.status !== "success") {
        throw new Error(data?.message || "mark_ng failed");
      }
      setMsg("NG marked: " + (data?.message || "Operation completed"));
      setShowNg(false);
      setNgReason("");
      await Promise.all([fetchNgRows(), fetchAllRows(), fetchDaily()]);
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
      const { data } = await api.post("/assembly_inventory/clear_ng", { us_sn });
      if (data?.status && data.status !== "success") {
        throw new Error(data?.message || "clear_ng failed");
      }
      setMsg("NG cleared: " + (data?.message || "Operation completed"));
      setShowNg(false);
      setNgReason("");
      await Promise.all([fetchNgRows(), fetchAllRows(), fetchDaily()]);
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
      await Promise.all([fetchNgRows(), fetchAllRows(), fetchDaily()]);
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
      const { data } = await api.post("/assembly_inventory/batch_mark_ng", {
        us_sns: Array.from(selectedRecords),
        reason: reason.trim()
      });

      if (data?.status && data.status !== "success") {
        throw new Error(data?.message || "batch mark NG failed");
      }

      setMsg(`Batch operation completed: ${data.message || "OK"}`);
      setSelectedRecords(new Set());
      await Promise.all([fetchAllRows(), fetchNgRows(), fetchDaily()]);
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
      const { data } = await api.post("/assembly_inventory/batch_clear_ng", {
        us_sns: Array.from(selectedRecords)
      });

      if (data?.status && data.status !== "success") {
        throw new Error(data?.message || "batch clear NG failed");
      }

      setMsg(`Batch operation completed: ${data.message || "OK"}`);
      setSelectedRecords(new Set());
      await Promise.all([fetchAllRows(), fetchNgRows(), fetchDaily()]);
    } catch (e) {
      setErrorMsg(e.response?.data?.message || e.message || "Batch operation failed");
    }
  };

  // Timestamp editing functions
  const startEditingTimestamp = (rowId, currentTimestamp) => {
    setEditingTimestamp(prev => ({ ...prev, [rowId]: true }));
    // Convert timestamp to datetime-local format
    const date = new Date(currentTimestamp);
    const localDateTime = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setTempTimestamp(prev => ({ ...prev, [rowId]: localDateTime }));
  };

  const cancelEditingTimestamp = (rowId) => {
    setEditingTimestamp(prev => ({ ...prev, [rowId]: false }));
    setTempTimestamp(prev => ({ ...prev, [rowId]: undefined }));
  };

  const saveTimestamp = async (usSn, rowId) => {
    const newTimestamp = tempTimestamp[rowId];
    if (!newTimestamp) return;

    // Turn <input type="datetime-local"> value into "YYYY-MM-DD HH:mm:ss"
    let formattedTimestamp = newTimestamp.replace('T', ' ');
    if (formattedTimestamp.length === 16) {
      formattedTimestamp += ':00';
    }

    try {
      const { data } = await api.patch(
        `/assembly_inventory/admin_edit/${usSn}`,
        { timestamp: formattedTimestamp }
      );

      if (!data?.status || data.status === 'success') {
        setMsg('Timestamp updated successfully');
        setEditingTimestamp(prev => ({ ...prev, [rowId]: false }));
        setTempTimestamp(prev => ({ ...prev, [rowId]: undefined }));
        await fetchAllRows();
      } else {
        setErrorMsg(data.message || 'Failed to update timestamp');
      }
    } catch (e) {
      if (e.response?.status === 403) {
        setErrorMsg("You don't have permission to edit timestamps");
      } else {
        setErrorMsg(e.response?.data?.message || 'Failed to update timestamp');
      }
    }
  };

  const handleDelete = async (id, chinaSn) => {
    if (!window.confirm(`Delete ${chinaSn}?`)) return;
    try {
      const { data } = await api.delete(`/assembly_inventory/delete/${id}`);
      if (data?.status && data.status !== "success") {
        throw new Error(data?.message || "delete failed");
      }
      setMsg("Record deleted: " + (data.message || "Operation completed"));
      await Promise.all([fetchAllRows(), fetchDaily()]);
    } catch (e) {
      if (e.response?.status === 403) {
        setErrorMsg(e.response.data.message || "You don't have permission to delete records");
      } else {
        setErrorMsg(e.response?.data?.message || e.message || "Delete failed");
      }
    }
  };

  // UI Components
  const StatCard = ({ title, value, subtitle, icon: Icon, color = "blue" }) => (
    <div className={`bg-gradient-to-br from-${color}-50 to-${color}-100 rounded-xl p-6 
                   border border-${color}-200 transition-transform hover:scale-105`}>
      <div className="flex items-center justify-between mb-2">
        <div className={`p-2 bg-${color}-500 rounded-lg`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
      </div>
      <div className={`text-sm font-medium text-${color}-700 mb-1`}>{title}</div>
      <div className={`text-4xl font-bold text-${color}-900`}>{value}</div>
      <div className={`text-xs text-${color}-600 mt-1`}>{subtitle}</div>
    </div>
  );

  const FilterPanel = ({ onApply, onReset }) => (
    <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-4">
      <div className="flex items-center gap-2 mb-3">
        <Filter className="w-5 h-5 text-gray-600" />
        <span className="font-medium text-gray-700">Filters</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
          <select
            value={filters.status}
            onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Status</option>
            <option value="ok">OK</option>
            <option value="NG">NG</option>
            <option value="Fixed">Fixed</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
          <input
            type="date"
            value={filters.fromDate}
            onChange={(e) => setFilters(prev => ({ ...prev, fromDate: e.target.value }))}
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
          <input
            type="date"
            value={filters.toDate}
            onChange={(e) => setFilters(prev => ({ ...prev, toDate: e.target.value }))}
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-end gap-2">
          <button
            onClick={() => {
              onApply();
              fetchAllRows();
              fetchNgRows();
            }}
            className="flex-1 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-colors"
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
            className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900 py-4 px-4 sm:px-6 lg:px-8">
      <ErrorModal message={errorMsg} onClose={() => setErrorMsg("")} />

      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <div className="p-3 bg-gradient-to-br from-blue-500 to-purple-500 rounded-xl shadow-lg">
                <Package className="w-8 h-8 text-white" />
              </div>
              Assembly Line Production
            </h1>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => {
                  if (!showAllRows) fetchAllRows();
                  setShowAllRows(!showAllRows);
                }}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 
                        hover:bg-gray-50 font-medium rounded-lg transition-all duration-200 
                        flex items-center gap-2 shadow-sm"
              >
                <BarChart3 size={18} />
                View DB
              </button>

              <button
                onClick={() => {
                  setShowNg(true);
                  setNgStep(1);
                  setNgSn("");
                  setNgReason("");
                  setTimeout(() => ngInputRef.current?.focus(), 60);
                }}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 
                        hover:bg-gray-50 font-medium rounded-lg transition-all duration-200 
                        flex items-center gap-2 shadow-sm"
              >
                <XCircle size={18} />
                NG
              </button>

              <button
                onClick={() => {
                  if (!showNgList) fetchNgRows();
                  setShowNgList(!showNgList);
                }}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 
                        hover:bg-gray-50 font-medium rounded-lg transition-all duration-200 
                        flex items-center gap-2 shadow-sm"
              >
                <AlertCircle size={18} />
                NG List
              </button>

              <button
                onClick={() => setShowExport(!showExport)}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 
                        hover:bg-gray-50 font-medium rounded-lg transition-all duration-200 
                        flex items-center gap-2 shadow-sm"
              >
                <Download size={18} />
                Export
              </button>
            </div>
          </div>

          {/* Export Panel (client-side CSV) */}
          {showExport && (
            <div className="mb-6 p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-4">
              <div className="flex items-center gap-3">
                <Download className="w-5 h-5 text-gray-700" />
                <span className="font-medium text-gray-800">Export (Client-side CSV)</span>
              </div>

              {/* Modes */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="flex items-center gap-2 p-3 bg-white border border-gray-200 rounded-lg cursor-pointer">
                  <input
                    type="radio"
                    name="exportMode"
                    value="raw"
                    checked={exportMode === "raw"}
                    onChange={() => setExportMode("raw")}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-gray-800 font-medium">Export all details</span>
                </label>
                <label className="flex items-center gap-2 p-3 bg-white border border-gray-200 rounded-lg cursor-pointer">
                  <input
                    type="radio"
                    name="exportMode"
                    value="daily"
                    checked={exportMode === "daily"}
                    onChange={() => setExportMode("daily")}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-gray-800 font-medium">Units per day</span>
                </label>
                <label className="flex items-center gap-2 p-3 bg-white border border-gray-200 rounded-lg cursor-pointer">
                  <input
                    type="radio"
                    name="exportMode"
                    value="hourly"
                    checked={exportMode === "hourly"}
                    onChange={() => setExportMode("hourly")}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-gray-800 font-medium">Units per hour</span>
                </label>
              </div>

              {/* Conditions (range for all modes) */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-gray-700">Range:</span>
                <input
                  type="date"
                  value={exportRange.from}
                  onChange={(e) => setExportRange(prev => ({ ...prev, from: e.target.value }))}
                  className="px-3 py-2 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-gray-600">To</span>
                <input
                  type="date"
                  value={exportRange.to}
                  onChange={(e) => setExportRange(prev => ({ ...prev, to: e.target.value }))}
                  className="px-3 py-2 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-gray-700">Max rows:</span>
                  <input
                    type="number"
                    min={1}
                    value={exportLimit}
                    onChange={(e) => setExportLimit(parseInt(e.target.value || "1", 10))}
                    className="w-28 px-3 py-2 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="pt-2">
                <button
                  onClick={exportClientCSV}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
                >
                  Download CSV
                </button>
                <button
                  onClick={() => setShowExport(false)}
                  className="ml-2 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {/* Production Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <StatCard
              title="Today's Production"
              value={daily.count}
              subtitle="units assembled"
              icon={Package}
              color="blue"
            />

            <StatCard
              title="NG Records"
              value={daily.ng}
              subtitle="need attention"
              icon={AlertCircle}
              color="red"
            />

            <StatCard
              title="Fixed Records"
              value={daily.fixed}
              subtitle="resolved today"
              icon={CheckCircle}
              color="green"
            />

            <StatCard
              title="Current Progress"
              value={`${scannedCount}/6`}
              subtitle="fields scanned"
              icon={Package}
              color="purple"
            />
          </div>

          {/* Progress Bar */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Scan Progress</span>
              <span className="text-sm text-gray-500">{Math.round((scannedCount / 6) * 100)}%</span>
            </div>
            <div className="w-full bg-gray-2 00 rounded-full h-3">
              <div
                className="bg-gradient-to-r from-blue-500 to-purple-500 h-3 rounded-full transition-all duration-300"
                style={{ width: `${(scannedCount / 6) * 100}%` }}
              />
            </div>
          </div>

          {/* Scan Form */}
          <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {fields.map((field, i) => (
                <div key={field} className="relative">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {labels[i]}
                    {form[field] && (
                      <CheckCircle className="inline-block ml-2 w-4 h-4 text-green-500" />
                    )}
                  </label>
                  <input
                    ref={(el) => (inputs.current[i] = el)}
                    value={form[field]}
                    disabled={busy}
                    onChange={(e) => onChange(e, i)}
                    onKeyDown={
                      i === fields.length - 1
                        ? (e) => e.key === "Enter" && submit()
                        : undefined
                    }
                    autoFocus={i === curIdx}
                    className={`w-full px-4 py-3 bg-white border rounded-lg text-gray-900
                             focus:ring-2 focus:ring-blue-500 focus:border-transparent
                             disabled:opacity-50 disabled:cursor-not-allowed
                             transition-all duration-200
                             ${flash === 'success' && form[field] ? 'border-green-400 bg-green-50' : 'border-gray-300'}
                             ${flash === 'error' && !form[field] ? 'border-red-400 bg-red-50' : ''}
                             ${i === curIdx ? 'ring-2 ring-blue-400' : ''}`}
                    placeholder={`Scan or enter ${labels[i]}`}
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-center">
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="px-8 py-3 bg-gradient-to-r from-blue-500 to-purple-500 
                         hover:from-blue-600 hover:to-purple-600 text-white font-semibold 
                         rounded-lg shadow-lg disabled:opacity-50 disabled:cursor-not-allowed
                         transform transition-all duration-200 hover:scale-105"
              >
                {busy ? (
                  <span className="flex items-center gap-2">
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    Submitting...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Save className="w-5 h-5" />
                    Submit Production
                  </span>
                )}
              </button>
            </div>

            {/* Messages */}
            {msg && (
              <div className={`mt-4 p-4 rounded-lg text-center font-medium
                ${flash === 'success' ? 'bg-green-100 text-green-800 border border-green-300' : ''}
                ${flash === 'error' ? 'bg-red-100 text-red-800 border border-red-300' : ''}`}>
                {msg}
              </div>
            )}
          </form>
        </div>
      </div>

      {/* NG Modal */}
      {showNg && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center 
                      justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                <AlertCircle className="text-red-500" />
                {ngStep === 1 ? "Scan Serial Number" : "Edit & Mark"}
              </h3>
              <button
                onClick={() => setShowNg(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            {/* Step 1: Scan SN */}
            {ngStep === 1 && (
              <div className="space-y-4">
                <input
                  ref={ngInputRef}
                  value={ngSn}
                  onChange={(e) => setNgSn(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && fetchNgRecord(e.target.value.trim())
                  }
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg
                           focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="Scan or type US-SN"
                />
                <div className="flex gap-3">
                  <button
                    onClick={() => fetchNgRecord(ngSn.trim())}
                    className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 text-white 
                           font-medium rounded-lg transition-all flex items-center justify-center gap-2"
                  >
                    <Search size={18} />
                    Search
                  </button>
                  <button
                    onClick={() => setShowNg(false)}
                    className="flex-1 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 
                           font-medium rounded-lg transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Edit & Mark */}
            {ngStep === 2 && ngRec && (
              <div className="space-y-4">
                {[
                  ["Module A", "module_a"],
                  ["Module B", "module_b"],
                  ["PCBA AU8", "pcba_au8"],
                  ["PCBA AM7", "pcba_am7"],
                ].map(([label, key]) => (
                  <div key={key}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {label}
                    </label>
                    <input
                      value={ngRec[key] || ""}
                      onChange={(e) =>
                        setNgRec((r) => ({ ...r, [key]: e.target.value }))
                      }
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg
                             focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                ))}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    NG Reason
                  </label>
                  <input
                    value={ngReason}
                    onChange={(e) => setNgReason(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg
                           focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    placeholder="Enter reason for NG"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3 pt-2">
                  <button
                    onClick={markNg}
                    className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white 
                           font-medium rounded-lg transition-all flex items-center justify-center gap-1"
                  >
                    <XCircle size={16} />
                    NG
                  </button>
                  <button
                    onClick={updateBoards}
                    className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white 
                           font-medium rounded-lg transition-all flex items-center justify-center gap-1"
                  >
                    <Edit3 size={16} />
                    Update
                  </button>
                  <button
                    onClick={clearNg}
                    className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white 
                           font-medium rounded-lg transition-all flex items-center justify-center gap-1"
                  >
                    <CheckCircle size={16} />
                    Fixed
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* NG List Modal */}
      {showNgList && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center 
                      justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full max-h-[85vh] 
                        flex flex-col">
            <div className="p-6 border-b border-gray-200 flex-shrink-0">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                  <AlertCircle className="text-orange-500" />
                  NG Records Management
                </h3>
                <button
                  onClick={() => setShowNgList(false)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X size={20} className="text-gray-500" />
                </button>
              </div>

              {/* NG List Filters */}
              <FilterPanel
                onApply={() => fetchNgRows()}
                onReset={() => fetchNgRows()}
              />

              {/* Batch Actions */}
              {selectedRecords.size > 0 && (
                <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-blue-800">
                      {selectedRecords.size} records selected
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={batchMarkNg}
                        className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white 
                                font-medium rounded text-sm transition-colors"
                      >
                        Batch Mark NG
                      </button>
                      <button
                        onClick={batchClearNg}
                        className="px-3 py-1 bg-green-500 hover:bg-green-600 text-white 
                                font-medium rounded text-sm transition-colors"
                      >
                        Batch Clear NG
                      </button>
                      <button
                        onClick={() => setSelectedRecords(new Set())}
                        className="px-3 py-1 bg-gray-500 hover:bg-gray-600 text-white 
                                font-medium rounded text-sm transition-colors"
                      >
                        Clear Selection
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-auto p-6">
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full">
                  <thead className="sticky top-0 bg-gray-50 z-10">
                    <tr className="border-b border-gray-200">
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
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                        US SN
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                        China SN
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                        NG Reason
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                        Timestamp
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {ngRows.length ? (
                      ngRows.map((r) => (
                        <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-4">
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
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900 font-medium">{r.us_sn}</td>
                          <td className="px-6 py-4 text-sm text-gray-900">{r.china_sn || '-'}</td>
                          <td className="px-6 py-4">
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium 
                                ${r.status === "Fixed" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                              {r.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-700 max-w-xs truncate" title={r.ng_reason}>
                            {r.ng_reason || '-'}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-500">{r.timestamp}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
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

      {/* All Records Modal with Timestamp Editing */}
      {showAllRows && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center 
                      justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[95vw] max-h-[90vh] 
                        flex flex-col">
            <div className="p-4 md:p-6 border-b border-gray-200 flex-shrink-0">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg md:text-xl font-semibold text-gray-900 flex items-center gap-2">
                  <Package className="text-blue-500" />
                  All Assembly Records
                </h3>
                <button
                  onClick={() => setShowAllRows(false)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X size={20} className="text-gray-500" />
                </button>
              </div>

              {/* Filters */}
              <FilterPanel
                onApply={() => fetchAllRows()}
                onReset={() => fetchAllRows()}
              />
            </div>

            <div className="flex-1 overflow-auto p-4 md:p-6">
              <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
                <table className="w-full min-w-[1200px]">
                  <thead className="sticky top-0 bg-gray-50 z-10">
                    <tr className="border-b border-gray-200">
                      {labels.map((label) => (
                        <th key={label} className="px-4 py-3 text-left text-xs font-medium 
                                                text-gray-700 uppercase tracking-wider whitespace-nowrap">
                          {label}
                        </th>
                      ))}
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase whitespace-nowrap">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase whitespace-nowrap">
                        NG Reason
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase whitespace-nowrap">
                        Timestamp
                      </th>
                      <th className="px-4 py-3 w-16"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {allRows.map((row) => (
                      <tr key={row.id} className={`hover:bg-gray-50 transition-colors group
                                                ${row.status === "NG" ? "bg-red-50" : ""}`}>
                        {fields.map((field) => (
                          <td key={field} className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                            {row[field] || '-'}
                          </td>
                        ))}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full 
                                         text-xs font-medium
                            ${row.status === "NG"
                              ? "bg-red-100 text-red-800"
                              : row.status === "Fixed"
                                ? "bg-green-100 text-green-800"
                                : "bg-gray-100 text-gray-800"}`}>
                            {row.status || 'OK'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 max-w-xs truncate" title={row.ng_reason}>
                          {row.ng_reason || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                          {editingTimestamp[row.id] ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="datetime-local"
                                value={tempTimestamp[row.id] || ''}
                                onChange={(e) => setTempTimestamp(prev => ({ ...prev, [row.id]: e.target.value }))}
                                className="px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                              />
                              <button
                                onClick={() => saveTimestamp(row.us_sn, row.id)}
                                className="p-1 text-green-600 hover:bg-green-50 rounded"
                                title="Save"
                              >
                                <Save size={14} />
                              </button>
                              <button
                                onClick={() => cancelEditingTimestamp(row.id)}
                                className="p-1 text-gray-600 hover:bg-gray-50 rounded"
                                title="Cancel"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span>{new Date(row.timestamp).toLocaleString()}</span>
                              <button
                                onClick={() => startEditingTimestamp(row.id, row.timestamp)}
                                className="p-1 text-blue-600 hover:bg-blue-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Edit timestamp"
                              >
                                <Edit size={14} />
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => handleDelete(row.id, row.china_sn)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg 
                                     transition-colors group"
                            title="Delete record"
                          >
                            <Trash2 size={16} className="group-hover:scale-110 transition-transform" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {allRows.length === 0 && (
                      <tr>
                        <td colSpan={10} className="px-6 py-8 text-center text-gray-500">
                          No records found
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
