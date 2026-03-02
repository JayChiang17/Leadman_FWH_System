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
    <div className="min-h-screen bg-gray-50 pb-20 md:pb-8" style={{ paddingBottom: 'max(5rem, env(safe-area-inset-bottom))' }}>
      {/* Fixed Header (Mobile) */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200 px-4 py-3 md:px-6 md:py-4 shadow-sm">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="p-2 bg-teal-100 rounded-lg">
            <Activity className="w-6 h-6 md:w-7 md:h-7 text-teal-600" />
          </div>
          <div>
            <h1 className="text-lg md:text-xl lg:text-2xl font-bold text-gray-800">
              ATE Testing Station
            </h1>
            <p className="text-xs text-gray-500 font-medium hidden md:block">Quality Control Management</p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 py-4 md:px-6 md:py-6 space-y-4 md:space-y-6">

        {/* Stats Cards - Responsive Grid */}
        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">

          {/* NG Count */}
          <div className="bg-white rounded-lg border border-amber-200 p-3 md:p-4 shadow-sm">
            <p className="text-xs md:text-sm font-semibold text-amber-700 uppercase tracking-wide">
              NG Units
            </p>
            <p className="text-2xl md:text-3xl lg:text-4xl font-bold text-amber-700 mt-1">
              {stats.ng_count}
            </p>
          </div>

          {/* Fixed Count */}
          <div className="bg-white rounded-lg border border-emerald-200 p-3 md:p-4 shadow-sm">
            <p className="text-xs md:text-sm font-semibold text-emerald-700 uppercase tracking-wide">
              Fixed
            </p>
            <p className="text-2xl md:text-3xl lg:text-4xl font-bold text-emerald-700 mt-1">
              {stats.fixed_count}
            </p>
          </div>

          {/* Desktop: Search Area in Stats Row */}
          <div className="hidden lg:block bg-gradient-to-br from-teal-50 to-cyan-50 rounded-xl border-2 border-teal-200 p-4 shadow-lg">
            <div className="flex items-center gap-2 mb-2">
              <Search className="w-5 h-5 text-teal-600" />
              <label className="block text-sm font-bold text-teal-900">
                Scan Serial Number
              </label>
            </div>
            <div className="relative mb-2">
              <input
                ref={snInputRef}
                value={sn}
                onChange={(e) => setSn(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleScan()}
                placeholder="US SN..."
                className="w-full px-4 py-3 bg-white border-2 border-teal-300
                           rounded-lg text-base font-semibold text-stone-900
                           focus:ring-2 focus:ring-teal-400 focus:border-teal-500
                           transition-all shadow-inner placeholder:text-stone-400"
                autoFocus
              />
            </div>
            <button
              onClick={handleScan}
              disabled={!sn.trim() || loading}
              className="w-full px-4 py-3 bg-teal-600 hover:bg-teal-700
                         text-white font-bold text-sm rounded-lg
                         transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                         shadow-md active:scale-95 flex items-center justify-center gap-2"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  <span>Search</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Mobile/Tablet: Search Area (Separate) - HERO SECTION */}
        <div className="lg:hidden bg-gradient-to-br from-teal-50 to-cyan-50 rounded-xl border-2 border-teal-200 p-5 md:p-6 shadow-lg">
          <div className="flex items-center gap-2 mb-3">
            <Search className="w-6 h-6 text-teal-600" />
            <label className="block text-base md:text-lg font-bold text-teal-900">
              Scan Serial Number
            </label>
          </div>

          <div className="relative mb-4">
            <input
              ref={snInputRef}
              value={sn}
              onChange={(e) => setSn(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleScan()}
              placeholder="Enter or scan US SN..."
              className="w-full px-5 py-5 md:py-4 bg-white border-2 border-teal-300
                         rounded-xl text-xl md:text-lg font-semibold text-stone-900
                         focus:ring-4 focus:ring-teal-400 focus:border-teal-500
                         transition-all shadow-inner placeholder:text-stone-400"
              autoFocus
            />
          </div>

          <button
            onClick={handleScan}
            disabled={!sn.trim() || loading}
            className="w-full px-8 py-6 md:py-5 bg-teal-600 hover:bg-teal-700 active:bg-teal-800
                       text-white font-bold text-xl md:text-lg rounded-xl
                       transition-all disabled:opacity-50 disabled:cursor-not-allowed
                       shadow-xl hover:shadow-2xl active:scale-98
                       flex items-center justify-center gap-3"
          >
            {loading ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin" />
                <span>Searching...</span>
              </>
            ) : (
              <>
                <Search className="w-6 h-6" />
                <span>Search Serial Number</span>
              </>
            )}
          </button>

          {/* Current Record Display */}
          {currentRecord && (
            <div className="mt-4 p-3 bg-stone-50 rounded-lg border border-stone-200">
              <p className="text-xs font-semibold text-stone-600 uppercase mb-2">Record Info</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-stone-500">Status:</span>{" "}
                  <span className={`font-semibold ${
                    currentRecord.status === 'NG' ? 'text-red-600' :
                    currentRecord.status === 'FIXED' ? 'text-emerald-600' :
                    'text-stone-800'
                  }`}>
                    {currentRecord.status || 'OK'}
                  </span>
                </div>
                {currentRecord.ng_reason && (
                  <div className="col-span-2">
                    <span className="text-stone-500">Reason:</span>{" "}
                    <span className="font-medium text-stone-700">{currentRecord.ng_reason}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* NG Management & Recent Records - Responsive Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">

          {/* NG Operations */}
          <div className="bg-white rounded-lg border border-stone-200 p-4 md:p-5 shadow-sm">
            <h2 className="text-base md:text-lg font-semibold text-stone-800 mb-4 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-600" />
              NG Management
            </h2>

            {isNgRecord ? (
              <>
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <span className="font-semibold">Current NG Reason:</span>{" "}
                  <span>{currentRecord?.ng_reason || "-"}</span>
                </div>

                <p className="text-sm font-medium text-stone-700 mb-2">
                  Update Module / PCBA SN (optional)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-stone-600 mb-1">
                      Module A SN
                    </label>
                    <input
                      value={moduleA}
                      onChange={(e) => setModuleA(e.target.value)}
                      placeholder="Module A SN"
                      className="w-full px-3 py-2 bg-white border-2 border-stone-300 rounded-lg
                                 focus:ring-2 focus:ring-teal-500 focus:border-teal-500
                                 text-base text-stone-800 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-stone-600 mb-1">
                      Module B SN
                    </label>
                    <input
                      value={moduleB}
                      onChange={(e) => setModuleB(e.target.value)}
                      placeholder="Module B SN"
                      className="w-full px-3 py-2 bg-white border-2 border-stone-300 rounded-lg
                                 focus:ring-2 focus:ring-teal-500 focus:border-teal-500
                                 text-base text-stone-800 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-stone-600 mb-1">
                      AU8 SN
                    </label>
                    <input
                      value={pcbaAu8}
                      onChange={(e) => setPcbaAu8(e.target.value)}
                      placeholder="AU8 SN"
                      className="w-full px-3 py-2 bg-white border-2 border-stone-300 rounded-lg
                                 focus:ring-2 focus:ring-teal-500 focus:border-teal-500
                                 text-base text-stone-800 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-stone-600 mb-1">
                      AM7 SN
                    </label>
                    <input
                      value={pcbaAm7}
                      onChange={(e) => setPcbaAm7(e.target.value)}
                      placeholder="AM7 SN"
                      className="w-full px-3 py-2 bg-white border-2 border-stone-300 rounded-lg
                                 focus:ring-2 focus:ring-teal-500 focus:border-teal-500
                                 text-base text-stone-800 transition-colors"
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <label className="block text-sm md:text-base font-medium text-stone-700 mb-2">
                  NG Reason <span className="text-red-600">*</span>
                </label>
                <textarea
                  value={ngReason}
                  onChange={(e) => setNgReason(e.target.value)}
                  placeholder="Enter NG reason..."
                  rows={4}
                  disabled={!hasRecord}
                  className="w-full px-4 py-3 bg-white border-2 border-stone-300 rounded-lg
                             focus:ring-2 focus:ring-teal-500 focus:border-teal-500
                             text-base md:text-lg text-stone-800 resize-none transition-colors"
                  required
                />
              </>
            )}

            {/* Action Buttons - Responsive */}
            <div className="mt-4 space-y-3 md:space-y-0 md:grid md:grid-cols-2 md:gap-4">

              {/* Label NG Button */}
              <button
                onClick={markNG}
                disabled={!sn || !hasRecord || isNgRecord || !ngReason.trim() || loading}
                className="w-full px-6 py-6 md:py-5 lg:py-4
                           bg-red-600 hover:bg-red-700 active:bg-red-800
                           text-white font-bold text-lg md:text-xl lg:text-lg
                           rounded-lg transition-all duration-150
                           disabled:opacity-50 disabled:cursor-not-allowed
                           shadow-lg hover:shadow-xl active:scale-95
                           flex items-center justify-center gap-3"
              >
                {loading ? (
                  <Loader2 className="w-7 h-7 md:w-6 md:h-6 animate-spin" />
                ) : (
                  <>
                    <XCircle size={28} className="md:w-6 md:h-6" />
                    <span>Label NG</span>
                  </>
                )}
              </button>

              {/* Clean NG Button */}
              <button
                onClick={cleanNG}
                disabled={!sn || !hasRecord || !isNgRecord || loading}
                className="w-full px-6 py-6 md:py-5 lg:py-4
                           bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800
                           text-white font-bold text-lg md:text-xl lg:text-lg
                           rounded-lg transition-all duration-150
                           disabled:opacity-50 disabled:cursor-not-allowed
                           shadow-lg hover:shadow-xl active:scale-95
                           flex items-center justify-center gap-3"
              >
                {loading ? (
                  <Loader2 className="w-7 h-7 md:w-6 md:h-6 animate-spin" />
                ) : (
                  <>
                    <CheckCircle size={28} className="md:w-6 md:h-6" />
                    <span>Clean NG</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Recent NG Records - Responsive Display */}
          <div className="bg-white rounded-lg border border-stone-200 p-4 md:p-5 shadow-sm">
            <h2 className="text-base md:text-lg font-semibold text-stone-800 mb-4">
              Recent NG Records
              <span className="ml-2 text-xs font-normal text-stone-500">(Live)</span>
            </h2>

            {/* Mobile: Card Style */}
            <div className="block md:hidden space-y-3 max-h-96 overflow-y-auto">
              {recentNg.length === 0 ? (
                <p className="text-center text-stone-500 py-8">No records</p>
              ) : (
                recentNg.slice(0, 10).map((record) => (
                  <div
                    key={record.id}
                    className={`border rounded-lg p-3 transition-colors ${
                      record.status === 'NG'
                        ? 'bg-red-50/50 border-red-200'
                        : 'bg-emerald-50/50 border-emerald-200'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <span className="font-mono text-sm font-semibold text-stone-800">
                        {record.us_sn}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                        record.status === 'NG'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {record.status}
                      </span>
                    </div>
                    <p className="text-sm text-stone-600 mb-1">
                      Reason: {record.ng_reason || '-'}
                    </p>
                    <p className="text-xs text-stone-500">
                      {new Date(record.timestamp).toLocaleString('en-US', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                  </div>
                ))
              )}
            </div>

            {/* Tablet/Desktop: Table Style */}
            <div className="hidden md:block overflow-x-auto max-h-96">
              <table className="w-full">
                <thead className="sticky top-0 bg-stone-50">
                  <tr className="border-b border-stone-200">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-stone-600 uppercase">
                      US SN
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-stone-600 uppercase">
                      Status
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-stone-600 uppercase">
                      Reason
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-stone-600 uppercase">
                      Time
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {recentNg.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-8 text-center text-stone-500">
                        No records
                      </td>
                    </tr>
                  ) : (
                    recentNg.slice(0, 10).map((record) => (
                      <tr
                        key={record.id}
                        className={`hover:bg-stone-50 transition-colors ${
                          record.status === 'NG' ? 'bg-red-50/30' : 'bg-emerald-50/30'
                        }`}
                      >
                        <td className="px-3 py-2 text-sm font-mono text-stone-800">
                          {record.us_sn}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                            record.status === 'NG'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}>
                            {record.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-sm text-stone-600 max-w-xs truncate" title={record.ng_reason}>
                          {record.ng_reason || '-'}
                        </td>
                        <td className="px-3 py-2 text-xs text-stone-500">
                          {new Date(record.timestamp).toLocaleString('en-US', {
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      {/* PWA Install Prompt */}
      {showInstallPrompt && (
        <div className="fixed bottom-24 left-4 right-4 md:left-auto md:right-4 md:w-96
                        bg-teal-600 text-white
                        p-4 rounded-xl shadow-2xl z-50 animate-slide-up">
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
                  className="flex-1 px-4 py-2 bg-white text-teal-600 font-semibold
                           rounded-lg hover:bg-gray-100 transition-colors text-sm"
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
                        p-4 rounded-lg shadow-2xl z-50 animate-slide-up ${
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
