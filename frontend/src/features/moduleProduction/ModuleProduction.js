// src/features/moduleProduction/ModuleProduction.js

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import {
  BatteryMedium, Download, X, AlertCircle,
  CheckCircle, XCircle
} from "lucide-react";
import api from "../../services/api";
import { openDashboardSocket } from "../../utils/wsConnect";
import "./ModuleProduction.css";

/* CSV helper: add BOM for Excel friendliness */
const toCsvAndDownload = (rows, filename) => {
  const bom = "\uFEFF";
  const csv = rows.map(r =>
    r.map((cell) => {
      const s = cell == null ? "" : String(cell);
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

/* Tiny helper for flash effects */
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

  // prevent double submit
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastSubmittedSn, setLastSubmittedSn] = useState("");

  const [cntA, setCntA] = useState(0);
  const [cntB, setCntB] = useState(0);
  const [prevCntA, setPrevCntA] = useState(0);
  const [prevCntB, setPrevCntB] = useState(0);

  // Export / NG Modal
  const [showExport, setShowExport] = useState(false);
  const [showNg, setShowNg] = useState(false);

  // NG / Update fields
  const [ngSn, setNgSn] = useState("");
  const [ngReason, setNgReason] = useState(""); // NG reason is required when marking NG
  const [showUpdate, setShowUpdate] = useState(false);
  const [newSn, setNewSn] = useState("");

  // Duplicate modal
  const [showDup, setShowDup] = useState(false);
  const [dupInfo, setDupInfo] = useState(null);

  // Export range
  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [range, setRange] = useState({ from: todayISO, to: todayISO });
  const [exportType, setExportType] = useState("details"); // details | per_day | per_hour
  const [statusFilter, setStatusFilter] = useState("all"); // all | ok | NG | Fixed
  const [maxRows, setMaxRows] = useState(5000);

  /* Refs */
  const inputRef = useRef(null);
  const ngInputRef = useRef(null);

  /* Beep on duplicate */
  const playBeep = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 880;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      osc.stop(ctx.currentTime + 0.5);
    } catch {
      /* no-op */
    }
  }, []);

  /* Close duplicate modal: clear input + refocus + unlock lastSubmittedSn */
  const closeDuplicateModal = useCallback(() => {
    setShowDup(false);
    setSn("");
    setLastSubmittedSn("");
    setTimeout(() => inputRef.current?.focus(), 60);
  }, []);

  /* ESC closes duplicate modal (and clears input) */
  useEffect(() => {
    const onKeydown = (e) => {
      if (e.key === "Escape" && showDup) {
        closeDuplicateModal();
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [showDup, closeDuplicateModal]);

  /* API helpers */
  const fetchCounts = useCallback(async () => {
    try {
      const { data } = await api.get("model_inventory_daily_count");
      if (data.status === "success") {
        setPrevCntA(data.count_a);
        setPrevCntB(data.count_b);
        setCntA(data.count_a);
        setCntB(data.count_b);
      }
    } catch {
      /* no-op */
    }
  }, []);


  // Submit with duplicate modal
  const submit = useCallback(async () => {
    if (showDup) return; // block while modal is open
    const snTrim = sn.trim();
    if (!snTrim || isSubmitting) return;

    if (snTrim === lastSubmittedSn) {
      setMsg("⚠️ Same serial number was just submitted");
      flashHelper(setFlashErr);
      return;
    }

    setIsSubmitting(true);
    setFlashOK(false);
    setFlashErr(false);
    setMsg("Processing...");

    try {
      const { data } = await api.post("model_inventory", { sn: snTrim });

      setTimeout(() => {
        if (data?.message === "duplicate") {
          setDupInfo(data.record || { sn: snTrim });
          setShowDup(true);
          playBeep();
          flashHelper(setFlashErr);
          setMsg(""); // show only the modal
          setLastSubmittedSn(snTrim);
          return;
        }

        setMsg(data.message);
        if (data.status === "success") {
          flashHelper(setFlashOK);
          setSn("");
          setLastSubmittedSn(snTrim);
          fetchCounts();
        } else {
          flashHelper(setFlashErr);
        }
      }, 100);
    } catch (err) {
      setTimeout(() => {
        if (err?.response?.status === 409 && err.response?.data?.message === "duplicate") {
          const rec = err.response.data.record || { sn: snTrim };
          setDupInfo(rec);
          setShowDup(true);
          playBeep();
          flashHelper(setFlashErr);
          setMsg(""); // show only the modal
          setLastSubmittedSn(snTrim);
          return;
        }

        let errorMessage = "";
        if (err.response?.status === 403) {
          errorMessage = "❌ Access Denied: Admin or Operator role required for module scanning";
        } else if (err.response?.status === 401) {
          errorMessage = "❌ Please login to continue";
        } else if (err.response?.data?.message) {
          if (err.response.data.message === "bad SN format") {
            errorMessage = "❌ Invalid Serial Format: Please check the serial number format";
          } else if (err.response.data.message === "slow down") {
            errorMessage = "⚠️ Scanning Too Fast: Please wait a moment before scanning the next module";
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
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [sn, isSubmitting, lastSubmittedSn, fetchCounts, playBeep, showDup]);

  const onKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  /* init */
  useEffect(() => {
    fetchCounts();
    const ws = openDashboardSocket((m) => {
      if (m.event === "module_updated") {
        setPrevCntA(m.count_a);
        setPrevCntB(m.count_b);
        setCntA(m.count_a);
        setCntB(m.count_b);
      }
    });
    return () => ws.destroy();
  }, [fetchCounts]);

  // NG / Fixed
  const callNgApi = async (action) => {
    const snTrim = ngSn.trim();
    if (!snTrim) {
      setMsg("Serial Number required");
      flashHelper(setFlashErr);
      return;
    }

    setMsg("Processing...");
    const url = action === "NG" ? "model_inventory/mark_ng" : "model_inventory/clear_ng";

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
        const { data } = await api.post("model_inventory/update_sn", {
          old_sn: oldSn.trim(),
          new_sn: newSerial.trim(),
        });
        setMsg(data.message || "Updated");
        flashHelper(setFlashOK);
        await fetchCounts();
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
    [fetchCounts]
  );

  const resetNgModal = () => {
    setNgSn("");
    setNgReason("");
    setNewSn("");
    setShowUpdate(false);
    setShowNg(false);
  };

  /* Export */
  const onRange = (e) =>
    setRange((p) => ({ ...p, [e.target.name]: e.target.value }));

  const exportCsv = async () => {
    if (!range.from || !range.to) {
      setMsg("Please select date range");
      flashHelper(setFlashErr);
      return;
    }
    if (exportType === "per_hour" && range.from !== range.to) {
      setMsg("⚠️ Units-per-hour export requires a single day (From = To)");
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
      const { data } = await api.get("model_inventory/list/all", { params });
      const rows = Array.isArray(data) ? data : [];

      if (rows.length === 0) {
        setMsg("No data in selected range");
        flashHelper(setFlashErr);
        return;
      }

      if (exportType === "details") {
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
        const byHour = {};
        rows.forEach(r => {
          const ts = r.timestamp || "";
          const d = ts.slice(0, 10);
          if (d !== range.from) return;
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

  /* UI */
  return (
    <div className="module-container">
      <div className="max-w-[1800px] mx-auto relative z-10">
        {/* Main card */}
        <div className="bg-surface-panel rounded-xl border border-stroke/80 p-5 md:p-6 mb-5">

            {/* Header actions */}
            <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
              <h1 className="text-xl font-semibold text-ink-primary flex items-center gap-3">
                <div className="p-2.5 bg-teal-500/10 rounded-lg">
                  <BatteryMedium className="w-5 h-5 text-teal-400" />
                </div>
                Module Line Production
              </h1>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    setShowNg(true);
                    setTimeout(() => ngInputRef.current?.focus(), 60);
                  }}
                  className="btn-secondary btn-ng flex items-center gap-2"
                >
                  <AlertCircle size={18} />
                  NG
                </button>

                <button
                  onClick={() => setShowExport((v) => !v)}
                  className="btn-secondary btn-export flex items-center gap-2"
                >
                  <Download size={18} />
                  Export
                </button>
              </div>
            </div>

            {/* Export Panel */}
            {showExport && (
              <div className="mb-4 p-4 bg-surface-raised rounded-lg space-y-3">
                <div className="flex items-center gap-2 text-ink-secondary">
                  <Download className="w-4 h-4" />
                  <span className="font-medium text-sm">Export Options</span>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-ink-secondary text-sm">
                  <span className="font-medium">Type:</span>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="exportType"
                      checked={exportType === "details"}
                      onChange={() => setExportType("details")}
                      className="text-teal-400 focus:ring-teal-500"
                    />
                    All details
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="exportType"
                      checked={exportType === "per_day"}
                      onChange={() => setExportType("per_day")}
                      className="text-teal-400 focus:ring-teal-500"
                    />
                    Units per day
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="exportType"
                      checked={exportType === "per_hour"}
                      onChange={() => setExportType("per_hour")}
                      className="text-teal-400 focus:ring-teal-500"
                    />
                    Units per hour
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-ink-secondary text-sm">
                  <span className="font-medium">Range:</span>
                  <input
                    type="date"
                    name="from"
                    value={range.from}
                    onChange={onRange}
                    className="px-3 py-2 bg-surface-panel border border-stroke rounded-lg
                             focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  />
                  <span className="text-ink-muted">to</span>
                  <input
                    type="date"
                    name="to"
                    value={range.to}
                    onChange={onRange}
                    className="px-3 py-2 bg-surface-panel border border-stroke rounded-lg
                             focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  />

                  <div className="flex items-center gap-2">
                    <span className="font-medium">Status:</span>
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="px-3 py-2 bg-surface-panel border border-stroke rounded-lg
                               focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                    >
                      <option value="all">All</option>
                      <option value="ok">OK</option>
                      <option value="NG">NG</option>
                      <option value="Fixed">Fixed</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="font-medium">Max rows:</span>
                    <input
                      type="number"
                      min={1}
                      value={maxRows}
                      onChange={(e) => setMaxRows(Number(e.target.value || 1))}
                      className="w-24 px-3 py-2 bg-surface-panel border border-stroke rounded-lg
                               focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                    />
                  </div>

                  <button
                    onClick={exportCsv}
                    className="ml-auto px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white font-medium
                             rounded-md transition-colors duration-150"
                  >
                    Download CSV
                  </button>
                </div>

                {exportType === "per_hour" && range.from !== range.to && (
                  <div className="text-sm text-amber-400 bg-signal-warn/10 border border-amber-500/30 rounded-lg p-2">
                    Units-per-hour export only supports a single date. Set From and To to the same day.
                  </div>
                )}
              </div>
            )}

            {/* Production stats - Unified Mini Metric Pattern */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-surface-panel border border-stroke/80 rounded-xl p-5">
                <div className="text-[11px] font-medium uppercase tracking-wider text-ink-muted mb-2">
                  A-Modules Today
                </div>
                <div className={`text-5xl md:text-6xl font-bold tabular-nums text-teal-400 ${cntA !== prevCntA ? 'number-change' : ''}`}>
                  {cntA}
                </div>
              </div>

              <div className="bg-surface-panel border border-stroke/80 rounded-xl p-5">
                <div className="text-[11px] font-medium uppercase tracking-wider text-ink-muted mb-2">
                  B-Modules Today
                </div>
                <div className={`text-5xl md:text-6xl font-bold tabular-nums text-orange-500 ${cntB !== prevCntB ? 'number-change' : ''}`}>
                  {cntB}
                </div>
              </div>
            </div>

            {/* Scan form */}
            <form onSubmit={(e) => e.preventDefault()} className="mb-6">
              <label htmlFor="snInput" className="block text-sm font-medium text-ink-secondary mb-2">
                Serial Number
              </label>
              <div className="flex gap-2">
                <input
                  id="snInput"
                  ref={inputRef}
                  value={sn}
                  onChange={(e) => setSn(e.target.value)}
                  onKeyDown={onKey}
                  disabled={isSubmitting}
                  autoFocus
                  className={`flex-1 px-3 py-3 bg-surface-panel border rounded-lg text-ink-primary text-base
                           focus:ring-2 focus:ring-teal-500 focus:border-teal-500
                           disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150
                           ${isSubmitting ? "border-amber-400 bg-signal-warn/10" :
                             flashOK ? "border-emerald-400 bg-signal-ok/10" :
                             flashErr ? "border-red-400 bg-signal-error/10" : "border-stroke"}`}
                  placeholder={isSubmitting ? "Processing..." : "Scan or enter serial number"}
                />
                <button
                  type="button"
                  onClick={submit}
                  disabled={isSubmitting || !sn.trim()}
                  className={`px-5 py-3 font-medium rounded-lg transition-colors duration-150
                           flex items-center justify-center min-w-[56px]
                           ${isSubmitting || !sn.trim()
                      ? "bg-surface-overlay text-ink-muted cursor-not-allowed"
                      : "bg-teal-600 hover:bg-teal-700 text-white"
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

            {/* Inline status message (success / error / info) */}
            {msg && (
              <div className={`alert ${flashErr || msg.includes("Access Denied") || msg.includes("Error") || msg.includes("Failed")
                  ? "alert-error"
                  : flashOK || msg.includes("completed") || msg.includes("success")
                    ? "alert-success"
                    : "alert-info"}`}>
                {flashErr && <XCircle className="w-5 h-5 flex-shrink-0" />}
                {flashOK && <CheckCircle className="w-5 h-5 flex-shrink-0" />}
                {!flashErr && !flashOK && <AlertCircle className="w-5 h-5 flex-shrink-0" />}
                <span>{msg.replace(/[❌✅⚠️]/g, '').trim()}</span>
              </div>
            )}

        </div>
      </div>

      {/* NG/Update Modal */}
      {showNg && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface-panel rounded-xl shadow-lg max-w-md w-full border border-stroke/80">
            <div className="px-5 py-4 border-b border-stroke flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-signal-warn/10 text-amber-400">
                  <AlertCircle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-ink-primary">NG / Fixed / Update</h3>
                  <p className="text-xs text-ink-muted">Manage module status</p>
                </div>
              </div>
              <button
                onClick={resetNgModal}
                className="p-1.5 rounded-lg hover:bg-surface-raised transition-colors duration-150"
                aria-label="Close"
              >
                <X size={16} className="text-ink-muted" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-ink-secondary mb-1.5">
                    Serial Number
                  </label>
                  <input
                    ref={ngInputRef}
                    value={ngSn}
                    onChange={(e) => setNgSn(e.target.value)}
                    placeholder="Scan or enter SN"
                    className="w-full px-3 py-2.5 bg-surface-panel border border-stroke rounded-lg
                             focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  />
                </div>

                {/* NG reason */}
                <div>
                  <label className="block text-sm font-medium text-ink-secondary mb-1.5">
                    NG Reason (required for NG)
                  </label>
                  <textarea
                    value={ngReason}
                    onChange={(e) => setNgReason(e.target.value)}
                    rows={2}
                    placeholder="Describe the reason..."
                    className="w-full px-3 py-2.5 bg-surface-panel border border-stroke rounded-lg
                             focus:ring-2 focus:ring-teal-500 focus:border-teal-500 resize-none"
                  />
                </div>

                {showUpdate && (
                  <div>
                    <label className="block text-sm font-medium text-ink-secondary mb-1.5">
                      New Serial Number
                    </label>
                    <input
                      value={newSn}
                      onChange={(e) => setNewSn(e.target.value)}
                      placeholder="Enter new SN"
                      className="w-full px-3 py-2.5 bg-surface-panel border border-stroke rounded-lg
                               focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2">
                <button
                  onClick={() => callNgApi("NG")}
                  className="px-3 py-2.5 bg-signal-error hover:bg-red-600 text-white font-medium rounded-lg transition-colors duration-150 flex items-center justify-center gap-1.5 text-sm"
                >
                  <XCircle size={14} />
                  NG
                </button>

                <button
                  onClick={() => callNgApi("FIX")}
                  className="px-3 py-2.5 bg-signal-ok hover:bg-emerald-600 text-white font-medium rounded-lg transition-colors duration-150 flex items-center justify-center gap-1.5 text-sm"
                >
                  <CheckCircle size={14} />
                  Fixed
                </button>

                {showUpdate ? (
                  <button
                    onClick={() => updateSn(ngSn.trim(), newSn.trim())}
                    className="px-3 py-2.5 bg-slate-700 hover:bg-slate-800 text-white font-medium rounded-lg transition-colors duration-150 text-sm"
                  >
                    Save
                  </button>
                ) : (
                  <button
                    onClick={() => setShowUpdate(true)}
                    className="px-3 py-2.5 bg-slate-700 hover:bg-slate-800 text-white font-medium rounded-lg transition-colors duration-150 text-sm"
                  >
                    Update
                  </button>
                )}

                <button
                  onClick={resetNgModal}
                  className="px-3 py-2.5 bg-surface-panel hover:bg-surface-base text-ink-secondary font-medium rounded-lg transition-colors duration-150 border border-stroke col-span-2 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate Warning Modal */}
      {showDup && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-lg bg-surface-panel rounded-xl shadow-lg border border-stroke/80">
            <div className="px-5 py-4 rounded-t-xl bg-signal-error text-white">
              <div className="text-base font-semibold">Duplicate Serial Detected</div>
              <div className="text-sm opacity-90">This serial already exists in the database.</div>
            </div>

            <div className="p-5 space-y-4 text-ink-secondary">
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="font-medium text-ink-muted">Serial</div>
                <div className="col-span-2 break-all text-ink-primary">{dupInfo?.sn || "-"}</div>

                <div className="font-medium text-ink-muted">Type</div>
                <div className="col-span-2 text-ink-primary">{dupInfo?.kind ? `${dupInfo.kind}-Module` : "-"}</div>

                <div className="font-medium text-ink-muted">Timestamp</div>
                <div className="col-span-2 text-ink-primary">{dupInfo?.ts || dupInfo?.timestamp || "-"}</div>

                <div className="font-medium text-ink-muted">Status</div>
                <div className="col-span-2 text-ink-primary">{dupInfo?.status || "OK"}</div>

                {(dupInfo?.status === "NG" || dupInfo?.ng_reason) && (
                  <>
                    <div className="font-medium text-ink-muted">NG Reason</div>
                    <div className="col-span-2 whitespace-pre-wrap text-ink-primary">{dupInfo?.ng_reason || "-"}</div>
                  </>
                )}
              </div>

              <div className="text-sm text-red-400 bg-signal-error/10 border border-red-500/30 rounded-lg p-3">
                Please check if the scanner double-triggered, or if the same module was scanned by mistake.
              </div>

              <div className="flex flex-wrap gap-2 justify-end pt-2">
                <button
                  onClick={() => {
                    const v = dupInfo?.sn ? String(dupInfo.sn) : "";
                    if (v) navigator.clipboard.writeText(v).catch(() => {});
                  }}
                  className="px-4 py-2 rounded-lg border border-stroke text-ink-secondary hover:bg-surface-base text-sm font-medium transition-colors duration-150"
                >
                  Copy SN
                </button>

                <button
                  onClick={closeDuplicateModal}
                  className="px-4 py-2 rounded-lg bg-signal-error text-white hover:bg-red-600 text-sm font-medium transition-colors duration-150"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
