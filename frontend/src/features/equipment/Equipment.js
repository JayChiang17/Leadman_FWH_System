// src/features/equipment/Equipment.js
/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Clock,
  Users,
  RefreshCw,
  Calendar,
  Zap,
  BarChart3,
  Cpu,
  Server,
  Database,
  ChevronUp,
  ChevronDown,
  Gauge,
} from "lucide-react";
import equipmentApi from "../../services/equipmentApi";
import ErrorModal from "../../components/ErrorModal";
import "./Equipment.css";

const CA_TZ = "America/Los_Angeles";

/** 取得加州當日的『YYYY-MM-DD』 */
const getTodayISO = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: CA_TZ });

/** 取指定天數前的『YYYY-MM-DD』 */
const getPastISO = (daysAgo) => {
  const nowLA = new Date(
    new Date().toLocaleString("en-US", { timeZone: CA_TZ })
  );
  const past = new Date(nowLA.getTime() - daysAgo * 86_400_000);
  return past.toLocaleDateString("en-CA", { timeZone: CA_TZ });
};

export default function Equipment() {
  /* ----------------------------- state ----------------------------- */
  const todayISO = getTodayISO();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDate, setSelectedDate] = useState(todayISO);

  const [dashboardData, setDashboardData] = useState(null);
  const [processTypes, setProcessTypes] = useState([]);
  const [userStats, setUserStats] = useState([]);
  const [recentRecords, setRecentRecords] = useState([]);
  const [rangeStats, setRangeStats] = useState([]);
  const [hourlyUsage, setHourlyUsage] = useState([]);

  const [dateRange, setDateRange] = useState({
    startDate: getPastISO(7),
    endDate: todayISO,
  });

  /* --------------------------- helpers ----------------------------- */
  const toNumber = (v, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };

  const formatTime = (sec = 0) => {
    sec = toNumber(sec, 0);
    if (sec < 60) return `${sec.toFixed(1)}s`;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}m ${s}s`;
  };

  const formatDateTime = (iso) => {
    try {
      const dt = new Date(iso);
      if (isNaN(dt.getTime())) return "--:--";
      return dt.toLocaleTimeString("en-US", {
        timeZone: CA_TZ,
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "--:--";
    }
  };

  // 以加州時區取得當下小時
  const nowCAHour = useMemo(() => {
    try {
      const f = new Intl.DateTimeFormat("en-US", {
        timeZone: CA_TZ,
        hour: "2-digit",
        hour12: false,
      }).format(new Date());
      return parseInt(String(f), 10);
    } catch {
      return new Date().getHours();
    }
  }, []);

  /* --------------------------- data fetch -------------------------- */
  const loadAllData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dashboard, types, users, recent] = await Promise.all([
        equipmentApi.getDashboardData(selectedDate),
        equipmentApi.getProcessTypes(),
        equipmentApi.getUserStats(selectedDate),
        equipmentApi.getRecentRecords(5),
      ]);
      setDashboardData(dashboard?.data ?? {});
      setProcessTypes(types?.data ?? []);
      setUserStats(users?.data ?? []);
      setRecentRecords(recent?.data ?? []);
    } catch (err) {
      setError(err?.message || "Failed to load equipment data");
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  const loadRangeStats = useCallback(async () => {
    try {
      const res = await equipmentApi.getRangeStats(
        dateRange.startDate,
        dateRange.endDate
      );
      setRangeStats(res?.data ?? []);
    } catch (err) {
      console.error("Failed to load range stats", err);
      setRangeStats([]);
    }
  }, [dateRange]);

  const loadHourlyUsage = useCallback(async () => {
    try {
      const res = await equipmentApi.getHourlyUsage(selectedDate);
      const arr = Array.isArray(res?.data) ? res.data : [];
      // 補齊 0~23，缺資料以 0 表示（不造假）
      const filled = Array.from({ length: 24 }, (_, hour) => {
        const found = arr.find((x) => toNumber(x.hour) === hour);
        return found
          ? { hour, usage: toNumber(found.usage), processes: toNumber(found.processes) }
          : { hour, usage: 0, processes: 0 };
      });
      setHourlyUsage(filled);
    } catch (err) {
      console.error("Failed to load hourly usage", err);
      setHourlyUsage([]);
    }
  }, [selectedDate]);

  /* --------------------------- lifecycles -------------------------- */
  useEffect(() => {
    loadAllData();
    loadHourlyUsage();
  }, [loadAllData, loadHourlyUsage]);

  useEffect(() => {
    loadRangeStats();
  }, [loadRangeStats]);

  /* --------------------- derived (before early return) ------------- */
  // MUST be before any early return to satisfy hooks rules
  const recentRange = useMemo(
    () => (Array.isArray(rangeStats) ? rangeStats.slice(-14) : []),
    [rangeStats]
  );
  const maxTime = useMemo(() => {
    if (!recentRange.length) return 1;
    const m = Math.max(...recentRange.map((s) => toNumber(s.avgProcessTime)));
    return Math.max(1, m);
  }, [recentRange]);

  /* --------------------------- loading UI -------------------------- */
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
        <div className="relative">
          <div className="w-20 h-20 border-4 border-gray-200 rounded-full"></div>
          <div className="absolute top-0 w-20 h-20 border-4 border-transparent border-t-blue-500 border-r-cyan-500 rounded-full animate-spin"></div>
          <div className="absolute top-2 left-2 w-16 h-16 border-4 border-transparent border-b-blue-400 border-l-cyan-400 rounded-full animate-spin-reverse"></div>
        </div>
        <div className="text-center">
          <p className="text-black font-semibold text-lg">Initializing Systems</p>
          <p className="text-gray-500 text-sm mt-1">Loading equipment data...</p>
        </div>
        <style>{`
          @keyframes spinrev { to { transform: rotate(-360deg) } }
          .animate-spin-reverse { animation: spinrev 1s linear infinite; }
        `}</style>
      </div>
    );
  }

  // 非 Hook 的一般計算
  const peakHour =
    hourlyUsage.length > 0
      ? hourlyUsage.reduce(
          (max, curr) => (toNumber(curr.usage) > toNumber(max.usage) ? curr : max),
          hourlyUsage[0]
        )
      : null;

  const avgHourlyUsage =
    hourlyUsage.length > 0
      ? Math.round(
          hourlyUsage.reduce((sum, h) => sum + toNumber(h.usage), 0) /
            hourlyUsage.length
        )
      : 0;

  /* ------------------------------ view ----------------------------- */
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50">
      {/* Error Modal */}
      <ErrorModal
        open={!!error}
        title="Load Error"
        message={error || ""}
        onClose={() => setError(null)}
      />

      <div className="px-6 py-6 max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="relative bg-gradient-to-r from-gray-900 via-blue-900 to-cyan-900 rounded-3xl p-8 mb-8 overflow-hidden">
          <div className="absolute inset-0 opacity-10">
            <div
              className="absolute inset-0 animate-pulse"
              style={{
                backgroundImage:
                  `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
              }}
            />
          </div>

          <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="p-4 bg-gradient-to-br from-cyan-400 to-blue-500 rounded-2xl shadow-2xl">
                  <Cpu size={32} className="text-white" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
              </div>
              <div>
                <h1 className="text-4xl font-bold text-white tracking-tight">
                  Module Line Performance Analytics
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-4 py-3 bg-white/10 backdrop-blur-md border border-white/20 rounded-xl">
                <Calendar size={18} className="text-cyan-300" />
                <input
                  type="date"
                  className="bg-transparent outline-none text-sm font-medium text-white cursor-pointer [color-scheme:dark]"
                  value={selectedDate}
                  max={todayISO}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
              </div>
              <button
                className="group inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold rounded-xl shadow-lg transition-all duration-300 hover:shadow-cyan-500/25 hover:scale-105"
                onClick={() => {
                  loadAllData();
                  loadRangeStats();
                  loadHourlyUsage();
                }}
              >
                <RefreshCw
                  size={18}
                  className="group-hover:rotate-180 transition-transform duration-500"
                />
                Sync Data
              </button>
            </div>
          </div>
        </div>

        {/* KPI Cards */}
        {dashboardData && (
          <div className="grid gap-6 mb-8 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                title: "Total Processes",
                icon: <Server size={24} />,
                value: toNumber(dashboardData.totalProcesses, 0),
                status: "optimal",
                gradient: "from-blue-600 to-cyan-500",
                glowColor: "shadow-cyan-500/20",
              },
              {
                title: "Process Time",
                icon: <Clock size={24} />,
                value: formatTime(toNumber(dashboardData.avgDailyProcessTime)),
                status: "improved",
                gradient: "from-violet-600 to-purple-500",
                glowColor: "shadow-purple-500/20",
              },
              {
                title: "Active Users",
                icon: <Users size={24} />,
                value: userStats.length,
                subtitle: `${processTypes.length} types`,
                status: "active",
                gradient: "from-emerald-600 to-green-500",
                glowColor: "shadow-green-500/20",
              },
              {
                title: "System Load",
                icon: <Gauge size={24} />,
                value: `${avgHourlyUsage}%`,
                subtitle: peakHour ? `Peak: ${toNumber(peakHour.hour)}:00` : "",
                status: avgHourlyUsage > 80 ? "high" : "normal",
                gradient: "from-orange-600 to-amber-500",
                glowColor: "shadow-amber-500/20",
              },
            ].map((c, i) => (
              <div
                key={i}
                className={`relative bg-white border border-gray-200 rounded-2xl p-6 shadow-xl hover:shadow-2xl ${c.glowColor} transition-all duration-300 hover:scale-105 overflow-hidden`}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${c.gradient} opacity-5`} />
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-4">
                    <div className={`p-3 bg-gradient-to-br ${c.gradient} rounded-xl text-white shadow-lg`}>
                      {c.icon}
                    </div>
                  </div>
                  <p className="text-sm font-medium text-gray-600 mb-1">{c.title}</p>
                  <p className="text-3xl font-bold text-black">{c.value}</p>
                  {c.subtitle && <p className="text-xs text-gray-500 mt-1">{c.subtitle}</p>}
                  <div className="absolute top-3 right-3">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        c.status === "optimal"
                          ? "bg-green-500"
                          : c.status === "improved"
                          ? "bg-blue-500"
                          : c.status === "active"
                          ? "bg-emerald-500"
                          : c.status === "high"
                          ? "bg-orange-500"
                          : "bg-gray-400"
                      } animate-pulse`}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* 24-Hour Usage Heatmap */}
          <div className="xl:col-span-2 bg-white border border-gray-200 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-black">24-Hour Usage Pattern</h2>
                <p className="text-sm text-gray-500 mt-1">Equipment utilization by hour</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-gradient-to-r from-blue-300 to-blue-500 rounded" />
                <span className="text-xs text-gray-600">Low</span>
                <div className="w-3 h-3 bg-gradient-to-r from-orange-400 to-red-500 rounded" />
                <span className="text-xs text-gray-600">High</span>
              </div>
            </div>

            {hourlyUsage.length > 0 ? (
              <>
                <div
                  className="grid grid-cols-24 gap-1 mb-4"
                  style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}
                >
                  {hourlyUsage.map((h, idx) => {
                    const usage = toNumber(h.usage);
                    const intensity = usage / 100;
                    const isCurrentHour = nowCAHour === toNumber(h.hour);

                    return (
                      <div key={idx} className="relative group">
                        <div
                          className={`h-20 rounded-lg transition-all duration-300 ${
                            isCurrentHour ? "ring-2 ring-cyan-500 ring-offset-2" : ""
                          } hover:scale-110 hover:z-10 cursor-pointer`}
                          style={{
                            background: `linear-gradient(to top, 
                              ${intensity > 0.7 ? "#ef4444" : intensity > 0.4 ? "#f59e0b" : "#3b82f6"} 0%, 
                              ${intensity > 0.7 ? "#dc2626" : intensity > 0.4 ? "#d97706" : "#2563eb"} 100%)`,
                            opacity: 0.3 + intensity * 0.7,
                          }}
                          title={`${toNumber(h.hour)}:00 - Usage: ${usage}%`}
                        >
                          {isCurrentHour && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                            </div>
                          )}
                        </div>
                        <p className="text-xs text-center mt-1 text-gray-600">{toNumber(h.hour)}</p>

                        {/* Tooltip */}
                        <div className="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
                          <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap">
                            <p className="font-semibold">{toNumber(h.hour)}:00</p>
                            <p>Usage: {usage}%</p>
                            <p>Processes: {toNumber(h.processes)}</p>
                          </div>
                          <div className="w-2 h-2 bg-gray-900 transform rotate-45 absolute -bottom-1 left-1/2 -translate-x-1/2"></div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-100">
                  <div className="text-center">
                    <p className="text-xs text-gray-500 mb-1">Peak Hour</p>
                    <p className="text-lg font-bold text-black">
                      {peakHour ? `${toNumber(peakHour.hour)}:00` : "--"}
                    </p>
                    <p className="text-xs text-gray-400">
                      {peakHour ? `${toNumber(peakHour.usage)}% usage` : ""}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-gray-500 mb-1">Average Load</p>
                    <p className="text-lg font-bold text-black">{avgHourlyUsage}%</p>
                    <p className="text-xs text-gray-400">across 24h</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-gray-500 mb-1">Active Hours</p>
                    <p className="text-lg font-bold text-black">
                      {hourlyUsage.filter((x) => toNumber(x.usage) > 0).length}
                    </p>
                    <p className="text-xs text-gray-400">of 24 hours</p>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-64 text-gray-400">
                <div className="text-center">
                  <Database size={48} className="mx-auto mb-3 opacity-50" />
                  <p>No hourly usage data</p>
                </div>
              </div>
            )}
          </div>

          {/* Process Performance */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-black">Process Matrix</h2>
              <Zap className="text-cyan-500" size={20} />
            </div>
            {dashboardData &&
            Array.isArray(dashboardData.processStats) &&
            dashboardData.processStats.length ? (
              <div className="space-y-3">
                {dashboardData.processStats.slice(0, 4).map((stat, idx) => (
                  <div key={idx} className="relative">
                    <div className="bg-gradient-to-r from-gray-50 to-white rounded-xl p-4 border border-gray-100 hover:border-cyan-200 transition-all">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-black text-sm">
                          {stat.processType}
                        </span>
                        <span className="text-xs px-2 py-1 bg-cyan-100 text-cyan-700 rounded-full font-medium">
                          {toNumber(stat.count)} ops
                        </span>
                      </div>

                      {/* Mini bar chart */}
                      <div className="flex items-end gap-1 h-8 mb-2">
                        {[
                          { label: "Min", value: stat.minTime, max: stat.maxTime },
                          { label: "Avg", value: stat.avgTime, max: stat.maxTime },
                          { label: "Max", value: stat.maxTime, max: stat.maxTime },
                        ].map((bar, i) => (
                          <div key={i} className="flex-1 flex flex-col items-center">
                            <div
                              className={`w-full rounded-t transition-all duration-500 ${
                                i === 0 ? "bg-green-500" : i === 1 ? "bg-blue-500" : "bg-orange-500"
                              }`}
                              style={{
                                height: `${Math.max(
                                  2,
                                  (toNumber(bar.value) / Math.max(1, toNumber(bar.max))) * 32
                                )}px`,
                              }}
                            />
                            <p className="text-xs text-gray-500 mt-1">{bar.label}</p>
                          </div>
                        ))}
                      </div>

                      <div className="relative h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="absolute h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all duration-1000"
                          style={{ width: `${toNumber(stat.percentage)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 text-gray-400">
                <div className="text-center">
                  <Database size={48} className="mx-auto mb-3 opacity-50" />
                  <p>No process data</p>
                </div>
              </div>
            )}
          </div>

          {/* Recent Activities */}
          <div className="xl:col-span-2 bg-white border border-gray-200 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-black">Activity Stream</h2>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-xs text-gray-600">Live</span>
              </div>
            </div>
            <div className="space-y-3">
              {recentRecords.length > 0 ? (
                recentRecords.map((record, idx) => (
                  <div key={idx} className="relative">
                    <div className="flex items-start gap-3">
                      <div className="relative mt-1">
                        <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-lg flex items-center justify-center text-white font-bold text-xs shadow-lg">
                          {(record?.userCode || "--").slice(-2)}
                        </div>
                        {idx === 0 && (
                          <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="bg-gradient-to-r from-gray-50 to-white rounded-xl p-3 border border-gray-100">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-black text-sm">
                              {record?.processType || "—"}
                            </span>
                            <span className="text-xs px-2 py-1 bg-gradient-to-r from-cyan-100 to-blue-100 text-cyan-700 rounded-full font-medium">
                              {formatTime(record?.processTime)}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                              <Users size={12} />
                              {record?.userCode || "—"}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock size={12} />
                              {formatDateTime(record?.startTime)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    {idx < recentRecords.length - 1 && (
                      <div className="absolute left-5 top-12 bottom-0 w-px bg-gradient-to-b from-cyan-200 to-transparent"></div>
                    )}
                  </div>
                ))
              ) : (
                <div className="flex items-center justify-center h-40 text-gray-400">
                  <div className="text-center">
                    <Database size={36} className="mx-auto mb-3 opacity-50" />
                    <p>No recent activities</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Trend Analysis - Full Width */}
        <div className="mt-6 bg-white border border-gray-200 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-black">Performance Analytics</h2>
              <p className="text-sm text-gray-500 mt-1">Historical trend analysis and predictions</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl">
                <input
                  type="date"
                  className="bg-transparent outline-none text-sm font-medium text-black"
                  value={dateRange.startDate}
                  onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
                  max={dateRange.endDate}
                />
                <span className="text-gray-400">→</span>
                <input
                  type="date"
                  className="bg-transparent outline-none text-sm font-medium text-black"
                  value={dateRange.endDate}
                  onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
                  min={dateRange.startDate}
                  max={todayISO}
                />
              </div>
              <BarChart3 className="text-blue-500" size={20} />
            </div>
          </div>

          <div className="bg-gradient-to-r from-gray-50 to-white rounded-xl p-6 border border-gray-100">
            {recentRange.length > 0 ? (
              <div>
                <div className="flex items-end justify-between h-64 gap-2">
                  {recentRange.map((stat, idx) => {
                    const height = (toNumber(stat.avgProcessTime) / maxTime) * 100;
                    const isToday = idx === recentRange.length - 1;

                    return (
                      <div
                        key={`${stat.date || idx}-${idx}`}
                        className="flex-1 flex flex-col items-center gap-2 group"
                      >
                        <div className="relative w-full flex-1 flex items-end">
                          <div
                            className={`w-full rounded-t-lg transition-all duration-500 hover:opacity-80 cursor-pointer ${
                              isToday
                                ? "bg-gradient-to-t from-cyan-500 to-blue-500 shadow-lg"
                                : "bg-gradient-to-t from-gray-400 to-gray-600"
                            }`}
                            style={{ height: `${Math.max(0, height)}%` }}
                            title={`Avg: ${formatTime(stat.avgProcessTime)}`}
                          />
                          {isToday && (
                            <div className="absolute -top-2 left-1/2 transform -translate-x-1/2">
                              <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></div>
                            </div>
                          )}
                        </div>
                        <div className="text-center">
                          <p className="text-xs font-semibold text-black opacity-0 group-hover:opacity-100 transition-opacity">
                            {formatTime(stat.avgProcessTime)}
                          </p>
                          <p className="text-xs text-gray-600">
                            {new Date(stat.date || 0).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Trend Summary */}
                <div className="grid grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-200">
                  <div className="text-center">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Avg Time</p>
                    <p className="text-xl font-bold text-black">
                      {formatTime(
                        recentRange.reduce((sum, s) => sum + toNumber(s.avgProcessTime), 0) /
                          recentRange.length
                      )}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Best Day</p>
                    <p className="text-xl font-bold text-green-600">
                      {formatTime(Math.min(...recentRange.map((s) => toNumber(s.avgProcessTime))))}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Peak Day</p>
                    <p className="text-xl font-bold text-orange-600">
                      {formatTime(Math.max(...recentRange.map((s) => toNumber(s.avgProcessTime))))}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Trend</p>
                    <div className="flex items-center justify-center gap-1">
                      {toNumber(recentRange[recentRange.length - 1]?.avgProcessTime) <
                      toNumber(recentRange[0]?.avgProcessTime) ? (
                        <>
                          <ChevronDown className="text-green-500" size={20} />
                          <p className="text-xl font-bold text-green-600">Improving</p>
                        </>
                      ) : (
                        <>
                          <ChevronUp className="text-orange-500" size={20} />
                          <p className="text-xl font-bold text-orange-600">Rising</p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 text-gray-400">
                <div className="text-center">
                  <Database size={48} className="mx-auto mb-3 opacity-50" />
                  <p>No range data</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
