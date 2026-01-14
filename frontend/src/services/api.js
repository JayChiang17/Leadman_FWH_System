import axios from "axios";

/* 讀 .env，去掉尾巴的斜線，避免 // */
const RAW_BASE = process.env.REACT_APP_API_BASE || "/api";
const API_BASE = RAW_BASE.replace(/\/+$/, "");   // ← 去除尾斜線

const api = axios.create({
  baseURL: API_BASE,   // ← 不再自動補 "/"
  timeout: 15000,
});

export const setAuthHeader = (jwt) => {
  if (jwt) api.defaults.headers.common.Authorization = `Bearer ${jwt}`;
  else delete api.defaults.headers.common.Authorization;
};

// refresh 併發隊列
let isRefreshing = false;
let failedQueue = [];
const processQueue = (error, token = null) => {
  failedQueue.forEach(p => (error ? p.reject(error) : p.resolve(token)));
  failedQueue = [];
};

/* Request interceptor */
api.interceptors.request.use((config) => {
  config.headers = config.headers || {};

  // 端點字樣不含開頭斜線，兩種情況都覆蓋到
  const url = String(config.url || "");
  const isAuthPath =
    /(^|\/)auth\/(refresh|token)(\/|$)/.test(url);

  const skipAuthHeader =
    config.skipAuthHeader === true || isAuthPath;

  if (!skipAuthHeader && !config.headers.Authorization) {
    const token = localStorage.getItem("token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }

  // 路徑若誤以 "/" 開頭，幫忙去掉，確保 base + "auth/xxx"
  if (url.startsWith("/")) {
    config.url = url.replace(/^\/+/, "");
  }
  return config;
});

/* Response interceptor：自動 refresh */
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config || {};
    const status = error.response?.status;

    const isAuthPath =
      /(^|\/)auth\/(refresh|token)(\/|$)/.test(String(original.url || ""));

    if (status === 401 && !original._retry && !isAuthPath) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((newToken) => {
          original.headers = original.headers || {};
          original.headers.Authorization = `Bearer ${newToken}`;
          return api(original);
        });
      }

      original._retry = true;
      isRefreshing = true;

      const rt = localStorage.getItem("refreshToken");
      if (!rt) {
        localStorage.removeItem("token");
        localStorage.removeItem("refreshToken");
        setAuthHeader(null);
        if (window.location.pathname !== "/login") window.location.href = "/login";
        return Promise.reject(error);
      }

      try {
        // 注意：這裡路徑不用 "/" 開頭
        const { data } = await api.post("auth/refresh", { refresh_token: rt }, { skipAuthHeader: true });
        const { access_token, refresh_token } = data || {};
        if (!access_token) throw new Error("No access_token from refresh");

        localStorage.setItem("token", access_token);
        if (refresh_token) localStorage.setItem("refreshToken", refresh_token);
        setAuthHeader(access_token);

        processQueue(null, access_token);

        original.headers = original.headers || {};
        original.headers.Authorization = `Bearer ${access_token}`;
        return api(original);
      } catch (e) {
        processQueue(e, null);
        localStorage.removeItem("token");
        localStorage.removeItem("refreshToken");
        setAuthHeader(null);
        if (window.location.pathname !== "/login") window.location.href = "/login";
        throw e;
      } finally {
        isRefreshing = false;
      }
    }

    throw error;
  }
);

export default api;
export { api };
