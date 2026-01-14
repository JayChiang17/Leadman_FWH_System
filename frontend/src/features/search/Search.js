// src/features/search/Search.js
import React, { useState, useRef, useEffect, useMemo } from "react";
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
} from "lucide-react";
import api from "../../services/api";
import ErrorModal from "../../components/ErrorModal";
import "./Search.css";

export default function Search() {
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
  const [hiddenColumns, setHiddenColumns] = useState([]);

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
    link.href = URL.createObjectURL(blob);
    link.download = `search_results_${getCaliforniaDate()}.csv`;
    link.click();
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
                    onKeyPress={handleKeyPress}
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
                          <button
                            className="action-btn"
                            title="Copy to clipboard"
                            onClick={() => {
                              navigator.clipboard.writeText(JSON.stringify(row, null, 2));
                            }}
                          >
                            <Copy className="w-4 h-4" />
                          </button>
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

      {/* Error Modal */}
      <ErrorModal message={error} onClose={() => setError("")} />
    </div>
  );
}
