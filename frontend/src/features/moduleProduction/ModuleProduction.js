// src/features/moduleProduction/ModuleProduction.js

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";
import {
  BatteryMedium, Download, X, Trash2, AlertCircle,
  CheckCircle, TrendingUp, Database, XCircle, Activity
} from "lucide-react";
import api from "../../services/api";
import { openDashboardSocket } from "../../utils/wsConnect";

/* Chart.js 全域註冊 */
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// 工具：簡易 CSV 轉換（自動加 BOM，Excel 友善）
const toCsvAndDownload = (rows, filename) => {
  const bom = "\uFEFF";
  const csv = rows.map(r =>
    r.map((cell) => {
      const s = cell == null ? "" : String(cell);
      // 逗號/雙引號/換行 → 需引用
      if (/[",\n]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    }).join(",")
  ).join("\n");
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// 🔧 修復 1: 改進 flash 動畫機制
const flashHelper = (setter, duration = 800) => {
  setter(true);
  setTimeout(() => setter(false), duration);
};

export default function ModuleInventoryLog() {
  /* State */
  const [sn, setSn] = useState("");
  const [msg, setMsg] = useState("");
  const [flashOK, setFlashOK] = useState(false);
  const [flashErr, setFlashErr] = useState(false);

  // 🔧 修復 2: 新增狀態管理，避免重複提交
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastSubmittedSn, setLastSubmittedSn] = useState("");

  const [cntA, setCntA] = useState(0);
  const [cntB, setCntB] = useState(0);
  const [chartLbl, setChartLbl] = useState([]);
  const [trendA, setTrendA] = useState([]);
  const [trendB, setTrendB] = useState([]);

  // View-DB / Export / NG Modal
  const [showAll, setShowAll] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showNg, setShowNg] = useState(false);
  const [allRows, setAllRows] = useState([]);

  // NG / Update fields
  const [ngSn, setNgSn] = useState("");
  const [ngReason, setNgReason] = useState(""); // ★ 新增：NG 原因
  const [showUpdate, setShowUpdate] = useState(false);
  const [newSn, setNewSn] = useState("");

  // 匯出區塊
  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [range, setRange] = useState({ from: todayISO, to: todayISO });
  const [exportType, setExportType] = useState("details"); // details | per_day | per_hour
  const [statusFilter, setStatusFilter] = useState("all"); // all | ok | NG | Fixed
  const [maxRows, setMaxRows] = useState(5000);

  /* Refs */
  const inputRef = useRef(null);
  const ngInputRef = useRef(null);

  /* API helpers */
  const fetchCounts = useCallback(async () => {
    try {
      const { data } = await api.get("/model_inventory_daily_count");
      if (data.status === "success") {
        setCntA(data.count_a);
        setCntB(data.count_b);
      }
    } catch {
      /* silent */
    }
  }, []);

  const fetchTrend = useCallback(async () => {
    try {
      const { data } = await api.get("/model_inventory_trend");
      if (data.status === "success") {
        setChartLbl(data.labels);
        setTrendA(data.trend_a);
        setTrendB(data.trend_b);
      }
    } catch {
      /* silent */
    }
  }, []);

  // 取清單（支援參數）
  const fetchAll = useCallback(
    async (opts = {}) => {
      const params = {
        limit: opts.limit ?? 1000,
        from_date: opts.from_date,
        to_date: opts.to_date,
        status_filter: opts.status_filter ?? "all",
      };
      try {
        const { data } = await api.get("/model_inventory/list/all", { params });
        setAllRows(Array.isArray(data) ? data : []);
      } catch (e) {
        if (e.response?.status === 403) {
          setMsg("❌ Access Denied: Admin or Operator role required to view database");
          flashHelper(setFlashErr);
        } else if (e.response?.status === 401) {
          setMsg("❌ Please login to continue");
          flashHelper(setFlashErr);
        }
        setAllRows([]);
      }
    },
    []
  );

  // 🔧 修復 3: 改進提交邏輯，避免重複提交和狀態混亂
  const submit = useCallback(async () => {
    const snTrim = sn.trim();
    if (!snTrim || isSubmitting) return;

    // 防止重複提交相同的 SN
    if (snTrim === lastSubmittedSn) {
      setMsg("⚠️ Same serial number was just submitted");
      flashHelper(setFlashErr);
      return;
    }

    setIsSubmitting(true);

    // 🔧 修復 4: 清除之前的狀態，避免顏色混亂
    setFlashOK(false);
    setFlashErr(false);
    setMsg("Processing...");

    try {
      const { data } = await api.post("/model_inventory", { sn: snTrim });

      // 🔧 修復 5: 確保狀態更新的順序性
      setTimeout(() => {
        setMsg(data.message);
        if (data.status === "success") {
          flashHelper(setFlashOK);
          setSn("");
          setLastSubmittedSn(snTrim);
          // 異步更新數據，避免阻塞 UI
          Promise.all([fetchCounts(), fetchTrend()]);
        } else {
          flashHelper(setFlashErr);
        }
      }, 100);
    } catch (err) {
      setTimeout(() => {
        let errorMessage = "";
        if (err.response?.status === 403) {
          errorMessage = "❌ Access Denied: Admin or Operator role required for module scanning";
        } else if (err.response?.status === 401) {
          errorMessage = "❌ Please login to continue";
        } else if (err.response?.data?.message) {
          if (err.response.data.message === "duplicate") {
            errorMessage = "❌ Duplicate Serial: This module has already been registered";
          } else if (err.response.data.message === "bad SN format") {
            errorMessage = "❌ Invalid Serial Format: Please check the serial number format";
          } else if (err.response.data.message === "slow down") {
            errorMessage = "⚠️ Scanning Too Fast: Please wait a moment before scanning next module";
          } else {
            errorMessage = `❌ ${err.response.data.message}`;
          }
        } else {
          errorMessage = `❌ Network Error: ${err.message}`;
        }

        setMsg(errorMessage);
        flashHelper(setFlashErr);
      }, 100);
    } finally {
      setIsSubmitting(false);
      // 延遲對焦，確保動畫完成
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [sn, isSubmitting, lastSubmittedSn, fetchCounts, fetchTrend]);

  const onKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  /* useEffect: init */
  useEffect(() => {
    fetchCounts();
    fetchTrend();
    const ws = openDashboardSocket((m) => {
      if (m.event === "module_updated") {
        setCntA(m.count_a);
        setCntB(m.count_b);
        setChartLbl(m.labels);
        setTrendA(m.trend_a);
        setTrendB(m.trend_b);
      }
    });
    return () => ws.destroy();
  }, [fetchCounts, fetchTrend]);

  // 🔧 修復 6: 改進 NG API 調用（★ 需原因）
  const callNgApi = async (action) => {
    const snTrim = ngSn.trim();
    if (!snTrim) {
      setMsg("Serial Number required");
      flashHelper(setFlashErr);
      return;
    }

    setMsg("Processing...");
    const url = action === "NG" ? "/model_inventory/mark_ng" : "/model_inventory/clear_ng";

    try {
      if (action === "NG") {
        const reason = ngReason.trim();
        if (!reason) {
          setMsg("❌ NG reason required");
          flashHelper(setFlashErr);
          return;
        }
        const { data } = await api.post(url, { sn: snTrim, reason });
        setMsg(data.message || "Done");
      } else {
        const { data } = await api.post(url, { sn: snTrim });
        setMsg(data.message || "Done");
      }

      flashHelper(setFlashOK);
      await fetchAll({
        from_date: range.from,
        to_date: range.to,
        limit: 1000,
        status_filter: statusFilter
      });
      resetNgModal();
    } catch (e) {
      let errorMessage = "";
      if (e.response?.status === 403) {
        errorMessage = "❌ Access Denied: Admin or Operator role required for NG operations";
      } else if (e.response?.status === 401) {
        errorMessage = "❌ Please login to continue";
      } else if (e.response?.data?.message) {
        errorMessage = `❌ ${e.response.data.message}`;
      } else {
        errorMessage = `❌ Operation Failed: ${e.message}`;
      }

      setMsg(errorMessage);
      flashHelper(setFlashErr);
    }
  };

  const updateSn = useCallback(
    async (oldSn, newSerial) => {
      if (!oldSn.trim() || !newSerial.trim()) {
        setMsg("Both Serial Number fields required");
        flashHelper(setFlashErr);
        return;
      }

      setMsg("Updating...");
      try {
        const { data } = await api.post("/model_inventory/update_sn", {
          old_sn: oldSn.trim(),
          new_sn: newSerial.trim(),
        });
        setMsg(data.message || "Updated");
        flashHelper(setFlashOK);
        await Promise.all([
          fetchAll({
            from_date: range.from,
            to_date: range.to,
            limit: 1000,
            status_filter: statusFilter
          }),
          fetchCounts(),
          fetchTrend(),
        ]);
        resetNgModal();
      } catch (e) {
        let errorMessage = "";
        if (e.response?.status === 403) {
          errorMessage = "❌ Access Denied: Admin or Operator role required for serial number updates";
        } else if (e.response?.status === 401) {
          errorMessage = "❌ Please login to continue";
        } else if (e.response?.data?.message) {
          errorMessage = `❌ ${e.response.data.message}`;
        } else {
          errorMessage = `❌ Update Failed: ${e.message}`;
        }

        setMsg(errorMessage);
        flashHelper(setFlashErr);
      }
    },
    [fetchAll, fetchCounts, fetchTrend, range.from, range.to, statusFilter]
  );

  const resetNgModal = () => {
    setNgSn("");
    setNgReason(""); // 清空原因
    setNewSn("");
    setShowUpdate(false);
    setShowNg(false);
  };

  /* Export - UI & Helpers */
  const onRange = (e) =>
    setRange((p) => ({ ...p, [e.target.name]: e.target.value }));

  const exportCsv = async () => {
    if (!range.from || !range.to) {
      setMsg("Please select date range");
      flashHelper(setFlashErr);
      return;
    }
    if (exportType === "per_hour" && range.from !== range.to) {
      setMsg("⚠️ Units per hour export requires a single day (From = To)");
      flashHelper(setFlashErr);
      return;
    }

    setMsg("Exporting...");
    try {
      const params = {
        from_date: range.from,
        to_date: range.to,
        limit: maxRows,
        status_filter: statusFilter,
      };
      const { data } = await api.get("/model_inventory/list/all", { params });
      const rows = Array.isArray(data) ? data : [];

      if (rows.length === 0) {
        setMsg("No data in selected range");
        flashHelper(setFlashErr);
        return;
      }

      if (exportType === "details") {
        // 明細：sn, kind, status, ng_reason, timestamp
        const header = ["sn", "kind", "status", "ng_reason", "timestamp"];
        const csvRows = [header];
        rows.forEach(r => {
          csvRows.push([
            r.sn,
            r.kind,
            r.status || "OK",
            r.ng_reason || "",
            r.timestamp,
          ]);
        });
        toCsvAndDownload(csvRows, `module_details_${range.from}_to_${range.to}.csv`);
      } else if (exportType === "per_day") {
        // 逐日彙總
        const byDate = {};
        rows.forEach(r => {
          const d = (r.timestamp || "").slice(0, 10);
          if (!byDate[d]) {
            byDate[d] = { A: 0, B: 0, NG: 0 };
          }
          if (r.kind === "A") byDate[d].A += 1;
          else if (r.kind === "B") byDate[d].B += 1;
          if (r.status === "NG") byDate[d].NG += 1;
        });

        const header = ["date", "count_a", "count_b", "total", "ok_count", "ng_count"];
        const csvRows = [header];
        Object.keys(byDate).sort().forEach(d => {
          const a = byDate[d].A;
          const b = byDate[d].B;
          const total = a + b;
          const ng = byDate[d].NG;
          const ok = total - ng;
          csvRows.push([d, a, b, total, ok, ng]);
        });
        toCsvAndDownload(csvRows, `module_daily_${range.from}_to_${range.to}.csv`);
      } else {
        // per_hour：同一天依小時彙總
        const byHour = {};
        rows.forEach(r => {
          const ts = r.timestamp || "";
          const d = ts.slice(0, 10);
          if (d !== range.from) return; // 僅當天
          const hh = ts.slice(11, 13) || "00";
          if (!byHour[hh]) {
            byHour[hh] = { A: 0, B: 0, NG: 0 };
          }
          if (r.kind === "A") byHour[hh].A += 1;
          else if (r.kind === "B") byHour[hh].B += 1;
          if (r.status === "NG") byHour[hh].NG += 1;
        });

        const header = ["hour", "count_a", "count_b", "total", "ok_count", "ng_count"];
        const csvRows = [header];
        Object.keys(byHour).sort().forEach(hh => {
          const a = byHour[hh].A;
          const b = byHour[hh].B;
          const total = a + b;
          const ng = byHour[hh].NG;
          const ok = total - ng;
          csvRows.push([`${hh}:00`, a, b, total, ok, ng]);
        });
        toCsvAndDownload(csvRows, `module_hourly_${range.from}.csv`);
      }

      setMsg("✅ Export completed");
      flashHelper(setFlashOK);
      setShowExport(false);
    } catch (e) {
      let errorMessage = "";
      if (e.response?.status === 403) {
        errorMessage = "❌ Access Denied: Admin or Operator role required for data export";
      } else if (e.response?.status === 401) {
        errorMessage = "❌ Please login to continue";
      } else if (e.response?.data?.message) {
        errorMessage = `❌ ${e.response.data.message}`;
      } else {
        errorMessage = "❌ Export Failed: Please try again later";
      }

      setMsg(errorMessage);
      flashHelper(setFlashErr);
    }
  };

  const handleDelete = async (id, serialNumber) => {
    if (!window.confirm(`Delete ${serialNumber}?`)) return;

    setMsg("Deleting...");
    try {
      const { data } = await api.delete(`/model_inventory/delete/${id}`);
      setMsg(data.message || "Deleted");
      flashHelper(setFlashOK);
      await Promise.all([
        fetchAll({
          from_date: range.from,
          to_date: range.to,
          limit: 1000,
          status_filter: statusFilter
        }),
        fetchCounts(),
        fetchTrend(),
      ]);
    } catch (e) {
      let errorMessage = "";
      if (e.response?.status === 403) {
        errorMessage = "❌ Access Denied: Admin role required for record deletion";
      } else if (e.response?.status === 401) {
        errorMessage = "❌ Please login to continue";
      } else if (e.response?.data?.message) {
        errorMessage = `❌ ${e.response.data.message}`;
      } else {
        errorMessage = `❌ Delete Failed: ${e.message}`;
      }

      setMsg(errorMessage);
      flashHelper(setFlashErr);
    }
  };

  // 🔧 修復 8: 計算輸入框的動態樣式，避免顏色衝突
  const getInputClassName = () => {
    let baseClass = `flex-1 px-4 py-3 bg-white/80 backdrop-blur-sm border rounded-lg 
                     text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent
                     transition-all duration-300 shadow-sm`;

    if (isSubmitting) {
      baseClass += " border-yellow-400 bg-yellow-50/80";
    } else if (flashOK) {
      baseClass += " border-green-400 bg-green-50/80 animate-pulse";
    } else if (flashErr) {
      baseClass += " border-red-400 bg-red-50/80 animate-pulse";
    } else {
      baseClass += " border-gray-300";
    }

    return baseClass;
  };

  // 🔧 修復 9: 計算訊息框的動態樣式
  const getMessageClassName = () => {
    let baseClass = `mb-6 p-4 rounded-lg text-center font-medium animate-in fade-in
                     backdrop-blur-sm shadow-lg transition-all duration-300`;

    if (flashErr || msg.includes("❌") || msg.includes("⚠️")) {
      baseClass += " bg-red-100/80 text-red-800 border border-red-300";
    } else if (flashOK || msg.includes("✅")) {
      baseClass += " bg-green-100/80 text-green-800 border border-green-300";
    } else {
      baseClass += " bg-blue-100/80 text-blue-800 border border-blue-300";
    }

    return baseClass;
  };

  const statusBadge = (status) => {
    const s = status || "";
    if (s === "NG") {
      return (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
          <XCircle className="w-3 h-3 mr-1" />
          NG
        </span>
      );
    }
    if (s === "Fixed") {
      return (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
          <CheckCircle className="w-3 h-3 mr-1" />
          Fixed
        </span>
      );
    }
    // OK（空字串）
    return (
      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
        <CheckCircle className="w-3 h-3 mr-1" />
        OK
      </span>
    );
  };

  /* UI */
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 py-4 px-4 sm:px-6 lg:px-8"
      style={{ colorScheme: "light" }}>

      <div className="max-w-7xl mx-auto relative z-10">
        {/* 主玻璃卡片 */}
        <div className="backdrop-blur-xl bg-white/30 rounded-3xl shadow-2xl border border-white/20 p-6 mb-6">
          <div className="bg-white/70 backdrop-blur-sm rounded-2xl p-6">

            {/* 頂部控制按鈕 */}
            <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                <div className="p-3 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-xl shadow-lg">
                  <BatteryMedium className="w-8 h-8 text-white" />
                </div>
                Module Line Production
              </h1>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => {
                    if (!showAll) {
                      fetchAll({
                        from_date: range.from,
                        to_date: range.to,
                        limit: 1000,
                        status_filter: statusFilter
                      });
                    }
                    setShowAll((v) => !v);
                  }}
                  className="px-4 py-2 bg-white/80 backdrop-blur-sm border border-gray-300 
                           text-gray-700 hover:bg-gray-50 font-medium rounded-lg 
                           transition-all duration-200 flex items-center gap-2 shadow-sm"
                >
                  <Database size={18} />
                  View DB
                </button>

                <button
                  onClick={() => {
                    setShowNg(true);
                    setTimeout(() => ngInputRef.current?.focus(), 60);
                  }}
                  className="px-4 py-2 bg-white border border-gray-300 text-gray-700 
                         hover:bg-gray-50 font-medium rounded-lg transition-all duration-200 
                         flex items-center gap-2 shadow-sm"
                >
                  <AlertCircle size={18} />
                  NG
                </button>

                <button
                  onClick={() => setShowExport((v) => !v)}
                  className="px-4 py-2 bg-white border border-gray-300 text-gray-700 
                         hover:bg-gray-50 font-medium rounded-lg transition-all duration-200 
                         flex items-center gap-2 shadow-sm"
                >
                  <Download size={18} />
                  Export
                </button>
              </div>
            </div>

            {/* Export Panel（前端 CSV） */}
            {showExport && (
              <div className="mb-6 p-4 bg-gradient-to-r from-green-50/80 to-emerald-50/80 
                            backdrop-blur-sm rounded-xl border border-green-200/50 
                            flex flex-col gap-4 animate-in slide-in-from-top">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="font-medium text-gray-700">Export type:</span>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="exportType"
                      checked={exportType === "details"}
                      onChange={() => setExportType("details")}
                    />
                    Export all details
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="exportType"
                      checked={exportType === "per_day"}
                      onChange={() => setExportType("per_day")}
                    />
                    Units per day
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="exportType"
                      checked={exportType === "per_hour"}
                      onChange={() => setExportType("per_hour")}
                    />
                    Units per hour
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <span className="font-medium text-gray-700">Range:</span>
                  <input
                    type="date"
                    name="from"
                    value={range.from}
                    onChange={onRange}
                    className="px-4 py-2 bg-white/80 border border-gray-300 rounded-lg 
                             focus:ring-2 focus:ring-green-500 focus:border-transparent text-black"
                  />
                  <span className="text-gray-600">to</span>
                  <input
                    type="date"
                    name="to"
                    value={range.to}
                    onChange={onRange}
                    className="px-4 py-2 bg-white/80 border border-gray-300 rounded-lg 
                             focus:ring-2 focus:ring-green-500 focus:border-transparent text-black"
                  />

                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-700">Status:</span>
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="px-3 py-2 bg-white/80 border border-gray-300 rounded-lg 
                               focus:ring-2 focus:ring-green-500 focus:border-transparent text-black"
                    >
                      <option value="all">All</option>
                      <option value="ok">OK</option>
                      <option value="NG">NG</option>
                      <option value="Fixed">Fixed</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-700">Max rows:</span>
                    <input
                      type="number"
                      min={1}
                      value={maxRows}
                      onChange={(e) => setMaxRows(Number(e.target.value || 1))}
                      className="w-28 px-3 py-2 bg-white/80 border border-gray-300 rounded-lg 
                               focus:ring-2 focus:ring-green-500 focus:border-transparent text-black"
                    />
                  </div>

                  <button
                    onClick={exportCsv}
                    className="ml-auto px-6 py-2 bg-gradient-to-r from-green-500 to-emerald-500 
                             hover:from-green-600 hover:to-emerald-600 text-white font-medium 
                             rounded-lg transition-all duration-200 shadow-sm"
                  >
                    Download CSV
                  </button>
                </div>

                {exportType === "per_hour" && range.from !== range.to && (
                  <div className="text-sm text-amber-700">
                    * Units per hour 只支援單一日期，請將 From 與 To 設為同一天。
                  </div>
                )}
              </div>
            )}

            {/* 生產統計 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div className="backdrop-blur-md bg-gradient-to-br from-blue-400/20 to-indigo-600/20 
                            rounded-xl p-6 border border-blue-200/50 shadow-lg
                            transition-all duration-300 hover:shadow-xl hover:scale-105">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-blue-800">A-Modules</div>
                  <Activity className="w-5 h-5 text-blue-600" />
                </div>
                <div className="text-4xl font-bold text-blue-900">{cntA}</div>
                <div className="text-xs text-blue-700 mt-1">units produced today</div>
              </div>

              <div className="backdrop-blur-md bg-gradient-to-br from-amber-400/20 to-orange-600/20 
                            rounded-xl p-6 border border-amber-200/50 shadow-lg
                            transition-all duration-300 hover:shadow-xl hover:scale-105">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-amber-800">B-Modules</div>
                  <Activity className="w-5 h-5 text-amber-600" />
                </div>
                <div className="text-4xl font-bold text-amber-900">{cntB}</div>
                <div className="text-xs text-amber-700 mt-1">units produced today</div>
              </div>
            </div>

            {/* 🔧 修復 10: 改進掃描表單，避免重復提交 */}
            <form onSubmit={(e) => e.preventDefault()} className="mb-8">
              <label htmlFor="snInput" className="block text-sm font-medium text-gray-700 mb-2">
                Serial Number
              </label>
              <div className="flex gap-3">
                <input
                  id="snInput"
                  ref={inputRef}
                  value={sn}
                  onChange={(e) => setSn(e.target.value)}
                  onKeyDown={onKey}
                  disabled={isSubmitting}
                  autoFocus
                  className={getInputClassName()}
                  placeholder={isSubmitting ? "Processing..." : "Scan or enter serial number"}
                />
                <button
                  type="button"
                  onClick={submit}
                  disabled={isSubmitting || !sn.trim()}
                  className={`px-6 py-3 font-semibold rounded-lg shadow-lg 
                           transform transition-all duration-200 backdrop-blur-sm 
                           border border-white/20 flex items-center justify-center min-w-[60px]
                           ${isSubmitting || !sn.trim()
                      ? "bg-gray-400 text-gray-200 cursor-not-allowed"
                      : "bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white hover:scale-105"
                    }`}
                >
                  {isSubmitting ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <CheckCircle className="w-5 h-5" />
                  )}
                </button>
              </div>
            </form>

            {/* 🔧 修復 11: 改進訊息提示顯示 */}
            {msg && (
              <div className={getMessageClassName()}>
                {msg}
              </div>
            )}

            {/* 趨勢圖表 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="backdrop-blur-sm bg-white/60 rounded-xl p-6 border border-gray-200/50 shadow-lg">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <TrendingUp className="text-blue-600" size={20} />
                  A Modules Trend
                </h3>
                <div className="h-64">
                  <Line
                    data={{
                      labels: chartLbl,
                      datasets: [{
                        label: "A Modules",
                        data: trendA,
                        borderColor: "#3b82f6",
                        backgroundColor: "rgba(59, 130, 246, 0.1)",
                        tension: 0.3,
                        fill: true,
                        pointRadius: 4,
                        pointBackgroundColor: "#3b82f6",
                        pointBorderColor: "#fff",
                        pointBorderWidth: 2,
                      }],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { position: "bottom" },
                        tooltip: {
                          backgroundColor: "rgba(0, 0, 0, 0.8)",
                          padding: 12,
                          cornerRadius: 8,
                        }
                      },
                      scales: {
                        y: {
                          beginAtZero: true,
                          grid: { color: "rgba(0, 0, 0, 0.05)" }
                        },
                        x: {
                          grid: { display: false }
                        },
                      },
                    }}
                  />
                </div>
              </div>

              <div className="backdrop-blur-sm bg-white/60 rounded-xl p-6 border border-gray-200/50 shadow-lg">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <TrendingUp className="text-amber-600" size={20} />
                  B Modules Trend
                </h3>
                <div className="h-64">
                  <Line
                    data={{
                      labels: chartLbl,
                      datasets: [{
                        label: "B Modules",
                        data: trendB,
                        borderColor: "#f59e0b",
                        backgroundColor: "rgba(245, 158, 11, 0.1)",
                        tension: 0.3,
                        fill: true,
                        pointRadius: 4,
                        pointBackgroundColor: "#f59e0b",
                        pointBorderColor: "#fff",
                        pointBorderWidth: 2,
                      }],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { position: "bottom" },
                        tooltip: {
                          backgroundColor: "rgba(0, 0, 0, 0.8)",
                          padding: 12,
                          cornerRadius: 8,
                        }
                      },
                      scales: {
                        y: {
                          beginAtZero: true,
                          grid: { color: "rgba(0, 0, 0, 0.05)" }
                        },
                        x: {
                          grid: { display: false }
                        },
                      },
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* NG/Update Modal */}
      {showNg && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-md flex items-center
                        justify-center z-50 p-4 animate-in fade-in">
          <div className="backdrop-blur-md bg-white/90 rounded-2xl shadow-xl
                          max-w-md w-full border border-gray-300 animate-in zoom-in-95">

            <div className="bg-gray-200 px-6 py-4 rounded-t-2xl border-b border-gray-300">
              <h3 className="text-lg font-semibold text-black flex items-center gap-2">
                <AlertCircle className="text-black" />
                Mark NG / Fixed / Update
              </h3>
            </div>

            <div className="p-6 space-y-5">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-black mb-2">
                    Current Serial Number
                  </label>
                  <input
                    ref={ngInputRef}
                    value={ngSn}
                    onChange={(e) => setNgSn(e.target.value)}
                    placeholder="Scan or enter SN"
                    className="w-full px-4 py-3 bg-white border border-gray-400 rounded-lg
                             focus:ring-2 focus:ring-gray-600 focus:border-transparent"
                  />
                </div>

                {/* ★ 新增：NG 原因輸入 */}
                <div>
                  <label className="block text-sm font-medium text-black mb-2">
                    NG Reason (required for NG)
                  </label>
                  <textarea
                    value={ngReason}
                    onChange={(e) => setNgReason(e.target.value)}
                    rows={2}
                    placeholder="Describe the reason..."
                    className="w-full px-4 py-3 bg-white border border-gray-400 rounded-lg
                             focus:ring-2 focus:ring-gray-600 focus:border-transparent resize-none"
                  />
                </div>

                {showUpdate && (
                  <div className="animate-in slide-in-from-top">
                    <label className="block text-sm font-medium text-black mb-2">
                      New Serial Number
                    </label>
                    <input
                      value={newSn}
                      onChange={(e) => setNewSn(e.target.value)}
                      placeholder="Enter new SN"
                      className="w-full px-4 py-3 bg-white border border-gray-400 rounded-lg
                               focus:ring-2 focus:ring-gray-600 focus:border-transparent"
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  onClick={() => callNgApi("NG")}
                  className="px-4 py-2.5 bg-gray-300 hover:bg-gray-400 text-black
                           font-medium rounded-lg transition-colors"
                >
                  NG
                </button>

                <button
                  onClick={() => callNgApi("FIX")}
                  className="px-4 py-2.5 bg-gray-300 hover:bg-gray-400 text-black
                           font-medium rounded-lg transition-colors"
                >
                  Fixed
                </button>

                {showUpdate ? (
                  <button
                    onClick={() => updateSn(ngSn.trim(), newSn.trim())}
                    className="px-4 py-2.5 bg-gray-300 hover:bg-gray-400 text-black
                             font-medium rounded-lg transition-colors"
                  >
                    Save
                  </button>
                ) : (
                  <button
                    onClick={() => setShowUpdate(true)}
                    className="px-4 py-2.5 bg-gray-300 hover:bg-gray-400 text-black
                             font-medium rounded-lg transition-colors"
                  >
                    Update
                  </button>
                )}

                <button
                  onClick={resetNgModal}
                  className="px-4 py-2.5 bg-gray-300 hover:bg-gray-400 text-black
                           font-medium rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* View DB Modal */}
      {showAll && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-md flex items-center
                      justify-center z-50 p-4 animate-in fade-in">
          <div className="backdrop-blur-xl bg-white/90 rounded-2xl shadow-2xl w-full
                        max-w-[95vw] max-h-[85vh] flex flex-col border border-white/30
                        animate-in zoom-in-95">
            <div className="bg-gradient-to-r from-blue-500 to-purple-500 p-6 rounded-t-2xl
                          flex items-center justify-between flex-shrink-0">
              <h3 className="text-xl font-semibold text-white flex items-center gap-2">
                <Database />
                All Module Records
              </h3>
              <div className="flex items-center gap-3">
                {/* 顯示同匯出控制的查詢條件（簡版） */}
                <input
                  type="date"
                  value={range.from}
                  onChange={(e) => setRange((p) => ({ ...p, from: e.target.value }))}
                  className="px-2 py-1 rounded text-sm"
                />
                <span className="text-white/80">to</span>
                <input
                  type="date"
                  value={range.to}
                  onChange={(e) => setRange((p) => ({ ...p, to: e.target.value }))}
                  className="px-2 py-1 rounded text-sm"
                />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-2 py-1 rounded text-sm"
                >
                  <option value="all">All</option>
                  <option value="ok">OK</option>
                  <option value="NG">NG</option>
                  <option value="Fixed">Fixed</option>
                </select>
                <button
                  onClick={() =>
                    fetchAll({
                      from_date: range.from,
                      to_date: range.to,
                      limit: 1000,
                      status_filter: statusFilter
                    })
                  }
                  className="px-3 py-1.5 bg-white/20 border border-white/40 rounded text-white hover:bg-white/30 text-sm"
                >
                  Refresh
                </button>
                <button
                  onClick={() => setShowAll(false)}
                  className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                >
                  <X size={20} className="text-white" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-6">
              <div className="bg-white rounded-lg shadow-inner border border-gray-200 overflow-x-auto">
                <table className="w-full min-w-[900px]">
                  <thead className="sticky top-0 bg-gradient-to-r from-gray-50 to-gray-100 z-10">
                    <tr className="border-b border-gray-200">
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Serial Number
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        NG Reason
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                        Timestamp
                      </th>
                      <th className="px-6 py-4 w-20"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {allRows.map((r) => (
                      <tr
                        key={r.id}
                        className={`hover:bg-gray-50 transition-colors ${r.status === "NG" ? "bg-red-50" : ""}`}
                      >
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">{r.sn}</td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium
                            ${r.kind === "A" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"}`}
                          >
                            {r.kind}-Module
                          </span>
                        </td>
                        <td className="px-6 py-4">{statusBadge(r.status)}</td>
                        <td className="px-6 py-4 text-sm text-gray-700">{r.ng_reason || ""}</td>
                        <td className="px-6 py-4 text-sm text-gray-500">{r.timestamp}</td>
                        <td className="px-6 py-4">
                          <button
                            onClick={() => handleDelete(r.id, r.sn)}
                            className="p-2 text-red-600 hover:bg-red-100 rounded-lg 
                                     transition-all duration-200 group"
                            title="Delete record"
                          >
                            <Trash2 size={16} className="group-hover:scale-110 transition-transform" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {allRows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                          <div className="flex flex-col items-center gap-3">
                            <Database className="w-12 h-12 text-gray-300" />
                            <p className="text-lg font-medium">No records found</p>
                            <p className="text-sm">Change filters or date range and try again</p>
                          </div>
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
