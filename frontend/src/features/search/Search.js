// src/features/search/Search.js
import React, {
  useState, useRef, useEffect, useMemo, useCallback, useContext,
} from "react";
import {
  Search as SearchIcon,
  Filter,
  AlertCircle,
  CheckCircle,
  Download,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  Settings2,
  Clock,
  X,
  Copy,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Trash2,
  Save,
  RefreshCw,
  Zap,
} from "lucide-react";
import api from "../../services/api";
import { AuthCtx } from "../../auth/AuthContext";
import ErrorModal from "../../components/ErrorModal";
import "./Search.css";

// ── Static configs ────────────────────────────────────────────────────────────

const COLUMNS = {
  assembly: [
    { key: "id",           label: "ID",           sortKey: null,           defaultHidden: true  },
    { key: "product_line", label: "Product Line",  sortKey: "product_line", defaultHidden: false },
    { key: "china_sn",     label: "China SN",      sortKey: "china_sn",     defaultHidden: false },
    { key: "us_sn",        label: "US SN",         sortKey: "us_sn",        defaultHidden: false },
    { key: "module_a",     label: "Module A",      sortKey: "module_a",     defaultHidden: false },
    { key: "module_b",     label: "Module B",      sortKey: "module_b",     defaultHidden: false },
    { key: "pcba_au8",     label: "PCBA AU8",      sortKey: "pcba_au8",     defaultHidden: false },
    { key: "pcba_am7",     label: "PCBA AM7",      sortKey: "pcba_am7",     defaultHidden: false },
    { key: "status",       label: "Status",        sortKey: "status",       defaultHidden: false },
    { key: "ng_reason",    label: "NG Reason",     sortKey: null,           defaultHidden: false },
    { key: "ts",           label: "Timestamp",     sortKey: "ts",           defaultHidden: false },
  ],
  module: [
    { key: "sn",     label: "Serial Number", sortKey: "sn",     defaultHidden: false },
    { key: "kind",   label: "Kind",          sortKey: "kind",   defaultHidden: false },
    { key: "status", label: "Status",        sortKey: "status", defaultHidden: false },
    { key: "ts",     label: "Timestamp",     sortKey: "ts",     defaultHidden: false },
  ],
};

const SEARCH_FIELDS = {
  assembly: [
    { value: "any",      label: "Any Field"   },
    { value: "us_sn",    label: "US SN"       },
    { value: "china_sn", label: "China SN"    },
    { value: "pcba_au8", label: "PCBA AU8"    },
    { value: "pcba_am7", label: "PCBA AM7"    },
    { value: "module_a", label: "Module A"    },
    { value: "module_b", label: "Module B"    },
  ],
  module: [
    { value: "any",  label: "Any Field"     },
    { value: "sn",   label: "Serial Number" },
    { value: "kind", label: "Kind"          },
  ],
};

const PRODUCT_LINES = [
  { value: "all",      label: "All Lines"  },
  { value: "apower",   label: "APower"     },
  { value: "apower2",  label: "APower 2"   },
  { value: "apower_s", label: "APower S"   },
];

const DATE_PRESETS = [
  { key: "today",      label: "Today"      },
  { key: "yesterday",  label: "Yesterday"  },
  { key: "this_week",  label: "This Week"  },
  { key: "this_month", label: "This Month" },
];

// ── Utilities ─────────────────────────────────────────────────────────────────

const getCaliforniaDate = () => {
  const now = new Date();
  const ca  = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  return `${ca.getFullYear()}-${String(ca.getMonth() + 1).padStart(2, "0")}-${String(ca.getDate()).padStart(2, "0")}`;
};

const defaultHiddenFor = (line) =>
  COLUMNS[line]?.filter((c) => c.defaultHidden).map((c) => c.key) ?? ["id"];

const getPresetDates = (preset) => {
  const today = getCaliforniaDate();
  const d     = new Date(today);
  switch (preset) {
    case "yesterday": {
      d.setDate(d.getDate() - 1);
      const s = d.toISOString().slice(0, 10);
      return { from: s, to: s };
    }
    case "this_week": {
      d.setDate(d.getDate() - d.getDay());
      return { from: d.toISOString().slice(0, 10), to: today };
    }
    case "this_month":
      return { from: today.slice(0, 7) + "-01", to: today };
    default:
      return { from: today, to: today };
  }
};

const downloadCSV = (rows, dateStr) => {
  if (!rows.length) return;
  const sanitize = (val) => {
    const s = (val ?? "").toString().replace(/"/g, '""');
    return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  };
  const headers = Object.keys(rows[0]);
  const content = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => `"${sanitize(row[h])}"`).join(",")),
  ].join("\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `search_results_${dateStr}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
};

// ── AdminEditModal ─────────────────────────────────────────────────────────────
const AdminEditModal = ({ record, onClose, onSave, onDelete, saving }) => {
  const toInputFormat = (ts) => (ts || "").replace(" ", "T").slice(0, 19);
  const toApiFormat   = (ts) => (ts || "").replace("T", " ").slice(0, 19);

  const [editData, setEditData] = useState({
    timestamp: toInputFormat(record?.ts || ""),
    china_sn:  record?.china_sn  || "",
    us_sn:     record?.us_sn     || "",
    module_a:  record?.module_a  || "",
    module_b:  record?.module_b  || "",
    pcba_au8:  record?.pcba_au8  || "",
    pcba_am7:  record?.pcba_am7  || "",
    status:    record?.status    || "",
    ng_reason: record?.ng_reason || "",
  });

  const fieldLabels = {
    timestamp: "Timestamp", china_sn: "China SN", us_sn: "US SN",
    module_a: "Module A",   module_b: "Module B",
    pcba_au8: "PCBA AU8",   pcba_am7: "PCBA AM7",
    status: "Status",       ng_reason: "NG Reason",
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface-panel rounded-xl shadow-lg max-w-2xl w-full max-h-[90vh] overflow-hidden">
        <div className="px-5 py-4 border-b border-stroke bg-surface-base flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-teal-500/15 text-teal-400">
              <Settings2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-ink-primary">Admin Edit Record</h3>
              <p className="text-xs text-ink-muted">ID: {record?.id} | US SN: {record?.us_sn}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-surface-overlay rounded-lg transition-colors">
            <X className="w-5 h-5 text-ink-muted" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto max-h-[60vh]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(fieldLabels).map(([field, label]) => (
              <div key={field} className={field === "ng_reason" ? "md:col-span-2" : ""}>
                <label className="block text-sm font-medium text-ink-secondary mb-1">{label}</label>
                {field === "status" ? (
                  <select
                    value={editData[field]}
                    onChange={(e) => setEditData((p) => ({ ...p, [field]: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-surface-raised border border-stroke rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  >
                    <option value="">OK</option>
                    <option value="NG">NG</option>
                    <option value="FIXED">FIXED</option>
                  </select>
                ) : field === "timestamp" ? (
                  <input
                    type="datetime-local"
                    step="1"
                    value={editData[field]}
                    onChange={(e) => setEditData((p) => ({ ...p, [field]: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-surface-raised border border-stroke rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  />
                ) : (
                  <input
                    type="text"
                    value={editData[field]}
                    onChange={(e) => setEditData((p) => ({ ...p, [field]: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-surface-raised border border-stroke rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-stroke bg-surface-base flex items-center justify-between">
          <button
            onClick={() => onDelete(record)}
            className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2.5 bg-surface-panel hover:bg-surface-raised text-ink-secondary font-medium rounded-lg transition-colors border border-stroke"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(record.id, { ...editData, timestamp: toApiFormat(editData.timestamp) })}
              disabled={saving}
              className="px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Recent-search helpers ─────────────────────────────────────────────────────
const loadRecent  = () => { try { return JSON.parse(localStorage.getItem("recentSearches") || "[]"); } catch { return []; } };
const saveRecent  = (entry) => {
  const list = loadRecent();
  const updated = [
    { ...entry, savedAt: new Date().toISOString() },
    ...list.filter((s) => JSON.stringify(s) !== JSON.stringify(entry)),
  ].slice(0, 5);
  localStorage.setItem("recentSearches", JSON.stringify(updated));
};

// ── Main component ────────────────────────────────────────────────────────────
export default function Search() {
  const { role } = useContext(AuthCtx);
  const isAdmin  = role === "admin";

  const today = getCaliforniaDate();

  // ── Search form state ──
  const [line,        setLine]        = useState("module");
  const [from,        setFrom]        = useState(today);
  const [to,          setTo]          = useState(today);
  const [sn,          setSn]          = useState("");
  const [searchField, setSearchField] = useState("any");
  const [productLine, setProductLine] = useState("all");
  const [onlyNg,      setOnlyNg]      = useState(false);

  // ── Sort state (server-side) ──
  const [sortField, setSortField] = useState("ts");
  const [sortDir,   setSortDir]   = useState("desc");

  // ── Pagination state (server-side) ──
  const [page,     setPage]     = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // ── Result state ──
  const [rows,       setRows]       = useState([]);
  const [totalCount, setTotalCount] = useState(0);

  // ── UI state ──
  const [loading,             setLoading]             = useState(false);
  const [error,               setError]               = useState("");
  const [hasSearched,         setHasSearched]         = useState(false);
  const [instantActive,       setInstantActive]       = useState(false);
  const [showAdvanced,        setShowAdvanced]        = useState(false);
  const [showRecentSearches,  setShowRecentSearches]  = useState(false);
  const [showColumnSelector,  setShowColumnSelector]  = useState(false);
  const [hiddenColumns,       setHiddenColumns]       = useState(() => defaultHiddenFor("module"));

  // ── Admin modal state ──
  const [editingRecord, setEditingRecord] = useState(null);
  const [adminSaving,   setAdminSaving]   = useState(false);

  // ── Refs ──
  const resultRef      = useRef(null);
  const searchInputRef = useRef(null);
  const snDebounceRef  = useRef(null);

  // searchStateRef always holds the latest form/sort/page values
  // (no dep array — runs after every render so it's always fresh)
  const searchStateRef = useRef({});
  useEffect(() => {
    searchStateRef.current = {
      line, from, to, sn, searchField, productLine, onlyNg,
      sortField, sortDir, page, pageSize,
    };
  });

  // ── Reset dependent state when line changes ──
  useEffect(() => {
    setSearchField("any");
    setProductLine("all");
    setSortField("ts");
    setSortDir("desc");
    setPage(1);
    setRows([]);
    setTotalCount(0);
    setHasSearched(false);
    setHiddenColumns(defaultHiddenFor(line));
  }, [line]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Core search function (stable — reads from ref) ──────────────────────────
  const executeSearch = useCallback(async (overrides = {}) => {
    const s = { ...searchStateRef.current, ...overrides };

    // Require at minimum a date range or a non-trivial SN
    const hasDates = !!(s.from && s.to);
    const hasSn    = (s.sn || "").trim().length > 0;
    if (!hasDates && !hasSn) {
      setError("Please select a date range or enter a Serial Number.");
      return;
    }
    if (s.from && s.to && new Date(s.from) > new Date(s.to)) {
      setError("From date cannot be later than To date.");
      return;
    }

    setError("");
    setLoading(true);
    setHasSearched(true);

    const fromDate = s.from || "2020-01-01";
    const toDate   = s.to   || getCaliforniaDate();
    const pg       = s.page     || 1;
    const ps       = s.pageSize || 50;

    const apiParams = {
      line:         s.line,
      from_:        fromDate,
      to:           toDate,
      sn:           (s.sn || "").trim(),
      search_field: s.searchField || "any",
      ng_only:      s.onlyNg ? 1 : 0,
      limit:        ps,
      offset:       (pg - 1) * ps,
      order_by:     s.sortField || "ts",
      order_dir:    s.sortDir   || "desc",
    };
    if (s.line === "assembly" && s.productLine && s.productLine !== "all") {
      apiParams.product_line = s.productLine;
    }

    try {
      const { data } = await api.get("search", { params: apiParams });
      if (data.status === "success") {
        setRows(data.records || []);
        setTotalCount(data.total_count || 0);
        if (!(data.records || []).length) {
          setError("No records found for the given criteria.");
        } else {
          saveRecent({ line: s.line, from: fromDate, to: toDate, sn: s.sn, searchField: s.searchField, productLine: s.productLine, onlyNg: s.onlyNg });
          setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth" }), 150);
        }
      } else {
        setError(data.message || "Unexpected response from server.");
      }
    } catch (e) {
      setError(e.response?.data?.message || e.message);
    } finally {
      setLoading(false);
    }
  }, []); // empty deps — always reads from searchStateRef

  // ── Plan E: SN debounce auto-search (≥ 6 chars, 400 ms) ──────────────────
  useEffect(() => {
    clearTimeout(snDebounceRef.current);
    const trimmed = (sn || "").trim();
    if (trimmed.length < 6) {
      setInstantActive(false);
      return;
    }
    setInstantActive(true);
    snDebounceRef.current = setTimeout(() => {
      setInstantActive(false);
      executeSearch({ sn: trimmed, page: 1 });
    }, 400);
    return () => {
      clearTimeout(snDebounceRef.current);
    };
  }, [sn, executeSearch]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.key === "k") { e.preventDefault(); searchInputRef.current?.focus(); }
      if (e.key === "Escape") { setSn(""); setShowRecentSearches(false); setShowColumnSelector(false); }
      if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); executeSearch({ page: 1 }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [executeSearch]);

  // ── Plan D: Date presets ──────────────────────────────────────────────────
  const applyDatePreset = useCallback((preset) => {
    const { from: f, to: t } = getPresetDates(preset);
    setFrom(f);
    setTo(t);
    setPage(1);
    executeSearch({ from: f, to: t, page: 1 });
  }, [executeSearch]);

  // ── Plan A: Page navigation ───────────────────────────────────────────────
  const goToPage = useCallback((p) => {
    setPage(p);
    executeSearch({ page: p });
  }, [executeSearch]);

  // ── Plan A: Page size change ──────────────────────────────────────────────
  const changePageSize = useCallback((ps) => {
    setPageSize(ps);
    setPage(1);
    executeSearch({ pageSize: ps, page: 1 });
  }, [executeSearch]);

  // ── Plan D: Server-side sort ──────────────────────────────────────────────
  const handleSort = useCallback((col) => {
    if (!col.sortKey) return;
    const newDir = sortField === col.sortKey
      ? (sortDir === "asc" ? "desc" : "asc")
      : "asc";
    setSortField(col.sortKey);
    setSortDir(newDir);
    setPage(1);
    executeSearch({ sortField: col.sortKey, sortDir: newDir, page: 1 });
  }, [sortField, sortDir, executeSearch]);

  // ── Recent search load ──
  const loadRecentSearch = (s) => {
    setLine(s.line);
    setFrom(s.from);
    setTo(s.to);
    setSn(s.sn || "");
    setSearchField(s.searchField || "any");
    setProductLine(s.productLine || "all");
    setOnlyNg(!!s.onlyNg);
    setShowRecentSearches(false);
  };

  // ── Column visibility ──
  const toggleColumn = (key) =>
    setHiddenColumns((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );

  const visibleColumns = useMemo(
    () => COLUMNS[line].filter((col) => !hiddenColumns.includes(col.key)),
    [line, hiddenColumns]
  );

  // ── Export All ──────────────────────────────────────────────────────────
  const handleExportAllCSV = useCallback(async () => {
    if (!hasSearched) return;
    setLoading(true);
    try {
      const s = searchStateRef.current;
      const apiParams = {
        line:         s.line,
        from_:        s.from || "2020-01-01",
        to:           s.to   || getCaliforniaDate(),
        sn:           (s.sn || "").trim(),
        search_field: s.searchField || "any",
        ng_only:      s.onlyNg ? 1 : 0,
        limit:        5000,
        offset:       0,
        order_by:     s.sortField || "ts",
        order_dir:    s.sortDir   || "desc",
      };
      if (s.line === "assembly" && s.productLine && s.productLine !== "all") {
        apiParams.product_line = s.productLine;
      }
      const { data } = await api.get("search", { params: apiParams });
      if (data.status === "success" && data.records?.length) {
        downloadCSV(data.records, getCaliforniaDate());
      } else {
        setError("No records to export.");
      }
    } catch (e) {
      setError(e.response?.data?.message || e.message);
    } finally {
      setLoading(false);
    }
  }, [hasSearched]);

  // ── Admin save / delete ──
  const handleAdminSave = async (recordId, editData) => {
    setAdminSaving(true);
    try {
      const { data } = await api.put(`assembly_inventory/admin_full_edit/${recordId}`, editData);
      if (data?.status === "success") {
        setRows((prev) => prev.map((row) =>
          row.id === recordId
            ? { ...row, ts: editData.timestamp, china_sn: editData.china_sn, us_sn: editData.us_sn, module_a: editData.module_a, module_b: editData.module_b, pcba_au8: editData.pcba_au8, pcba_am7: editData.pcba_am7, status: editData.status, ng_reason: editData.ng_reason }
            : row
        ));
        setEditingRecord(null);
      } else { setError(data?.message || "Update failed"); }
    } catch (e) { setError(e.response?.data?.message || e.message || "Update failed"); }
    finally { setAdminSaving(false); }
  };

  const handleAdminDelete = async (record) => {
    if (!record?.id) return;
    if (!window.confirm(`Delete record ID ${record.id} (US SN: ${record.us_sn})?\nThis action cannot be undone.`)) return;
    setAdminSaving(true);
    try {
      const { data } = await api.delete(`assembly_inventory/delete/${record.id}`);
      if (data?.status === "success") {
        setRows((prev) => prev.filter((r) => r.id !== record.id));
        setTotalCount((n) => n - 1);
        setEditingRecord(null);
      } else { setError(data?.message || "Delete failed"); }
    } catch (e) { setError(e.response?.data?.message || e.message || "Delete failed"); }
    finally { setAdminSaving(false); }
  };

  // ── Helpers ──
  const formatDate = (v) => {
    if (!v) return "-";
    try {
      // Timestamps are returned as factory-local time (naive, no TZ offset).
      // Parse directly without timezone shift: "2026-03-05T07:34:11" → "03/05/2026 07:34 AM"
      const [datePart, timePart = ""] = String(v).split("T");
      const [y, mo, d]  = datePart.split("-").map(Number);
      const [h = 0, mi = 0] = timePart.split(":").map(Number);
      const dt = new Date(y, mo - 1, d, h, mi);
      return dt.toLocaleString("en-US", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch { return v; }
  };

  const renderCell = (col, value) => {
    if (col.key === "status") {
      const v = (value || "").toLowerCase();
      // Use explicit ternary (not &&) to avoid consecutive false→SVG transitions
      // which can cause React insertBefore DOM reconciliation errors
      const icon = (v === "pass" || v === "ok") ? <CheckCircle className="w-3 h-3" />
                 : (v === "fail" || v === "ng")  ? <AlertCircle className="w-3 h-3" />
                 : null;
      return (
        <span className={`status-badge ${v === "pass" || v === "ok" ? "status-pass" : v === "fail" || v === "ng" ? "status-fail" : v === "fixed" ? "status-fixed" : "status-neutral"}`}>
          {icon}
          {value || "OK"}
        </span>
      );
    }
    if (col.key === "ts") return <span className="timestamp-cell">{formatDate(value)}</span>;
    return value || "-";
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="search-page">
      <div className="search-container">

        {/* ── Header Card ── */}
        <div className="search-header-card">
          <div className="search-header-top">
            <div className="search-header-left">
              <div className="search-icon-badge">
                <SearchIcon className="w-6 h-6" />
              </div>
              <div>
                <h1 className="search-title">Search Production Records</h1>
                <p className="search-subtitle">Server-side search with live SN lookup</p>
              </div>
            </div>
            <div className="search-header-actions">
              {/* Recent Searches */}
              <div className="relative">
                <button
                  onClick={() => setShowRecentSearches((v) => !v)}
                  className="header-action-btn"
                  title="Recent Searches"
                >
                  <Clock className="w-5 h-5" />
                  <span className="hidden md:inline">Recent</span>
                  <ChevronDown className="w-4 h-4" />
                </button>
                {showRecentSearches && (
                  <div className="dropdown-menu recent-searches-menu">
                    <div className="dropdown-header">
                      <span className="dropdown-title">Recent Searches</span>
                      <button onClick={() => { localStorage.removeItem("recentSearches"); setShowRecentSearches(false); }} className="dropdown-clear-btn">Clear</button>
                    </div>
                    <div className="dropdown-items">
                      {loadRecent().length === 0 ? (
                        <div className="dropdown-empty">No recent searches</div>
                      ) : (
                        loadRecent().map((s, i) => (
                          <button key={i} onClick={() => loadRecentSearch(s)} className="recent-search-item">
                            <div className="recent-search-line">{s.line === "module" ? "Module" : "Assembly"}</div>
                            <div className="recent-search-details">
                              {s.from} ~ {s.to}
                              {s.sn && ` • SN: ${s.sn}`}
                              {s.productLine && s.productLine !== "all" && ` • ${s.productLine}`}
                              {s.onlyNg && " • NG Only"}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Search Form ── */}
          <div className="search-form-compact">
            <div className="search-form-row">

              {/* Production Line */}
              <div className="form-field">
                <label>Production Line</label>
                <select value={line} onChange={(e) => setLine(e.target.value)}>
                  <option value="module">Module Line</option>
                  <option value="assembly">Assembly Line</option>
                </select>
              </div>

              {/* Search Field */}
              <div className="form-field">
                <label>Search In</label>
                <select value={searchField} onChange={(e) => setSearchField(e.target.value)}>
                  {(SEARCH_FIELDS[line] || SEARCH_FIELDS.module).map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>

              {/* Serial Number */}
              <div className="form-field">
                <label>
                  Serial Number
                  {instantActive && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-amber-400">
                      <Zap className="w-3 h-3" />
                      searching…
                    </span>
                  )}
                </label>
                <div className="input-with-icon">
                  <SearchIcon className="input-icon" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Type ≥ 6 chars to auto-search…"
                    value={sn}
                    onChange={(e) => setSn(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !loading) executeSearch({ page: 1 }); }}
                  />
                </div>
              </div>

              {/* From Date */}
              <div className="form-field">
                <label>From Date</label>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>

              {/* To Date */}
              <div className="form-field">
                <label>To Date</label>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>

              {/* Search Button */}
              <div className="form-actions">
                <button
                  onClick={() => executeSearch({ page: 1 })}
                  disabled={loading}
                  className="btn-search"
                >
                  {/* Keyed Fragments prevent insertBefore SVG reconciliation error */}
                  {loading ? (
                    <React.Fragment key="loading">
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Searching…
                    </React.Fragment>
                  ) : (
                    <React.Fragment key="idle">
                      <SearchIcon className="w-5 h-5" />
                      Search Records
                    </React.Fragment>
                  )}
                </button>
              </div>
            </div>

            {/* ── Plan D: Date Presets ── */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-stone-400 uppercase tracking-wide">Jump to:</span>
              {DATE_PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => applyDatePreset(p.key)}
                  disabled={loading}
                  className="px-3 py-1.5 text-xs font-semibold border border-stroke rounded-md
                             hover:border-blue-400 hover:text-blue-400 hover:bg-signal-info/10
                             transition-colors duration-150 disabled:opacity-40"
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Advanced toggle */}
            <button onClick={() => setShowAdvanced((v) => !v)} className="advanced-toggle-btn">
              <Filter className="w-4 h-4" />
              Advanced Filters
              {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {/* Advanced Filters */}
            {showAdvanced && (
              <div className="advanced-filters">
                <div className="advanced-filters-grid">
                  {/* NG Only */}
                  <label className="filter-checkbox">
                    <input type="checkbox" checked={onlyNg} onChange={(e) => setOnlyNg(e.target.checked)} />
                    <span><Filter className="w-4 h-4" /> NG Only</span>
                  </label>

                  {/* Product Line (assembly only) */}
                  {line === "assembly" && (
                    <div className="quick-filters">
                      <span className="quick-filters-label">Product Line:</span>
                      {PRODUCT_LINES.map((pl) => (
                        <button
                          key={pl.value}
                          onClick={() => setProductLine(pl.value)}
                          className={`quick-filter-btn ${productLine === pl.value ? "active" : ""}`}
                        >
                          {pl.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Date validation warning */}
          {from && to && new Date(from) > new Date(to) && (
            <div className="validation-warning">
              <AlertCircle className="w-4 h-4" />
              From date cannot be later than To date
            </div>
          )}
        </div>

        {/* ── Results Section ── */}
        <div ref={resultRef} className="search-results-section">

          {/* Results Header */}
          {!loading && totalCount > 0 && (
            <div className="results-header">
              <div className="results-count">
                <CheckCircle className="w-6 h-6" />
                <span>
                  Found <strong>{totalCount.toLocaleString()}</strong> records
                  {totalCount > rows.length && (
                    <span className="text-sm text-stone-400 ml-1">
                      — showing {((page - 1) * pageSize + 1).toLocaleString()}–{Math.min(page * pageSize, totalCount).toLocaleString()}
                    </span>
                  )}
                </span>
              </div>
              <div className="results-actions">
                {/* Column Selector */}
                <div className="relative">
                  <button onClick={() => setShowColumnSelector((v) => !v)} className="results-action-btn">
                    <Settings2 className="w-4 h-4" />
                    Columns
                  </button>
                  {showColumnSelector && (
                    <div className="dropdown-menu column-selector-menu">
                      <div className="dropdown-header">
                        <span className="dropdown-title">Show / Hide Columns</span>
                        <button onClick={() => setShowColumnSelector(false)} className="dropdown-close-btn">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="dropdown-items">
                        {COLUMNS[line].map((col) => (
                          <label key={col.key} className="column-selector-item">
                            <input
                              type="checkbox"
                              checked={!hiddenColumns.includes(col.key)}
                              onChange={() => toggleColumn(col.key)}
                            />
                            <span>{col.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Export All */}
                <button onClick={handleExportAllCSV} disabled={loading} className="results-action-btn">
                  <Download className="w-4 h-4" />
                  Export All
                </button>
              </div>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="loading-state">
              <div className="loading-spinner" />
              <p>Searching records…</p>
            </div>
          )}

          {/* Table */}
          {rows.length > 0 && !loading && (
            <div className="results-table-card">
              <div className="table-wrapper">
                <table className="results-table">
                  <thead>
                    <tr>
                      {visibleColumns.map((col) => (
                        <th
                          key={col.key}
                          onClick={col.sortKey ? () => handleSort(col) : undefined}
                          className={col.sortKey ? "sortable-header" : ""}
                        >
                          <div className="th-content">
                            <span>{col.label}</span>
                            {col.sortKey && (
                              <span className={`sort-icon ${sortField === col.sortKey ? "active" : ""}`}>
                                {/* Explicit keys force remount instead of SVG-patch, preventing insertBefore error */}
                                {sortField === col.sortKey
                                  ? (sortDir === "asc"
                                    ? <ChevronUp key="asc" className="w-4 h-4" />
                                    : <ChevronDown key="desc" className="w-4 h-4" />)
                                  : <ArrowUpDown key="none" className="w-4 h-4" />}
                              </span>
                            )}
                          </div>
                        </th>
                      ))}
                      <th className="actions-header">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => (
                      <tr key={row.id ?? row.us_sn ?? row.sn ?? idx}>
                        {visibleColumns.map((col) => (
                          <td key={col.key}>{renderCell(col, row[col.key])}</td>
                        ))}
                        <td className="actions-cell">
                          <div className="flex items-center gap-1 justify-center">
                            <button
                              className="action-btn"
                              title="Copy to clipboard"
                              onClick={() => navigator.clipboard.writeText(JSON.stringify(row, null, 2))}
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                            {isAdmin && line === "assembly" && row.id && (
                              <>
                                <button
                                  className="action-btn text-teal-400 hover:text-teal-300"
                                  title="Edit record"
                                  onClick={() => setEditingRecord(row)}
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
                                <button
                                  className="action-btn text-red-400 hover:text-red-300"
                                  title="Delete record"
                                  onClick={() => handleAdminDelete(row)}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ── Plan A: Pagination ── */}
              {totalPages > 1 && (
                <div className="pagination-bar">
                  <div className="pagination-info">
                    Showing {((page - 1) * pageSize + 1).toLocaleString()}–{Math.min(page * pageSize, totalCount).toLocaleString()} of {totalCount.toLocaleString()} records
                  </div>
                  <div className="pagination-controls">
                    <select
                      value={pageSize}
                      onChange={(e) => changePageSize(Number(e.target.value))}
                      className="page-size-select"
                    >
                      <option value={25}>25 / page</option>
                      <option value={50}>50 / page</option>
                      <option value={100}>100 / page</option>
                      <option value={200}>200 / page</option>
                    </select>
                    <div className="page-buttons">
                      <button onClick={() => goToPage(1)}              disabled={page === 1}          className="page-btn">First</button>
                      <button onClick={() => goToPage(page - 1)}       disabled={page === 1}          className="page-btn"><ChevronLeft  className="w-4 h-4" /></button>
                      <span className="page-indicator">Page {page} of {totalPages}</span>
                      <button onClick={() => goToPage(page + 1)}       disabled={page === totalPages} className="page-btn"><ChevronRight className="w-4 h-4" /></button>
                      <button onClick={() => goToPage(totalPages)}     disabled={page === totalPages} className="page-btn">Last</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {!loading && hasSearched && rows.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">
                <AlertCircle className="w-12 h-12" />
              </div>
              <h3>No records found</h3>
              <p>Try adjusting your search criteria or date range</p>
            </div>
          )}

          {/* Initial state (never searched) */}
          {!loading && !hasSearched && (
            <div className="empty-state">
              <div className="empty-icon">
                <SearchIcon className="w-12 h-12" />
              </div>
              <h3>Ready to search</h3>
              <p>Set a date range or type a serial number (≥ 6 chars auto-searches)</p>
            </div>
          )}
        </div>
      </div>

      {/* Admin Edit Modal */}
      {editingRecord && (
        <AdminEditModal
          record={editingRecord}
          onClose={() => setEditingRecord(null)}
          onSave={handleAdminSave}
          onDelete={handleAdminDelete}
          saving={adminSaving}
        />
      )}

      <ErrorModal message={error} onClose={() => setError("")} />
    </div>
  );
}
