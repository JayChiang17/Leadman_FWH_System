// src/features/search/Search.js
import React, { useState, useRef, useEffect, useMemo, useContext } from "react";
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
} from "lucide-react";
import api from "../../services/api";
import { AuthCtx } from "../../auth/AuthContext";
import ErrorModal from "../../components/ErrorModal";
import "./Search.css";

// Admin Edit Modal Component
const AdminEditModal = ({ record, onClose, onSave, onDelete, saving }) => {
  // Convert "YYYY-MM-DD HH:MM:SS" to "YYYY-MM-DDTHH:MM:SS" for datetime-local input
  const toInputFormat = (ts) => (ts || '').replace(' ', 'T').slice(0, 19);
  // Convert back for API
  const toApiFormat = (ts) => (ts || '').replace('T', ' ').slice(0, 19);

  const [editData, setEditData] = useState({
    timestamp: toInputFormat(record?.ts || ''),
    china_sn: record?.china_sn || '',
    us_sn: record?.us_sn || '',
    module_a: record?.module_a || '',
    module_b: record?.module_b || '',
    pcba_au8: record?.pcba_au8 || '',
    pcba_am7: record?.pcba_am7 || '',
    status: record?.status || '',
    ng_reason: record?.ng_reason || '',
  });

  const handleChange = (field, value) => {
    setEditData(prev => ({ ...prev, [field]: value }));
  };

  const fieldLabels = {
    timestamp: 'Timestamp',
    china_sn: 'China SN',
    us_sn: 'US SN',
    module_a: 'Module A',
    module_b: 'Module B',
    pcba_au8: 'PCBA AU8',
    pcba_am7: 'PCBA AM7',
    status: 'Status',
    ng_reason: 'NG Reason',
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-teal-100 text-teal-700">
              <Settings2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-stone-800">Admin Edit Record</h3>
              <p className="text-xs text-stone-500">ID: {record?.id} | US SN: {record?.us_sn}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-stone-200 rounded-lg transition-colors">
            <X className="w-5 h-5 text-stone-500" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto max-h-[60vh]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(fieldLabels).map(([field, label]) => (
              <div key={field} className={field === 'ng_reason' ? 'md:col-span-2' : ''}>
                <label className="block text-sm font-medium text-stone-600 mb-1">{label}</label>
                {field === 'status' ? (
                  <select
                    value={editData[field]}
                    onChange={(e) => handleChange(field, e.target.value)}
                    className="w-full px-3 py-2.5 bg-white border border-stone-300 rounded-lg
                             focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  >
                    <option value="">OK</option>
                    <option value="NG">NG</option>
                    <option value="FIXED">FIXED</option>
                  </select>
                ) : field === 'timestamp' ? (
                  <input
                    type="datetime-local"
                    step="1"
                    value={editData[field]}
                    onChange={(e) => handleChange(field, e.target.value)}
                    className="w-full px-3 py-2.5 bg-white border border-stone-300 rounded-lg
                             focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  />
                ) : (
                  <input
                    type="text"
                    value={editData[field]}
                    onChange={(e) => handleChange(field, e.target.value)}
                    className="w-full px-3 py-2.5 bg-white border border-stone-300 rounded-lg
                             focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-stone-200 bg-stone-50 flex items-center justify-between">
          <button
            onClick={() => onDelete(record)}
            className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg
                     transition-colors flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2.5 bg-white hover:bg-stone-100 text-stone-600 font-medium rounded-lg
                       transition-colors border border-stone-300"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(record.id, { ...editData, timestamp: toApiFormat(editData.timestamp) })}
              disabled={saving}
              className="px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-lg
                       transition-colors flex items-center gap-2 disabled:opacity-50"
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

export default function Search() {
  // Admin role check
  const { role } = useContext(AuthCtx);
  const isAdmin = role === 'admin';

  // Admin edit state
  const [editingRecord, setEditingRecord] = useState(null);
  const [adminSaving, setAdminSaving] = useState(false);

  // Get California time (not UTC)
  const getCaliforniaDate = () => {
    const now = new Date();
    const californiaTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    const year = californiaTime.getFullYear();
    const month = String(californiaTime.getMonth() + 1).padStart(2, "0");
    const day = String(californiaTime.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const today = getCaliforniaDate();

  // Search Params
  const [line, setLine] = useState("module");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [onlyNg, setOnlyNg] = useState(false);
  const [sn, setSn] = useState("");
  const [assyFilter, setAssyFilter] = useState("all");

  // UI State
  const [loading, setLoading] = useState(false);
  const [allRows, setAllRows] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [error, setError] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showRecentSearches, setShowRecentSearches] = useState(false);
  const [showColumnSelector, setShowColumnSelector] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Sorting
  const [sortField, setSortField] = useState("");
  const [sortDirection, setSortDirection] = useState("asc");

  // Column Visibility
  const [hiddenColumns, setHiddenColumns] = useState(['id']);

  const resultRef = useRef(null);
  const searchInputRef = useRef(null);

  // Recent Searches (LocalStorage)
  const getRecentSearches = () => {
    try {
      return JSON.parse(localStorage.getItem("recentSearches") || "[]");
    } catch {
      return [];
    }
  };

  const saveRecentSearch = (params) => {
    const recent = getRecentSearches();
    const newSearch = {
      ...params,
      timestamp: new Date().toISOString(),
    };
    const updated = [newSearch, ...recent.filter((s) => JSON.stringify(s) !== JSON.stringify(newSearch))].slice(0, 5);
    localStorage.setItem("recentSearches", JSON.stringify(updated));
  };

  const loadRecentSearch = (search) => {
    setLine(search.line);
    setFrom(search.from);
    setTo(search.to);
    setOnlyNg(search.onlyNg);
    setSn(search.sn || "");
    setAssyFilter(search.assyFilter || "all");
    setShowRecentSearches(false);
  };

  const clearRecentSearches = () => {
    localStorage.removeItem("recentSearches");
    setShowRecentSearches(false);
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl+K: Focus search
      if (e.ctrlKey && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      // Escape: Clear search
      if (e.key === "Escape") {
        setSn("");
        setShowRecentSearches(false);
        setShowColumnSelector(false);
      }
      // Ctrl+Enter: Execute search
      if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        handleSearch();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line, from, to, onlyNg, sn, assyFilter]);

  // Search Handler
  const handleSearch = async () => {
    setError("");
    setAllRows([]);
    setTotalCount(0);
    setCurrentPage(1);

    if (!sn.trim() && (!from || !to)) {
      setError("Please select a date range or enter a Serial Number.");
      return;
    }

    // Date validation
    if (from && to && new Date(from) > new Date(to)) {
      setError("From date cannot be later than To date.");
      return;
    }

    try {
      setLoading(true);
      let snParam = sn.trim();
      if (line === "assembly" && !snParam && assyFilter !== "all") {
        snParam = assyFilter === "apower2" ? "2" : "S";
      }

      const params = { line, from_: from, to, ng_only: onlyNg ? 1 : 0, sn: snParam };

      const { data } = await api.get("search", { params });

      if (data.status === "success" && Array.isArray(data.records)) {
        setTotalCount(data.total_count || 0);
        if (data.records.length) {
          setAllRows(data.records);
          saveRecentSearch({ line, from, to, onlyNg, sn: snParam, assyFilter });
        } else {
          setError("No records found for the given criteria.");
        }
      } else {
        setError(data.message || "Unexpected response.");
      }

      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 150);
    } catch (e) {
      setError(e.response?.data?.message || e.message);
    } finally {
      setLoading(false);
    }
  };

  // Export CSV
  const handleExportCSV = () => {
    if (!allRows.length) return;

    const headers = Object.keys(allRows[0]);
    const csvContent = [
      headers.join(","),
      ...allRows.map((row) =>
        headers.map((h) => `"${(row[h] || "").toString().replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `search_results_${getCaliforniaDate()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Sorting
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
    setCurrentPage(1);
  };

  const sortedRows = useMemo(() => {
    if (!sortField) return allRows;
    return [...allRows].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (aVal === bVal) return 0;
      const comparison = aVal > bVal ? 1 : -1;
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [allRows, sortField, sortDirection]);

  // Pagination
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, currentPage, pageSize]);

  const totalPages = Math.ceil(sortedRows.length / pageSize);

  // Column Visibility
  const visibleColumns = useMemo(() => {
    if (!allRows.length) return [];
    return Object.keys(allRows[0]).filter((col) => !hiddenColumns.includes(col));
  }, [allRows, hiddenColumns]);

  const toggleColumn = (col) => {
    setHiddenColumns((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !loading) {
      handleSearch();
    }
  };

  // Admin Save Handler
  const handleAdminSave = async (recordId, editData) => {
    setAdminSaving(true);
    try {
      const { data } = await api.put(
        `assembly_inventory/admin_full_edit/${recordId}`,
        editData
      );
      if (data?.status === 'success') {
        // Update the row in local state
        setAllRows(prev => prev.map(row => {
          if (row.id === recordId) {
            return {
              ...row,
              ts: editData.timestamp,
              china_sn: editData.china_sn,
              us_sn: editData.us_sn,
              module_a: editData.module_a,
              module_b: editData.module_b,
              pcba_au8: editData.pcba_au8,
              pcba_am7: editData.pcba_am7,
              status: editData.status,
              ng_reason: editData.ng_reason,
            };
          }
          return row;
        }));
        setEditingRecord(null);
      } else {
        setError(data?.message || 'Update failed');
      }
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Update failed');
    } finally {
      setAdminSaving(false);
    }
  };

  // Admin Delete Handler
  const handleAdminDelete = async (record) => {
    if (!record?.id) return;
    if (!window.confirm(`Delete record ID ${record.id} (US SN: ${record.us_sn})?\nThis action cannot be undone.`)) {
      return;
    }
    setAdminSaving(true);
    try {
      const { data } = await api.delete(`assembly_inventory/delete/${record.id}`);
      if (data?.status === 'success') {
        // Remove from local state
        setAllRows(prev => prev.filter(row => row.id !== record.id));
        setTotalCount(prev => prev - 1);
        setEditingRecord(null);
      } else {
        setError(data?.message || 'Delete failed');
      }
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Delete failed');
    } finally {
      setAdminSaving(false);
    }
  };

  const formatDate = (dateStr) => {
    try {
      return new Date(dateStr).toLocaleString("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="search-page">
      <div className="search-container">

        {/* Premium Header Card */}
        <div className="search-header-card">
          <div className="search-header-top">
            <div className="search-header-left">
              <div className="search-icon-badge">
                <SearchIcon className="w-6 h-6" />
              </div>
              <div>
                <h1 className="search-title">Search Production Records</h1>
                <p className="search-subtitle">Query and analyze production data</p>
              </div>
            </div>
            <div className="search-header-actions">
              {/* Recent Searches */}
              <div className="relative">
                <button
                  onClick={() => setShowRecentSearches(!showRecentSearches)}
                  className="header-action-btn"
                  title="Recent Searches (Ctrl+K)"
                >
                  <Clock className="w-5 h-5" />
                  <span className="hidden md:inline">Recent</span>
                  <ChevronDown className="w-4 h-4" />
                </button>
                {showRecentSearches && (
                  <div className="dropdown-menu recent-searches-menu">
                    <div className="dropdown-header">
                      <span className="dropdown-title">Recent Searches</span>
                      <button onClick={clearRecentSearches} className="dropdown-clear-btn">
                        Clear
                      </button>
                    </div>
                    <div className="dropdown-items">
                      {getRecentSearches().length === 0 ? (
                        <div className="dropdown-empty">No recent searches</div>
                      ) : (
                        getRecentSearches().map((search, idx) => (
                          <button
                            key={idx}
                            onClick={() => loadRecentSearch(search)}
                            className="recent-search-item"
                          >
                            <div className="recent-search-line">{search.line === "module" ? "Module" : "Assembly"}</div>
                            <div className="recent-search-details">
                              {search.from} ~ {search.to}
                              {search.sn && ` • SN: ${search.sn}`}
                              {search.onlyNg && " • NG Only"}
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

          {/* Professional Search Form */}
          <div className="search-form-compact">
            <div className="search-form-row">
              {/* Line Selection */}
              <div className="form-field">
                <label>Production Line</label>
                <select value={line} onChange={(e) => setLine(e.target.value)}>
                  <option value="module">Module Line</option>
                  <option value="assembly">Assembly Line</option>
                </select>
              </div>

              {/* Serial Number */}
              <div className="form-field">
                <label>Serial Number</label>
                <div className="input-with-icon">
                  <SearchIcon className="input-icon" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Enter or scan serial number..."
                    value={sn}
                    onChange={(e) => setSn(e.target.value)}
                    onKeyDown={handleKeyPress}
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
                <button onClick={handleSearch} disabled={loading} className="btn-search">
                  {loading ? (
                    <>
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Searching...
                    </>
                  ) : (
                    <>
                      <SearchIcon className="w-5 h-5" />
                      Search Records
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Advanced Filters Toggle */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="advanced-toggle-btn"
            >
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
                    <input
                      type="checkbox"
                      checked={onlyNg}
                      onChange={(e) => setOnlyNg(e.target.checked)}
                    />
                    <span>
                      <Filter className="w-4 h-4" />
                      NG Only
                    </span>
                  </label>

                  {/* Assembly Quick Filters */}
                  {line === "assembly" && (
                    <div className="quick-filters">
                      <span className="quick-filters-label">Quick Filter:</span>
                      {[
                        { key: "all", label: "All" },
                        { key: "apower2", label: "Apower 2" },
                        { key: "apowers", label: "Apower S" },
                      ].map((opt) => (
                        <button
                          key={opt.key}
                          onClick={() => setAssyFilter(opt.key)}
                          className={`quick-filter-btn ${assyFilter === opt.key ? "active" : ""}`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Date Validation Warning */}
          {from && to && new Date(from) > new Date(to) && (
            <div className="validation-warning">
              <AlertCircle className="w-4 h-4" />
              From date cannot be later than To date
            </div>
          )}
        </div>

        {/* Results Section */}
        <div ref={resultRef} className="search-results-section">
          {/* Results Header */}
          {!loading && totalCount > 0 && (
            <div className="results-header">
              <div className="results-count">
                <CheckCircle className="w-6 h-6" />
                <span>
                  Found <strong>{totalCount.toLocaleString()}</strong> records
                </span>
              </div>
              <div className="results-actions">
                {/* Column Selector */}
                <div className="relative">
                  <button
                    onClick={() => setShowColumnSelector(!showColumnSelector)}
                    className="results-action-btn"
                  >
                    <Settings2 className="w-4 h-4" />
                    Columns
                  </button>
                  {showColumnSelector && (
                    <div className="dropdown-menu column-selector-menu">
                      <div className="dropdown-header">
                        <span className="dropdown-title">Show/Hide Columns</span>
                        <button
                          onClick={() => setShowColumnSelector(false)}
                          className="dropdown-close-btn"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="dropdown-items">
                        {allRows.length > 0 &&
                          Object.keys(allRows[0]).map((col) => (
                            <label key={col} className="column-selector-item">
                              <input
                                type="checkbox"
                                checked={!hiddenColumns.includes(col)}
                                onChange={() => toggleColumn(col)}
                              />
                              <span>{col.replace(/_/g, " ")}</span>
                            </label>
                          ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Export CSV */}
                <button onClick={handleExportCSV} className="results-action-btn">
                  <Download className="w-4 h-4" />
                  Export CSV
                </button>
              </div>
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div className="loading-state">
              <div className="loading-spinner" />
              <p>Searching records...</p>
            </div>
          )}

          {/* Results Table */}
          {paginatedRows.length > 0 && (
            <div className="results-table-card">
              <div className="table-wrapper">
                <table className="results-table">
                  <thead>
                    <tr>
                      {visibleColumns.map((key) => (
                        <th key={key} onClick={() => handleSort(key)} className="sortable-header">
                          <div className="th-content">
                            <span>{key.replace(/_/g, " ")}</span>
                            <ArrowUpDown
                              className={`sort-icon ${sortField === key ? "active" : ""}`}
                            />
                          </div>
                        </th>
                      ))}
                      <th className="actions-header">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedRows.map((row, index) => (
                      <tr key={index}>
                        {visibleColumns.map((key) => (
                          <td key={key}>
                            {key.toLowerCase().includes("status") ||
                            key.toLowerCase().includes("result") ? (
                              <span
                                className={`status-badge ${
                                  row[key]?.toString().toLowerCase() === "pass" ||
                                  row[key]?.toString().toLowerCase() === "ok"
                                    ? "status-pass"
                                    : row[key]?.toString().toLowerCase() === "fail" ||
                                      row[key]?.toString().toLowerCase() === "ng"
                                    ? "status-fail"
                                    : row[key]?.toString().toLowerCase() === "fixed"
                                    ? "status-fixed"
                                    : "status-neutral"
                                }`}
                              >
                                {row[key]?.toString().toLowerCase() === "pass" && (
                                  <CheckCircle className="w-3 h-3" />
                                )}
                                {(row[key]?.toString().toLowerCase() === "fail" ||
                                  row[key]?.toString().toLowerCase() === "ng") && (
                                  <AlertCircle className="w-3 h-3" />
                                )}
                                {row[key]}
                              </span>
                            ) : key.toLowerCase().includes("ts") || key.toLowerCase().includes("time") ? (
                              <span className="timestamp-cell">{formatDate(row[key])}</span>
                            ) : (
                              row[key] || "-"
                            )}
                          </td>
                        ))}
                        <td className="actions-cell">
                          <div className="flex items-center gap-1">
                            <button
                              className="action-btn"
                              title="Copy to clipboard"
                              onClick={() => {
                                navigator.clipboard.writeText(JSON.stringify(row, null, 2));
                              }}
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                            {isAdmin && line === 'assembly' && row.id && (
                              <>
                                <button
                                  className="action-btn text-teal-600 hover:text-teal-800"
                                  title="Edit record"
                                  onClick={() => setEditingRecord(row)}
                                >
                                  <Edit3 className="w-4 h-4" />
                                </button>
                                <button
                                  className="action-btn text-red-600 hover:text-red-800"
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

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="pagination-bar">
                  <div className="pagination-info">
                    Showing {(currentPage - 1) * pageSize + 1}-
                    {Math.min(currentPage * pageSize, sortedRows.length)} of{" "}
                    {sortedRows.length.toLocaleString()} records
                  </div>
                  <div className="pagination-controls">
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      className="page-size-select"
                    >
                      <option value={25}>25 / page</option>
                      <option value={50}>50 / page</option>
                      <option value={100}>100 / page</option>
                      <option value={200}>200 / page</option>
                    </select>
                    <div className="page-buttons">
                      <button
                        onClick={() => setCurrentPage(1)}
                        disabled={currentPage === 1}
                        className="page-btn"
                      >
                        First
                      </button>
                      <button
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="page-btn"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <span className="page-indicator">
                        Page {currentPage} of {totalPages}
                      </span>
                      <button
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="page-btn"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setCurrentPage(totalPages)}
                        disabled={currentPage === totalPages}
                        className="page-btn"
                      >
                        Last
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* No Results */}
          {!loading && allRows.length === 0 && totalCount === 0 && (
            <div className="empty-state">
              <div className="empty-icon">
                <AlertCircle className="w-12 h-12" />
              </div>
              <h3>No records found</h3>
              <p>Try adjusting your search criteria or date range</p>
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

      {/* Error Modal */}
      <ErrorModal message={error} onClose={() => setError("")} />
    </div>
  );
}
