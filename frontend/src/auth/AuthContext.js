// src/auth/AuthContext.js
import { createContext, useState, useEffect, useCallback, useRef } from "react";
import { jwtDecode } from "jwt-decode";
import { setAuthHeader, api } from "../services/api";

export const AuthCtx = createContext();

const safeDecode = (jwt) => {
  try { return jwtDecode(jwt); } catch { return null; }
};

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem("token"));
  // 只在邏輯中使用，不直接讀取 state 以免 lint 警告；仍保留 setRefreshToken
  const [, setRefreshToken] = useState(() => localStorage.getItem("refreshToken"));
  const [role, setRole] = useState(null);
  const [name, setName] = useState(null);
  const [exp, setExp] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const refreshPromiseRef = useRef(null);

  const isExpiringSoon = useCallback((expTs) => {
    if (!expTs) return true;
    return Date.now() >= (expTs * 1000 - 30 * 1000);
  }, []);

  const isCompletelyExpired = useCallback((expTs) => {
    if (!expTs) return true;
    return Date.now() >= expTs * 1000;
  }, []);

  const clearAuth = useCallback(() => {
    console.log("🚪 AuthContext: Clearing auth state");
    localStorage.removeItem("token");
    localStorage.removeItem("refreshToken");
    setAuthHeader(null);
    setToken(null);
    setRefreshToken(null);
    setRole(null);
    setName(null);
    setExp(null);
    try {
      localStorage.setItem("__logout_broadcast__", String(Date.now()));
      localStorage.setItem("__token_changed__", String(Date.now()));
    } catch {}
  }, []);

  const setAuthFromTokens = useCallback((accessToken, refreshTokenValue, payload = safeDecode(accessToken)) => {
    if (!payload) {
      console.error("❌ AuthContext: Invalid token payload");
      return;
    }
    if (isCompletelyExpired(payload.exp)) {
      console.error("❌ AuthContext: Received expired token", new Date(payload.exp * 1000));
      clearAuth();
      return;
    }

    setToken(accessToken);
    setRefreshToken(refreshTokenValue);
    setRole(payload.role);
    setName(payload.name || payload.username || payload.sub || "User");
    setExp(payload.exp);
    setAuthHeader(accessToken);

    localStorage.setItem("token", accessToken);
    localStorage.setItem("refreshToken", refreshTokenValue);
    try { localStorage.setItem("__token_changed__", String(Date.now())); } catch {}
  }, [clearAuth, isCompletelyExpired]);

  const refreshAccessToken = useCallback(async () => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }
    const storedRefreshToken = localStorage.getItem("refreshToken");
    if (!storedRefreshToken) {
      clearAuth();
      throw new Error("No refresh token");
    }

    setIsRefreshing(true);
    refreshPromiseRef.current = api.post("/auth/refresh", { refresh_token: storedRefreshToken })
      .then(({ data }) => {
        setAuthFromTokens(data.access_token, data.refresh_token);
        return data.access_token;
      })
      .catch((err) => {
        clearAuth();
        throw err;
      })
      .finally(() => {
        setIsRefreshing(false);
        refreshPromiseRef.current = null;
      });

    return refreshPromiseRef.current;
  }, [setAuthFromTokens, clearAuth]);

  const logout = useCallback(async () => {
    try {
      if (token) await api.post("/auth/logout");
    } catch (e) {
      // ignore
    }
    clearAuth();
  }, [token, clearAuth]);

  useEffect(() => {
    const init = async () => {
      const storedToken = localStorage.getItem("token");
      const storedRefreshToken = localStorage.getItem("refreshToken");

      if (storedToken) setAuthHeader(storedToken);

      if (!storedToken || !storedRefreshToken) {
        setIsInitialized(true);
        return;
      }

      const payload = safeDecode(storedToken);
      if (!payload) {
        clearAuth();
        setIsInitialized(true);
        return;
      }

      if (isCompletelyExpired(payload.exp)) {
        try { await refreshAccessToken(); } catch {}
      } else {
        setAuthFromTokens(storedToken, storedRefreshToken, payload);
      }
      setIsInitialized(true);
    };

    init();

    const onStorage = (e) => {
      if (e.key === "__logout_broadcast__") {
        clearAuth();
      } else if (e.key === "__token_changed__") {
        const t = localStorage.getItem("token");
        const rt = localStorage.getItem("refreshToken");
        const p = t ? safeDecode(t) : null;
        if (t && rt && p) {
          setAuthFromTokens(t, rt, p);
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [clearAuth, setAuthFromTokens, isCompletelyExpired, refreshAccessToken]);

  useEffect(() => {
    if (!exp || isRefreshing) return;
    const tm = setInterval(() => {
      if (isExpiringSoon(exp)) {
        refreshAccessToken().catch(() => {});
      }
    }, 10_000);
    return () => clearInterval(tm);
  }, [exp, isRefreshing, isExpiringSoon, refreshAccessToken]);

  const getValidToken = useCallback(async () => {
    if (isRefreshing) return refreshPromiseRef.current;
    if (!token || isCompletelyExpired(exp)) return refreshAccessToken();
    if (isExpiringSoon(exp)) {
      try { return await refreshAccessToken(); } catch { return token; }
    }
    return token;
  }, [token, exp, isRefreshing, isCompletelyExpired, isExpiringSoon, refreshAccessToken]);

  return (
    <AuthCtx.Provider value={{
      token,
      role,
      name,
      login: setAuthFromTokens,
      logout,
      getValidToken,
      isRefreshing,
      isInitialized
    }}>
      {children}
    </AuthCtx.Provider>
  );
}
