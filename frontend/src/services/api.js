import axios from "axios";

/*———— BaseURL：從 REACT_APP_API_BASE 取得 ————*/
const API_BASE = process.env.REACT_APP_API_BASE || "/api";

/*———— axios instance ————*/
const api = axios.create({
  baseURL: API_BASE.endsWith("/") ? API_BASE : API_BASE + "/",
  timeout: 8000,
});

export const setAuthHeader = (jwt) => {
  if (jwt) {
    api.defaults.headers.common.Authorization = `Bearer ${jwt}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
};

// 用於追蹤是否正在 refresh token
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error);
    else prom.resolve(token);
  });
  failedQueue = [];
};

/* Request interceptor */
api.interceptors.request.use((config) => {
  config.headers = config.headers || {};
  const url = config.url || "";
  const skipAuthHeader =
    config.skipAuthHeader === true ||
    url.includes("/auth/refresh") ||
    url.includes("/auth/token");

  // 如果已經有 Authorization 或需跳過，就不覆蓋
  if (!skipAuthHeader && !config.headers.Authorization) {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

/* Response interceptor - 處理 401 和自動 refresh */
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config || {};

    // 只攔 401，且不是 refresh/token 相關，且尚未重試過
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes("/auth/refresh") &&
      !originalRequest.url?.includes("/auth/token")
    ) {
      if (isRefreshing) {
        // 若正在 refresh，把請求排隊
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers = originalRequest.headers || {};
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem("refreshToken");

      if (!refreshToken) {
        // 沒 refresh token → 登出
        localStorage.removeItem("token");
        localStorage.removeItem("refreshToken");
        setAuthHeader(null);
        if (window.location.pathname !== "/login") {
          window.location.href = "/login";
        }
        return Promise.reject(error);
      }

      try {
        // 這支 refresh 不帶 Bearer（用自訂 flag 跳過）
        const resp = await api.post(
          "/auth/refresh",
          { refresh_token: refreshToken },
          { skipAuthHeader: true }
        );

        const { access_token, refresh_token } = resp.data || {};
        if (!access_token) {
          throw new Error("No access_token from refresh");
        }

        // 更新 tokens
        localStorage.setItem("token", access_token);
        if (refresh_token) {
          localStorage.setItem("refreshToken", refresh_token);
        }
        setAuthHeader(access_token);

        // 喚醒併發隊列
        processQueue(null, access_token);

        // 重試原請求
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${access_token}`;
        return api(originalRequest);
      } catch (refreshError) {
        // Refresh 失敗 → 清除、導回登入
        processQueue(refreshError, null);
        localStorage.removeItem("token");
        localStorage.removeItem("refreshToken");
        setAuthHeader(null);
        if (window.location.pathname !== "/login") {
          window.location.href = "/login";
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default api;
export { api };
