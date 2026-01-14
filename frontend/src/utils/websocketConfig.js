// src/utils/websocketConfig.js
// 共享的 WebSocket 配置工具

/**
 * 計算 WebSocket 基礎 URL
 * 統一 usePCBAWebSocket.js 和 wsConnect.js 的 URL 計算邏輯
 */
export function getWsBaseURL() {
  // 1. 優先使用環境變量
  const envWsBase = process.env.REACT_APP_WS_URL?.replace(/\/+$/, "");
  if (envWsBase) return envWsBase;

  // 2. 根據頁面 URL 計算
  const { protocol, origin } = window.location;
  const pageWsBase = origin.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");

  // 3. 檢查 API base 配置
  const apiBaseRaw = process.env.REACT_APP_API_BASE;
  if (!apiBaseRaw) return pageWsBase;

  const apiBase = apiBaseRaw.replace(/\/+$/, "").replace(/\/api\/?$/, "");
  if (!apiBase || apiBase.startsWith("/")) return pageWsBase;

  // 4. 如果 API base 是完整 URL，轉換為 WebSocket URL
  if (/^https?:\/\//i.test(apiBase)) {
    const apiWsBase = apiBase.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
    // 避免 HTTPS 頁面連接 ws:// (非加密)
    if (protocol === "https:" && apiWsBase.startsWith("ws:")) {
      return pageWsBase;
    }
    return apiWsBase;
  }

  return pageWsBase;
}

// 預計算的 WebSocket 基礎 URL
export const WS_BASE = getWsBaseURL();

/**
 * 構建完整的 WebSocket URL (含 token)
 */
export function buildWsUrl(path, token) {
  const qs = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${WS_BASE}${path}${qs}`;
}

/**
 * 重連配置
 */
export const RECONNECT_CONFIG = {
  maxAttempts: 8,
  baseDelay: 1000,
  multiplier: 1.5,
  maxDelay: 30000,
  jitter: 500
};

/**
 * 計算重連延遲時間（指數退避 + 抖動）
 * @param {number} attempt - 當前重連嘗試次數
 * @returns {number} - 延遲時間（毫秒）
 */
export function getReconnectDelay(attempt) {
  const { baseDelay, multiplier, maxDelay, jitter } = RECONNECT_CONFIG;
  const base = Math.min(baseDelay * Math.pow(multiplier, attempt), maxDelay);
  return base + Math.floor(Math.random() * jitter);
}

/**
 * JWT 工具函數
 */
export function getExpFromJWT(jwt) {
  try {
    const payload = jwt.split(".")[1];
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.exp === "number" ? json.exp : null;
  } catch {
    return null;
  }
}

export function isTokenExpired(jwt) {
  const exp = getExpFromJWT(jwt);
  if (!exp) return true;
  return Date.now() >= exp * 1000;
}

export function isTokenExpiringSoon(jwt, bufferMs = 30000) {
  const exp = getExpFromJWT(jwt);
  if (!exp) return true;
  return Date.now() >= (exp * 1000 - bufferMs);
}
