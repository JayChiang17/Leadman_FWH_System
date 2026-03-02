import React, { useState, useEffect, useCallback, useRef } from "react";
import api from "../../services/api";
import "./SystemMonitor.css";

// ── Tab definitions ──
const TABS = [
  { key: "health", label: "Health" },
  { key: "ws", label: "WebSocket" },
  { key: "api-logs", label: "API Logs" },
  { key: "audit", label: "Audit Trail" },
  { key: "fe-errors", label: "Frontend Errors" },
];

export default function SystemMonitor() {
  const [tab, setTab] = useState("health");

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 pb-20 md:pb-8">
      <h1 className="text-xl md:text-2xl font-bold text-gray-800 mb-4">System Monitor</h1>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm whitespace-nowrap transition-colors duration-150 ${
              tab === t.key
                ? "monitor-tab-active"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "health" && <HealthTab />}
      {tab === "ws" && <WebSocketTab />}
      {tab === "api-logs" && <ApiLogsTab />}
      {tab === "audit" && <AuditTab />}
      {tab === "fe-errors" && <FrontendErrorsTab />}
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
  if (!data) return <p className="text-gray-500">Failed to load health data.</p>;

  const fmtUptime = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  };

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="DB Healthy" value={`${data.healthy_db_count}/${data.total_db_count}`} color="teal" />
        <StatCard label="WS Connections" value={data.ws_connections} color="cyan" />
        <StatCard label="Memory" value={`${data.memory.percent}%`} color={data.memory.percent > 85 ? "red" : "emerald"} />
        <StatCard label="Uptime" value={fmtUptime(data.uptime_seconds)} color="gray" />
      </div>

      {/* DB detail table */}
      <div className="bg-white border border-stone-200 rounded-lg shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-2 font-semibold text-gray-600">Database</th>
              <th className="text-left px-4 py-2 font-semibold text-gray-600">Status</th>
              <th className="text-right px-4 py-2 font-semibold text-gray-600">Size (MB)</th>
              <th className="text-right px-4 py-2 font-semibold text-gray-600">WAL (MB)</th>
            </tr>
          </thead>
          <tbody>
            {data.databases.map((db) => (
              <tr key={db.name} className="border-t border-gray-100">
                <td className="px-4 py-2 font-medium">{db.name}</td>
                <td className="px-4 py-2">
                  <span className={`monitor-status-dot ${db.status}`} />{" "}
                  <span className="capitalize">{db.status}</span>
                </td>
                <td className="px-4 py-2 text-right">{db.size_mb ?? "-"}</td>
                <td className="px-4 py-2 text-right">{db.wal_size_mb ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  if (!data) return <p className="text-gray-500">Failed to load WebSocket data.</p>;

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
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700 font-semibold text-sm mb-2">Excessive Connections Detected (&gt;3 per user)</p>
          <div className="flex flex-wrap gap-2">
            {data.excessive.map((e) => (
              <span key={e.user} className="bg-red-100 text-red-800 text-xs font-mono px-2 py-1 rounded">
                {e.user}: {e.count} connections
              </span>
            ))}
          </div>
        </div>
      )}

      {/* By user */}
      {data.by_user.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-lg shadow-sm overflow-x-auto">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="font-semibold text-gray-700 text-sm">Connections by User</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2 font-semibold text-gray-600">User</th>
                <th className="text-right px-4 py-2 font-semibold text-gray-600">Connections</th>
              </tr>
            </thead>
            <tbody>
              {data.by_user.map((u) => (
                <tr key={u.user} className="border-t border-gray-100">
                  <td className="px-4 py-2 font-medium">{u.user}</td>
                  <td className="px-4 py-2 text-right">
                    <span className={`font-mono ${u.count > 3 ? "text-red-600 font-bold" : "text-gray-700"}`}>{u.count}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* All connections detail */}
      <div className="bg-white border border-stone-200 rounded-lg shadow-sm overflow-x-auto">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="font-semibold text-gray-700 text-sm">All Active Connections</h3>
        </div>
        {data.connections.length === 0 ? (
          <p className="text-center py-8 text-gray-400 text-sm">No active WebSocket connections</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {["User", "Role", "Connected", "Messages", "Idle"].map((h) => (
                  <th key={h} className="text-left px-3 py-2 font-semibold text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.connections.map((c, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-medium">{c.user}</td>
                  <td className="px-3 py-2 text-gray-500">{c.role}</td>
                  <td className="px-3 py-2">{fmtDuration(c.connected_seconds)}</td>
                  <td className="px-3 py-2 text-right font-mono">{c.msg_count}</td>
                  <td className="px-3 py-2">
                    <span className={c.idle_seconds > 120 ? "text-amber-600" : "text-gray-600"}>
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

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 50 };
      if (filterPath) params.path = filterPath;
      if (filterStatus) params.status_code = parseInt(filterStatus);
      const res = await api.get("monitor/api-logs", { params });
      setLogs(res.data.records);
      setTotal(res.data.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, filterPath, filterStatus]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get("monitor/api-stats");
      setStats(res.data);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);
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
          className="border-2 border-stone-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
        />
        <input
          type="text"
          placeholder="Status code..."
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
          className="border-2 border-stone-300 rounded-lg px-3 py-2 text-sm bg-white w-32 focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
        />
        <button onClick={() => { fetchLogs(); fetchStats(); }}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm rounded-lg font-medium transition-colors duration-150">
          Refresh
        </button>
      </div>

      {/* Table */}
      <div className="bg-white border border-stone-200 rounded-lg shadow-sm overflow-x-auto">
        {loading ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {["Timestamp", "Method", "Path", "Status", "Duration", "User"].map((h) => (
                  <th key={h} className="text-left px-3 py-2 font-semibold text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((r) => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 whitespace-nowrap">{fmtTs(r.timestamp)}</td>
                  <td className="px-3 py-2">
                    <span className={`font-mono text-xs px-1.5 py-0.5 rounded ${methodColor(r.method)}`}>{r.method}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs max-w-xs truncate">{r.path}</td>
                  <td className="px-3 py-2">
                    <span className={`font-mono ${r.status_code >= 400 ? "text-red-600 font-bold" : "text-gray-700"}`}>{r.status_code}</span>
                  </td>
                  <td className="px-3 py-2 text-right">{r.duration_ms?.toFixed(1)}ms</td>
                  <td className="px-3 py-2">{r.user || "-"}</td>
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
            className="px-3 py-1 border border-stone-300 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors">Prev</button>
          <span className="text-sm text-gray-600">Page {page} of {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}
            className="px-3 py-1 border border-stone-300 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors">Next</button>
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

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 50 };
      if (filterUser) params.user = filterUser;
      if (filterAction) params.action = filterAction;
      const res = await api.get("monitor/audit-logs", { params });
      setLogs(res.data.records);
      setTotal(res.data.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, filterUser, filterAction]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-2">
        <input type="text" placeholder="Filter by user..." value={filterUser}
          onChange={(e) => { setFilterUser(e.target.value); setPage(1); }}
          className="border-2 border-stone-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500" />
        <select value={filterAction} onChange={(e) => { setFilterAction(e.target.value); setPage(1); }}
          className="border-2 border-stone-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500">
          <option value="">All Actions</option>
          <option value="ate_ng_mark">ATE NG Mark</option>
          <option value="ate_ng_clear">ATE NG Clear</option>
          <option value="downtime_add">Downtime Add</option>
          <option value="downtime_delete">Downtime Delete</option>
          <option value="user_role_change">User Role Change</option>
          <option value="email_config_update">Email Config Update</option>
        </select>
        <button onClick={fetchLogs}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm rounded-lg font-medium transition-colors duration-150">
          Refresh
        </button>
      </div>

      <div className="bg-white border border-stone-200 rounded-lg shadow-sm overflow-x-auto">
        {loading ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {["Timestamp", "User", "Action", "Target", "Old Value", "New Value"].map((h) => (
                  <th key={h} className="text-left px-3 py-2 font-semibold text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((r) => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 whitespace-nowrap">{fmtTs(r.timestamp)}</td>
                  <td className="px-3 py-2 font-medium">{r.user}</td>
                  <td className="px-3 py-2">
                    <span className="bg-gray-100 text-gray-700 text-xs font-mono px-2 py-0.5 rounded">{r.action}</span>
                  </td>
                  <td className="px-3 py-2">{r.target || "-"}</td>
                  <td className="px-3 py-2 text-gray-500 max-w-[120px] truncate">{r.old_value || "-"}</td>
                  <td className="px-3 py-2 max-w-[120px] truncate">{r.new_value || "-"}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">
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
            className="px-3 py-1 border border-stone-300 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors">Prev</button>
          <span className="text-sm text-gray-600">Page {page} of {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}
            className="px-3 py-1 border border-stone-300 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors">Next</button>
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

      <div className="bg-white border border-stone-200 rounded-lg shadow-sm overflow-x-auto">
        {loading ? <Spinner /> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {["Timestamp", "Component", "Error", "User", "URL", ""].map((h) => (
                  <th key={h} className="text-left px-3 py-2 font-semibold text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {errors.map((r) => (
                <React.Fragment key={r.id}>
                  <tr className="border-t border-gray-100">
                    <td className="px-3 py-2 whitespace-nowrap">{fmtTs(r.timestamp)}</td>
                    <td className="px-3 py-2">{r.component || "-"}</td>
                    <td className="px-3 py-2 max-w-xs truncate text-red-600">{r.error_message}</td>
                    <td className="px-3 py-2">{r.user || "-"}</td>
                    <td className="px-3 py-2 max-w-[150px] truncate text-gray-500">{r.url || "-"}</td>
                    <td className="px-3 py-2">
                      {r.stack && (
                        <button onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                          className="text-teal-600 hover:text-teal-700 text-xs font-medium monitor-stack-toggle">
                          {expanded === r.id ? "Hide" : "Stack"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === r.id && r.stack && (
                    <tr>
                      <td colSpan={6} className="px-3 py-2 bg-gray-50">
                        <pre className="text-xs text-gray-600 whitespace-pre-wrap max-h-48 overflow-y-auto font-mono">{r.stack}</pre>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {errors.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">
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
            className="px-3 py-1 border border-stone-300 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors">Prev</button>
          <span className="text-sm text-gray-600">Page {page} of {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}
            className="px-3 py-1 border border-stone-300 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors">Next</button>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════
// Shared components & utils
// ════════════════════════════════════════

function StatCard({ label, value, color }) {
  const colorMap = {
    teal: "bg-teal-50 text-teal-700 border-teal-200",
    cyan: "bg-cyan-50 text-cyan-700 border-cyan-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    red: "bg-red-50 text-red-700 border-red-200",
    gray: "bg-gray-50 text-gray-700 border-gray-200",
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
  const map = { GET: "bg-emerald-100 text-emerald-700", POST: "bg-cyan-100 text-cyan-700", PUT: "bg-amber-100 text-amber-700", DELETE: "bg-red-100 text-red-700", PATCH: "bg-gray-100 text-gray-700" };
  return map[m] || "bg-gray-100 text-gray-700";
}
