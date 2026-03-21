// frontend/src/features/ateTesting/ATETesting.js
// ATE Testing - NG Management Interface (Mobile-First RWD Design)

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Activity, Search, XCircle, CheckCircle, Loader2, AlertCircle, Download } from "lucide-react";
import api from "../../services/api";
import useWs from "../../utils/wsConnect";
import useMessageTimer from "../../utils/useMessageTimer";
import "./ATETesting.css";

export default function ATETesting() {
  // ─────────────────────────── State Management ───────────────────────────
  const [sn, setSn] = useState("");
  const [ngReason, setNgReason] = useState("");
  const [currentRecord, setCurrentRecord] = useState(null);
  const [moduleA, setModuleA] = useState("");
  const [moduleB, setModuleB] = useState("");
  const [pcbaAu8, setPcbaAu8] = useState("");
  const [pcbaAm7, setPcbaAm7] = useState("");
  const [stats, setStats] = useState({
    ng_count: 0,
    fixed_count: 0,
    pass_rate: 100,
    total_today: 0
  });
  const [recentNg, setRecentNg] = useState([]);
  const [message, showMessage] = useMessageTimer(4000);
  const [loading, setLoading] = useState(false);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);

  // Refs
  const snInputRef = useRef(null);

  // ─────────────────────────── API Calls ───────────────────────────

  // Fetch today's stats
  const fetchStats = useCallback(async () => {
    try {
      const { data } = await api.get("ate/stats");
      setStats(data);
    } catch (error) {
      console.error("Error fetching stats:", error);
    }
  }, []);

  // Fetch recent NG records
  const fetchRecentNg = useCallback(async () => {
    try {
      const { data } = await api.get("ate/recent?limit=50&include_fixed=true");
      setRecentNg(data.records || []);
    } catch (error) {
      console.error("Error fetching recent NG:", error);
    }
  }, []);

  // Scan SN
  const handleScan = async () => {
    const trimmedSn = sn.trim();
    if (!trimmedSn) {
      showMessage("Please enter a serial number", "error");
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.get(`ate/scan/${encodeURIComponent(trimmedSn)}`);

      if (data.exists) {
        setCurrentRecord(data.record);
        setModuleA(data.record?.module_a || "");
        setModuleB(data.record?.module_b || "");
        setPcbaAu8(data.record?.pcba_au8 || "");
        setPcbaAm7(data.record?.pcba_am7 || "");
        if ((data.record?.status || "").toUpperCase() === "NG") {
          setNgReason(data.record?.ng_reason || "");
        } else {
          setNgReason("");
        }
        showMessage(data.message, "success");
      } else {
        setCurrentRecord(null);
        setModuleA("");
        setModuleB("");
        setPcbaAu8("");
        setPcbaAm7("");
        setNgReason("");
        showMessage(data.message, "error");
      }
    } catch (error) {
      console.error("Scan error:", error);
      showMessage(
        error.response?.data?.detail || error.message || "Scan failed",
        "error"
      );
      setCurrentRecord(null);
      setModuleA("");
      setModuleB("");
      setPcbaAu8("");
      setPcbaAm7("");
      setNgReason("");
    } finally {
      setLoading(false);
    }
  };

  // Mark NG
  const markNG = async () => {
    const trimmedSn = sn.trim();
    const trimmedReason = ngReason.trim();

    if (!trimmedSn) {
      showMessage("Please scan a serial number first", "error");
      return;
    }

    if (!currentRecord) {
      showMessage("Please scan a valid serial number first", "error");
      return;
    }

    if ((currentRecord.status || "").toUpperCase() === "NG") {
      showMessage("This serial number is already marked NG", "error");
      return;
    }

    if (!trimmedReason) {
      showMessage("Please enter NG reason", "error");
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post("ate/mark_ng", {
        us_sn: trimmedSn,
        reason: trimmedReason
      });

      showMessage(data.message || "Successfully marked as NG", "success");

      // WebSocket will trigger fetchStats() and fetchRecentNg() automatically
      // No need to refresh here - avoids duplicate API calls

      // Clear form
      clearForm();
    } catch (error) {
      console.error("Mark NG error:", error);
      showMessage(
        error.response?.data?.detail || error.message || "Failed to mark as NG",
        "error"
      );
    } finally {
      setLoading(false);
    }
  };

  // Clean NG
  const cleanNG = async () => {
    const trimmedSn = sn.trim();

    if (!trimmedSn) {
      showMessage("Please scan a serial number first", "error");
      return;
    }

    if (!currentRecord) {
      showMessage("Please scan a valid serial number first", "error");
      return;
    }

    if ((currentRecord.status || "").toUpperCase() !== "NG") {
      showMessage("This serial number is not marked NG", "error");
      return;
    }

    if (!window.confirm(`Clear NG status for ${trimmedSn}?`)) {
      return;
    }

    setLoading(true);
    try {
      const payload = { us_sn: trimmedSn };
      if (moduleA.trim()) payload.module_a = moduleA.trim();
      if (moduleB.trim()) payload.module_b = moduleB.trim();
      if (pcbaAu8.trim()) payload.pcba_au8 = pcbaAu8.trim();
      if (pcbaAm7.trim()) payload.pcba_am7 = pcbaAm7.trim();

      const { data } = await api.post("ate/clear_ng", payload);

      showMessage(data.message || "Successfully cleared NG", "success");

      // WebSocket will trigger fetchStats() and fetchRecentNg() automatically
      // No need to refresh here - avoids duplicate API calls

      // Clear form
      clearForm();
    } catch (error) {
      console.error("Clean NG error:", error);
      showMessage(
        error.response?.data?.detail || error.message || "Failed to clear NG",
        "error"
      );
    } finally {
      setLoading(false);
    }
  };

  // ─────────────────────────── Helper Functions ───────────────────────────

  // showMessage provided by useMessageTimer hook

  const clearForm = () => {
    setSn("");
    setNgReason("");
    setCurrentRecord(null);
    setModuleA("");
    setModuleB("");
    setPcbaAu8("");
    setPcbaAm7("");
    setTimeout(() => snInputRef.current?.focus(), 100);
  };

  // ─────────────────────────── WebSocket Integration ───────────────────────────

  const handleWsMessage = useCallback((data) => {
    if (data.event === "assembly_status_updated") {
      Promise.all([fetchStats(), fetchRecentNg()]);
    }
  }, [fetchStats, fetchRecentNg]);
  useWs("/realtime/dashboard", handleWsMessage);

  // ─────────────────────────── PWA Install Support ───────────────────────────

  useEffect(() => {
    // Check if mobile device (screen width < 768px)
    const isMobile = window.innerWidth < 768;

    if (!isMobile) {
      setShowInstallPrompt(false);
      return;
    }

    // Check if already installed
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                         window.navigator.standalone === true;

    if (isStandalone) {
      setShowInstallPrompt(false);
      return;
    }

    // Listen for install prompt availability
    const handleInstallAvailable = () => {
      setShowInstallPrompt(true);
    };

    window.addEventListener('pwa-install-available', handleInstallAvailable);

    // Show install prompt after 3 seconds if not installed
    const timer = setTimeout(() => {
      if (!isStandalone && isMobile) {
        setShowInstallPrompt(true);
      }
    }, 3000);

    // Handle window resize to hide prompt on desktop
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setShowInstallPrompt(false);
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('pwa-install-available', handleInstallAvailable);
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
    };
  }, []);

  const handleInstallClick = async () => {
    try {
      const installed = await window.installPWA();
      if (installed) {
        setShowInstallPrompt(false);
        showMessage("App installed successfully!", "success");
      }
    } catch (error) {
      console.error("Install error:", error);
    }
  };

  const dismissInstallPrompt = () => {
    setShowInstallPrompt(false);
    localStorage.setItem('pwa-install-dismissed', Date.now().toString());
  };

  // ─────────────────────────── Initial Data Load ───────────────────────────

  useEffect(() => {
    // Load stats and recent records in parallel
    Promise.all([fetchStats(), fetchRecentNg()]);

    // Check if install was dismissed recently (within 7 days)
    const dismissed = localStorage.getItem('pwa-install-dismissed');
    if (dismissed) {
      const dismissedTime = parseInt(dismissed);
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      if (Date.now() - dismissedTime < sevenDays) {
        setShowInstallPrompt(false);
      }
    }
  }, [fetchStats, fetchRecentNg]);

  // ─────────────────────────── Render ───────────────────────────

  const hasRecord = Boolean(currentRecord);
  const isNgRecord = (currentRecord?.status || "").toUpperCase() === "NG";

  return (
    <div className="min-h-screen bg-surface-base pb-20 md:pb-8" style={{ paddingBottom: 'max(5rem, env(safe-area-inset-bottom))' }}>
      {/* Fixed Header (Mobile) */}
      <header className="sticky top-0 z-40 bg-surface-panel border-b border-stroke px-4 py-3 md:px-6 md:py-4 shadow-sm">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="p-2 bg-teal-500/15 rounded-lg">
            <Activity className="w-6 h-6 md:w-7 md:h-7 text-teal-400" />
          </div>
          <div>
            <h1 className="text-lg md:text-xl lg:text-2xl font-bold text-ink-primary">
              ATE Testing Station
            </h1>
            <p className="text-xs text-ink-muted font-medium hidden md:block">Quality Control Management</p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 py-4 md:px-6 md:py-6 space-y-4 md:space-y-5">

        {/* Stats Cards — 2 cols mobile, 4 cols desktop */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <div className="bg-surface-panel rounded-lg border border-amber-500/30 p-3 md:p-4 shadow-sm">
            <p className="text-xs font-semibold text-amber-400 uppercase tracking-wide">NG Units</p>
            <p className="text-2xl md:text-3xl font-bold text-amber-400 mt-1">{stats.ng_count}</p>
          </div>
          <div className="bg-surface-panel rounded-lg border border-emerald-500/30 p-3 md:p-4 shadow-sm">
            <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">Fixed</p>
            <p className="text-2xl md:text-3xl font-bold text-emerald-400 mt-1">{stats.fixed_count}</p>
          </div>
          <div className="bg-surface-panel rounded-lg border border-teal-500/30 p-3 md:p-4 shadow-sm">
            <p className="text-xs font-semibold text-teal-400 uppercase tracking-wide">Pass Rate</p>
            <p className="text-2xl md:text-3xl font-bold text-teal-400 mt-1">
              {typeof stats.pass_rate === 'number' ? `${stats.pass_rate.toFixed(1)}%` : '—'}
            </p>
          </div>
          <div className="bg-surface-panel rounded-lg border border-stroke p-3 md:p-4 shadow-sm">
            <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide">Total Today</p>
            <p className="text-2xl md:text-3xl font-bold text-ink-secondary mt-1">{stats.total_today ?? 0}</p>
          </div>
        </div>

        {/* Scan Section — always full width, unified for all breakpoints */}
        <div className="bg-gradient-to-br from-teal-500/10 to-signal-info/10 rounded-xl border-2 border-teal-500/30 p-4 md:p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Search className="w-5 h-5 text-teal-400" />
            <label className="text-sm md:text-base font-bold text-teal-300">Scan Serial Number</label>
          </div>
          <div className="flex gap-3">
            <input
              ref={snInputRef}
              value={sn}
              onChange={(e) => setSn(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleScan()}
              placeholder="Enter or scan US SN..."
              className="flex-1 px-4 py-3 md:py-3 bg-surface-raised border-2 border-teal-300
                         rounded-lg text-base md:text-lg font-semibold text-ink-primary
                         focus:ring-2 focus:ring-teal-400 focus:border-teal-500
                         transition-all shadow-inner placeholder:text-stone-400"
              style={{ fontSize: '16px' }}
            />
            <button
              onClick={handleScan}
              disabled={!sn.trim() || loading}
              className="px-5 md:px-6 py-3 bg-teal-600 hover:bg-teal-700 active:bg-teal-800
                         text-white font-bold text-sm md:text-base rounded-lg
                         transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                         shadow-md active:scale-95 flex items-center gap-2 whitespace-nowrap"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Search className="w-4 h-4" /><span className="hidden sm:inline">Search</span></>}
            </button>
          </div>

          {/* Record info — shown on all screen sizes after scan */}
          {currentRecord && (
            <div className={`mt-3 px-4 py-3 rounded-lg border flex flex-wrap items-center gap-x-5 gap-y-1 text-sm ${
              isNgRecord
                ? 'bg-signal-error/10 border-red-500/30'
                : currentRecord.status === 'FIXED'
                ? 'bg-signal-ok/10 border-emerald-500/30'
                : 'bg-surface-panel border-stroke'
            }`}>
              <div className="flex items-center gap-2">
                <span className="text-ink-muted font-medium">SN:</span>
                <span className="font-mono font-semibold text-ink-primary">{currentRecord.us_sn || sn}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-ink-muted font-medium">Status:</span>
                <span className={`font-bold ${
                  isNgRecord ? 'text-red-400' :
                  currentRecord.status === 'FIXED' ? 'text-emerald-400' :
                  'text-teal-400'
                }`}>
                  {currentRecord.status || 'OK'}
                </span>
              </div>
              {currentRecord.ng_reason && (
                <div className="flex items-center gap-2">
                  <span className="text-ink-muted font-medium">Reason:</span>
                  <span className="font-medium text-ink-secondary">{currentRecord.ng_reason}</span>
                </div>
              )}
              {currentRecord.operator && (
                <div className="flex items-center gap-2">
                  <span className="text-ink-muted font-medium">Operator:</span>
                  <span className="text-ink-secondary">{currentRecord.operator}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* NG Management & Recent Records */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5">

          {/* Left: NG Operations */}
          <div className="bg-surface-panel rounded-lg border border-stroke p-4 md:p-5 shadow-sm flex flex-col">
            <h2 className="text-base font-semibold text-ink-primary mb-4 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400" />
              NG Management
            </h2>

            {/* Idle state — no record scanned yet */}
            {!hasRecord ? (
              <div className="flex-1 flex flex-col items-center justify-center py-8 text-center">
                <div className="w-14 h-14 bg-surface-raised rounded-lg flex items-center justify-center mb-3">
                  <Search className="w-7 h-7 text-stone-400" />
                </div>
                <p className="text-ink-secondary font-semibold text-base">Scan a serial number to begin</p>
                <p className="text-stone-400 text-sm mt-1">Results will appear here after scanning</p>
                <div className="mt-5 flex flex-col gap-2 text-sm text-ink-muted text-left">
                  {[
                    { step: '1', text: 'Enter or scan US serial number above' },
                    { step: '2', text: 'Enter NG reason (if marking NG)' },
                    { step: '3', text: 'Press Label NG or Clean NG' },
                  ].map(({ step, text }) => (
                    <div key={step} className="flex items-center gap-3">
                      <span className="w-6 h-6 bg-teal-500/15 text-teal-400 rounded-md flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {step}
                      </span>
                      <span>{text}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : isNgRecord ? (
              <>
                <div className="mb-3 rounded-lg border border-amber-500/30 bg-signal-warn/10 px-3 py-2 text-sm text-amber-300">
                  <span className="font-semibold">Current NG Reason:</span>{" "}
                  <span>{currentRecord?.ng_reason || "-"}</span>
                </div>
                <p className="text-sm font-medium text-ink-secondary mb-2">
                  Update Module / PCBA SN (optional)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[
                    { label: 'Module A SN', value: moduleA, setter: setModuleA, placeholder: 'Module A SN' },
                    { label: 'Module B SN', value: moduleB, setter: setModuleB, placeholder: 'Module B SN' },
                    { label: 'AU8 SN',      value: pcbaAu8, setter: setPcbaAu8, placeholder: 'AU8 SN' },
                    { label: 'AM7 SN',      value: pcbaAm7, setter: setPcbaAm7, placeholder: 'AM7 SN' },
                  ].map(({ label, value, setter, placeholder }) => (
                    <div key={label}>
                      <label className="block text-xs font-semibold text-ink-secondary mb-1">{label}</label>
                      <input
                        value={value}
                        onChange={(e) => setter(e.target.value)}
                        placeholder={placeholder}
                        className="w-full px-3 py-2 bg-surface-raised border-2 border-stroke rounded-lg
                                   focus:ring-2 focus:ring-teal-500 focus:border-teal-500
                                   text-base text-ink-primary transition-colors"
                      />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <label className="block text-sm font-medium text-ink-secondary mb-2">
                  NG Reason <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={ngReason}
                  onChange={(e) => setNgReason(e.target.value)}
                  placeholder="Enter NG reason..."
                  rows={4}
                  className="w-full px-4 py-3 bg-surface-raised border-2 border-stroke rounded-lg
                             focus:ring-2 focus:ring-teal-500 focus:border-teal-500
                             text-base text-ink-primary resize-none transition-colors"
                  required
                />
              </>
            )}

            {/* Action Buttons */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                onClick={markNG}
                disabled={!sn || !hasRecord || isNgRecord || !ngReason.trim() || loading}
                className="w-full px-4 py-4 md:py-3
                           bg-red-600 hover:bg-red-700 active:bg-red-800
                           text-white font-bold text-base rounded-lg transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed
                           shadow-sm active:scale-95 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><XCircle className="w-5 h-5" /><span>Label NG</span></>}
              </button>
              <button
                onClick={cleanNG}
                disabled={!sn || !hasRecord || !isNgRecord || loading}
                className="w-full px-4 py-4 md:py-3
                           bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800
                           text-white font-bold text-base rounded-lg transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed
                           shadow-sm active:scale-95 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><CheckCircle className="w-5 h-5" /><span>Clean NG</span></>}
              </button>
            </div>
          </div>

          {/* Right: Recent NG Records */}
          <div className="bg-surface-panel rounded-lg border border-stroke p-4 md:p-5 shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-ink-primary flex items-center gap-2">
                Recent NG Records
                <span className="text-xs font-normal text-stone-400">(Live)</span>
              </h2>
              {recentNg.length > 0 && (
                <span className="text-xs text-stone-400">{recentNg.length} records</span>
              )}
            </div>

            {recentNg.length === 0 ? (
              /* Empty state — meaningful, not just "No records" */
              <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
                <div className="w-14 h-14 bg-signal-ok/10 rounded-lg flex items-center justify-center mb-3">
                  <CheckCircle className="w-7 h-7 text-emerald-500" />
                </div>
                <p className="text-ink-secondary font-semibold">No NG records today</p>
                <p className="text-stone-400 text-sm mt-1">
                  {stats.total_today > 0
                    ? `${stats.total_today} units scanned — all passed`
                    : 'Records will appear here after marking NG'}
                </p>
              </div>
            ) : (
              <>
                {/* Mobile: Cards */}
                <div className="block md:hidden space-y-2 max-h-[28rem] overflow-y-auto">
                  {recentNg.map((record) => (
                    <div key={record.id} className={`border rounded-lg p-3 ${
                      record.status === 'NG' ? 'bg-signal-error/10 border-red-500/30' : 'bg-signal-ok/10 border-emerald-500/30'
                    }`}>
                      <div className="flex items-start justify-between mb-1">
                        <span className="font-mono text-sm font-semibold text-ink-primary">{record.us_sn}</span>
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          record.status === 'NG' ? 'bg-signal-error/15 text-red-400' : 'bg-signal-ok/15 text-emerald-400'
                        }`}>{record.status}</span>
                      </div>
                      <p className="text-xs text-ink-secondary">{record.ng_reason || '—'}</p>
                      <p className="text-xs text-stone-400 mt-1">
                        {new Date(record.timestamp).toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Tablet/Desktop: Table */}
                <div className="hidden md:block overflow-y-auto flex-1" style={{ maxHeight: '360px' }}>
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-surface-base z-10">
                      <tr className="border-b border-stroke">
                        <th className="px-3 py-2 text-left text-xs font-semibold text-ink-muted uppercase">US SN</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-ink-muted uppercase">Status</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-ink-muted uppercase">Reason</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-ink-muted uppercase">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {recentNg.map((record) => (
                        <tr key={record.id} className={`hover:bg-surface-base transition-colors ${
                          record.status === 'NG' ? 'bg-signal-error/10' : 'bg-signal-ok/10'
                        }`}>
                          <td className="px-3 py-2 font-mono text-ink-primary">{record.us_sn}</td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                              record.status === 'NG' ? 'bg-signal-error/15 text-red-400' : 'bg-signal-ok/15 text-emerald-400'
                            }`}>{record.status}</span>
                          </td>
                          <td className="px-3 py-2 text-ink-secondary max-w-[160px] truncate" title={record.ng_reason}>
                            {record.ng_reason || '—'}
                          </td>
                          <td className="px-3 py-2 text-xs text-stone-400 whitespace-nowrap">
                            {new Date(record.timestamp).toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </main>

      {/* PWA Install Prompt */}
      {showInstallPrompt && (
        <div className="fixed bottom-24 left-4 right-4 md:left-auto md:right-4 md:w-96
                        bg-teal-600 text-white
                        p-4 rounded-xl shadow-lg z-50 animate-slide-up">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-white/20 rounded-lg">
              <Download className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-base mb-1">Install ATE Testing App</h3>
              <p className="text-sm text-white/90 mb-3">
                Add to home screen for better experience
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleInstallClick}
                  className="flex-1 px-4 py-2 bg-surface-panel text-teal-400 font-semibold
                           rounded-lg hover:bg-surface-raised transition-colors text-sm"
                >
                  Install
                </button>
                <button
                  onClick={dismissInstallPrompt}
                  className="px-4 py-2 bg-white/20 text-white font-medium
                           rounded-lg hover:bg-white/30 transition-colors text-sm"
                >
                  Later
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Message */}
      {message.text && (
        <div className={`fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96
                        p-4 rounded-lg shadow-lg z-50 animate-slide-up ${
          message.type === 'success'
            ? 'bg-emerald-600 text-white'
            : message.type === 'error'
            ? 'bg-red-600 text-white'
            : 'bg-stone-600 text-white'
        }`}>
          <div className="flex items-center gap-3">
            {message.type === 'success' ? (
              <CheckCircle className="w-5 h-5 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
            )}
            <p className="text-base md:text-sm font-medium">{message.text}</p>
          </div>
        </div>
      )}
    </div>
  );
}
