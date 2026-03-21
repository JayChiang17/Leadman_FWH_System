import React, { useState, useEffect, useCallback, useRef } from "react";
import api from "../../services/api";
import "./SystemMonitor.css";
import Plot3D, { buildHourDowMatrix } from "../../components/Plot3D";
import { PLOTLY_DARK_LAYOUT } from "../../utils/chartTheme";

// ── Tab definitions ──
const TABS = [
  { key: "health",    label: "Health" },
  { key: "docker",    label: "Docker" },
  { key: "ws",        label: "WebSocket" },
  { key: "api-logs",  label: "API Logs" },
  { key: "audit",     label: "Audit Trail" },
  { key: "fe-errors", label: "Frontend Errors" },
  { key: "3d",        label: "3D Analysis" },
];

export default function SystemMonitor() {
  const [tab, setTab] = useState("health");

  return (
    <div className="min-h-screen bg-surface-base p-4 md:p-6 pb-20 md:pb-8">
      <h1 className="text-xl md:text-2xl font-bold text-ink-primary mb-4">System Monitor</h1>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-stroke mb-6 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm whitespace-nowrap transition-colors duration-150 ${
              tab === t.key
                ? "monitor-tab-active"
                : "text-ink-muted hover:text-ink-secondary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "health"    && <HealthTab />}
      {tab === "docker"    && <DockerTab />}
      {tab === "ws"        && <WebSocketTab />}
      {tab === "api-logs"  && <ApiLogsTab />}
      {tab === "audit"     && <AuditTab />}
      {tab === "fe-errors" && <FrontendErrorsTab />}
      {tab === "3d"        && <Monitor3DTab />}
    </div>
  );
}

// ════════════════════════════════════════
// Health Tab
// ════════════════════════════════════════
function HealthTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);

  const fetch_ = useCallback(async () => {
    try {
      const res = await api.get("monitor/health");
      setData(res.data);
    } catch (e) {
      console.error("Health fetch error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch_();
    timerRef.current = setInterval(fetch_, 30000);
    return () => clearInterval(timerRef.current);
  }, [fetch_]);

  if (loading) return <Spinner />;
  if (!data) return <p className="text-ink-muted">Failed to load health data.</p>;

  const fmtUptime = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  };

  const dbHealth = data.database_health || {};
  const dbCapacity = data.database_capacity || {};
  const dbTables = Array.isArray(dbCapacity.tables) ? dbCapacity.tables : [];
  const connUsage = dbHealth.connection_usage_percent ?? 0;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard label="DB Healthy" value={`${data.healthy_db_count}/${data.total_db_count}`} color="teal" />
        <StatCard label="DB Size" value={dbCapacity.database_size_pretty || "-"} color="gray" />
        <StatCard label="DB Connections" value={`${dbHealth.connection_count ?? 0}/${dbHealth.max_connections ?? 0}`} color={connUsage > 80 ? "red" : "cyan"} />
        <StatCard label="WS Connections" value={data.ws_connections} color="cyan" />
        <StatCard label="Memory" value={`${data.memory.percent}%`} color={data.memory.percent > 85 ? "red" : "emerald"} />
        <StatCard label="Uptime" value={fmtUptime(data.uptime_seconds)} color="gray" />
      </div>

      {/* DB health summary */}
      <div className="bg-surface-panel border border-stroke rounded-lg shadow-sm p-4">
        <h3 className="font-semibold text-ink-secondary text-sm mb-3">Database Health</h3>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-sm">
          <div className="rounded border border-stroke p-3 bg-surface-base">
            <p className="text-ink-muted text-xs uppercase tracking-wide">Status</p>
            <p className={`font-semibold mt-1 ${dbHealth.status === "ok" ? "text-emerald-400" : "text-amber-400"}`}>{dbHealth.status || "unknown"}</p>
          </div>
          <div className="rounded border border-stroke p-3 bg-surface-base">
            <p className="text-ink-muted text-xs uppercase tracking-wide">Response</p>
            <p className="font-semibold mt-1">{dbHealth.response_ms ?? 0} ms</p>
          </div>
          <div className="rounded border border-stroke p-3 bg-surface-base">
            <p className="text-ink-muted text-xs uppercase tracking-wide">Conn Usage</p>
            <p className={`font-semibold mt-1 ${connUsage > 80 ? "text-red-400" : "text-ink-primary"}`}>{connUsage}%</p>
          </div>
          <div className="rounded border border-stroke p-3 bg-surface-base">
            <p className="text-ink-muted text-xs uppercase tracking-wide">Cache Hit</p>
            <p className="font-semibold mt-1">{dbHealth.cache_hit_percent ?? 0}%</p>
          </div>
          <div className="rounded border border-stroke p-3 bg-surface-base">
            <p className="text-ink-muted text-xs uppercase tracking-wide">Deadlocks / Temp</p>
            <p className="font-semibold mt-1">{dbHealth.deadlocks ?? 0} / {dbHealth.temp_size_pretty || "0 bytes"}</p>
          </div>
        </div>
      </div>

      {/* DB detail table */}
      <div className="bg-surface-panel border border-stroke rounded-lg shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-base">
            <tr>
              <th className="text-left px-4 py-2 font-semibold text-ink-secondary">Database</th>
              <th className="text-left px-4 py-2 font-semibold text-ink-secondary">Status</th>
              <th className="text-right px-4 py-2 font-semibold text-ink-secondary">Tables</th>
              <th className="text-right px-4 py-2 font-semibold text-ink-secondary">Size</th>
            </tr>
          </thead>
          <tbody>
            {data.databases.map((db) => (
              <tr key={db.name} className="border-t border-stroke-subtle">
                <td className="px-4 py-2 font-medium">{db.name}</td>
                <td className="px-4 py-2">
                  <span className={`monitor-status-dot ${db.status}`} />{" "}
                  <span className="capitalize">{db.status}</span>
                </td>
                <td className="px-4 py-2 text-right">{db.table_count ?? "-"}</td>
                <td className="px-4 py-2 text-right font-mono text-xs">{db.total_size_pretty ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Table capacity */}
      <div className="bg-surface-panel border border-stroke rounded-lg shadow-sm">
        <div className="px-4 py-3 border-b border-stroke-subtle flex items-center justify-between">
          <h3 className="font-semibold text-ink-secondary text-sm">Table Capacity</h3>
          <span className="text-xs text-ink-muted">{dbCapacity.table_count ?? 0} tables</span>
        </div>
        <div className="overflow-x-auto max-h-[420px]">
          <table className="w-full text-sm">
            <thead className="bg-surface-base sticky top-0">
              <tr>
                <th className="text-left px-4 py-2 font-semibold text-ink-secondary">Table</th>
                <th className="text-right px-4 py-2 font-semibold text-ink-secondary">Rows(est)</th>
                <th className="text-right px-4 py-2 font-semibold text-ink-secondary">Data</th>
                <th className="text-right px-4 py-2 font-semibold text-ink-secondary">Index</th>
                <th className="text-right px-4 py-2 font-semibold text-ink-secondary">Total</th>
              </tr>
            </thead>
            <tbody>
              {dbTables.map((t) => (
                <tr key={`${t.schema_name}.${t.table_name}`} className="border-t border-stroke-subtle">
                  <td className="px-4 py-2 font-mono text-xs">{t.schema_name}.{t.table_name}</td>
                  <td className="px-4 py-2 text-right font-mono">{t.estimated_rows ?? 0}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{t.table_size_pretty || "-"}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{t.index_size_pretty || "-"}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs font-semibold">{t.total_size_pretty || "-"}</td>
                </tr>
              ))}
              {dbTables.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-ink-muted">No table capacity data.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// Docker Tab
// ════════════════════════════════════════
function DockerTab() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const timerRef = useRef(null);

  const fetch_ = useCallback(async () => {
    try {
      const res = await api.get("monitor/docker");
      setData(res.data);
      setLastUpdated(new Date());
    } catch (e) {
      console.error("Docker fetch error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch_();
    timerRef.current = setInterval(fetch_, 15000);
    return () => clearInterval(timerRef.current);
  }, [fetch_]);

  if (loading) return <Spinner />;
  if (!data)   return <p className="text-ink-muted">Failed to load Docker data.</p>;

  /* ── Docker not available ── */
  if (!data.available) {
    return (
      <div className="bg-signal-warn/10 border border-amber-500/30 rounded-lg p-6 flex items-start gap-3">
        <span className="text-2xl mt-0.5">🐳</span>
        <div>
          <p className="font-semibold text-amber-300 mb-1">Docker unavailable</p>
          <p className="text-sm text-amber-400">{data.error || "Docker CLI not found or daemon not running."}</p>
        </div>
      </div>
    );
  }

  const stateChip = (state) => {
    if (state === "running") return "bg-signal-ok/10 text-emerald-400 border-emerald-500/30";
    if (state === "exited")  return "bg-signal-error/10    text-red-400    border-red-500/30";
    if (state === "paused")  return "bg-signal-warn/10  text-amber-400  border-amber-500/30";
    return                          "bg-surface-base   text-ink-secondary   border-stroke";
  };

  const stateDot = (state) => {
    if (state === "running") return "bg-signal-ok shadow-emerald-400";
    if (state === "exited")  return "bg-red-400";
    if (state === "paused")  return "bg-amber-400";
    return                          "bg-gray-400";
  };

  return (
    <div className="space-y-6">

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Running"  value={data.running} color={data.running > 0 ? "emerald" : "gray"} />
        <StatCard label="Stopped"  value={data.exited}  color={data.exited  > 0 ? "red"     : "gray"} />
        <StatCard label="Paused"   value={data.paused}  color={data.paused  > 0 ? "amber"   : "gray"} />
        <StatCard label="Total"    value={data.total}   color="gray" />
      </div>

      {/* ── Container table ── */}
      <div className="bg-surface-panel border border-stroke rounded-lg shadow-sm">
        <div className="px-4 py-3 border-b border-stroke-subtle flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🐳</span>
            <h3 className="font-semibold text-ink-secondary text-sm">Containers</h3>
            <span className="text-xs text-ink-muted">{data.total} total</span>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-ink-muted hidden md:inline">
                Updated {lastUpdated.toLocaleTimeString("en-US", { hour12: false })}
              </span>
            )}
            <button
              onClick={fetch_}
              className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs rounded-lg font-medium transition-colors duration-150"
            >
              Refresh
            </button>
          </div>
        </div>

        {data.containers.length === 0 ? (
          <p className="text-center py-10 text-ink-muted text-sm">No containers found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-base">
                <tr>
                  <th className="w-4 px-3 py-2.5" />
                  <th className="text-left px-3 py-2.5 font-semibold text-ink-secondary whitespace-nowrap">Name</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-ink-secondary whitespace-nowrap">Image</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-ink-secondary whitespace-nowrap">Status</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-ink-secondary whitespace-nowrap">CPU%</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-ink-secondary whitespace-nowrap">Memory</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-ink-secondary whitespace-nowrap">Mem%</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-ink-secondary whitespace-nowrap">Net I/O</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-ink-secondary whitespace-nowrap">Block I/O</th>
                  <th className="text-right px-3 py-2.5 font-semibold text-ink-secondary whitespace-nowrap">PIDs</th>
                </tr>
              </thead>
              <tbody>
                {data.containers.map((c) => (
                  <tr key={c.id} className="border-t border-stroke-subtle hover:bg-surface-raised transition-colors">
                    {/* state dot */}
                    <td className="px-3 py-3">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${stateDot(c.state)} ${c.state === "running" ? "shadow-sm" : ""}`}
                      />
                    </td>
                    {/* name */}
                    <td className="px-3 py-3 font-mono font-semibold text-ink-primary whitespace-nowrap">
                      {c.name}
                    </td>
                    {/* image */}
                    <td className="px-3 py-3 font-mono text-xs text-ink-muted max-w-[160px] truncate" title={c.image}>
                      {c.image}
                    </td>
                    {/* status chip */}
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${stateChip(c.state)}`}>
                        {c.status}
                      </span>
                    </td>
                    {/* cpu */}
                    <td className={`px-3 py-3 text-right font-mono text-xs ${
                      parseFloat(c.cpu_pct) > 80 ? "text-red-400 font-bold" :
                      parseFloat(c.cpu_pct) > 50 ? "text-amber-400" : "text-ink-secondary"
                    }`}>
                      {c.cpu_pct}
                    </td>
                    {/* mem usage */}
                    <td className="px-3 py-3 text-right font-mono text-xs text-ink-secondary whitespace-nowrap">
                      {c.mem_usage}
                    </td>
                    {/* mem pct */}
                    <td className={`px-3 py-3 text-right font-mono text-xs ${
                      parseFloat(c.mem_pct) > 80 ? "text-red-400 font-bold" :
                      parseFloat(c.mem_pct) > 60 ? "text-amber-400" : "text-ink-muted"
                    }`}>
                      {c.mem_pct}
                    </td>
                    {/* net io */}
                    <td className="px-3 py-3 text-right font-mono text-xs text-ink-muted whitespace-nowrap">
                      {c.net_io}
                    </td>
                    {/* block io */}
                    <td className="px-3 py-3 text-right font-mono text-xs text-ink-muted whitespace-nowrap">
                      {c.block_io}
                    </td>
                    {/* pids */}
                    <td className="px-3 py-3 text-right font-mono text-xs text-ink-secondary">
                      {c.pids}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Ports section (if any container exposes ports) ── */}
      {data.containers.some((c) => c.ports) && (
        <div className="bg-surface-panel border border-stroke rounded-lg shadow-sm">
          <div className="px-4 py-3 border-b border-stroke-subtle">
            <h3 className="font-semibold text-ink-secondary text-sm">Port Mappings</h3>
          </div>
          <div className="p-4 space-y-2">
            {data.containers
              .filter((c) => c.ports)
              .map((c) => (
                <div key={c.id} className="flex items-start gap-3">
                  <span className={`mt-0.5 inline-block w-2 h-2 rounded-full flex-shrink-0 ${stateDot(c.state)}`} />
                  <span className="text-sm font-mono font-semibold text-ink-secondary w-36 shrink-0">{c.name}</span>
                  <span className="text-xs font-mono text-ink-muted break-all">{c.ports}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      <p className="text-xs text-ink-muted">
        Auto-refreshes every 15s · Stats via <code className="font-mono bg-surface-raised px-1 rounded">docker stats --no-stream</code>
      </p>
    </div>
  );
}


// ════════════════════════════════════════
// WebSocket Tab
// ════════════════════════════════════════
function WebSocketTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);

  const fetch_ = useCallback(async () => {
    try {
      const res = await api.get("monitor/ws-stats");
      setData(res.data);
    } catch (e) {
      console.error("WS stats fetch error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch_();
    timerRef.current = setInterval(fetch_, 10000);
    return () => clearInterval(timerRef.current);
  }, [fetch_]);

  if (loading) return <Spinner />;
  if (!data) return <p className="text-ink-muted">Failed to load WebSocket data.</p>;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard label="Active Connections" value={data.total} color="cyan" />
        <StatCard label="Unique Users" value={data.by_user.length} color="teal" />
        <StatCard
          label="Excessive"
          value={data.excessive.length > 0 ? `${data.excessive.length} user(s)` : "None"}
          color={data.excessive.length > 0 ? "red" : "emerald"}
        />
      </div>

      {/* Excessive warning */}
      {data.excessive.length > 0 && (
        <div className="bg-signal-error/10 border border-red-500/30 rounded-lg p-4">
          <p className="text-red-400 font-semibold text-sm mb-2">Excessive Connections Detected (&gt;3 per user)</p>
          <div className="flex flex-wrap gap-2">
            {data.excessive.map((e) => (
              <span key={e.user} className="bg-signal-error/15 text-red-300 text-xs font-mono px-2 py-1 rounded">
                {e.user}: {e.count} connections
              </span>
            ))}
          </div>
        </div>
      )}

      {/* By user */}
      {data.by_user.length > 0 && (
        <div className="bg-surface-panel border border-stroke rounded-lg shadow-sm overflow-x-auto">
          <div className="px-4 py-3 border-b border-stroke-subtle">
            <h3 className="font-semibold text-ink-secondary text-sm">Connections by User</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-surface-base">
              <tr>
                <th className="text-left px-4 py-2 font-semibold text-ink-secondary">User</th>
                <th className="text-right px-4 py-2 font-semibold text-ink-secondary">Connections</th>
              </tr>
            </thead>
            <tbody>
              {data.by_user.map((u) => (
                <tr key={u.user} className="border-t border-stroke-subtle">
                  <td className="px-4 py-2 font-medium">{u.user}</td>
                  <td className="px-4 py-2 text-right">
                    <span className={`font-mono ${u.count > 3 ? "text-red-400 font-bold" : "text-ink-secondary"}`}>{u.count}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* All connections detail */}
      <div className="bg-surface-panel border border-stroke rounded-lg shadow-sm overflow-x-auto">
        <div className="px-4 py-3 border-b border-stroke-subtle">
          <h3 className="font-semibold text-ink-secondary text-sm">All Active Connections</h3>
        </div>
        {data.connections.length === 0 ? (
          <p className="text-center py-8 text-ink-muted text-sm">No active WebSocket connections</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-base">
              <tr>
                {["User", "Role", "Connected", "Messages", "Idle"].map((h) => (
                  <th key={h} className="text-left px-3 py-2 font-semibold text-ink-secondary">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.connections.map((c, i) => (
                <tr key={`${c.user || "anon"}-${i}`} className="border-t border-stroke-subtle">
                  <td className="px-3 py-2 font-medium">{c.user}</td>
                  <td className="px-3 py-2 text-ink-muted">{c.role}</td>
                  <td className="px-3 py-2">{fmtDuration(c.connected_seconds)}</td>
                  <td className="px-3 py-2 text-right font-mono">{c.msg_count}</td>
                  <td className="px-3 py-2">
                    <span className={c.idle_seconds > 120 ? "text-amber-400" : "text-ink-secondary"}>
                      {fmtDuration(c.idle_seconds)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <button onClick={fetch_}
        className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm rounded-lg font-medium transition-colors duration-150">
        Refresh
      </button>
    </div>
  );
}

// ════════════════════════════════════════
// API Logs Tab
// ════════════════════════════════════════
function ApiLogsTab() {
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filterPath, setFilterPath] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get("monitor/api-stats");
      setStats(res.data);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      setLoading(true);
      try {
        const params = { page, limit: 50 };
        if (filterPath) params.path = filterPath;
        if (filterStatus) params.status_code = parseInt(filterStatus);
        const res = await api.get("monitor/api-logs", { params });
        if (!cancelled) { setLogs(res.data.records); setTotal(res.data.total); }
      } catch (e) {
        if (!cancelled) console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [page, filterPath, filterStatus, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fetchStats(); }, [fetchStats]);

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="space-y-4">
      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="P50" value={`${stats.p50}ms`} color="teal" />
          <StatCard label="P95" value={`${stats.p95}ms`} color="cyan" />
          <StatCard label="P99" value={`${stats.p99}ms`} color="amber" />
          <StatCard label="Total Requests" value={stats.total_requests} color="gray" />
          <StatCard label="Error Rate" value={`${stats.error_rate}%`} color={stats.error_rate > 5 ? "red" : "emerald"} />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-2">
        <input
          type="text"
          placeholder="Filter by path..."
          value={filterPath}
          onChange={(e) => { setFilterPath(e.target.value); setPage(1); }}
          className="border-2 border-stroke rounded-lg px-3 py-2 text-sm bg-surface-panel focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
        />
        <input
          type="text"
          placeholder="Status code..."
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
          className="border-2 border-stroke rounded-lg px-3 py-2 text-sm bg-surface-panel w-32 focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
        />
        <button onClick={() => { setRefreshKey((k) => k + 1); fetchStats(); }}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm rounded-lg font-medium transition-colors duration-150">
          Refresh
        </button>
      </div>

      {/* Table */}
      <div className="bg-surface-panel border border-stroke rounded-lg shadow-sm overflow-x-auto">
        {loading ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className="bg-surface-base">
              <tr>
                {["Timestamp", "Method", "Path", "Status", "Duration", "User"].map((h) => (
                  <th key={h} className="text-left px-3 py-2 font-semibold text-ink-secondary">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((r) => (
                <tr key={r.id} className="border-t border-stroke-subtle">
                  <td className="px-3 py-2 whitespace-nowrap">{fmtTs(r.occurred_at)}</td>
                  <td className="px-3 py-2">
                    <span className={`font-mono text-xs px-1.5 py-0.5 rounded ${methodColor(r.method)}`}>{r.method}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs max-w-xs truncate">{r.path}</td>
                  <td className="px-3 py-2">
                    <span className={`font-mono ${r.status_code >= 400 ? "text-red-400 font-bold" : "text-ink-secondary"}`}>{r.status_code}</span>
                  </td>
                  <td className="px-3 py-2 text-right">{r.duration_ms?.toFixed(1)}ms</td>
                  <td className="px-3 py-2">{r.username || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}
            className="px-3 py-1 border border-stroke rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-raised transition-colors">Prev</button>
          <span className="text-sm text-ink-secondary">Page {page} of {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}
            className="px-3 py-1 border border-stroke rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-raised transition-colors">Next</button>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════
// Audit Trail Tab
// ════════════════════════════════════════
function AuditTab() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filterUser, setFilterUser] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      setLoading(true);
      try {
        const params = { page, limit: 50 };
        if (filterUser) params.user = filterUser;
        if (filterAction) params.action = filterAction;
        const res = await api.get("monitor/audit-logs", { params });
        if (!cancelled) { setLogs(res.data.records); setTotal(res.data.total); }
      } catch (e) {
        if (!cancelled) console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [page, filterUser, filterAction, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-2">
        <input type="text" placeholder="Filter by user..." value={filterUser}
          onChange={(e) => { setFilterUser(e.target.value); setPage(1); }}
          className="border-2 border-stroke rounded-lg px-3 py-2 text-sm bg-surface-panel focus:ring-2 focus:ring-teal-500 focus:border-teal-500" />
        <select value={filterAction} onChange={(e) => { setFilterAction(e.target.value); setPage(1); }}
          className="border-2 border-stroke rounded-lg px-3 py-2 text-sm bg-surface-panel focus:ring-2 focus:ring-teal-500 focus:border-teal-500">
          <option value="">All Actions</option>
          <option value="ate_ng_mark">ATE NG Mark</option>
          <option value="ate_ng_clear">ATE NG Clear</option>
          <option value="downtime_add">Downtime Add</option>
          <option value="downtime_delete">Downtime Delete</option>
          <option value="user_role_change">User Role Change</option>
          <option value="email_config_update">Email Config Update</option>
        </select>
        <button onClick={() => setRefreshKey((k) => k + 1)}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm rounded-lg font-medium transition-colors duration-150">
          Refresh
        </button>
      </div>

      <div className="bg-surface-panel border border-stroke rounded-lg shadow-sm overflow-x-auto">
        {loading ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className="bg-surface-base">
              <tr>
                {["Timestamp", "User", "Action", "Target", "Old Value", "New Value"].map((h) => (
                  <th key={h} className="text-left px-3 py-2 font-semibold text-ink-secondary">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((r) => (
                <tr key={r.id} className="border-t border-stroke-subtle">
                  <td className="px-3 py-2 whitespace-nowrap">{fmtTs(r.occurred_at)}</td>
                  <td className="px-3 py-2 font-medium">{r.username}</td>
                  <td className="px-3 py-2">
                    <span className="bg-surface-raised text-ink-secondary text-xs font-mono px-2 py-0.5 rounded">{r.action}</span>
                  </td>
                  <td className="px-3 py-2">{r.target || "-"}</td>
                  <td className="px-3 py-2 text-ink-muted max-w-[120px] truncate">{r.old_value || "-"}</td>
                  <td className="px-3 py-2 max-w-[120px] truncate">{r.new_value || "-"}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-ink-muted">
                  <p className="font-medium mb-1">No audit logs yet</p>
                  <p className="text-xs">Audit events are recorded when actions are performed: ATE NG mark/clear, downtime add/delete, user role change, email config update.</p>
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}
            className="px-3 py-1 border border-stroke rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-raised transition-colors">Prev</button>
          <span className="text-sm text-ink-secondary">Page {page} of {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}
            className="px-3 py-1 border border-stroke rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-raised transition-colors">Next</button>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════
// Frontend Errors Tab
// ════════════════════════════════════════
function FrontendErrorsTab() {
  const [errors, setErrors] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchErrors = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("monitor/frontend-errors", { params: { page, limit: 50 } });
      setErrors(res.data.records);
      setTotal(res.data.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { fetchErrors(); }, [fetchErrors]);

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="space-y-4">
      <button onClick={fetchErrors}
        className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm rounded-lg font-medium transition-colors duration-150">
        Refresh
      </button>

      <div className="bg-surface-panel border border-stroke rounded-lg shadow-sm overflow-x-auto">
        {loading ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className="bg-surface-base">
              <tr>
                {["Timestamp", "Component", "Error", "User", "URL", ""].map((h) => (
                  <th key={h} className="text-left px-3 py-2 font-semibold text-ink-secondary">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {errors.map((r) => (
                <React.Fragment key={r.id}>
                  <tr className="border-t border-stroke-subtle">
                    <td className="px-3 py-2 whitespace-nowrap">{fmtTs(r.occurred_at)}</td>
                    <td className="px-3 py-2">{r.component || "-"}</td>
                    <td className="px-3 py-2 max-w-xs truncate text-red-400">{r.error_message}</td>
                    <td className="px-3 py-2">{r.username || "-"}</td>
                    <td className="px-3 py-2 max-w-[150px] truncate text-ink-muted">{r.url || "-"}</td>
                    <td className="px-3 py-2">
                      {r.stack && (
                        <button onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                          className="text-teal-400 hover:text-teal-400 text-xs font-medium monitor-stack-toggle">
                          {expanded === r.id ? "Hide" : "Stack"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === r.id && r.stack && (
                    <tr>
                      <td colSpan={6} className="px-3 py-2 bg-surface-base">
                        <pre className="text-xs text-ink-secondary whitespace-pre-wrap max-h-48 overflow-y-auto font-mono">{r.stack}</pre>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {errors.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-ink-muted">
                  <p className="font-medium mb-1">No frontend errors recorded</p>
                  <p className="text-xs">Errors are captured automatically when React components crash (via ErrorBoundary). No crashes have occurred.</p>
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}
            className="px-3 py-1 border border-stroke rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-raised transition-colors">Prev</button>
          <span className="text-sm text-ink-secondary">Page {page} of {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}
            className="px-3 py-1 border border-stroke rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-raised transition-colors">Next</button>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════
// 3D Analysis Tab
// ════════════════════════════════════════
function Monitor3DTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState("avg_ms"); // avg_ms | request_count

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("monitor/api-stats/response-3d");
      setData(res.data?.data || []);
    } catch (e) {
      console.error("3D response fetch error:", e);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);

  const DOW_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  const renderChart = () => {
    if (!data || data.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center bg-surface-base rounded-lg border border-stroke" style={{ height: 480 }}>
          <p className="text-ink-muted font-semibold text-sm">No API log data yet</p>
          <p className="text-ink-muted text-xs mt-1">Logs accumulate over time</p>
        </div>
      );
    }
    const { z, x, y } = buildHourDowMatrix(data, metric);
    const isMs = metric === "avg_ms";
    return (
      <Plot3D
        title=""
        xTitle="Hour of Day"
        yTitle="Day of Week"
        zTitle={isMs ? "Avg Response (ms)" : "Request Count"}
        height={480}
        data={[{
          type: "surface",
          z, x, y,
          colorscale: isMs ? [
            [0,   "#f0fdf4"],
            [0.3, "#6ee7b7"],
            [0.6, "#f59e0b"],
            [0.85,"#ef4444"],
            [1,   "#7f1d1d"],
          ] : [
            [0,   "#f0fdf4"],
            [0.25,"#6ee7b7"],
            [0.5, "#0d9488"],
            [0.75,"#0891b2"],
            [1,   "#1e40af"],
          ],
          contours: {
            z: { show: true, usecolormap: true, highlightcolor: "#0d9488", project: { z: true } }
          },
          hovertemplate: isMs
            ? "<b>%{y}</b><br>Hour: %{x}<br>Avg: <b>%{z} ms</b><extra></extra>"
            : "<b>%{y}</b><br>Hour: %{x}<br>Requests: <b>%{z}</b><extra></extra>",
        }]}
        layout={{
          ...PLOTLY_DARK_LAYOUT,
          scene: {
            ...PLOTLY_DARK_LAYOUT.scene,
            camera: { eye: { x: 1.5, y: 1.5, z: 1.2 } },
            yaxis: {
              ...PLOTLY_DARK_LAYOUT.scene.yaxis,
              title: "Day of Week",
              tickmode: "array", tickvals: [0,1,2,3,4,5,6], ticktext: DOW_LABELS,
            },
            xaxis: { ...PLOTLY_DARK_LAYOUT.scene.xaxis, title: "Hour of Day" },
            zaxis: { ...PLOTLY_DARK_LAYOUT.scene.zaxis, title: isMs ? "ms" : "Count" },
          },
          margin: { l: 0, r: 0, t: 10, b: 0 },
        }}
      />
    );
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1 bg-surface-raised rounded-lg p-1">
          <button
            onClick={() => setMetric("avg_ms")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${metric === "avg_ms" ? "bg-surface-panel text-ink-primary shadow-sm" : "text-ink-muted hover:text-ink-secondary"}`}
          >
            Avg Response Time
          </button>
          <button
            onClick={() => setMetric("request_count")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${metric === "request_count" ? "bg-surface-panel text-ink-primary shadow-sm" : "text-ink-muted hover:text-ink-secondary"}`}
          >
            Request Volume
          </button>
        </div>
        <button
          onClick={fetch_}
          disabled={loading}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs rounded-lg font-medium transition-colors duration-150 disabled:opacity-50"
        >
          Refresh
        </button>
        <span className="text-xs text-ink-muted">Past 30 days · drag to rotate</span>
      </div>

      {/* Chart cards */}
      <div className="bg-surface-panel border border-stroke rounded-lg shadow-sm p-4">
        <h3 className="font-semibold text-ink-secondary text-sm mb-1">
          {metric === "avg_ms" ? "API Response Time Heatmap" : "API Request Volume Heatmap"}
        </h3>
        <p className="text-xs text-ink-muted mb-3">Hour-of-Day × Day-of-Week · 3D surface chart</p>
        {loading ? (
          <div className="flex items-center justify-center bg-surface-base rounded-lg border border-stroke animate-pulse" style={{ height: 480 }}>
            <p className="text-sm text-ink-muted">Building 3D surface…</p>
          </div>
        ) : renderChart()}
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// Shared components & utils
// ════════════════════════════════════════

function StatCard({ label, value, color }) {
  const colorMap = {
    teal: "bg-teal-500/10 text-teal-400 border-teal-500/30",
    cyan: "bg-signal-info/10 text-cyan-400 border-cyan-500/30",
    emerald: "bg-signal-ok/10 text-emerald-400 border-emerald-500/30",
    amber: "bg-signal-warn/10 text-amber-400 border-amber-500/30",
    red: "bg-signal-error/10 text-red-400 border-red-500/30",
    gray: "bg-surface-base text-ink-secondary border-stroke",
  };
  return (
    <div className={`border rounded-lg p-4 ${colorMap[color] || colorMap.gray}`}>
      <p className="text-xs uppercase tracking-wide font-semibold opacity-70">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-8">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600" />
    </div>
  );
}

function fmtDuration(s) {
  if (s == null) return "-";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

function fmtTs(iso) {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  } catch {
    return iso;
  }
}

function methodColor(m) {
  const map = { GET: "bg-signal-ok/15 text-emerald-400", POST: "bg-signal-info/15 text-cyan-400", PUT: "bg-signal-warn/15 text-amber-400", DELETE: "bg-signal-error/15 text-red-400", PATCH: "bg-surface-raised text-ink-secondary" };
  return map[m] || "bg-surface-raised text-ink-secondary";
}
