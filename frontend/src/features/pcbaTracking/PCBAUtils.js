// 共同工具（你原檔裡的 helper 拿出來）
export const API_BASE = (process.env.REACT_APP_API_BASE || `${window.location.origin}/api`).replace(/\/+$/, "");

export const decodeJWT = (jwt) => {
  try {
    const payload = jwt.split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch { return null; }
};
export const getToken = () => localStorage.getItem("token");

export const useDebounced = (value, delay = 350) => {
  const React = require("react");
  const { useState, useEffect } = React;
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
};

// Fixes issue #23: Model detection must stay in sync with backend
// IMPORTANT: These rules must match MODEL_PREFIXES in backend api/pcba.py
// Backend: MODEL_PREFIXES = { "AU8": [r"^10030035", r"^10030055"], "AM7": [r"^10030034"] }
const MODEL_RULES = { AU8: ["10030035", "10030055"], AM7: ["10030034"] };
export const inferModel = (serial) => {
  if (!serial) return null;
  const s = String(serial).toUpperCase().replace(/[- ]/g, "");
  for (const [model, prefixes] of Object.entries(MODEL_RULES)) {
    if (prefixes.some((p) => s.startsWith(p))) return model;
  }
  if (s.includes("AU8")) return "AU8";
  if (s.includes("AM7")) return "AM7";
  return null;
};

export const fmtElapsed = (startIso, lastIso, stage) => {
  const start = new Date(startIso).getTime();
  if (!start) return "-";
  const isCompleted = String(stage || "").toLowerCase() === "completed";
  const end = isCompleted && lastIso ? new Date(lastIso).getTime() : Date.now();
  if (!end || Number.isNaN(end)) return "-";
  let diff = Math.max(0, end - start);
  const h = Math.floor(diff / 3_600_000); diff -= h * 3_600_000;
  const m = Math.floor(diff / 60_000);    diff -= m * 60_000;
  const s = Math.floor(diff / 1_000);
  return `${h}h ${m}m ${s}s`;
};

export const toCaliTime = (iso) => {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
  });
};

export const toCAISODate = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(d);
};

export const shortMMDD = (yyyyDashMmDashDd) => {
  const [, m, d] = (yyyyDashMmDashDd || "").split("-");
  return `${m}-${d}`;
};

/**
 * Safe JSON parsing with fallback
 * Fixes issue #16: JSON parsing without error handling
 */
export const safeJsonParse = async (response) => {
  try {
    return await response.json();
  } catch (error) {
    console.error('JSON parse error:', error);
    return {};
  }
};

/**
 * Enhanced authFetch with error handling and auth redirect
 * Fixes issue #13: Missing error handling in API calls
 * Fixes issue #17: Missing 401/403 handling
 */
export const authFetch = async (path, options = {}) => {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { ...headers, ...(options.headers || {}) },
      // Support AbortController signal (fixes issue #14)
      signal: options.signal
    });

    // Handle authentication errors (401/403)
    if (res.status === 401 || res.status === 403) {
      console.warn(`Authentication error (${res.status}) on ${path}`);
      // Clear token and redirect to login
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
      throw new Error('Authentication required');
    }

    // Handle other HTTP errors
    if (!res.ok && res.status >= 400) {
      const errorData = await safeJsonParse(res);
      const errorMessage = errorData.detail || errorData.message || `HTTP ${res.status} error`;
      console.error(`API error on ${path}:`, errorMessage);
      throw new Error(errorMessage);
    }

    return res;
  } catch (error) {
    // Don't log AbortError as it's intentional cancellation
    if (error.name === 'AbortError') {
      throw error;
    }
    // Network errors or fetch failures
    if (error.message !== 'Authentication required') {
      console.error(`Network error on ${path}:`, error);
    }
    throw error;
  }
};

/**
 * Wrapper for API calls with user-friendly error notifications
 * Fixes issue #13: API calls with inadequate error handling
 */
export const apiCall = async (path, options = {}, showErrorToast = true) => {
  try {
    const res = await authFetch(path, options);
    return await safeJsonParse(res);
  } catch (error) {
    if (showErrorToast && window.showToast) {
      window.showToast(error.message || 'Request failed', 'error');
    }
    throw error;
  }
};
