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
  Image
} from "lucide-react";

import {
  ResponsiveContainer,
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

// date helpers
const todayStr = () => new Date().toISOString().split("T")[0];
const ymd = (d) => d.toISOString().split("T")[0];
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

export default function QCCheck() {
/* state */
  const [mode, setMode] = useState("fqc");
  const [sn, setSn] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });

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
  const [issueLine, setIssueLine] = useState("Line A");
  const [issueTitle, setIssueTitle] = useState("");
  const [issueCategory, setIssueCategory] = useState("Process");
  const [issueSeverity, setIssueSeverity] = useState("medium");
  const [issueDesc, setIssueDesc] = useState("");
  const [issueImage, setIssueImage] = useState(null);
  const [showLineIssues, setShowLineIssues] = useState(false);

  const snInput = useRef(null);

/* API calls - defined before effects that use them */
  const fetchDashboard = useCallback(async () => {
    try {
      const { data } = await api.get(`${QC_PREFIX}/dashboard`);
      setDashboard(data);
    } catch (e) {
      console.error("Dashboard fetch error:", e);
    }
  }, []);

  const fetchIssues = useCallback(async () => {
    try {
      setIssuesLoading(true);
      const { data } = await api.get(`${QC_PREFIX}/issues`, { params: { limit: 50 } });
      setIssues(Array.isArray(data) ? data : []);
    } catch {
      setMessage({ text: "Failed to load issues", type: "error" });
      setTimeout(() => setMessage({ text: "", type: "" }), 4000);
    } finally {
      setIssuesLoading(false);
    }
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
      const { data: cur } = await api.get(`${QC_PREFIX}/check/${code}`);
      const duplicated =
        (mode === "fqc" && cur?.fqc_ready) || (mode === "shipping" && cur?.shipped);

      if (duplicated) {
        showMessage(`${code} already scanned`, "error");
        return;
      }

      const { data } = await api.post(`${QC_PREFIX}/action`, {
        sn: code,
        action: mode === "fqc" ? "fqc_ready" : "ship",
      });

      const level =
        data.status === "warning" ? "error" : data.status === "success" ? "success" : "info";

      showMessage(data.message, level);
      fetchDashboard();
      if (showDashboard) fetchSeries();
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || "Failed";
      showMessage(detail, "error");
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
      const sns = batchInput
        .split(/[\n\s,\t]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      if (sns.length === 0) {
        showMessage("No valid serial numbers found", "error");
        return;
      }

      const { data } = await api.post(`${QC_PREFIX}/batch-check`, { sns });

      const categorized = {
        ready: data.results.filter((r) => r.status === "pending"),
        notReady: data.results.filter((r) => r.status === "not_ready"),
        alreadyShipped: data.results.filter((r) => r.status === "shipped"),
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
      const sns = input
        .split(/[\n\s,\t]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

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
    try {
      const payload = {
        line: issueLine,
        title: issueTitle.trim(),
        description: issueDesc.trim(),
        category: issueCategory,
        severity: issueSeverity,
        image_base64: issueImage,
      };
      const { data } = await api.post(`${QC_PREFIX}/issues`, payload);
      setIssues((prev) => [data, ...prev].slice(0, 50));
      showMessage("Issue logged", "success");
      resetIssueForm();
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || "Failed to log issue";
      showMessage(detail, "error");
    }
  };

/* helpers */
  const showMessage = (text, type = "info") => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: "", type: "" }), 4000);
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
    "inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium transition-all";

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Database className="w-8 h-8 text-gray-700 mr-3" />
              <h1 className="text-xl font-semibold text-gray-900">QC Check System</h1>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-10 space-y-8">
        {/* Hero */}
        <section className="rounded-3xl border border-emerald-100 bg-gradient-to-r from-emerald-50 via-teal-50 to-blue-50 shadow-sm p-8">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">QC Command Center</p>
              <h2 className="text-3xl font-bold text-gray-900">FQC & Shipping Control</h2>
              <p className="text-gray-700 max-w-2xl">
                Scan, batch ship, dashboards, and line-issue logging are all in one place to keep the rhythm going.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => {
                    if (!showDashboard) fetchSeries();
                    setShowDashboard(true);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-600 text-white font-medium shadow-sm hover:bg-emerald-700"
                >
                  <BarChart3 className="w-4 h-4" />
                  Open Dashboard
                </button>
                <button
                  onClick={() => {
                    fetchRecords(recordsFilter, recordsFrom, recordsTo, recordsPage, recordsLimit);
                    setShowRecords(true);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-gray-300 bg-white text-gray-800 font-medium hover:bg-gray-50"
                >
                  <FileText className="w-4 h-4" />
                  Production Records
                </button>
                <button
                  onClick={() => setShowExport(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-gray-300 bg-white text-gray-800 font-medium hover:bg-gray-50"
                >
                  <Download className="w-4 h-4" />
                  Export Excel
                </button>
                <button
                  onClick={() => {
                    fetchIssues();
                    setShowLineIssues(true);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-gray-300 bg-white text-gray-800 font-medium hover:bg-gray-50"
                >
                  <FileText className="w-4 h-4" />
                  Line Issues
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 w-full lg:w-auto">
              <div className="rounded-2xl bg-white border border-emerald-100 p-4 shadow-sm">
                <p className="text-xs font-semibold text-emerald-700 mb-1">Today FQC</p>
                <div className="flex items-end gap-2">
                  <span className="text-3xl font-bold text-gray-900">{dashboard.today_fqc}</span>
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                </div>
              </div>
              <div className="rounded-2xl bg-white border border-sky-100 p-4 shadow-sm">
                <p className="text-xs font-semibold text-sky-700 mb-1">Today Shipped</p>
                <div className="flex items-end gap-2">
                  <span className="text-3xl font-bold text-gray-900">{dashboard.today_shipped}</span>
                  <TruckIcon className="w-5 h-5 text-sky-600" />
                </div>
              </div>
              <div className="rounded-2xl bg-white border border-amber-100 p-4 shadow-sm">
                <p className="text-xs font-semibold text-amber-700 mb-1">Pending Shipments</p>
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-amber-600" />
                  <span className="text-2xl font-semibold text-gray-900">{dashboard.pending_shipment}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Mode + Scan */}
        <section className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6 space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-gray-800">Operation Mode</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setMode("fqc")}
                  className={`${modeBaseClass} ${
                    mode === "fqc"
                      ? "bg-emerald-100 border-emerald-300 text-emerald-700"
                      : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  FQC Ready
                </button>
                <button
                  onClick={() => setMode("shipping")}
                  className={`${modeBaseClass} ${
                    mode === "shipping"
                      ? "bg-sky-100 border-sky-300 text-sky-700"
                      : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <TruckIcon className="w-4 h-4" />
                  Shipping
                </button>
              </div>
            </div>
            <div className="flex gap-2 text-xs text-gray-500">
              <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-700">
                <Activity className="w-3.5 h-3.5" />
                Shipping rate today {dashboard.shipping_rate_today}%
              </div>
              <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-teal-50 border border-teal-100 text-teal-700">
                <TrendingUp className="w-3.5 h-3.5" />
                Weekly {dashboard.shipping_rate_week}%
              </div>
            </div>
          </div>

          <div className="grid lg:grid-cols-[1.6fr,1fr] gap-5">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-semibold text-gray-800">Scan Serial Number</p>
                  <p className="text-xs text-gray-500">Press Enter to submit instantly and refresh status.</p>
                </div>
                {mode === "shipping" && (
                  <button
                    onClick={() => setShowBatchShip(true)}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border border-sky-200 bg-white text-sky-700 hover:bg-sky-50"
                  >
                    <FileText className="w-4 h-4" />
                    Batch Ship
                  </button>
                )}
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  ref={snInput}
                  value={sn}
                  onChange={(e) => setSn(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleScan()}
                  placeholder={mode === "fqc" ? "Scan SN for FQC" : "Scan SN for Shipping"}
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 text-black bg-white"
                  autoFocus
                />
                <button
                  onClick={handleScan}
                  disabled={!sn.trim() || loading}
                  className={`px-6 py-3 rounded-lg font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    mode === "fqc" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-sky-600 hover:bg-sky-700"
                  }`}
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : mode === "fqc" ? (
                    "Mark FQC Ready"
                  ) : (
                    "Confirm Shipping"
                  )}
                </button>
              </div>
              {message.text && (
                <div
                  className={`mt-4 p-3 rounded-lg flex items-center gap-2 border ${
                    message.type === "success"
                      ? "bg-emerald-50 text-emerald-800 border-emerald-100"
                      : message.type === "error"
                      ? "bg-red-50 text-red-800 border-red-100"
                      : message.type === "warning"
                      ? "bg-amber-50 text-amber-800 border-amber-100"
                      : "bg-sky-50 text-sky-800 border-sky-100"
                  }`}
                >
                  {message.type === "success" ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                  <span className="text-sm">{message.text}</span>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-100 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-emerald-700" />
                    <p className="text-sm font-semibold text-gray-900">Throughput</p>
                  </div>
                  <span className="text-xs text-gray-500">{todayStr()}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3">
                    <p className="text-xs text-emerald-700">Week FQC</p>
                    <p className="text-xl font-semibold text-gray-900">{dashboard.week_fqc}</p>
                  </div>
                  <div className="rounded-lg bg-sky-50 border border-sky-100 p-3">
                    <p className="text-xs text-sky-700">Week Shipped</p>
                    <p className="text-xl font-semibold text-gray-900">{dashboard.week_shipped}</p>
                  </div>
                  <div className="rounded-lg bg-teal-50 border border-teal-100 p-3">
                    <p className="text-xs text-teal-700">Month FQC</p>
                    <p className="text-xl font-semibold text-gray-900">{dashboard.month_fqc}</p>
                  </div>
                  <div className="rounded-lg bg-amber-50 border border-amber-100 p-3">
                    <p className="text-xs text-amber-700">Month Shipped</p>
                    <p className="text-xl font-semibold text-gray-900">{dashboard.month_shipped}</p>
                  </div>
                </div>
              </div>
              {dashboard.pending_shipment > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
                  <Clock className="w-5 h-5 text-amber-700 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">Pending shipment</p>
                    <p className="text-sm text-amber-700">{dashboard.pending_shipment} units pending shipment</p>
                  </div>
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
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75" onClick={() => setShowLineIssues(false)} />
            <div className="relative bg-white rounded-lg max-w-6xl w-full max-h-[90vh] overflow-auto shadow-xl">
              <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Line Findings</p>
                  <h2 className="text-xl font-semibold text-gray-900">Log QC Issues on Line</h2>
                </div>
                <button onClick={() => setShowLineIssues(false)} className="p-2 hover:bg-gray-100 rounded-full">
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-sm text-gray-500">Log line issues with photos and line tags for smoother follow-up.</p>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Form */}
                  <div className="space-y-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Line</label>
                        <select
                          value={issueLine}
                          onChange={(e) => setIssueLine(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-emerald-500 focus:border-emerald-500"
                        >
                          {["Line A", "Line B", "Line C", "Module", "Assembly", "Shipping"].map((l) => (
                            <option key={l} value={l}>{l}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Severity</label>
                        <select
                          value={issueSeverity}
                          onChange={(e) => setIssueSeverity(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-emerald-500 focus:border-emerald-500"
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
                        <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                        <select
                          value={issueCategory}
                          onChange={(e) => setIssueCategory(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-emerald-500 focus:border-emerald-500"
                        >
                          <option value="Process">Process</option>
                          <option value="Material">Material</option>
                          <option value="Equipment">Equipment</option>
                          <option value="Documentation">Documentation</option>
                          <option value="Others">Others</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                        <input
                          value={issueTitle}
                          onChange={(e) => setIssueTitle(e.target.value)}
                          placeholder="Short summary"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-emerald-500 focus:border-emerald-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                      <textarea
                        value={issueDesc}
                        onChange={(e) => setIssueDesc(e.target.value)}
                        placeholder="What happened? Impact? Immediate action?"
                        rows={4}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-emerald-500 focus:border-emerald-500 text-black"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-center">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Attach Photo (optional)</label>
                        <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-md text-sm text-gray-700 cursor-pointer hover:border-emerald-400">
                          <Image className="w-4 h-4" />
                          <span>{issueImage ? "Change file" : "Upload file"}</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => handleIssueImage(e.target.files?.[0])}
                          />
                        </label>
                        <p className="text-xs text-gray-500 mt-1">JPG/PNG, stored as base64 for quick preview.</p>
                      </div>
                      {issueImage && (
                        <div className="border rounded-md p-2 bg-white">
                          <p className="text-xs text-gray-600 mb-1">Preview</p>
                          <img src={issueImage} alt="Issue" className="max-h-32 object-cover rounded" />
                        </div>
                      )}
                    </div>

                    <div className="flex gap-3">
                      <button
                        onClick={submitIssue}
                        className="px-4 py-2 rounded-md text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700"
                      >
                        Save Issue
                      </button>
                      <button
                        onClick={resetIssueForm}
                        className="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 bg-white hover:bg-gray-50 text-gray-700"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {/* List */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-gray-800">Recent Issues</h3>
                      <span className="text-xs text-gray-500">Latest 50</span>
                    </div>
                    <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                      {issuesLoading ? (
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Loading...
                        </div>
                      ) : issues.length === 0 ? (
                        <p className="text-sm text-gray-600">No issues logged yet.</p>
                      ) : (
                        issues.map((it) => (
                          <div key={it.id} className="border border-gray-200 rounded-lg p-3 bg-white shadow-sm">
                            <div className="flex items-start justify-between">
                              <div>
                                <p className="text-sm font-semibold text-gray-900">{it.title}</p>
                                <p className="text-xs text-gray-500">{it.line}</p>
                              </div>
                              <div className="flex gap-2">
                                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
                                  {it.category || "N/A"}
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                    it.severity === "critical"
                                      ? "bg-red-100 text-red-700"
                                      : it.severity === "high"
                                      ? "bg-orange-100 text-orange-700"
                                      : it.severity === "medium"
                                      ? "bg-amber-100 text-amber-700"
                                      : "bg-emerald-100 text-emerald-700"
                                  }`}
                                >
                                  {it.severity || "low"}
                                </span>
                              </div>
                            </div>
                            <p className="mt-2 text-sm text-gray-700 whitespace-pre-line">{it.description}</p>
                            <div className="mt-2 flex items-center text-xs text-gray-500 gap-2">
                              <Calendar className="w-3.5 h-3.5" />
                              <span>{it.created_at ? new Date(it.created_at).toLocaleString() : ""}</span>
                              {it.created_by && <span>by {it.created_by}</span>}
                            </div>
                            {it.image_base64 && (
                              <div className="mt-2">
                                <img src={it.image_base64} alt="attachment" className="max-h-40 rounded border" />
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
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75" onClick={() => setShowDashboard(false)} />

            <div className="relative bg-white rounded-lg max-w-5xl w-full max-h-[90vh] overflow-auto">
              <div className="sticky top-0 bg-white border-b px-6 py-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-gray-900">FQC Dashboard</h2>
                  <button onClick={() => setShowDashboard(false)} className="p-2 hover:bg-gray-100 rounded-full">
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-8">
                {/* Time Period Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-6">
                    <div className="flex items-center mb-4">
                      <Calendar className="w-5 h-5 text-green-700 mr-2" />
                      <h3 className="font-semibold text-green-900">Today</h3>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-green-700">FQC Ready</span>
                        <span className="text-2xl font-bold text-green-900">{dashboard.today_fqc}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-green-700">Shipped</span>
                        <span className="text-2xl font-bold text-green-900">{dashboard.today_shipped}</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-6">
                    <div className="flex items-center mb-4">
                      <TrendingUp className="w-5 h-5 text-blue-700 mr-2" />
                      <h3 className="font-semibold text-blue-900">This Week</h3>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-blue-700">FQC Ready</span>
                        <span className="text-2xl font-bold text-blue-900">{dashboard.week_fqc}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-blue-700">Shipped</span>
                        <span className="text-2xl font-bold text-blue-900">{dashboard.week_shipped}</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-cyan-50 to-emerald-100 rounded-lg p-6">
                    <div className="flex items-center mb-4">
                      <Activity className="w-5 h-5 text-emerald-700 mr-2" />
                      <h3 className="font-semibold text-emerald-900">This Month</h3>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-emerald-700">FQC Ready</span>
                        <span className="text-2xl font-bold text-emerald-900">{dashboard.month_fqc}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-emerald-700">Shipped</span>
                        <span className="text-2xl font-bold text-emerald-900">{dashboard.month_shipped}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Performance Metrics */}
                <div className="bg-gray-50 rounded-lg p-6">
                  <h3 className="font-semibold text-gray-900 mb-4">Performance Metrics</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    <div>
                      <p className="text-sm text-gray-600">Shipping Rate (Today)</p>
                      <p className="text-2xl font-bold text-gray-900">{dashboard.shipping_rate_today}%</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Shipping Rate (Week)</p>
                      <p className="text-2xl font-bold text-gray-900">{dashboard.shipping_rate_week}%</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Pending Shipments</p>
                      <p className="text-2xl font-bold text-orange-600">{dashboard.pending_shipment}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Avg Daily Output</p>
                      <p className="text-2xl font-bold text-gray-900">{Math.round(dashboard.week_fqc / 7)}</p>
                    </div>
                  </div>
                </div>

                {/* Shipping Trends */}
                <div className="space-y-6">
                  <h3 className="font-semibold text-gray-900">Shipping Trends</h3>

                  <div className="bg-white rounded-lg shadow p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-600">This Month - Daily Shipped</span>
                      {seriesLoading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
                    </div>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={dailyShipSeries}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="label" />
                          <YAxis allowDecimals={false} />
                          <Tooltip />
                          <Legend />
                          <Line type="monotone" dataKey="shipped" name="Shipped (Daily)" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="bg-white rounded-lg shadow p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-600">This Year - Monthly Shipped</span>
                      {seriesLoading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
                    </div>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={monthlyShipSeries}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="label" />
                          <YAxis allowDecimals={false} />
                          <Tooltip />
                          <Legend />
                          <Line type="monotone" dataKey="shipped" name="Shipped (Monthly)" strokeWidth={2} dot />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
                {/* END Shipping Trends */}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {showExport && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75" onClick={() => setShowExport(false)} />

            <div className="relative bg-white rounded-lg max-w-md w-full">
              <div className="border-b px-6 py-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-gray-900">Export Records</h2>
                  <button onClick={() => setShowExport(false)} className="p-2 hover:bg-gray-100 rounded-full">
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>
              </div>

              <div className="p-6">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
                    <input
                      type="date"
                      value={exportSettings.from}
                      onChange={(e) => setExportSettings({ ...exportSettings, from: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-black"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
                    <input
                      type="date"
                      value={exportSettings.to}
                      onChange={(e) => setExportSettings({ ...exportSettings, to: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-black"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Export Type</label>
                    <select
                      value={exportSettings.type}
                      onChange={(e) => setExportSettings({ ...exportSettings, type: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-black"
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
                    className="flex-1 inline-flex justify-center items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export
                  </button>
                  <button
                    onClick={() => setShowExport(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
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
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75" onClick={() => setShowRecords(false)} />

            <div className="relative bg-white rounded-lg max-w-6xl w-full max-h-[90vh] overflow-hidden">
              {/* Header + Filters */}
              <div className="sticky top-0 bg-white border-b px-6 py-4 z-10">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-gray-900">QC Records</h2>
                  <button onClick={() => setShowRecords(false)} className="p-2 hover:bg-gray-100 rounded-full">
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                    <select
                      value={recordsFilter}
                      onChange={(e) => setRecordsFilter(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    >
                      <option value="all">All</option>
                      <option value="pending">Pending</option>
                      <option value="shipped">Shipped</option>
                    </select>
                  </div>

                  <div className="md:col-span-3">
                    <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
                    <input
                      type="date"
                      value={recordsFrom || ""}
                      onChange={(e) => setRecordsFrom(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-black"
                    />
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                    <input
                      type="date"
                      value={recordsTo || ""}
                      onChange={(e) => setRecordsTo(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-black"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Page Size</label>
                    <select
                      value={recordsLimit}
                      onChange={(e) => {
                        const newLimit = parseInt(e.target.value, 10);
                        setRecordsLimit(newLimit);
                        setRecordsPage(0);
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    >
                      {[50, 100, 200, 500].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-2 flex gap-2">
                    <button
                      onClick={applyRecordsFilter}
                      className="flex-1 inline-flex justify-center items-center px-3 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
                    >
                      Apply
                    </button>
                    <button
                      onClick={clearRecordsFilter}
                      className="flex-1 inline-flex justify-center items-center px-3 py-2 rounded-md text-sm font-medium border border-gray-300 bg-white hover:bg-gray-50"
                    >
                      Clear
                    </button>
                  </div>

                  {/* Quick ranges */}
                  <div className="md:col-span-12 flex flex-wrap gap-2 pt-1">
                    <button
                      onClick={() => {
                        const t = todayStr();
                        setRecordsFrom(t);
                        setRecordsTo(t);
                        setRecordsPage(0);
                        fetchRecords(recordsFilter, t, t, 0, recordsLimit);
                      }}
                      className="px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50"
                    >
                      Today
                    </button>
                    <button
                      onClick={() => {
                        const y = yesterdayStr();
                        setRecordsFrom(y);
                        setRecordsTo(y);
                        setRecordsPage(0);
                        fetchRecords(recordsFilter, y, y, 0, recordsLimit);
                      }}
                      className="px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50"
                    >
                      Yesterday
                    </button>
                    <button
                      onClick={() => {
                        const f = firstDayOfMonth();
                        const t = todayStr();
                        setRecordsFrom(f);
                        setRecordsTo(t);
                        setRecordsPage(0);
                        fetchRecords(recordsFilter, f, t, 0, recordsLimit);
                      }}
                      className="px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50"
                    >
                      This Month
                    </button>
                    <button
                      onClick={() => {
                        setRecordsFrom("");
                        setRecordsTo("");
                        setRecordsPage(0);
                        fetchRecords(recordsFilter, "", "", 0, recordsLimit);
                      }}
                      className="px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50"
                    >
                      All
                    </button>
                  </div>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-y-auto max-h-[calc(90vh-190px)]">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Serial Number
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        FQC Ready Time
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Shipped Time
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {recordsLoading ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-6 text-center text-sm text-gray-500">
                          <div className="inline-flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                    Loading...
                          </div>
                        </td>
                      </tr>
                    ) : records.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-6 text-center text-sm text-gray-500">
                          No data
                        </td>
                      </tr>
                    ) : (
                      records.map((record) => (
                        <tr key={record.sn} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{record.sn}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {record.fqc_ready_at ? new Date(record.fqc_ready_at).toLocaleString() : "-"}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {record.shipped_at ? new Date(record.shipped_at).toLocaleString() : "-"}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span
                              className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                record.status === "Shipped"
                                  ? "bg-blue-100 text-blue-800"
                                  : record.status === "Pending"
                                  ? "bg-yellow-100 text-yellow-800"
                                  : "bg-gray-100 text-gray-800"
                              }`}
                            >
                              {record.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <button onClick={() => deleteRecord(record.sn)} className="text-red-600 hover:text-red-900">
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="border-t bg-white px-6 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="text-sm text-gray-600">
                  Total: <span className="font-medium">{recordsTotal}</span>{" "}
                  {recordsFrom || recordsTo ? (
                    <>
                      | Range: <span className="font-mono">{recordsFrom || "..."} ~ {recordsTo || "..."}</span>
                    </>
                  ) : (
                    "| Range: All"
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    disabled={!canPrev}
                    onClick={() => {
                      if (!canPrev) return;
                      const p = recordsPage - 1;
                      setRecordsPage(p);
                      fetchRecords(recordsFilter, recordsFrom, recordsTo, p, recordsLimit);
                    }}
                    className={`px-3 py-1 rounded border text-sm ${
                      canPrev ? "bg-white hover:bg-gray-50" : "bg-gray-100 text-gray-400 cursor-not-allowed"
                    }`}
                  >
                    Prev
                  </button>
                  <span className="text-sm text-gray-700">
                    Page <span className="font-medium">{recordsPage + 1}</span> / {Math.max(1, Math.ceil(recordsTotal / recordsLimit))}
                  </span>
                  <button
                    disabled={!canNext}
                    onClick={() => {
                      if (!canNext) return;
                      const p = recordsPage + 1;
                      setRecordsPage(p);
                      fetchRecords(recordsFilter, recordsFrom, recordsTo, p, recordsLimit);
                    }}
                    className={`px-3 py-1 rounded border text-sm ${
                      canNext ? "bg-white hover:bg-gray-50" : "bg-gray-100 text-gray-400 cursor-not-allowed"
                    }`}
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Batch Ship Modal */}
      {showBatchShip && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75" onClick={() => setShowBatchShip(false)} />

            <div className="relative bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden">
              <div className="sticky top-0 bg-white border-b px-6 py-4 z-10">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-gray-900">Batch Shipping</h2>
                  <button onClick={() => setShowBatchShip(false)} className="p-2 hover:bg-gray-100 rounded-full">
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>

                {/* Operation Bar - Batch Export & Batch Ship 按鈕 */}
                <div className="mt-4 flex gap-3">
                  <button
                    onClick={handleBatchExportPcba}
                    disabled={!batchInput.trim()}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-emerald-600 rounded-lg text-sm font-semibold text-emerald-700 bg-white hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Batch Export
                  </button>

                  <button
                    onClick={handleBatchCheck}
                    disabled={!batchInput.trim() || batchLoading}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-transparent rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
                      <label className="block text-sm font-medium text-gray-700 mb-2">Paste Serial Numbers</label>
                      <p className="text-sm text-gray-500 mb-2">
                        Paste your serial numbers from Excel. They can be separated by newlines, spaces, commas, or tabs.
                      </p>
                      <textarea
                        value={batchInput}
                        onChange={(e) => setBatchInput(e.target.value)}
                        placeholder="Paste serial numbers here..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-black"
                        rows={12}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Summary */}
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h3 className="font-semibold text-gray-900 mb-3">Batch Check Results</h3>
                      <div className="grid grid-cols-4 gap-4">
                        <div>
                          <p className="text-sm text-gray-600">Total SNs</p>
                          <p className="text-2xl font-bold text-gray-900">{batchResults.total}</p>
                        </div>
                        <div>
                          <p className="text-sm text-green-600">Ready to Ship</p>
                          <p className="text-2xl font-bold text-green-700">{batchResults.ready.length}</p>
                        </div>
                        <div>
                          <p className="text-sm text-red-600">Not Ready</p>
                          <p className="text-2xl font-bold text-red-700">{batchResults.notReady.length}</p>
                        </div>
                        <div>
                          <p className="text-sm text-blue-600">Already Shipped</p>
                          <p className="text-2xl font-bold text-blue-700">{batchResults.alreadyShipped.length}</p>
                        </div>
                      </div>
                    </div>

                    {/* Not Ready Warning */}
                    {batchResults.notReady.length > 0 && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                        <div className="flex items-start">
                          <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 mr-2 flex-shrink-0" />
                          <div className="flex-1">
                            <h4 className="text-sm font-semibold text-red-800 mb-2">
                              The following {batchResults.notReady.length} serial numbers are NOT in pending shipment:
                            </h4>
                            <div className="bg-white border border-red-200 rounded p-3 overflow-y-auto" style={{ maxHeight: "150px" }}>
                              <p className="text-sm text-red-700 font-mono whitespace-pre-wrap">
                                {batchResults.notReady.map((r) => r.sn).join("\n")}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Already Shipped Info */}
                    {batchResults.alreadyShipped.length > 0 && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <div className="flex items-start">
                          <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5 mr-2 flex-shrink-0" />
                          <div className="flex-1">
                            <h4 className="text-sm font-semibold text-blue-800 mb-2">
                              The following {batchResults.alreadyShipped.length} serial numbers were already shipped:
                            </h4>
                            <div className="bg-white border border-blue-200 rounded p-3 overflow-y-auto" style={{ maxHeight: "150px" }}>
                              <p className="text-sm text-blue-700 font-mono whitespace-pre-wrap">
                                {batchResults.alreadyShipped.map((r) => r.sn).join("\n")}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Ready to Ship */}
                    {batchResults.ready.length > 0 && (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                        <div className="flex items-start">
                          <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 mr-2 flex-shrink-0" />
                          <div className="flex-1">
                            <h4 className="text-sm font-semibold text-green-800 mb-2">
                              {batchResults.ready.length} serial numbers are ready to ship:
                            </h4>
                            <div className="bg-white border border-green-200 rounded p-3 overflow-y-auto" style={{ maxHeight: "150px" }}>
                              <p className="text-sm text-green-700 font-mono whitespace-pre-wrap">
                                {batchResults.ready.map((r) => r.sn).join("\n")}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-3 sticky bottom-0 bg-white pt-4 pb-2">
                      {batchResults.ready.length > 0 && (
                        <button
                          onClick={handleBatchShip}
                          disabled={batchLoading}
                          className="flex-1 inline-flex justify-center items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
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
                        className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
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
