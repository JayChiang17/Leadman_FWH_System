// src/features/search/Search.js
import React, { useState, useRef } from "react";
import {
  Search as SearchIcon,
  Filter,
  AlertCircle,
  CheckCircle,
} from "lucide-react";
import api from "../../services/api";
import ErrorModal from "../../components/ErrorModal";

export default function Search() {
  const today = new Date().toISOString().slice(0, 10);

  const [line, setLine] = useState("module");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [onlyNg, setOnlyNg] = useState(false);
  const [sn, setSn] = useState("");

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [error, setError] = useState("");

  const resultRef = useRef(null);

  /* 共用輸入欄 class */
  const inputCls =
    "w-full px-4 py-2.5 bg-white text-gray-900 placeholder:text-gray-400 " +
    "border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 " +
    "focus:border-transparent transition-all duration-200";

  const handleSearch = async () => {
    setError("");
    setRows([]);
    setTotalCount(0);

    if (!sn.trim() && (!from || !to)) {
      setError("Please select a date range or enter a Serial Number.");
      return;
    }

    try {
      setLoading(true);
      const { data } = await api.get("search", {
        params: {
          line,
          from_: from,
          to,
          ng_only: onlyNg ? 1 : 0,
          sn: sn.trim(),
        },
      });

      if (data.status === "success" && Array.isArray(data.records)) {
        setTotalCount(data.total_count || 0);
        if (data.records.length) {
          setRows(data.records);
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

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !loading) {
      handleSearch();
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 mb-6">
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="p-3 bg-blue-100 rounded-xl">
              <SearchIcon className="w-8 h-8 text-blue-600" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900">
              Search Production Records
            </h1>
          </div>

          {/* Search Form */}
          <div className="space-y-6">
            {/* First Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Line Selection */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  Production Line
                </label>
                <select
                  value={line}
                  onChange={(e) => setLine(e.target.value)}
                  className={inputCls}
                >
                  <option value="module">Module Line</option>
                  <option value="assembly">Assembly Line</option>
                </select>
              </div>

              {/* Serial Number */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  Serial Number
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Enter or scan SN (optional)"
                    value={sn}
                    onChange={(e) => setSn(e.target.value)}
                    onKeyPress={handleKeyPress}
                    className={`${inputCls} pr-10`}
                  />
                  <SearchIcon className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                </div>
              </div>

              {/* NG Only Checkbox */}
              <div className="flex items-end">
                <label
                  className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 
                                 border border-gray-300 rounded-lg cursor-pointer
                                 hover:bg-gray-100 transition-colors duration-200"
                >
                  <input
                    type="checkbox"
                    checked={onlyNg}
                    onChange={(e) => setOnlyNg(e.target.checked)}
                    className="w-5 h-5 text-blue-600 border-gray-300 rounded 
                             focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-900 flex items-center gap-2">
                    <Filter className="w-4 h-4" />
                    NG Only
                  </span>
                </label>
              </div>
            </div>

            {/* Second Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Date From */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  From Date
                </label>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className={inputCls}
                />
              </div>

              {/* Date To */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  To Date
                </label>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className={inputCls}
                />
              </div>

              {/* Search Button */}
              <div className="flex items-end">
                <button
                  onClick={handleSearch}
                  disabled={loading}
                  className="w-full px-6 py-2.5 bg-blue-600 hover:bg-blue-700 
                           text-white font-medium rounded-lg shadow-sm
                           disabled:opacity-50 disabled:cursor-not-allowed
                           transform transition-all duration-200 hover:scale-[1.02]
                           focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg
                        className="animate-spin h-5 w-5"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      Searching...
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <SearchIcon className="w-5 h-5" />
                      Search
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Results Section */}
        <div ref={resultRef} className="transition-all duration-300">
          {/* Status Message */}
          {!loading && totalCount > 0 && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg 
                          flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <span className="text-green-800 font-medium">
                Found {totalCount.toLocaleString()} records
              </span>
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-4">
                <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent 
                              rounded-full animate-spin" />
                <p className="text-gray-600 font-medium">
                  Searching records...
                </p>
              </div>
            </div>
          )}

          {/* Results Table */}
          {rows.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      {Object.keys(rows[0]).map((key) => (
                        <th
                          key={key}
                          className="px-6 py-3 text-left text-xs font-medium text-gray-700 
                                   uppercase tracking-wider whitespace-nowrap"
                        >
                          {key.replace(/_/g, " ")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {rows.map((row, index) => (
                      <tr
                        key={index}
                        className="hover:bg-gray-50 transition-colors duration-150"
                      >
                        {Object.entries(row).map(([key, value]) => (
                          <td
                            key={key}
                            className="px-6 py-4 text-sm text-gray-900 whitespace-nowrap"
                          >
                            {/* Special handling for status/result columns */}
                            {key.toLowerCase().includes("status") ||
                            key.toLowerCase().includes("result") ? (
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
                                ${
                                  value?.toString().toLowerCase() === "pass" ||
                                  value?.toString().toLowerCase() === "ok"
                                    ? "bg-green-100 text-green-800"
                                    : value
                                          ?.toString()
                                          .toLowerCase() === "fail" ||
                                      value?.toString().toLowerCase() === "ng"
                                    ? "bg-red-100 text-red-800"
                                    : "bg-gray-100 text-gray-800"
                                }`}
                              >
                                {value}
                              </span>
                            ) : (
                              value || "-"
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Table Footer */}
              <div className="bg-gray-50 px-6 py-3 border-t border-gray-200">
                <p className="text-sm text-gray-600">
                  Showing {rows.length} of {totalCount.toLocaleString()} records
                </p>
              </div>
            </div>
          )}

          {/* No Results */}
          {!loading && rows.length === 0 && totalCount === 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12">
              <div className="flex flex-col items-center gap-4">
                <div className="p-4 bg-gray-100 rounded-full">
                  <AlertCircle className="w-8 h-8 text-gray-400" />
                </div>
                <p className="text-gray-600 text-center">
                  No records found. Try adjusting your search criteria.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Error Modal */}
      <ErrorModal message={error} onClose={() => setError("")} />
    </div>
  );
}
