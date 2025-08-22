import { useEffect, useState, useRef } from "react";
import {
  TruckIcon,
  BarChart3,
  FileSpreadsheet,
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
  AlertTriangle
} from "lucide-react";

import api from "../../services/api";   // ← 共用 axios instance
const QC_PREFIX = "/qc";               // ← 後端 router.prefix

export default function QCCheck() {
  /* ───────────── state ───────────── */
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
    shipping_rate_week: 0
  });

  const [showDashboard, setShowDashboard] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showRecords, setShowRecords] = useState(false);
  const [showBatchShip, setShowBatchShip] = useState(false);

  const [records, setRecords] = useState([]);
  const [recordsFilter, setRecordsFilter] = useState("all");

  const [exportSettings, setExportSettings] = useState({
    from: new Date().toISOString().split("T")[0],
    to: new Date().toISOString().split("T")[0],
    type: "all"
  });

  const [batchInput, setBatchInput] = useState("");
  const [batchResults, setBatchResults] = useState(null);
  const [batchLoading, setBatchLoading] = useState(false);

  const snInput = useRef(null);

  /* ───────────── effects ──────────── */
  useEffect(() => {
    fetchDashboard();
    const id = setInterval(fetchDashboard, 30_000);
    return () => clearInterval(id);
  }, []);

  /* ───────────── API calls ────────── */
  const fetchDashboard = async () => {
    try {
      const { data } = await api.get(`${QC_PREFIX}/dashboard`);
      setDashboard(data);
    } catch (e) {
      console.error("Dashboard fetch error:", e);
    }
  };

  const fetchRecords = async (filter = "all") => {
    try {
      const { data } = await api.get(
        `${QC_PREFIX}/records?status=${filter}&limit=100`
      );
      setRecords(data.records);
    } catch {
      showMessage("Failed to fetch records", "error");
    }
  };

  const handleScan = async () => {
    const code = sn.trim();
    if (!code || loading) return;

    setLoading(true);

    try {
      /* ── ① Check current status ─────────────────────── */
      const { data: cur } = await api.get(`${QC_PREFIX}/check/${code}`);

      const duplicated =
        (mode === "fqc" && cur?.fqc_ready) ||
        (mode === "shipping" && cur?.shipped);

      if (duplicated) {
        showMessage(`${code} Already Scanned!`, "error");
        return;
      }

      /* ── ② Send action ─────────────────────────── */
      const { data } = await api.post(`${QC_PREFIX}/action`, {
        sn: code,
        action: mode === "fqc" ? "fqc_ready" : "ship"
      });

      const level =
        data.status === "warning" ? "error" :
        data.status === "success" ? "success" :
        "info";

      showMessage(data.message, level);
      fetchDashboard();
    } catch (e) {
      showMessage(e.message || "Failed", "error");
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
      // Parse input - split by newline, space, comma, or tab
      const sns = batchInput
        .split(/[\n\s,\t]+/)
        .map(s => s.trim())
        .filter(s => s.length > 0);

      if (sns.length === 0) {
        showMessage("No valid serial numbers found", "error");
        return;
      }

      // Check status of all SNs
      const { data } = await api.post(`${QC_PREFIX}/batch-check`, { sns });
      
      const categorized = {
        ready: data.results.filter(r => r.status === 'pending'),
        notReady: data.results.filter(r => r.status === 'not_ready'),
        alreadyShipped: data.results.filter(r => r.status === 'shipped')
      };

      setBatchResults({
        total: sns.length,
        ...categorized
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
        sns: batchResults.ready.map(r => r.sn)
      });

      showMessage(data.message, "success");
      fetchDashboard();
      setShowBatchShip(false);
      setBatchInput("");
      setBatchResults(null);
    } catch (e) {
      showMessage("Batch shipping failed", "error");
    } finally {
      setBatchLoading(false);
    }
  };

  const deleteRecord = async (sn) => {
    if (!window.confirm(`Delete record for ${sn}?`)) return;
    try {
      await api.delete(`${QC_PREFIX}/delete/${sn}`);
      showMessage("Record deleted", "success");
      fetchRecords(recordsFilter);
      fetchDashboard();
    } catch {
      showMessage("Delete failed", "error");
    }
  };

  const handleExport = () => {
    const qs = new URLSearchParams({
      from_date: exportSettings.from,
      to_date: exportSettings.to,
      export_type: exportSettings.type
    });
    const base = api.defaults.baseURL.replace(/\/$/, ""); // "/api"
    window.location.href = `${base}${QC_PREFIX}/export?${qs.toString()}`;

    setShowExport(false);
    showMessage("Export started", "success");
  };

  /* ───────────── helpers ─────────── */
  const showMessage = (text, type = "info") => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: "", type: "" }), 4000);
  };

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
            <nav className="flex space-x-4">
              <button
                onClick={() => setShowDashboard(!showDashboard)}
                className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <BarChart3 className="w-4 h-4 mr-2" />
                Dashboard
              </button>
              <button
                onClick={() => { fetchRecords(); setShowRecords(!showRecords); }}
                className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <Database className="w-4 h-4 mr-2" />
                Records
              </button>
              <button
                onClick={() => setShowExport(!showExport)}
                className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                Export
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-3xl mx-auto px-4 py-8">
        {/* Mode Selector */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Select Operation Mode</h2>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setMode("fqc")}
                className={`relative rounded-lg border-2 p-6 flex flex-col items-center transition-all ${
                  mode === "fqc"
                    ? "border-green-500 bg-green-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <CheckCircle2 className={`w-10 h-10 mb-3 ${
                  mode === "fqc" ? "text-green-600" : "text-gray-400"
                }`} />
                <h3 className={`text-base font-medium ${
                  mode === "fqc" ? "text-green-700" : "text-gray-900"
                }`}>FQC Ready</h3>
                <p className="mt-1 text-sm text-gray-500">Mark units ready for shipping</p>
              </button>

              <button
                onClick={() => setMode("shipping")}
                className={`relative rounded-lg border-2 p-6 flex flex-col items-center transition-all ${
                  mode === "shipping"
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <TruckIcon className={`w-10 h-10 mb-3 ${
                  mode === "shipping" ? "text-blue-600" : "text-gray-400"
                }`} />
                <h3 className={`text-base font-medium ${
                  mode === "shipping" ? "text-blue-700" : "text-gray-900"
                }`}>Shipping</h3>
                <p className="mt-1 text-sm text-gray-500">Confirm units for shipment</p>
              </button>
            </div>
          </div>
        </div>

        {/* Scanner Input */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="p-6">
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Scan Serial Number
              </label>
              {mode === "shipping" && (
                <button
                  onClick={() => setShowBatchShip(true)}
                  className="inline-flex items-center px-3 py-1 border border-blue-300 rounded-md text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100"
                >
                  <FileText className="w-4 h-4 mr-1" />
                  Batch Ship
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <input
                ref={snInput}
                value={sn}
                onChange={e => setSn(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleScan()}
                placeholder={mode === "fqc" ? "Scan SN for FQC..." : "Scan SN for Ship..."}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 text-black"
                autoFocus
              />
              <button
                onClick={handleScan}
                disabled={!sn.trim() || loading}
                className={`px-6 py-2 rounded-md font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  mode === "fqc"
                    ? "bg-green-600 hover:bg-green-700"
                    : "bg-blue-600 hover:bg-blue-700"
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

            {/* Message */}
            {message.text && (
              <div className={`mt-4 p-3 rounded-md flex items-center ${
                message.type === "success" ? "bg-green-50 text-green-800" :
                message.type === "error" ? "bg-red-50 text-red-800" :
                message.type === "warning" ? "bg-yellow-50 text-yellow-800" :
                "bg-blue-50 text-blue-800"
              }`}>
                {message.type === "success" ? <CheckCircle2 className="w-5 h-5 mr-2" /> :
                 message.type === "error" ? <AlertCircle className="w-5 h-5 mr-2" /> :
                 <AlertCircle className="w-5 h-5 mr-2" />}
                {message.text}
              </div>
            )}
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Today's FQC</p>
                <p className="mt-1 text-3xl font-semibold text-gray-900">{dashboard.today_fqc}</p>
              </div>
              <div className="p-3 bg-green-100 rounded-full">
                <CheckCircle2 className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Today's Shipped</p>
                <p className="mt-1 text-3xl font-semibold text-gray-900">{dashboard.today_shipped}</p>
              </div>
              <div className="p-3 bg-blue-100 rounded-full">
                <TruckIcon className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Pending Shipments Alert */}
        {dashboard.pending_shipment > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <div className="flex items-center">
              <Clock className="w-5 h-5 text-yellow-600 mr-2" />
              <p className="text-sm font-medium text-yellow-800">
                {dashboard.pending_shipment} units pending shipment
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Dashboard Modal */}
      {showDashboard && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75" onClick={() => setShowDashboard(false)} />
            
            <div className="relative bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-auto">
              <div className="sticky top-0 bg-white border-b px-6 py-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-gray-900">FQC Dashboard</h2>
                  <button
                    onClick={() => setShowDashboard(false)}
                    className="p-2 hover:bg-gray-100 rounded-full"
                  >
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>
              </div>

              <div className="p-6">
                {/* Time Period Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
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

                  <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-6">
                    <div className="flex items-center mb-4">
                      <Activity className="w-5 h-5 text-purple-700 mr-2" />
                      <h3 className="font-semibold text-purple-900">This Month</h3>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-purple-700">FQC Ready</span>
                        <span className="text-2xl font-bold text-purple-900">{dashboard.month_fqc}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-purple-700">Shipped</span>
                        <span className="text-2xl font-bold text-purple-900">{dashboard.month_shipped}</span>
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
                      <p className="text-2xl font-bold text-gray-900">
                        {Math.round(dashboard.week_fqc / 7)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Export Modal */}
{showExport && (
  <div className="fixed inset-0 z-50 overflow-y-auto">
    <div className="flex items-center justify-center min-h-screen px-4">
      <div
        className="fixed inset-0 bg-gray-500 bg-opacity-75"
        onClick={() => setShowExport(false)}
      />

      <div className="relative bg-white rounded-lg max-w-md w-full">
        <div className="border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">Export Records</h2>
            <button
              onClick={() => setShowExport(false)}
              className="p-2 hover:bg-gray-100 rounded-full"
            >
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
                onChange={(e) =>
                  setExportSettings({ ...exportSettings, from: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-black"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
              <input
                type="date"
                value={exportSettings.to}
                onChange={(e) =>
                  setExportSettings({ ...exportSettings, to: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-black"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Export Type</label>
              <select
                value={exportSettings.type}
                onChange={(e) =>
                  setExportSettings({ ...exportSettings, type: e.target.value })
                }
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
              <div className="sticky top-0 bg-white border-b px-6 py-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-gray-900">QC Records</h2>
                  <div className="flex items-center gap-4">
                    <select
                      value={recordsFilter}
                      onChange={(e) => {
                        setRecordsFilter(e.target.value);
                        fetchRecords(e.target.value);
                      }}
                      className="px-3 py-1 border border-gray-300 rounded-md text-sm"
                    >
                      <option value="all">All Records</option>
                      <option value="pending">Pending Shipment</option>
                      <option value="shipped">Shipped</option>
                    </select>
                    <button
                      onClick={() => setShowRecords(false)}
                      className="p-2 hover:bg-gray-100 rounded-full"
                    >
                      <X className="w-5 h-5 text-gray-500" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="overflow-y-auto max-h-[90vh]">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Serial Number</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">FQC Ready Time</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Shipped Time</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {records.map((record) => (
                      <tr key={record.sn} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{record.sn}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {record.fqc_ready_at ? new Date(record.fqc_ready_at).toLocaleString() : "-"}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {record.shipped_at ? new Date(record.shipped_at).toLocaleString() : "-"}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            record.status === "Shipped" 
                              ? "bg-blue-100 text-blue-800" 
                              : "bg-yellow-100 text-yellow-800"
                          }`}>
                            {record.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <button
                            onClick={() => deleteRecord(record.sn)}
                            className="text-red-600 hover:text-red-900"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
        <div className="sticky top-0 bg-white border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">Batch Shipping</h2>
            <button
              onClick={() => setShowBatchShip(false)}
              className="p-2 hover:bg-gray-100 rounded-full"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 80px)' }}>
          {!batchResults ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Paste Serial Numbers
                </label>
                <p className="text-sm text-gray-500 mb-2">
                  Paste your serial numbers from Excel. They can be separated by newlines, spaces, commas, or tabs.
                </p>
                <textarea
                  value={batchInput}
                  onChange={(e) => setBatchInput(e.target.value)}
                  placeholder="Paste serial numbers here..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-black"
                  rows={10}
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleBatchCheck}
                  disabled={!batchInput.trim() || batchLoading}
                  className="flex-1 inline-flex justify-center items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {batchLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>Check Status</>
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowBatchShip(false);
                    setBatchInput("");
                    setBatchResults(null);
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                >
                  Cancel
                </button>
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
                      <div className="bg-white border border-red-200 rounded p-3 overflow-y-auto" style={{ maxHeight: '150px' }}>
                        <p className="text-sm text-red-700 font-mono whitespace-pre-wrap">
                          {batchResults.notReady.map(r => r.sn).join('\n')}
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
                      <div className="bg-white border border-blue-200 rounded p-3 overflow-y-auto" style={{ maxHeight: '150px' }}>
                        <p className="text-sm text-blue-700 font-mono whitespace-pre-wrap">
                          {batchResults.alreadyShipped.map(r => r.sn).join('\n')}
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
                      <div className="bg-white border border-green-200 rounded p-3 overflow-y-auto" style={{ maxHeight: '150px' }}>
                        <p className="text-sm text-green-700 font-mono whitespace-pre-wrap">
                          {batchResults.ready.map(r => r.sn).join('\n')}
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