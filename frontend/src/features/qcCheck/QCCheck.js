// @ts-nocheck
import { useEffect, useState, useRef, useCallback } from "react";
import {
  TruckIcon,
  BarChart3,
  CheckCircle2,
  AlertCircle,
  Clock,
  TrendingUp,
  Calendar,
  Download,
  X,
  Loader2,
  Database,
  Activity,
  FileText,
  AlertTriangle,
  Image,
  ClipboardList,
  Box,
} from "lucide-react";
import Plot3D, { buildHourDowMatrix } from "../../components/Plot3D";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

import api from "../../services/api"; // shared axios instance
const QC_PREFIX = "qc";

// date helpers – use local date (not UTC) so LA timezone works correctly
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayStr = () => ymd(new Date());
const firstDayOfMonth = () => {
  const d = new Date();
  d.setDate(1);
  return ymd(d);
};
const yesterdayStr = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return ymd(d);
};
const thisWeekStart = () => {
  const d = new Date();
  const dow = d.getDay(); // 0=Sun,1=Mon...
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1)); // back to Monday
  return ymd(d);
};

const parseUniqueSerialNumbers = (input) => [...new Set(
  input
    .split(/[\n\s,\t]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
)];

const buildQcRowKey = (row, index) =>
  row?.id ?? [row?.sn, row?.created_at, row?.fqc_ready_at, row?.shipped_at, index].filter(Boolean).join(":");

// Build 12-month × 31-day Z-matrix from [{month, dom, ship_count}]
const MONTH_LABELS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function buildCalendarMatrix(records) {
  const z = Array.from({ length: 12 }, () => Array(31).fill(0));
  for (const r of records) {
    const mi = Number(r.month) - 1;
    const di = Number(r.dom)   - 1;
    if (mi >= 0 && mi < 12 && di >= 0 && di < 31)
      z[mi][di] = Number(r.ship_count) || 0;
  }
  return {
    z,
    x: Array.from({ length: 31 }, (_, i) => String(i + 1)),
    y: MONTH_LABELS_SHORT,
  };
}

export default function QCCheck() {
/* state */
  const [mode, setMode] = useState("fqc");
  const [sn, setSn] = useState("");
  const [loading, setLoading] = useState(false);
  const [, setMessage] = useState({ text: "", type: "" });
  const [toast, setToast] = useState({ text: "", type: "", visible: false });
  const toastTimerRef = useRef(null);
  const [recentScans, setRecentScans] = useState([]);
  // FQC Batch state
  const [showBatchFqc, setShowBatchFqc] = useState(false);
  const [batchFqcInput, setBatchFqcInput] = useState("");
  const [batchFqcResults, setBatchFqcResults] = useState(null);
  const [batchFqcLoading, setBatchFqcLoading] = useState(false);

  const [dashboard, setDashboard] = useState({
    today_fqc: 0,
    today_shipped: 0,
    week_fqc: 0,
    week_shipped: 0,
    month_fqc: 0,
    month_shipped: 0,
    pending_shipment: 0,
    shipping_rate_today: 0,
    shipping_rate_week: 0,
  });

  const [showDashboard, setShowDashboard] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showRecords, setShowRecords] = useState(false);
  const [showBatchShip, setShowBatchShip] = useState(false);
  const [dashboardTab, setDashboardTab] = useState("overview");

  // Records state (with date & paging)
  const [records, setRecords] = useState([]);
  const [recordsFilter, setRecordsFilter] = useState("all");
  const [recordsFrom, setRecordsFrom] = useState("");      // default: show ALL
  const [recordsTo, setRecordsTo] = useState("");
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordsLimit, setRecordsLimit] = useState(100);   // backend max 500
  const [recordsPage, setRecordsPage] = useState(0);       // 0-based

  const [exportSettings, setExportSettings] = useState({
    from: todayStr(),
    to: todayStr(),
    type: "all",
  });

  const [batchInput, setBatchInput] = useState("");
  const [batchResults, setBatchResults] = useState(null);
  const [batchLoading, setBatchLoading] = useState(false);

  // Trend series
  const [dailyShipSeries, setDailyShipSeries] = useState([]);
  const [monthlyShipSeries, setMonthlyShipSeries] = useState([]);
  const [seriesLoading, setSeriesLoading] = useState(false);

  // Line issues
  const [issues, setIssues] = useState([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issueSubmitting, setIssueSubmitting] = useState(false);
  const [issueLine, setIssueLine] = useState("Line A");
  const [issueFilterLine, setIssueFilterLine] = useState("");
  const [issueTitle, setIssueTitle] = useState("");
  const [issueCategory, setIssueCategory] = useState("Process");
  const [issueSeverity, setIssueSeverity] = useState("medium");
  const [issueDesc, setIssueDesc] = useState("");
  const [issueImage, setIssueImage] = useState(null);
  const [showLineIssues, setShowLineIssues] = useState(false);

  // History chart
  const [historyChartData, setHistoryChartData] = useState([]);
  const [historyChartLoading, setHistoryChartLoading] = useState(false);
  const [historyGranularity, setHistoryGranularity] = useState("month"); // "day" | "month"

  // 3D chart data
  const [qc3dActivity, setQc3dActivity] = useState([]);
  const [qc3dCalendar, setQc3dCalendar] = useState([]);
  const [qc3dLoading, setQc3dLoading] = useState(false);

  const snInput = useRef(null);
  const msgTimerRef = useRef(null);

/* API calls - defined before effects that use them */
  const fetchDashboard = useCallback(async () => {
    try {
      const { data } = await api.get(`${QC_PREFIX}/dashboard`);
      setDashboard(data);
    } catch (e) {
      console.error("Dashboard fetch error:", e);
    }
  }, []);

  const fetchIssues = useCallback(async (filterLine = "") => {
    try {
      setIssuesLoading(true);
      const params = { limit: 50 };
      if (filterLine) params.line = filterLine;
      const { data } = await api.get(`${QC_PREFIX}/issues`, { params });
      setIssues(Array.isArray(data) ? data : []);
    } catch {
      clearTimeout(msgTimerRef.current);
      setMessage({ text: "Failed to load issues", type: "error" });
      msgTimerRef.current = setTimeout(() => setMessage({ text: "", type: "" }), 4000);
    } finally {
      setIssuesLoading(false);
    }
  }, []);

  const fetchQc3dData = useCallback(async () => {
    setQc3dLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        api.get(`${QC_PREFIX}/3d/activity-surface`, { params: { days: 90 } }),
        api.get(`${QC_PREFIX}/3d/calendar-surface`),
      ]);
      setQc3dActivity(r1.data.data || []);
      setQc3dCalendar(r2.data.data || []);
    } catch (e) { console.error("QC 3D fetch error:", e); }
    finally { setQc3dLoading(false); }
  }, []);

/* effects */
  useEffect(() => {
    fetchDashboard();
    const id = setInterval(fetchDashboard, 30_000);
    return () => clearInterval(id);
  }, [fetchDashboard]);

  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  const fetchSeries = async () => {
    try {
      setSeriesLoading(true);
      const { data } = await api.get(`${QC_PREFIX}/series`);
      // { month_daily_shipped:[{date,count}], year_monthly_shipped:[{month,count}] }
      const daily = (data.month_daily_shipped || []).map((d) => ({
        date: d.date,
        label: d.date.slice(5), // "MM-DD"
        shipped: d.count,
      }));
      const monthly = (data.year_monthly_shipped || []).map((m) => {
        const dt = new Date(`${m.month}-01T00:00:00`);
        const mLabel = dt.toLocaleString("en-US", { month: "short" });
        return { month: m.month, label: mLabel, shipped: m.count };
      });
      setDailyShipSeries(daily);
      setMonthlyShipSeries(monthly);
    } catch (e) {
      console.error("Series fetch error:", e);
    } finally {
      setSeriesLoading(false);
    }
  };

  // Records (status + date + paging)
  const fetchRecords = async (
    filter = recordsFilter,
    from = recordsFrom,
    to = recordsTo,
    page = recordsPage,
    limit = recordsLimit
  ) => {
    try {
      setRecordsLoading(true);
      const qp = new URLSearchParams();
      if (filter && filter !== "all") qp.set("status", filter);
      if (from) qp.set("from_date", from);
      if (to) qp.set("to_date", to);
      qp.set("limit", String(limit));
      qp.set("offset", String(page * limit));

      const { data } = await api.get(`${QC_PREFIX}/records?${qp.toString()}`);
      setRecords(data.records || []);
      setRecordsTotal(data.total || 0);
      setRecordsLimit(data.limit || limit);
      setRecordsPage(Math.floor((data.offset || 0) / (data.limit || limit)));
    } catch (e) {
      showMessage("Failed to fetch records", "error");
    } finally {
      setRecordsLoading(false);
    }
  };

  const handleScan = async () => {
    const code = sn.trim();
    if (!code || loading) return;

    setLoading(true);
    try {
      const { data } = await api.post(`${QC_PREFIX}/action`, {
        sn: code,
        action: mode === "fqc" ? "fqc_ready" : "ship",
      });

      const level =
        data.status === "warning" ? "error" : data.status === "success" ? "success" : "info";

      showMessage(data.message, level);
      setRecentScans(prev => [{
        sn: code,
        action: mode,
        status: level,
        label: data.message,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      }, ...prev].slice(0, 8));
      fetchDashboard();
      if (showDashboard) fetchSeries();
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || "Failed";
      showMessage(detail, "error");
      setRecentScans(prev => [{
        sn: code,
        action: mode,
        status: "error",
        label: detail,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      }, ...prev].slice(0, 8));
    } finally {
      setSn("");
      requestAnimationFrame(() => snInput.current?.focus());
      setLoading(false);
    }
  };

  const handleBatchCheck = async () => {
    if (!batchInput.trim() || batchLoading) return;
    setBatchLoading(true);
    setBatchResults(null);

    try {
      const sns = parseUniqueSerialNumbers(batchInput);

      if (sns.length === 0) {
        showMessage("No valid serial numbers found", "error");
        return;
      }

      const { data } = await api.post(`${QC_PREFIX}/batch-ship-check`, { sns });

      const categorized = {
        ready: data.results.filter((r) => r.status === "ready_to_ship"),
        notFound: data.results.filter((r) => r.status === "not_found"),
        notReady: data.results.filter((r) => r.status === "not_ready"),
        alreadyShipped: data.results.filter((r) => r.status === "already_shipped"),
      };

      setBatchResults({
        total: sns.length,
        ...categorized,
      });
    } catch (e) {
      showMessage("Batch check failed", "error");
    } finally {
      setBatchLoading(false);
    }
  };

  const handleBatchShip = async () => {
    if (!batchResults || batchResults.ready.length === 0) return;
    setBatchLoading(true);

    try {
      const { data } = await api.post(`${QC_PREFIX}/batch-ship`, {
        sns: batchResults.ready.map((r) => r.sn),
      });

      showMessage(data.message, "success");
      fetchDashboard();
      if (showDashboard) fetchSeries();
      setShowBatchShip(false);
      setBatchInput("");
      setBatchResults(null);
    } catch (e) {
      showMessage("Batch shipping failed", "error");
    } finally {
      setBatchLoading(false);
    }
  };

  const handleBatchExportPcba = async () => {
    const input = batchInput.trim();
    if (!input) {
      showMessage("Please paste serial numbers first", "error");
      return;
    }

    try {
      // 解析輸入的序號
      const sns = parseUniqueSerialNumbers(input);

      if (sns.length === 0) {
        showMessage("No valid serial numbers found", "error");
        return;
      }

      // 調用 Export API
      const { data, headers } = await api.post(
        `${QC_PREFIX}/batch-export-pcba`,
        { sns },
        { responseType: "blob" }
      );

      // 解析檔案名稱
      let filename = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${sns.length}.xlsx`;
      const cd = headers["content-disposition"];
      if (cd) {
        const match = cd.match(/filename\*=UTF-8''([^;]+)|filename="?([^"]+)"?/);
        filename = decodeURIComponent((match && (match[1] || match[2])) || filename);
      }

      // 檢查是否有缺失的 SN
      const missingCount = headers["x-missing-count"];
      const foundCount = headers["x-found-count"];
      const totalCount = headers["x-total-count"];

      // 下載文件
      downloadBlob(data, filename);

      // 根據是否有缺失的 SN 顯示不同的消息
      if (missingCount && parseInt(missingCount) > 0) {
        showMessage(
          `Export completed: ${foundCount}/${totalCount} SNs found. ${missingCount} SN(s) not found in database - check "Missing_SNs" sheet.`,
          "warning"
        );
      } else {
        showMessage(`PCBA data exported: ${sns.length} serial numbers`, "success");
      }
    } catch (e) {
      let errorMsg = "Export failed";
      if (e?.response?.status === 404) {
        errorMsg = "No matching records found in assembly database";
      } else if (e?.response?.status === 403) {
        errorMsg = "Access Denied: Admin or QC role required";
      } else if (e?.response?.data?.detail) {
        errorMsg = e.response.data.detail;
      }
      showMessage(errorMsg, "error");
    }
  };

  const handleBatchFqcCheck = async () => {
    if (!batchFqcInput.trim() || batchFqcLoading) return;
    setBatchFqcLoading(true);
    setBatchFqcResults(null);
    try {
      const sns = parseUniqueSerialNumbers(batchFqcInput);
      if (sns.length === 0) {
        showMessage("No valid serial numbers found", "error");
        return;
      }
      const { data } = await api.post(`${QC_PREFIX}/batch-fqc-check`, { sns });
      const categorized = {
        readyForFqc: data.results.filter((r) => r.status === "ready_for_fqc"),
        notFound: data.results.filter((r) => r.status === "not_found"),
        alreadyFqc: data.results.filter((r) => r.status === "already_fqc"),
        alreadyShipped: data.results.filter((r) => r.status === "already_shipped"),
      };
      setBatchFqcResults({ total: sns.length, ...categorized });
    } catch (e) {
      showMessage("Batch check failed", "error");
    } finally {
      setBatchFqcLoading(false);
    }
  };

  const handleBatchFqcMark = async () => {
    if (!batchFqcResults || batchFqcResults.readyForFqc.length === 0) return;
    setBatchFqcLoading(true);
    try {
      const { data } = await api.post(`${QC_PREFIX}/batch-fqc`, {
        sns: batchFqcResults.readyForFqc.map((r) => r.sn),
      });
      showMessage(data.message, "success");
      fetchDashboard();
      if (showDashboard) fetchSeries();
      setShowBatchFqc(false);
      setBatchFqcInput("");
      setBatchFqcResults(null);
    } catch (e) {
      showMessage("Batch FQC marking failed", "error");
    } finally {
      setBatchFqcLoading(false);
    }
  };

  const deleteRecord = async (sn) => {
    if (!window.confirm(`Delete record for ${sn}?`)) return;
    try {
      await api.delete(`${QC_PREFIX}/delete/${sn}`);
      showMessage("Record deleted", "success");
      fetchRecords(recordsFilter, recordsFrom, recordsTo, recordsPage, recordsLimit);
      fetchDashboard();
      if (showDashboard) fetchSeries();
    } catch {
      showMessage("Delete failed", "error");
    }
  };

/* Export (blob download) */
  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "export.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleExport = async () => {
    try {
      const qs = new URLSearchParams({
        from_date: exportSettings.from,
        to_date: exportSettings.to,
        export_type: exportSettings.type, // all | fqc_only | shipped_only
      }).toString();

      const { data, headers } = await api.get(`${QC_PREFIX}/export?${qs}`, {
        responseType: "blob",
      });

      let filename = "qc_export.xlsx";
      const cd = headers["content-disposition"];
      if (cd) {
        const m = cd.match(/filename\*=UTF-8''([^;]+)|filename="?([^"]+)"?/);
        filename = decodeURIComponent((m && (m[1] || m[2])) || filename);
      }

      downloadBlob(data, filename);
      setShowExport(false);
      showMessage("Export completed", "success");
    } catch (err) {
      try {
        const text = await err?.response?.data?.text?.();
        showMessage(text || "Export failed", "error");
      } catch {
        showMessage("Export failed", "error");
      }
    }
  };

  const handleIssueImage = (file) => {
    if (!file) {
      setIssueImage(null);
      return;
    }
    const MAX_BYTES = 1.5 * 1024 * 1024; // 1.5 MB
    if (file.size > MAX_BYTES) {
      showMessage("Image too large (max 1.5 MB). Please compress before uploading.", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => setIssueImage(e.target.result);
    reader.readAsDataURL(file);
  };

  const resetIssueForm = () => {
    setIssueTitle("");
    setIssueDesc("");
    setIssueCategory("Process");
    setIssueSeverity("medium");
    setIssueImage(null);
  };

  const submitIssue = async () => {
    if (!issueLine || !issueTitle.trim() || !issueDesc.trim()) {
      showMessage("Line, title, and description are required", "error");
      return;
    }
    if (issueSubmitting) return;
    setIssueSubmitting(true);
    try {
      const payload = {
        line: issueLine,
        title: issueTitle.trim(),
        description: issueDesc.trim(),
        category: issueCategory,
        severity: issueSeverity,
        image_path: issueImage,
      };
      const { data } = await api.post(`${QC_PREFIX}/issues`, payload);
      setIssues((prev) => [data, ...prev].slice(0, 50));
      showMessage("Issue logged", "success");
      resetIssueForm();
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || "Failed to log issue";
      showMessage(detail, "error");
    } finally {
      setIssueSubmitting(false);
    }
  };

  const deleteIssue = async (id) => {
    if (!window.confirm("Delete this issue record?")) return;
    try {
      await api.delete(`${QC_PREFIX}/issues/${id}`);
      setIssues((prev) => prev.filter((i) => i.id !== id));
      showMessage("Issue deleted", "success");
    } catch {
      showMessage("Failed to delete issue", "error");
    }
  };

  const fetchHistoryChart = async (from = "", to = "") => {
    try {
      setHistoryChartLoading(true);
      const params = {};
      if (from) params.from_date = from;
      if (to)   params.to_date   = to;
      const { data } = await api.get(`${QC_PREFIX}/history-chart`, { params });
      setHistoryChartData(data.daily || []);
      setHistoryGranularity(data.granularity || "day");
    } catch (e) {
      console.error("History chart fetch error:", e);
    } finally {
      setHistoryChartLoading(false);
    }
  };

/* helpers */
  const showMessage = (text, type = "info") => {
    clearTimeout(toastTimerRef.current);
    setToast({ text, type, visible: true });
    toastTimerRef.current = setTimeout(() => setToast(t => ({ ...t, visible: false })), 3500);
  };

  // Pagination helpers
  const totalPages = Math.max(1, Math.ceil(recordsTotal / recordsLimit));
  const canPrev = recordsPage > 0;
  const canNext = recordsPage + 1 < totalPages;

  const applyRecordsFilter = () => {
    setRecordsPage(0);
    fetchRecords(recordsFilter, recordsFrom, recordsTo, 0, recordsLimit);
  };

  const clearRecordsFilter = () => {
    setRecordsFrom("");
    setRecordsTo("");
    setRecordsFilter("all");
    setRecordsPage(0);
    fetchRecords("all", "", "", 0, recordsLimit);
  };

  const modeBaseClass =
    "inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors duration-150";

  return (
    <div className="min-h-screen bg-surface-base">
      {/* Toast Notification */}
      <div
        className={`fixed top-4 right-4 z-[100] max-w-sm w-full transition-all duration-300 ${
          toast.visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2 pointer-events-none"
        }`}
      >
        {toast.text && (
          <div
            className={`flex items-start gap-3 p-4 rounded-lg shadow-xl border ${
              toast.type === "success"
                ? "bg-emerald-600 text-white border-emerald-700"
                : toast.type === "error"
                ? "bg-red-600 text-white border-red-700"
                : toast.type === "warning"
                ? "bg-signal-warn text-white border-amber-600"
                : "bg-gray-800 text-white border-gray-700"
            }`}
          >
            {toast.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0" />
            ) : toast.type === "error" ? (
              <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
            ) : toast.type === "warning" ? (
              <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
            ) : (
              <Activity className="w-5 h-5 mt-0.5 flex-shrink-0" />
            )}
            <p className="text-sm font-semibold leading-snug flex-1">{toast.text}</p>
            <button
              onClick={() => setToast(t => ({ ...t, visible: false }))}
              className="opacity-70 hover:opacity-100 transition-opacity"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Header */}
      <header className="bg-surface-panel border-b border-stroke">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Database className="w-8 h-8 text-ink-secondary mr-3" />
              <h1 className="text-xl font-semibold text-ink-primary">QC Check System</h1>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        {/* Header Bar */}
        <section className="rounded-lg bg-surface-panel border border-stroke shadow-sm p-4">
          <div className="flex flex-col lg:flex-row lg:items-center gap-4">
            <div className="flex flex-wrap items-center gap-2 flex-1">
              <span className="text-xs font-semibold uppercase tracking-[0.15em] text-emerald-400 whitespace-nowrap">QC Command Center</span>
              <span className="text-ink-muted hidden sm:inline">|</span>
              <h2 className="text-base font-bold text-ink-primary whitespace-nowrap">FQC & Shipping Control</h2>
              <div className="flex flex-wrap gap-2 ml-auto lg:ml-2">
                <button
                  onClick={() => { if (!showDashboard) fetchSeries(); setShowDashboard(true); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium shadow-sm hover:bg-emerald-700 transition-colors duration-150"
                >
                  <BarChart3 className="w-4 h-4" />
                  Dashboard
                </button>
                <button
                  onClick={() => { fetchRecords(recordsFilter, recordsFrom, recordsTo, recordsPage, recordsLimit); setShowRecords(true); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stroke bg-surface-panel text-ink-secondary text-sm font-medium hover:bg-surface-base transition-colors duration-150"
                >
                  <ClipboardList className="w-4 h-4" />
                  Records
                </button>
                <button
                  onClick={() => setShowExport(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stroke bg-surface-panel text-ink-secondary text-sm font-medium hover:bg-surface-base transition-colors duration-150"
                >
                  <Download className="w-4 h-4" />
                  Export
                </button>
                <button
                  onClick={() => { fetchIssues(); setShowLineIssues(true); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stroke bg-surface-panel text-ink-secondary text-sm font-medium hover:bg-surface-base transition-colors duration-150"
                >
                  <AlertTriangle className="w-4 h-4" />
                  Line Issues
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 w-full lg:w-auto lg:min-w-[340px]">
              <div className="rounded-lg bg-surface-panel border border-stroke px-3 py-3 shadow-sm">
                <p className="text-xs font-medium text-ink-muted mb-1.5">Today FQC</p>
                <div className="flex items-end gap-1.5">
                  <span className="text-2xl font-bold text-ink-primary">{dashboard.today_fqc}</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 mb-0.5" />
                </div>
              </div>
              <div className="rounded-lg bg-surface-panel border border-stroke px-3 py-3 shadow-sm">
                <p className="text-xs font-medium text-ink-muted mb-1.5">Today Shipped</p>
                <div className="flex items-end gap-1.5">
                  <span className="text-2xl font-bold text-ink-primary">{dashboard.today_shipped}</span>
                  <TruckIcon className="w-4 h-4 text-sky-500 mb-0.5" />
                </div>
              </div>
              <div className="rounded-lg bg-surface-panel border border-stroke px-3 py-3 shadow-sm">
                <p className="text-xs font-medium text-ink-muted mb-1.5">Pending Ship</p>
                <div className="flex items-end gap-1.5">
                  <span className={`text-2xl font-bold ${dashboard.pending_shipment > 0 ? "text-amber-400" : "text-ink-primary"}`}>{dashboard.pending_shipment}</span>
                  <Clock className={`w-4 h-4 mb-0.5 ${dashboard.pending_shipment > 0 ? "text-amber-500" : "text-stone-400"}`} />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Mode + Scan */}
        <section className={`rounded-lg bg-surface-panel shadow-sm p-6 space-y-4 border-l-4 border border-stroke transition-colors duration-200 ${
          mode === "fqc" ? "border-l-emerald-500" : "border-l-sky-500"
        }`}>
          {/* Mode toggle + rates row */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-ink-secondary">Mode</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setMode("fqc")}
                  className={`${modeBaseClass} ${
                    mode === "fqc"
                      ? "bg-emerald-600 border-emerald-600 text-white shadow-sm"
                      : "bg-surface-panel border-stroke text-ink-secondary hover:bg-surface-base"
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  FQC Ready
                </button>
                <button
                  onClick={() => setMode("shipping")}
                  className={`${modeBaseClass} ${
                    mode === "shipping"
                      ? "bg-sky-600 border-sky-600 text-white shadow-sm"
                      : "bg-surface-panel border-stroke text-ink-secondary hover:bg-surface-base"
                  }`}
                >
                  <TruckIcon className="w-4 h-4" />
                  Shipping
                </button>
              </div>
            </div>
            <div className="flex gap-2 text-xs">
              <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-surface-base border border-stroke text-ink-secondary">
                <Activity className="w-3.5 h-3.5" />
                Today {dashboard.shipping_rate_today}%
              </div>
              <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-surface-base border border-stroke text-ink-secondary">
                <TrendingUp className="w-3.5 h-3.5" />
                Week {dashboard.shipping_rate_week}%
              </div>
            </div>
          </div>

          {/* Scan + Throughput grid */}
          <div className="grid lg:grid-cols-[1.6fr,1fr] gap-5">
            {/* Left: Scan area */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-ink-primary">Scan Serial Number</p>
                  <p className="text-xs text-ink-muted">Press Enter to submit. Auto-focus after each scan.</p>
                </div>
                <div className="flex gap-2">
                  {mode === "fqc" && (
                    <button
                      onClick={() => { setBatchFqcResults(null); setBatchFqcInput(""); setShowBatchFqc(true); }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-emerald-500/30 bg-surface-panel text-emerald-400 hover:bg-signal-ok/10 transition-colors duration-150"
                    >
                      <ClipboardList className="w-4 h-4" />
                      Batch FQC
                    </button>
                  )}
                  {mode === "shipping" && (
                    <button
                      onClick={() => setShowBatchShip(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-sky-500/30 bg-surface-panel text-sky-400 hover:bg-signal-info/10 transition-colors duration-150"
                    >
                      <FileText className="w-4 h-4" />
                      Batch Ship
                    </button>
                  )}
                </div>
              </div>

              {/* Big scan input */}
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  ref={snInput}
                  value={sn}
                  onChange={(e) => setSn(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleScan()}
                  placeholder={mode === "fqc" ? "Scan or type SN for FQC..." : "Scan or type SN for Shipping..."}
                  className={`flex-1 px-4 py-4 text-base border-2 rounded-lg focus:ring-2 text-ink-primary bg-surface-panel font-mono transition-colors duration-150 ${
                    mode === "fqc"
                      ? "border-emerald-300 focus:ring-emerald-400 focus:border-emerald-500"
                      : "border-sky-300 focus:ring-sky-400 focus:border-sky-500"
                  }`}
                  autoFocus
                />
                <button
                  onClick={handleScan}
                  disabled={!sn.trim() || loading}
                  className={`px-8 py-4 rounded-lg font-bold text-white text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 ${
                    mode === "fqc" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-sky-600 hover:bg-sky-700"
                  }`}
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : mode === "fqc" ? (
                    "FQC ✓"
                  ) : (
                    "SHIP →"
                  )}
                </button>
              </div>

              {/* Recent Scans */}
              {recentScans.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide">Recent Scans</p>
                  <div className="space-y-1">
                    {recentScans.map((s, i) => (
                      <div
                        key={i}
                        className={`flex items-center gap-2.5 px-3 py-1.5 rounded-md bg-surface-panel border border-stroke-subtle border-l-2 ${
                          s.status === "success" ? "border-l-emerald-400"
                          : s.status === "error" ? "border-l-red-400"
                          : "border-l-amber-400"
                        }`}
                      >
                        {s.status === "success" ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                        ) : s.status === "error" ? (
                          <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                        )}
                        <span className="font-mono text-xs font-medium text-ink-primary truncate">{s.sn}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 font-medium ${
                          s.action === "fqc" ? "bg-signal-ok/10 text-emerald-400" : "bg-signal-info/10 text-sky-400"
                        }`}>
                          {s.action === "fqc" ? "FQC" : "SHIP"}
                        </span>
                        <span className="text-xs text-stone-400 ml-auto flex-shrink-0 tabular-nums">{s.time}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right: Throughput + Pending */}
            <div className="space-y-3">
              <div className="rounded-lg border border-stroke bg-surface-base p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-ink-primary">Throughput</p>
                  <span className="text-xs text-stone-400">{todayStr()}</span>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-stroke">
                      <th className="text-left pb-2 text-xs font-semibold text-stone-400 uppercase tracking-wide"></th>
                      <th className="text-right pb-2 text-xs font-semibold text-emerald-400 uppercase tracking-wide">FQC</th>
                      <th className="text-right pb-2 text-xs font-semibold text-sky-400 uppercase tracking-wide">Shipped</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    <tr>
                      <td className="py-2.5 text-xs font-medium text-ink-muted">Week</td>
                      <td className="py-2.5 text-right text-lg font-bold text-ink-primary">{dashboard.week_fqc}</td>
                      <td className="py-2.5 text-right text-lg font-bold text-ink-primary">{dashboard.week_shipped}</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 text-xs font-medium text-ink-muted">Month</td>
                      <td className="py-2.5 text-right text-lg font-bold text-ink-primary">{dashboard.month_fqc}</td>
                      <td className="py-2.5 text-right text-lg font-bold text-ink-primary">{dashboard.month_shipped}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Pending Shipment with CTA */}
              {dashboard.pending_shipment > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-signal-warn/10 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-400 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-amber-300">{dashboard.pending_shipment} units pending</p>
                      <p className="text-xs text-amber-400 mt-0.5">FQC passed, awaiting shipment</p>
                    </div>
                  </div>
                  {mode !== "shipping" && (
                    <button
                      onClick={() => setMode("shipping")}
                      className="w-full px-3 py-2 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors duration-150 flex items-center justify-center gap-1.5"
                    >
                      <TruckIcon className="w-4 h-4" />
                      Switch to Shipping Mode
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

      </main>

      {/* Line Issues Modal */}
      {showLineIssues && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="fixed inset-0 bg-black/50" onClick={() => setShowLineIssues(false)} />
            <div className="relative bg-surface-panel rounded-lg max-w-6xl w-full max-h-[90vh] overflow-auto shadow-xl">
              <div className="sticky top-0 bg-surface-panel border-b px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-ink-secondary">Line Findings</p>
                  <h2 className="text-xl font-semibold text-ink-primary">Log QC Issues on Line</h2>
                </div>
                <button onClick={() => setShowLineIssues(false)} className="p-1.5 hover:bg-surface-raised rounded-md">
                  <X className="w-5 h-5 text-ink-muted" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-sm text-ink-muted">Log line issues with photos and line tags for smoother follow-up.</p>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Form */}
                  <div className="space-y-4 rounded-lg border border-stroke bg-surface-base p-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-ink-secondary mb-1">Line</label>
                        <select
                          value={issueLine}
                          onChange={(e) => setIssueLine(e.target.value)}
                          className="w-full px-3 py-2 border border-stroke rounded-md text-sm focus:ring-emerald-500 focus:border-emerald-500"
                        >
                          {["Line A", "Line B", "Line C", "Module", "Assembly", "Shipping"].map((l) => (
                            <option key={l} value={l}>{l}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ink-secondary mb-1">Severity</label>
                        <select
                          value={issueSeverity}
                          onChange={(e) => setIssueSeverity(e.target.value)}
                          className="w-full px-3 py-2 border border-stroke rounded-md text-sm focus:ring-emerald-500 focus:border-emerald-500"
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="critical">Critical</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-ink-secondary mb-1">Category</label>
                        <select
                          value={issueCategory}
                          onChange={(e) => setIssueCategory(e.target.value)}
                          className="w-full px-3 py-2 border border-stroke rounded-md text-sm focus:ring-emerald-500 focus:border-emerald-500"
                        >
                          <option value="Process">Process</option>
                          <option value="Material">Material</option>
                          <option value="Equipment">Equipment</option>
                          <option value="Documentation">Documentation</option>
                          <option value="Others">Others</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-ink-secondary mb-1">Title</label>
                        <input
                          value={issueTitle}
                          onChange={(e) => setIssueTitle(e.target.value)}
                          placeholder="Short summary"
                          className="w-full px-3 py-2 border border-stroke rounded-md text-sm focus:ring-emerald-500 focus:border-emerald-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-ink-secondary mb-1">Description</label>
                      <textarea
                        value={issueDesc}
                        onChange={(e) => setIssueDesc(e.target.value)}
                        placeholder="What happened? Impact? Immediate action?"
                        rows={4}
                        className="w-full px-3 py-2 border border-stroke rounded-md text-sm focus:ring-emerald-500 focus:border-emerald-500 text-ink-primary"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-center">
                      <div>
                        <label className="block text-sm font-medium text-ink-secondary mb-1">Attach Photo (optional)</label>
                        <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-stroke rounded-md text-sm text-ink-secondary cursor-pointer hover:border-emerald-400">
                          <Image className="w-4 h-4" />
                          <span>{issueImage ? "Change file" : "Upload file"}</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => handleIssueImage(e.target.files?.[0])}
                          />
                        </label>
                        <p className="text-xs text-ink-muted mt-1">JPG/PNG, max 1.5 MB. Stored as base64 for quick preview.</p>
                      </div>
                      {issueImage && (
                        <div className="border rounded-md p-2 bg-surface-panel">
                          <p className="text-xs text-ink-secondary mb-1">Preview</p>
                          <img src={issueImage} alt="Issue" className="max-h-32 object-cover rounded" />
                        </div>
                      )}
                    </div>

                    <div className="flex gap-3">
                      <button
                        onClick={submitIssue}
                        disabled={issueSubmitting}
                        className="px-4 py-2 rounded-md text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {issueSubmitting ? <Loader2 className="w-4 h-4 animate-spin inline" /> : "Save Issue"}
                      </button>
                      <button
                        onClick={resetIssueForm}
                        className="px-4 py-2 rounded-md text-sm font-medium border border-stroke bg-surface-panel hover:bg-surface-base text-ink-secondary"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {/* List */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-ink-primary">Recent Issues</h3>
                      <div className="flex items-center gap-2">
                        <select
                          value={issueFilterLine}
                          onChange={(e) => {
                            setIssueFilterLine(e.target.value);
                            fetchIssues(e.target.value);
                          }}
                          className="px-2 py-1 text-xs border border-stroke rounded-md bg-surface-panel text-ink-secondary focus:ring-emerald-500 focus:border-emerald-500"
                        >
                          <option value="">All Lines</option>
                          {["Line A","Line B","Line C","Module","Assembly","Shipping"].map(l => (
                            <option key={l} value={l}>{l}</option>
                          ))}
                        </select>
                        <span className="text-xs text-ink-muted">Latest 50</span>
                      </div>
                    </div>
                    <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                      {issuesLoading ? (
                        <div className="flex items-center gap-2 text-sm text-ink-secondary">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Loading...
                        </div>
                      ) : issues.length === 0 ? (
                        <p className="text-sm text-ink-secondary">No issues logged yet.</p>
                      ) : (
                        issues.map((it) => (
                          <div key={it.id} className="border border-stroke rounded-lg p-3 bg-surface-panel shadow-sm">
                            <div className="flex items-start justify-between">
                              <div>
                                <p className="text-sm font-semibold text-ink-primary">{it.title}</p>
                                <p className="text-xs text-ink-muted">{it.line}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded text-xs font-semibold bg-surface-raised text-ink-secondary">
                                  {it.category || "N/A"}
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                    it.severity === "critical"
                                      ? "bg-signal-error/15 text-red-400"
                                      : it.severity === "high"
                                      ? "bg-signal-warn/15 text-orange-400"
                                      : it.severity === "medium"
                                      ? "bg-signal-warn/15 text-amber-400"
                                      : "bg-signal-ok/15 text-emerald-400"
                                  }`}
                                >
                                  {it.severity || "low"}
                                </span>
                                <button
                                  onClick={() => deleteIssue(it.id)}
                                  className="p-1 text-ink-muted hover:text-red-400 transition-colors"
                                  title="Delete issue"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                            <p className="mt-2 text-sm text-ink-secondary whitespace-pre-line">{it.description}</p>
                            <div className="mt-2 flex items-center text-xs text-ink-muted gap-2">
                              <Calendar className="w-3.5 h-3.5" />
                              <span>{it.created_at ? new Date(it.created_at).toLocaleString() : ""}</span>
                              {it.created_by && <span>by {it.created_by}</span>}
                            </div>
                            {it.image_path && (
                              <div className="mt-2">
                                <img src={it.image_path} alt="attachment" className="max-h-40 rounded border" />
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dashboard Modal */}
      {showDashboard && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="fixed inset-0 bg-black/50" onClick={() => setShowDashboard(false)} />

            <div className="relative bg-surface-panel rounded-lg max-w-5xl w-full max-h-[90vh] overflow-auto">
              <div className="sticky top-0 bg-surface-panel border-b px-6 pt-4 pb-0 z-10">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xl font-semibold text-ink-primary">FQC Dashboard</h2>
                  <button onClick={() => setShowDashboard(false)} className="p-2 hover:bg-surface-raised rounded-lg">
                    <X className="w-5 h-5 text-ink-muted" />
                  </button>
                </div>
                <div className="flex gap-0">
                  {[
                    { key: "overview", label: "Overview",    Icon: BarChart3 },
                    { key: "history",  label: "History",     Icon: FileText  },
                    { key: "3d",       label: "3D Analysis", Icon: Box       },
                  ].map(({ key, label, Icon }) => (
                    <button
                      key={key}
                      onClick={() => {
                        setDashboardTab(key);
                        if (key === "history") {
                          setRecordsFrom(""); setRecordsTo("");
                          setRecordsFilter("all"); setRecordsPage(0);
                          fetchRecords("all", "", "", 0, 100);
                          fetchHistoryChart("", "");
                        }
                        if (key === "3d") fetchQc3dData();
                      }}
                      className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors duration-150 ${
                        dashboardTab === key
                          ? "border-teal-600 text-teal-400"
                          : "border-transparent text-ink-muted hover:text-ink-secondary"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {dashboardTab === "overview" && (
              <div className="p-5 space-y-5">
                {/* Stats table */}
                <div className="border border-stroke rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-surface-base border-b border-stroke">
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-ink-muted uppercase tracking-wide w-28">Period</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-emerald-400 uppercase tracking-wide">FQC Ready</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-sky-400 uppercase tracking-wide">Shipped</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-ink-muted uppercase tracking-wide">Ship Rate</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-amber-400 uppercase tracking-wide hidden sm:table-cell">Pending</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stroke-subtle">
                      <tr className="hover:bg-surface-base transition-colors">
                        <td className="px-4 py-3 font-medium text-ink-secondary flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-ink-muted" />Today</td>
                        <td className="px-4 py-3 text-right font-bold text-emerald-400 text-lg">{dashboard.today_fqc}</td>
                        <td className="px-4 py-3 text-right font-bold text-sky-400 text-lg">{dashboard.today_shipped}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`text-sm font-semibold ${dashboard.shipping_rate_today >= 80 ? "text-emerald-400" : dashboard.shipping_rate_today >= 50 ? "text-amber-400" : "text-red-400"}`}>{dashboard.shipping_rate_today}%</span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-amber-400 hidden sm:table-cell">{dashboard.pending_shipment}</td>
                      </tr>
                      <tr className="hover:bg-surface-base transition-colors">
                        <td className="px-4 py-3 font-medium text-ink-secondary flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5 text-ink-muted" />This Week</td>
                        <td className="px-4 py-3 text-right font-bold text-emerald-400 text-lg">{dashboard.week_fqc}</td>
                        <td className="px-4 py-3 text-right font-bold text-sky-400 text-lg">{dashboard.week_shipped}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`text-sm font-semibold ${dashboard.shipping_rate_week >= 80 ? "text-emerald-400" : dashboard.shipping_rate_week >= 50 ? "text-amber-400" : "text-red-400"}`}>{dashboard.shipping_rate_week}%</span>
                        </td>
                        <td className="px-4 py-3 text-right text-ink-muted text-sm hidden sm:table-cell">—</td>
                      </tr>
                      <tr className="hover:bg-surface-base transition-colors">
                        <td className="px-4 py-3 font-medium text-ink-secondary flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-ink-muted" />This Month</td>
                        <td className="px-4 py-3 text-right font-bold text-emerald-400 text-lg">{dashboard.month_fqc}</td>
                        <td className="px-4 py-3 text-right font-bold text-sky-400 text-lg">{dashboard.month_shipped}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`text-sm font-semibold ${dashboard.month_fqc > 0 ? (Math.round(dashboard.month_shipped/dashboard.month_fqc*100) >= 80 ? "text-emerald-400" : "text-amber-400") : "text-ink-muted"}`}>
                            {dashboard.month_fqc > 0 ? Math.round(dashboard.month_shipped / dashboard.month_fqc * 100) : 0}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-ink-muted text-sm hidden sm:table-cell">—</td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr className="bg-surface-base border-t border-stroke">
                        <td className="px-4 py-2 text-xs text-ink-muted font-medium">Avg daily output</td>
                        <td className="px-4 py-2 text-right text-xs text-ink-secondary font-semibold" colSpan={4}>{Math.round(dashboard.week_fqc / 5)} units/day (this week)</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Charts — side by side on lg */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="border border-stroke rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide">Daily Shipped</p>
                        <p className="text-xs text-ink-muted">This month</p>
                      </div>
                      {seriesLoading && <Loader2 className="w-4 h-4 animate-spin text-ink-muted" />}
                    </div>
                    <div className="h-52">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={dailyShipSeries} barSize={8}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2e3650" />
                          <XAxis dataKey="label" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} interval={4} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={28} />
                          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 4, border: "1px solid #2e3650", background: "#262d42" }} />
                          <Bar dataKey="shipped" name="Shipped" fill="#0ea5e9" radius={[2, 2, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="border border-stroke rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide">Monthly Shipped</p>
                        <p className="text-xs text-ink-muted">This year</p>
                      </div>
                      {seriesLoading && <Loader2 className="w-4 h-4 animate-spin text-ink-muted" />}
                    </div>
                    <div className="h-52">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={monthlyShipSeries}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2e3650" />
                          <XAxis dataKey="label" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={28} />
                          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 4, border: "1px solid #2e3650", background: "#262d42" }} />
                          <Line type="monotone" dataKey="shipped" name="Shipped" stroke="#0d9488" strokeWidth={2} dot={{ r: 3, fill: "#0d9488" }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </div>
              )}

              {dashboardTab === "3d" && (
                <div className="p-5 space-y-5">
                  {qc3dLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-3">
                      <Loader2 className="w-7 h-7 animate-spin text-teal-400" />
                      <p className="text-sm text-stone-400">Loading 3D charts…</p>
                    </div>
                  ) : (
                    <>
                      {/* Chart 1: FQC Activity Surface */}
                      <div className="bg-surface-panel border border-stroke rounded-xl p-4 shadow-sm">
                        <div className="flex items-center gap-2 mb-1">
                          <Box className="w-4 h-4 text-teal-400" />
                          <span className="text-sm font-semibold text-ink-secondary">FQC Activity — Hour × Day-of-Week (Last 90 Days)</span>
                        </div>
                        <p className="text-xs text-stone-400 mb-3 pl-6">Shows when QC operators scan the most units — peaks identify shift patterns</p>
                        {qc3dActivity.length > 0 ? (
                          <Plot3D
                            data={[{
                              type: "surface",
                              ...buildHourDowMatrix(qc3dActivity, "fqc_count"),
                              colorscale: [
                                [0,   "#f0fdf4"],
                                [0.2, "#86efac"],
                                [0.5, "#22c55e"],
                                [0.8, "#15803d"],
                                [1,   "#14532d"],
                              ],
                              showscale: true,
                              hovertemplate: "Hour %{x}<br>%{y}<br>FQC: <b>%{z}</b><extra></extra>",
                            }]}
                            height={420}
                            xTitle="Hour (Pacific)"
                            yTitle="Day of Week"
                            zTitle="FQC Count"
                          />
                        ) : (
                          <p className="text-xs text-stone-400 text-center py-10">No FQC activity data in the last 90 days</p>
                        )}
                      </div>

                      {/* Chart 2: Monthly Shipping Calendar */}
                      <div className="bg-surface-panel border border-stroke rounded-xl p-4 shadow-sm">
                        <div className="flex items-center gap-2 mb-1">
                          <Box className="w-4 h-4 text-sky-400" />
                          <span className="text-sm font-semibold text-ink-secondary">Shipping Calendar — Day of Month × Month (All-time)</span>
                        </div>
                        <p className="text-xs text-stone-400 mb-3 pl-6">Calendar heatmap showing shipment density — spot month-end rushes and seasonal patterns</p>
                        {qc3dCalendar.length > 0 ? (() => {
                          const { z, x, y } = buildCalendarMatrix(qc3dCalendar);
                          return (
                            <Plot3D
                              data={[{
                                type: "surface",
                                z, x, y,
                                colorscale: [
                                  [0,   "#f0f9ff"],
                                  [0.3, "#7dd3fc"],
                                  [0.6, "#0284c7"],
                                  [1,   "#0c4a6e"],
                                ],
                                showscale: true,
                                hovertemplate: "Day %{x}<br>%{y}<br>Shipped: <b>%{z}</b><extra></extra>",
                              }]}
                              height={420}
                              xTitle="Day of Month"
                              yTitle="Month"
                              zTitle="Shipped"
                            />
                          );
                        })() : (
                          <p className="text-xs text-stone-400 text-center py-10">No shipping data available</p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {dashboardTab === "history" && (
                <div className="p-6 space-y-4">
                  {/* Quick date ranges */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-ink-muted uppercase tracking-wide">Range:</span>
                    {[
                      { label: "Today",      f: () => todayStr(),       t: () => todayStr() },
                      { label: "Yesterday",  f: () => yesterdayStr(),   t: () => yesterdayStr() },
                      { label: "This Week",  f: () => thisWeekStart(),  t: () => todayStr() },
                      { label: "This Month", f: () => firstDayOfMonth(),t: () => todayStr() },
                      { label: "All",        f: () => "",               t: () => "" },
                    ].map(({ label, f, t }) => (
                      <button key={label} onClick={() => {
                        const from = f(), to = t();
                        setRecordsFrom(from); setRecordsTo(to);
                        setRecordsFilter("all"); setRecordsPage(0);
                        fetchRecords("all", from, to, 0, 100);
                        fetchHistoryChart(from, to);
                      }}
                        className="px-3 py-1 text-xs rounded-lg border border-stroke bg-surface-panel hover:bg-teal-500/10 hover:border-teal-300 text-ink-secondary hover:text-teal-400 transition-colors duration-150">
                        {label}
                      </button>
                    ))}
                    <select
                      value={recordsFilter}
                      onChange={(e) => { setRecordsFilter(e.target.value); setRecordsPage(0); fetchRecords(e.target.value, recordsFrom, recordsTo, 0, 100); }}
                      className="ml-1 px-2 py-1 text-xs border border-stroke rounded-lg bg-surface-panel text-ink-secondary focus:ring-teal-500 focus:border-teal-500"
                    >
                      <option value="all">All Status</option>
                      <option value="pending">Pending</option>
                      <option value="shipped">Shipped</option>
                    </select>
                  </div>

                  {/* History chart: FQC Ready vs Shipped */}
                  <div className="bg-surface-panel border border-stroke rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-semibold text-ink-secondary">FQC Ready vs Shipped ({historyGranularity === "month" ? "Monthly" : "Daily"})</span>
                      {historyChartLoading && <Loader2 className="w-4 h-4 animate-spin text-ink-muted" />}
                    </div>
                    {historyChartData.length === 0 && !historyChartLoading ? (
                      <p className="text-xs text-ink-muted text-center py-6">No data for selected range</p>
                    ) : (
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={historyChartData} barGap={2}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2e3650" />
                            <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} />
                            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                            <Tooltip contentStyle={{ fontSize: 12, background: "#262d42", border: "1px solid #2e3650" }} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Bar dataKey="fqc_ready" name="FQC Ready" fill="#0d9488" radius={[2,2,0,0]} />
                            <Bar dataKey="shipped"   name="Shipped"   fill="#0ea5e9" radius={[2,2,0,0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>

                  {/* Records table */}
                  <div className="border border-stroke rounded-lg overflow-hidden">
                    <div className="overflow-y-auto" style={{ maxHeight: "400px" }}>
                      <table className="w-full text-xs">
                        <thead className="bg-surface-base sticky top-0 z-10">
                          <tr className="border-b border-stroke">
                            <th className="px-4 py-2 text-left font-semibold text-ink-muted uppercase tracking-wide">Serial Number</th>
                            <th className="px-4 py-2 text-left font-semibold text-ink-muted uppercase tracking-wide">FQC Ready</th>
                            <th className="px-4 py-2 text-left font-semibold text-ink-muted uppercase tracking-wide">Shipped</th>
                            <th className="px-4 py-2 text-left font-semibold text-ink-muted uppercase tracking-wide">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stroke-subtle">
                          {recordsLoading ? (
                            <tr>
                              <td colSpan={4} className="px-4 py-8 text-center text-ink-muted">
                                <div className="inline-flex items-center gap-2">
                                  <Loader2 className="w-4 h-4 animate-spin" />Loading...
                                </div>
                              </td>
                            </tr>
                          ) : records.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="px-4 py-8 text-center text-ink-muted">No records found</td>
                            </tr>
                          ) : records.map((r, i) => (
                            <tr key={buildQcRowKey(r, i)} className="hover:bg-surface-base transition-colors">
                              <td className="px-4 py-2 font-mono font-medium text-ink-primary">{r.sn}</td>
                              <td className="px-4 py-2 text-ink-muted">{r.fqc_ready_at ? new Date(r.fqc_ready_at).toLocaleString() : "—"}</td>
                              <td className="px-4 py-2 text-ink-muted">{r.shipped_at ? new Date(r.shipped_at).toLocaleString() : "—"}</td>
                              <td className="px-4 py-2">
                                <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                  r.status === "Shipped" ? "bg-signal-info/15 text-cyan-300" :
                                  r.status === "Pending" ? "bg-signal-warn/15 text-amber-300" :
                                  "bg-surface-raised text-ink-secondary"
                                }`}>{r.status}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Pagination */}
                  <div className="flex items-center justify-between text-xs text-ink-muted">
                    <span>
                      Showing <span className="font-medium text-ink-secondary">{records.length}</span> of{" "}
                      <span className="font-medium text-ink-secondary">{recordsTotal}</span> records
                      {(recordsFrom || recordsTo) && (
                        <span className="ml-2 text-ink-muted">({recordsFrom || "..."} → {recordsTo || "now"})</span>
                      )}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        disabled={!canPrev}
                        onClick={() => { const p = recordsPage - 1; setRecordsPage(p); fetchRecords(recordsFilter, recordsFrom, recordsTo, p, 100); }}
                        className={`px-2 py-1 rounded border transition-colors ${canPrev ? "bg-surface-panel hover:bg-surface-base border-stroke text-ink-secondary" : "bg-surface-base text-ink-muted border-stroke-subtle cursor-not-allowed"}`}
                      >Prev</button>
                      <span>{recordsPage + 1} / {Math.max(1, Math.ceil(recordsTotal / 100))}</span>
                      <button
                        disabled={!canNext}
                        onClick={() => { const p = recordsPage + 1; setRecordsPage(p); fetchRecords(recordsFilter, recordsFrom, recordsTo, p, 100); }}
                        className={`px-2 py-1 rounded border transition-colors ${canNext ? "bg-surface-panel hover:bg-surface-base border-stroke text-ink-secondary" : "bg-surface-base text-ink-muted border-stroke-subtle cursor-not-allowed"}`}
                      >Next</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {showExport && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="fixed inset-0 bg-black/50" onClick={() => setShowExport(false)} />

            <div className="relative bg-surface-panel rounded-lg max-w-md w-full">
              <div className="border-b px-6 py-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-ink-primary">Export Records</h2>
                  <button onClick={() => setShowExport(false)} className="p-1.5 hover:bg-surface-raised rounded-md">
                    <X className="w-5 h-5 text-ink-muted" />
                  </button>
                </div>
              </div>

              <div className="p-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-ink-secondary mb-1">From Date</label>
                    <input
                      type="date"
                      value={exportSettings.from}
                      onChange={(e) => setExportSettings({ ...exportSettings, from: e.target.value })}
                      className="w-full px-3 py-2 border border-stroke rounded-md focus:ring-teal-500 focus:border-teal-500 text-ink-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink-secondary mb-1">To Date</label>
                    <input
                      type="date"
                      value={exportSettings.to}
                      onChange={(e) => setExportSettings({ ...exportSettings, to: e.target.value })}
                      className="w-full px-3 py-2 border border-stroke rounded-md focus:ring-teal-500 focus:border-teal-500 text-ink-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink-secondary mb-1">Export Type</label>
                    <select
                      value={exportSettings.type}
                      onChange={(e) => setExportSettings({ ...exportSettings, type: e.target.value })}
                      className="w-full px-3 py-2 border border-stroke rounded-md focus:ring-teal-500 focus:border-teal-500 text-ink-primary"
                    >
                      <option value="all">All Records</option>
                      <option value="fqc_only">FQC Ready Only</option>
                      <option value="shipped_only">Shipped Only</option>
                    </select>
                  </div>
                </div>

                <div className="mt-6 flex gap-3">
                  <button
                    onClick={handleExport}
                    className="flex-1 inline-flex justify-center items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 transition-colors duration-150"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export
                  </button>
                  <button
                    onClick={() => setShowExport(false)}
                    className="flex-1 px-4 py-2 border border-stroke rounded-md text-sm font-medium text-ink-secondary bg-surface-panel hover:bg-surface-base focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Records Modal */}
      {showRecords && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowRecords(false)} />
          <div className="relative bg-surface-panel rounded-lg w-full max-w-5xl max-h-[92vh] flex flex-col shadow-xl">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-stroke flex-shrink-0">
              <div>
                <h2 className="text-base font-semibold text-ink-primary">QC Records</h2>
                <p className="text-xs text-ink-muted mt-0.5">Total: <span className="font-medium text-ink-secondary">{recordsTotal}</span> records</p>
              </div>
              <button onClick={() => setShowRecords(false)} className="p-1.5 hover:bg-surface-raised rounded-md">
                <X className="w-4 h-4 text-ink-muted" />
              </button>
            </div>

            {/* Filter bar */}
            <div className="px-5 py-3 border-b border-stroke-subtle bg-surface-base flex-shrink-0">
              <div className="flex flex-wrap items-center gap-2">
                {/* Quick date chips */}
                {[
                  { label: "Today",    from: todayStr,        to: todayStr },
                  { label: "Yesterday",from: yesterdayStr,    to: yesterdayStr },
                  { label: "This Week",from: thisWeekStart,   to: todayStr },
                  { label: "This Month",from: firstDayOfMonth,to: todayStr },
                  { label: "All",      from: () => "",        to: () => "" },
                ].map(({ label, from, to }) => (
                  <button
                    key={label}
                    onClick={() => { const f=from(),t=to(); setRecordsFrom(f); setRecordsTo(t); setRecordsFilter("all"); setRecordsPage(0); fetchRecords("all",f,t,0,recordsLimit); }}
                    className={`px-2.5 py-1 text-xs rounded-md border transition-colors duration-100 ${
                      (label === "Today" && recordsFrom === todayStr() && recordsTo === todayStr()) ||
                      (label === "All" && !recordsFrom && !recordsTo)
                        ? "bg-teal-600 text-white border-teal-600"
                        : "bg-surface-panel text-ink-secondary border-stroke hover:border-teal-400 hover:text-teal-400"
                    }`}
                  >{label}</button>
                ))}

                <span className="text-ink-muted select-none">|</span>

                <select
                  value={recordsFilter}
                  onChange={(e) => { setRecordsFilter(e.target.value); setRecordsPage(0); fetchRecords(e.target.value,recordsFrom,recordsTo,0,recordsLimit); }}
                  className="px-2.5 py-1 text-xs border border-stroke rounded-md bg-surface-panel text-ink-secondary focus:ring-1 focus:ring-teal-500"
                >
                  <option value="all">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="shipped">Shipped</option>
                </select>

                <input type="date" value={recordsFrom||""} onChange={(e)=>setRecordsFrom(e.target.value)}
                  className="px-2 py-1 text-xs border border-stroke rounded-md text-ink-secondary focus:ring-1 focus:ring-teal-500" />
                <span className="text-ink-muted text-xs">—</span>
                <input type="date" value={recordsTo||""} onChange={(e)=>setRecordsTo(e.target.value)}
                  className="px-2 py-1 text-xs border border-stroke rounded-md text-ink-secondary focus:ring-1 focus:ring-teal-500" />

                <button onClick={applyRecordsFilter} className="px-3 py-1 text-xs rounded-md bg-teal-600 text-white hover:bg-teal-700 font-medium transition-colors">Apply</button>
                <button onClick={clearRecordsFilter} className="px-3 py-1 text-xs rounded-md border border-stroke bg-surface-panel text-ink-secondary hover:bg-surface-base transition-colors">Reset</button>

                <select
                  value={recordsLimit}
                  onChange={(e)=>{ const n=parseInt(e.target.value,10); setRecordsLimit(n); setRecordsPage(0); fetchRecords(recordsFilter,recordsFrom,recordsTo,0,n); }}
                  className="ml-auto px-2 py-1 text-xs border border-stroke rounded-md bg-surface-panel text-ink-secondary"
                >
                  {[50,100,200,500].map(n=><option key={n} value={n}>{n}/page</option>)}
                </select>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-xs">
                <thead className="bg-surface-base sticky top-0 z-10">
                  <tr className="border-b border-stroke">
                    <th className="px-4 py-2.5 text-left font-semibold text-ink-muted uppercase tracking-wide w-8 text-center">#</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-ink-muted uppercase tracking-wide">Serial Number</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-ink-muted uppercase tracking-wide hidden sm:table-cell">FQC Ready</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-ink-muted uppercase tracking-wide hidden sm:table-cell">Shipped</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-ink-muted uppercase tracking-wide">Status</th>
                    <th className="px-4 py-2.5 text-center font-semibold text-ink-muted uppercase tracking-wide w-16">Del</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stroke-subtle">
                  {recordsLoading ? (
                    <tr><td colSpan={6} className="py-12 text-center text-ink-muted"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                  ) : records.length === 0 ? (
                    <tr><td colSpan={6} className="py-12 text-center text-ink-muted">No records found</td></tr>
                  ) : records.map((record, i) => (
                    <tr key={buildQcRowKey(record, i)} className="hover:bg-surface-base transition-colors">
                      <td className="px-4 py-2 text-ink-muted text-center">{recordsPage * recordsLimit + i + 1}</td>
                      <td className="px-4 py-2 font-mono font-medium text-ink-primary text-xs">{record.sn}</td>
                      <td className="px-4 py-2 text-ink-muted hidden sm:table-cell tabular-nums">
                        {record.fqc_ready_at ? new Date(record.fqc_ready_at).toLocaleString() : <span className="text-ink-muted">—</span>}
                      </td>
                      <td className="px-4 py-2 text-ink-muted hidden sm:table-cell tabular-nums">
                        {record.shipped_at ? new Date(record.shipped_at).toLocaleString() : <span className="text-ink-muted">—</span>}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${
                          record.status === "Shipped"
                            ? "bg-signal-info/15 text-sky-400"
                            : record.status === "Pending"
                            ? "bg-signal-warn/15 text-amber-400"
                            : "bg-surface-raised text-ink-secondary"
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${record.status === "Shipped" ? "bg-signal-info" : record.status === "Pending" ? "bg-signal-warn" : "bg-gray-400"}`} />
                          {record.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <button onClick={() => deleteRecord(record.sn)} className="p-1 text-ink-muted hover:text-red-500 rounded transition-colors" title="Delete">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination footer */}
            <div className="px-5 py-2.5 border-t border-stroke bg-surface-panel flex items-center justify-between flex-shrink-0">
              <span className="text-xs text-ink-muted">
                {records.length > 0 && `${recordsPage * recordsLimit + 1}–${recordsPage * recordsLimit + records.length} of ${recordsTotal}`}
              </span>
              <div className="flex items-center gap-1.5">
                <button disabled={!canPrev} onClick={()=>{ const p=recordsPage-1; setRecordsPage(p); fetchRecords(recordsFilter,recordsFrom,recordsTo,p,recordsLimit); }}
                  className="px-2.5 py-1 text-xs rounded-md border border-stroke disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-surface-base transition-colors">← Prev</button>
                <span className="text-xs text-ink-muted px-2">{recordsPage+1} / {Math.max(1,Math.ceil(recordsTotal/recordsLimit))}</span>
                <button disabled={!canNext} onClick={()=>{ const p=recordsPage+1; setRecordsPage(p); fetchRecords(recordsFilter,recordsFrom,recordsTo,p,recordsLimit); }}
                  className="px-2.5 py-1 text-xs rounded-md border border-stroke disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-surface-base transition-colors">Next →</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Batch Ship Modal */}
      {showBatchShip && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="fixed inset-0 bg-black/50" onClick={() => setShowBatchShip(false)} />

            <div className="relative bg-surface-panel rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden">
              <div className="sticky top-0 bg-surface-panel border-b px-6 py-4 z-10">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-ink-primary">Batch Shipping</h2>
                  <button onClick={() => setShowBatchShip(false)} className="p-1.5 hover:bg-surface-raised rounded-md">
                    <X className="w-5 h-5 text-ink-muted" />
                  </button>
                </div>

                {/* Operation Bar - Batch Export & Batch Ship 按鈕 */}
                <div className="mt-4 flex gap-3">
                  <button
                    onClick={handleBatchExportPcba}
                    disabled={!batchInput.trim()}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-emerald-600 rounded-lg text-sm font-semibold text-emerald-400 bg-surface-panel hover:bg-signal-ok/10 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Batch Export
                  </button>

                  <button
                    onClick={handleBatchCheck}
                    disabled={!batchInput.trim() || batchLoading}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-transparent rounded-lg text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
                  >
                    {batchLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <TruckIcon className="w-4 h-4" />
                        Batch Ship
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="p-6 overflow-y-auto" style={{ maxHeight: "calc(90vh - 140px)" }}>
                {!batchResults ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-ink-secondary mb-2">Paste Serial Numbers</label>
                      <p className="text-sm text-ink-muted mb-2">
                        Paste your serial numbers from Excel. They can be separated by newlines, spaces, commas, or tabs.
                      </p>
                      <textarea
                        value={batchInput}
                        onChange={(e) => setBatchInput(e.target.value)}
                        placeholder="Paste serial numbers here..."
                        className="w-full px-3 py-2 border border-stroke rounded-md focus:ring-teal-500 focus:border-teal-500 text-ink-primary"
                        rows={12}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Summary */}
                    <div className="bg-surface-base rounded-lg p-4">
                      <h3 className="font-semibold text-ink-primary mb-3">Batch Shipping Check Results</h3>
                      <div className="grid grid-cols-4 gap-4">
                        <div>
                          <p className="text-sm text-ink-secondary">Total SNs</p>
                          <p className="text-2xl font-bold text-ink-primary">{batchResults.total}</p>
                        </div>
                        <div>
                          <p className="text-sm text-green-400">Ready to Ship</p>
                          <p className="text-2xl font-bold text-green-400">{batchResults.ready.length}</p>
                        </div>
                        <div>
                          <p className="text-sm text-red-400">Not Ready</p>
                          <p className="text-2xl font-bold text-red-400">{batchResults.notFound.length + batchResults.notReady.length}</p>
                        </div>
                        <div>
                          <p className="text-sm text-cyan-400">Already Shipped</p>
                          <p className="text-2xl font-bold text-cyan-400">{batchResults.alreadyShipped.length}</p>
                        </div>
                      </div>
                    </div>

                    {/* Not Ready Warning */}
                    {(batchResults.notFound.length > 0 || batchResults.notReady.length > 0) && (
                      <div className="space-y-3">
                          {/* Sub-group A: never entered QC system */}
                          {batchResults.notFound.length > 0 && (
                            <div className="bg-signal-error/10 border border-red-500/30 rounded-lg p-4">
                              <div className="flex items-start gap-2 mb-3">
                                <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
                                <div>
                                  <h4 className="text-sm font-semibold text-red-300">
                                    {batchResults.notFound.length} SN(s) — Not Found in QC System
                                  </h4>
                                  <p className="text-xs text-red-400 mt-0.5">
                                    These serial numbers have never been FQC scanned. Assembly production time shown if available.
                                  </p>
                                </div>
                              </div>
                              <div className="overflow-y-auto rounded border border-red-500/30 bg-surface-panel" style={{ maxHeight: "180px" }}>
                                <table className="w-full text-xs">
                                  <thead className="bg-signal-error/10 sticky top-0">
                                    <tr>
                                      <th className="px-3 py-1.5 text-left font-semibold text-red-400 w-8">#</th>
                                      <th className="px-3 py-1.5 text-left font-semibold text-red-400">Serial Number</th>
                                      <th className="px-3 py-1.5 text-left font-semibold text-red-400">Assembly Production Time</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-red-100">
                                    {batchResults.notFound.map((r, i) => (
                                      <tr key={buildQcRowKey(r, i)} className="hover:bg-signal-error/10">
                                        <td className="px-3 py-1.5 text-red-400">{i + 1}</td>
                                        <td className="px-3 py-1.5 font-mono text-red-300">{r.sn}</td>
                                        <td className="px-3 py-1.5 text-red-400">
                                          {r.production_time
                                            ? new Date(r.production_time).toLocaleString()
                                            : <span className="italic text-red-300">Not found in assembly DB</span>}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                          {/* Sub-group B: in system but FQC not done */}
                          {batchResults.notReady.length > 0 && (
                            <div className="bg-signal-warn/10 border border-amber-500/30 rounded-lg p-4">
                              <div className="flex items-start gap-2 mb-3">
                                <AlertCircle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
                                <div>
                                  <h4 className="text-sm font-semibold text-amber-300">
                                    {batchResults.notReady.length} SN(s) — FQC Not Completed
                                  </h4>
                                  <p className="text-xs text-amber-400 mt-0.5">
                                    These serial numbers are in the system but FQC scan has not been performed.
                                  </p>
                                </div>
                              </div>
                              <div className="overflow-y-auto rounded border border-amber-500/30 bg-surface-panel" style={{ maxHeight: "180px" }}>
                                <table className="w-full text-xs">
                                  <thead className="bg-signal-warn/10 sticky top-0">
                                    <tr>
                                      <th className="px-3 py-1.5 text-left font-semibold text-amber-400 w-8">#</th>
                                      <th className="px-3 py-1.5 text-left font-semibold text-amber-400">Serial Number</th>
                                      <th className="px-3 py-1.5 text-left font-semibold text-amber-400">Entered QC System At</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-amber-100">
                                    {batchResults.notReady.map((r, i) => (
                                      <tr key={buildQcRowKey(r, i)} className="hover:bg-signal-warn/10">
                                        <td className="px-3 py-1.5 text-amber-400">{i + 1}</td>
                                        <td className="px-3 py-1.5 font-mono text-amber-300">{r.sn}</td>
                                        <td className="px-3 py-1.5 text-amber-400">
                                          {r.production_time ? new Date(r.production_time).toLocaleString() : "—"}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                    )}

                    {/* Already Shipped Info */}
                    {batchResults.alreadyShipped.length > 0 && (
                      <div className="bg-signal-info/10 border border-cyan-500/30 rounded-lg p-4">
                        <div className="flex items-start gap-2 mb-3">
                          <AlertCircle className="w-5 h-5 text-cyan-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <h4 className="text-sm font-semibold text-cyan-300">
                              {batchResults.alreadyShipped.length} SN(s) — Already Shipped
                            </h4>
                            <p className="text-xs text-cyan-400 mt-0.5">
                              These serial numbers were shipped in a previous batch.
                            </p>
                          </div>
                        </div>
                        <div className="overflow-y-auto rounded border border-cyan-500/30 bg-surface-panel" style={{ maxHeight: "150px" }}>
                          <table className="w-full text-xs">
                            <thead className="bg-signal-info/10 sticky top-0">
                              <tr>
                                <th className="px-3 py-1.5 text-left font-semibold text-cyan-400 w-8">#</th>
                                <th className="px-3 py-1.5 text-left font-semibold text-cyan-400">Serial Number</th>
                                <th className="px-3 py-1.5 text-left font-semibold text-cyan-400">Shipped At</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-cyan-100">
                              {batchResults.alreadyShipped.map((r, i) => (
                                <tr key={buildQcRowKey(r, i)} className="hover:bg-signal-info/10">
                                  <td className="px-3 py-1.5 text-cyan-400">{i + 1}</td>
                                  <td className="px-3 py-1.5 font-mono text-cyan-300">{r.sn}</td>
                                  <td className="px-3 py-1.5 text-cyan-400">
                                    {r.shipped_at ? new Date(r.shipped_at).toLocaleString() : "—"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Ready to Ship */}
                    {batchResults.ready.length > 0 && (
                      <div className="bg-signal-ok/10 border border-emerald-500/30 rounded-lg p-4">
                        <div className="flex items-start">
                          <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 mr-2 flex-shrink-0" />
                          <div className="flex-1">
                            <h4 className="text-sm font-semibold text-emerald-300 mb-2">
                              {batchResults.ready.length} serial numbers are ready to ship:
                            </h4>
                            <div className="bg-surface-panel border border-emerald-500/30 rounded-md p-3 overflow-y-auto" style={{ maxHeight: "150px" }}>
                              <p className="text-sm text-emerald-400 font-mono whitespace-pre-wrap">
                                {batchResults.ready.map((r, i) => `${i + 1}. ${r.sn}`).join("\n")}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-3 sticky bottom-0 bg-surface-panel pt-4 pb-2">
                      {batchResults.ready.length > 0 && (
                        <button
                          onClick={handleBatchShip}
                          disabled={batchLoading}
                          className="flex-1 inline-flex justify-center items-center px-4 py-2 border border-transparent rounded-lg text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
                        >
                          {batchLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <>
                              <TruckIcon className="w-4 h-4 mr-2" />
                              Ship {batchResults.ready.length} Units
                            </>
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setBatchResults(null);
                          setBatchInput("");
                        }}
                        className="px-4 py-2 border border-stroke rounded-md text-sm font-medium text-ink-secondary bg-surface-panel hover:bg-surface-base focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                      >
                        Back
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Batch FQC Modal */}
      {showBatchFqc && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="fixed inset-0 bg-black/50" onClick={() => setShowBatchFqc(false)} />
            <div className="relative bg-surface-panel rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden">
              <div className="sticky top-0 bg-surface-panel border-b px-6 py-4 z-10">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-semibold text-ink-primary">Batch FQC Check</h2>
                    <p className="text-sm text-ink-muted mt-0.5">Paste serial numbers to check if they exist in assembly or QC records</p>
                  </div>
                  <button onClick={() => setShowBatchFqc(false)} className="p-1.5 hover:bg-surface-raised rounded-md">
                    <X className="w-5 h-5 text-ink-muted" />
                  </button>
                </div>
                <div className="mt-4 flex gap-3">
                  <button
                    onClick={handleBatchFqcCheck}
                    disabled={!batchFqcInput.trim() || batchFqcLoading}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-transparent rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
                  >
                    {batchFqcLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle2 className="w-4 h-4" />Check Production Records</>}
                  </button>
                  {batchFqcResults && batchFqcResults.readyForFqc.length > 0 && (
                    <button
                      onClick={handleBatchFqcMark}
                      disabled={batchFqcLoading}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-emerald-600 rounded-lg text-sm font-semibold text-emerald-400 bg-surface-panel hover:bg-signal-ok/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {batchFqcLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle2 className="w-4 h-4" />Mark {batchFqcResults.readyForFqc.length} as FQC Ready</>}
                    </button>
                  )}
                </div>
              </div>

              <div className="p-6 overflow-y-auto" style={{ maxHeight: "calc(90vh - 160px)" }}>
                {!batchFqcResults ? (
                  <div className="space-y-3">
                    <label className="block text-sm font-medium text-ink-secondary">Paste Serial Numbers</label>
                    <p className="text-sm text-ink-muted">Separated by newlines, spaces, commas, or tabs. The system will check if each SN exists in assembly or QC records.</p>
                    <textarea
                      value={batchFqcInput}
                      onChange={(e) => setBatchFqcInput(e.target.value)}
                      placeholder="Paste serial numbers here..."
                      className="w-full px-3 py-2 border border-stroke rounded-md focus:ring-emerald-500 focus:border-emerald-500 text-ink-primary"
                      rows={14}
                      autoFocus
                    />
                  </div>
                ) : (
                  <div className="space-y-5">
                    {/* Summary */}
                    <div className="bg-surface-base rounded-lg p-4">
                      <h3 className="font-semibold text-ink-primary mb-3">Check Results — {batchFqcResults.total} SNs</h3>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <div className="text-center p-3 rounded-lg bg-signal-ok/10 border border-signal-ok/20">
                          <p className="text-xs font-semibold text-emerald-400 mb-1">Ready for FQC</p>
                          <p className="text-2xl font-bold text-emerald-300">{batchFqcResults.readyForFqc.length}</p>
                          <p className="text-xs text-emerald-400 mt-0.5">Eligible to mark</p>
                        </div>
                        <div className="text-center p-3 rounded-lg bg-signal-error/10 border border-signal-error/20">
                          <p className="text-xs font-semibold text-red-400 mb-1">Not Found</p>
                          <p className="text-2xl font-bold text-red-300">{batchFqcResults.notFound.length}</p>
                          <p className="text-xs text-red-400 mt-0.5">Missing from production/QC</p>
                        </div>
                        <div className="text-center p-3 rounded-lg bg-signal-info/10 border border-signal-info/20">
                          <p className="text-xs font-semibold text-sky-400 mb-1">Already FQC'd</p>
                          <p className="text-2xl font-bold text-sky-300">{batchFqcResults.alreadyFqc.length}</p>
                          <p className="text-xs text-sky-400 mt-0.5">Pending shipment</p>
                        </div>
                        <div className="text-center p-3 rounded-lg bg-surface-base border border-stroke">
                          <p className="text-xs font-semibold text-ink-secondary mb-1">Already Shipped</p>
                          <p className="text-2xl font-bold text-ink-secondary">{batchFqcResults.alreadyShipped.length}</p>
                          <p className="text-xs text-ink-muted mt-0.5">Completed</p>
                        </div>
                      </div>
                    </div>

                    {/* In Assembly - Ready for FQC */}
                    {batchFqcResults.readyForFqc.length > 0 && (
                      <div className="bg-signal-ok/10 border border-emerald-500/30 rounded-lg p-4">
                        <div className="flex items-start gap-2 mb-3">
                          <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <h4 className="text-sm font-semibold text-emerald-300">{batchFqcResults.readyForFqc.length} SN(s) — Found in System, Ready for FQC</h4>
                            <p className="text-xs text-emerald-400 mt-0.5">These SNs were found in assembly or QC records and can be marked as FQC ready.</p>
                          </div>
                        </div>
                        <div className="overflow-y-auto rounded border border-emerald-500/30 bg-surface-panel" style={{ maxHeight: "180px" }}>
                          <table className="w-full text-xs">
                            <thead className="bg-signal-ok/10 sticky top-0">
                              <tr>
                                <th className="px-3 py-1.5 text-left font-semibold text-emerald-400 w-8">#</th>
                                <th className="px-3 py-1.5 text-left font-semibold text-emerald-400">Serial Number</th>
                                <th className="px-3 py-1.5 text-left font-semibold text-emerald-400">Reference Time</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-emerald-100">
                              {batchFqcResults.readyForFqc.map((r, i) => (
                                <tr key={buildQcRowKey(r, i)} className="hover:bg-signal-ok/10">
                                  <td className="px-3 py-1.5 text-emerald-400">{i + 1}</td>
                                  <td className="px-3 py-1.5 font-mono text-emerald-300">{r.sn}</td>
                                  <td className="px-3 py-1.5 text-emerald-400">{r.production_time ? new Date(r.production_time).toLocaleString() : "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Not in assembly DB */}
                    {batchFqcResults.notFound.length > 0 && (
                      <div className="bg-signal-error/10 border border-red-500/30 rounded-lg p-4">
                        <div className="flex items-start gap-2 mb-3">
                          <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <h4 className="text-sm font-semibold text-red-300">{batchFqcResults.notFound.length} SN(s) — Not Found in Production or QC Records</h4>
                            <p className="text-xs text-red-400 mt-0.5">These SNs were not found in assembly production or QC records. Verify the serial numbers.</p>
                          </div>
                        </div>
                        <div className="overflow-y-auto rounded border border-red-500/30 bg-surface-panel" style={{ maxHeight: "150px" }}>
                          <table className="w-full text-xs">
                            <thead className="bg-signal-error/10 sticky top-0">
                              <tr>
                                <th className="px-3 py-1.5 text-left font-semibold text-red-400 w-8">#</th>
                                <th className="px-3 py-1.5 text-left font-semibold text-red-400">Serial Number</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-red-100">
                              {batchFqcResults.notFound.map((r, i) => (
                                <tr key={buildQcRowKey(r, i)} className="hover:bg-signal-error/10">
                                  <td className="px-3 py-1.5 text-red-400">{i + 1}</td>
                                  <td className="px-3 py-1.5 font-mono text-red-300">{r.sn}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Already FQC'd */}
                    {batchFqcResults.alreadyFqc.length > 0 && (
                      <div className="bg-signal-info/10 border border-sky-500/30 rounded-lg p-4">
                        <div className="flex items-start gap-2 mb-2">
                          <CheckCircle2 className="w-5 h-5 text-sky-400 mt-0.5 flex-shrink-0" />
                          <h4 className="text-sm font-semibold text-sky-300">{batchFqcResults.alreadyFqc.length} SN(s) — Already FQC Ready (Pending Shipment)</h4>
                        </div>
                        <div className="overflow-y-auto rounded border border-sky-500/30 bg-surface-panel" style={{ maxHeight: "120px" }}>
                          <table className="w-full text-xs">
                            <thead className="bg-signal-info/10 sticky top-0">
                              <tr>
                                <th className="px-3 py-1.5 text-left font-semibold text-sky-400 w-8">#</th>
                                <th className="px-3 py-1.5 text-left font-semibold text-sky-400">Serial Number</th>
                                <th className="px-3 py-1.5 text-left font-semibold text-sky-400">FQC Ready At</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-sky-100">
                              {batchFqcResults.alreadyFqc.map((r, i) => (
                                <tr key={buildQcRowKey(r, i)} className="hover:bg-signal-info/10">
                                  <td className="px-3 py-1.5 text-sky-400">{i + 1}</td>
                                  <td className="px-3 py-1.5 font-mono text-sky-300">{r.sn}</td>
                                  <td className="px-3 py-1.5 text-sky-400">{r.fqc_ready_at ? new Date(r.fqc_ready_at).toLocaleString() : "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-3 sticky bottom-0 bg-surface-panel pt-3 pb-1">
                      <button
                        onClick={() => { setBatchFqcResults(null); setBatchFqcInput(""); }}
                        className="px-4 py-2 border border-stroke rounded-md text-sm font-medium text-ink-secondary bg-surface-panel hover:bg-surface-base"
                      >
                        Back
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
