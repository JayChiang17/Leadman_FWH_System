import { useEffect, useRef, useState, useContext } from "react";
import { AuthCtx } from "../auth/AuthContext";

/* ---------- URL 工具 ---------- */
function getWsBaseURL() {
  // 從 REACT_APP_API_BASE 推算 WebSocket URL
  const apiBase = process.env.REACT_APP_API_BASE;
  
  if (apiBase) {
    // 將 http://xxx/api 轉換成 ws://xxx
    return apiBase
      .replace(/^https?/, (m) => (m === "https" ? "wss" : "ws"))
      .replace(/\/api\/?$/, "");
  }
  
  // fallback：取瀏覽器 location
  const { protocol, host } = window.location;
  return (protocol === "https:" ? "wss://" : "ws://") + host;
}

function buildUrl(path, token) {
  const qs = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${getWsBaseURL()}${path}${qs}`;
}

/* ---------- 核心：可自動重連 WebSocket (支援 token refresh) ---------- */
export function openSocket(
  path,
  onMsg,
  onErr = () => {},
  pingMs = 30_000,
  getTokenFn = null  // 新增：取得有效 token 的函數
) {
  let ws;
  let pingId;
  let closed = false;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 10;

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

      const url = buildUrl(path, token);
      ws = new WebSocket(url);

      /* 連線成功 → 啟動心跳 */
      ws.onopen = () => {
        console.log("WebSocket connected");
        reconnectAttempts = 0;
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
        onErr(ev);
        
        if (!closed && reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          const delay = Math.min(2000 * Math.pow(1.5, reconnectAttempts), 30000);
          console.log(`WebSocket disconnected, reconnecting in ${delay}ms...`);
          setTimeout(() => connect(), delay);
        }
      };
      
      ws.onerror = handleClose;
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

/* -------- Dashboard 專用快捷 (支援 token refresh) -------- */
export const openDashboardSocket = (onMsg, onErr, pingMs, getTokenFn) =>
  openSocket("/ws/dashboard", onMsg, onErr, pingMs, getTokenFn);

/* -------- React hook 版本 (支援 AuthContext) -------- */
export default function useWs(path) {
  const { getValidToken } = useContext(AuthCtx);
  const wsRef = useRef(null);
  const destroyRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const { ws, destroy } = openSocket(
      path,
      (msg) => {
        // 可以在這裡處理訊息
        console.log("WS message:", msg);
      },
      (err) => {
        setIsConnected(false);
        console.error("WS error:", err);
      },
      30_000,
      getValidToken  // 傳入取得有效 token 的函數
    );

    wsRef.current = ws;
    destroyRef.current = destroy;

    // 監聽連線狀態
    const checkConnection = setInterval(() => {
      if (wsRef.current) {
        setIsConnected(wsRef.current.readyState === WebSocket.OPEN);
      }
    }, 1000);

    return () => {
      clearInterval(checkConnection);
      if (destroyRef.current) {
        destroyRef.current();
      }
    };
  }, [path, getValidToken]);

  return { 
    ws: wsRef.current, 
    isConnected 
  };
}