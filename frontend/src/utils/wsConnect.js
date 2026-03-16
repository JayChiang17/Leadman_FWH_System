import { useEffect, useRef, useState, useContext } from "react";
import { AuthCtx } from "../auth/AuthContext";
import { buildWsUrl, getReconnectDelay, RECONNECT_CONFIG } from "./websocketConfig";

// 非儀表板路徑的單例追蹤器 - 防止 HMR 造成的重複連線
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
      if (reconnectAttempts === 0) {
        try {
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
        if (e.data === "ping" || e.data === "pong" || e.data === "heartbeat") return;
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
          // Token expired / auth failed → stop reconnecting, user must re-login
          closed = true;
          console.warn("[WS] Auth failed (code %d) on %s — stopped reconnecting", ev.code, path);
          return;
        }

        // Code 1000 = 正常關閉 (組件卸載)
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

  return { destroy };
}


/* ─────────────────────────────────────────────────────────────────────────────
 * 儀表板 WS 訂閱者模式
 *
 * 問題：Dashboard、ModuleProduction、NGDashboard、ATETesting、AssemblyProduction
 *       全部使用相同的 /realtime/dashboard 路徑。舊的「先關後建」做法讓每次
 *       頁面切換都會殺掉前一個元件的連線，造成重連風暴。
 *
 * 解法：一個底層連線，多個訂閱者共享。元件卸載只移除訂閱，最後一個訂閱者
 *       離開才真正銷毀連線。
 * ────────────────────────────────────────────────────────────────────────── */
const _dsubs     = new Map(); // subscriberId → onMsg callback
const _dconnCbs  = new Map(); // subscriberId → onConnChange callback
let   _dconn     = null;      // 底層 openSocket 返回的 { destroy }
let   _did       = 0;         // 訂閱者 ID 計數器
let   _dGetToken = null;      // 最新的 getTokenFn（訂閱時更新）

function _startDashboardConn() {
  if (_dconn) return;
  _dconn = openSocket(
    "/realtime/dashboard",
    (msg) => {
      _dsubs.forEach((cb) => { try { cb(msg); } catch {} });
    },
    () => {}, // errors are logged inside openSocket
    30_000,
    // 永遠使用最新的 getTokenFn（透過閉包引用 _dGetToken）
    (...args) => (_dGetToken
      ? _dGetToken(...args)
      : Promise.resolve(localStorage.getItem("token"))
    ),
    (ok) => {
      _dconnCbs.forEach((cb) => { try { cb(ok); } catch {} });
    }
  );
}

function _subscribeDashboard(onMsg, getTokenFn, onConnChange) {
  const id = ++_did;
  _dsubs.set(id, onMsg);
  if (onConnChange) _dconnCbs.set(id, onConnChange);
  if (getTokenFn) _dGetToken = getTokenFn; // 記住最新的 token 函數

  _startDashboardConn();

  return () => {
    _dsubs.delete(id);
    _dconnCbs.delete(id);
    // 最後一個訂閱者離開時才銷毀底層連線
    if (_dsubs.size === 0 && _dconn) {
      _dconn.destroy();
      _dconn = null;
    }
  };
}


/* -------- Dashboard 專用快捷（向後相容舊 API）-------- */
export const openDashboardSocket = (onMsg, onErr, pingMs, getTokenFn) => {
  const unsubscribe = _subscribeDashboard(onMsg, getTokenFn, null);
  // 回傳 { destroy } 維持舊呼叫介面相容性（ws 屬性不再提供）
  return { destroy: unsubscribe };
};


/* -------- React hook 版本（支援 AuthContext）-------- */
export default function useWs(path, onMessage) {
  const { getValidToken } = useContext(AuthCtx);
  const getValidTokenRef = useRef(getValidToken);
  useEffect(() => { getValidTokenRef.current = getValidToken; }, [getValidToken]);
  const onMessageRef = useRef(onMessage);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);

  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const stableGetToken = (...args) => getValidTokenRef.current(...args);

    // 儀表板路徑：使用共享訂閱者模式，不重建連線
    if (path === "/realtime/dashboard") {
      const cleanup = _subscribeDashboard(
        (msg) => { if (onMessageRef.current) onMessageRef.current(msg); },
        stableGetToken,
        (ok) => setIsConnected(ok)
      );
      return cleanup;
    }

    // 其他路徑：每個元件各自獨立連線
    if (activeConnections.has(path)) {
      const old = activeConnections.get(path);
      if (old?.destroy) old.destroy();
      activeConnections.delete(path);
    }

    const { destroy } = openSocket(
      path,
      (msg) => { if (onMessageRef.current) onMessageRef.current(msg); },
      () => {},
      30_000,
      stableGetToken,
      (ok) => setIsConnected(ok)
    );

    const wrappedDestroy = () => { activeConnections.delete(path); destroy(); };
    activeConnections.set(path, { destroy: wrappedDestroy });

    return wrappedDestroy;
  }, [path]); // ← 只依賴 path

  return { isConnected };
}
