import { useEffect, useRef, useState, useContext } from "react";
import { AuthCtx } from "../auth/AuthContext";
import { buildWsUrl, getReconnectDelay, RECONNECT_CONFIG } from "./websocketConfig";

// 單例追蹤器 - 防止 HMR 造成的重複連線
const activeConnections = new Map();

/* ---------- 核心：可自動重連 WebSocket (支援 token refresh) ---------- */
export function openSocket(
  path,
  onMsg,
  onErr = () => {},
  pingMs = 30_000,
  getTokenFn = null,  // 新增：取得有效 token 的函數
  onConnChange = null // 連線狀態變化回調: (connected: boolean) => void
) {
  let ws;
  let pingId;
  let closed = false;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = RECONNECT_CONFIG.maxAttempts;

  const connect = async () => {
    if (closed || reconnectAttempts >= maxReconnectAttempts) return;

    try {
      // 如果有提供 getTokenFn，使用它取得最新的有效 token
      let token = localStorage.getItem("token");
      if (getTokenFn) {
        try {
          token = await getTokenFn();
        } catch (err) {
          console.error("Failed to get valid token for WebSocket:", err);
          return;
        }
      }

      // 沒有 token 就不連線，等下一次重連
      if (!token) {
        if (!closed && reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          setTimeout(() => connect(), 2000);
        }
        return;
      }

      // 首次連線時，先發送 warmup HTTP 請求確保 proxy 的 upgrade handler 已就緒
      // 這是因為 CRA 的 setupProxy.js 需要第一個 HTTP 請求來設置 WebSocket 代理
      if (reconnectAttempts === 0) {
        try {
          // Warmup request to trigger proxy setup
          await fetch('/api/health').catch(() => {});
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (e) {
          // Ignore warmup errors
        }
      }

      // 關閉舊連線，防止連線洩漏
      if (ws) {
        try { ws.onclose = null; ws.onerror = null; ws.close(); } catch {}
        ws = null;
      }
      clearInterval(pingId);

      const url = buildWsUrl(path, token);
      ws = new WebSocket(url);

      /* 連線成功 → 啟動心跳 */
      ws.onopen = () => {
        reconnectAttempts = 0;
        if (onConnChange) onConnChange(true);
        pingId = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send("ping");
        }, pingMs);
      };

      /* 收到訊息 */
      ws.onmessage = (e) => {
        if (e.data === "ping") return;
        try { 
          onMsg(JSON.parse(e.data)); 
        } catch {
          // ignore bad JSON
        }
      };

      /* 關閉或錯誤 → 清資源 + 自動重連 */
      const handleClose = (ev) => {
        clearInterval(pingId);
        if (onConnChange) onConnChange(false);

        const isAuthClose = ev.code === 4003 || ev.code === 1008;
        if (isAuthClose) {
          closed = true;
        }

        // 只在非正常關閉時才調用錯誤處理
        // Code 1000 = 正常關閉 (例如組件卸載)
        const isNormalClose = ev.code === 1000 || closed;

        if (!isNormalClose) {
          onErr(ev);
        }

        if (!closed && reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          const delay = getReconnectDelay(reconnectAttempts);
          setTimeout(() => connect(), delay);
        }
      };

      ws.onerror = (ev) => {
        // 錯誤事件總是調用 onErr
        onErr(ev);
      };
      ws.onclose = handleClose;
      
    } catch (error) {
      console.error("WebSocket connection error:", error);
      if (!closed) {
        setTimeout(() => connect(), 5000);
      }
    }
  };

  connect();

  /* 供 React 卸載時呼叫 */
  const destroy = () => {
    closed = true;
    clearInterval(pingId);
    if (ws && ws.readyState <= WebSocket.CLOSING) {
      ws.close(1000, "component unmount");
    }
  };

  return { ws, destroy };
}

/* -------- Dashboard 專用快捷 (支援 token refresh) - 單例模式 -------- */
export const openDashboardSocket = (onMsg, onErr, pingMs, getTokenFn) => {
  const path = "/realtime/dashboard";

  // 如果已有連線，先關閉舊的（防止 HMR 重複連線）
  if (activeConnections.has(path)) {
    console.log("[WS] Closing existing dashboard connection before creating new one");
    const oldConnection = activeConnections.get(path);
    if (oldConnection && oldConnection.destroy) {
      oldConnection.destroy();
    }
    activeConnections.delete(path);
  }

  const connection = openSocket(path, onMsg, onErr, pingMs, getTokenFn);

  // 追蹤新連線
  activeConnections.set(path, connection);

  // 包裝 destroy 以同時清除追蹤
  const originalDestroy = connection.destroy;
  connection.destroy = () => {
    activeConnections.delete(path);
    originalDestroy();
  };

  return connection;
};

/* -------- React hook 版本 (支援 AuthContext) - 單例模式 -------- */
export default function useWs(path, onMessage) {
  const { getValidToken } = useContext(AuthCtx);
  const getValidTokenRef = useRef(getValidToken);
  useEffect(() => { getValidTokenRef.current = getValidToken; }, [getValidToken]);
  const onMessageRef = useRef(onMessage);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);

  const destroyRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // 如果已有連線，先關閉舊的（防止 HMR 重複連線）
    if (activeConnections.has(path)) {
      console.log(`[WS] Closing existing ${path} connection before creating new one`);
      const oldConnection = activeConnections.get(path);
      if (oldConnection && oldConnection.destroy) {
        oldConnection.destroy();
      }
      activeConnections.delete(path);
    }

    // 使用 ref 間接引用，避免 getValidToken 引用變化導致 effect 重跑
    const stableGetToken = (...args) => getValidTokenRef.current(...args);

    const { destroy } = openSocket(
      path,
      (msg) => {
        if (onMessageRef.current) onMessageRef.current(msg);
      },
      () => {
        // Connection errors are expected during reconnection; state is
        // already tracked via onConnChange callback.
      },
      30_000,
      stableGetToken,
      (connected) => setIsConnected(connected)
    );

    // 包裝 destroy 並追蹤連線
    const wrappedDestroy = () => {
      activeConnections.delete(path);
      destroy();
    };
    destroyRef.current = wrappedDestroy;
    activeConnections.set(path, { destroy: wrappedDestroy });

    return () => {
      if (destroyRef.current) {
        destroyRef.current();
      }
    };
  }, [path]); // ← 只依賴 path，不再依賴 getValidToken

  return {
    isConnected
  };
}
