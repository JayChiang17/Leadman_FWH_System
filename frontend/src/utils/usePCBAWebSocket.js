// src/utils/usePCBAWebSocket.js
import { useEffect, useState, useRef, useCallback, useContext } from 'react';
import { AuthCtx } from '../auth/AuthContext';
import { WS_BASE, isTokenExpired, getReconnectDelay, RECONNECT_CONFIG } from './websocketConfig';

// 本地別名，保持向下兼容
const isExpired = isTokenExpired;

// 單例追蹤器 - 防止 HMR 造成的重複連線
let activePCBAConnection = null;

/* ============================================================== */
export const usePCBAWebSocket = (onMessage) => {
  const [wsStatus, setWsStatus] = useState('disconnected'); 
  const reconnectAttemptRef = useRef(0);
  const [lastError, setLastError] = useState(null);

  const onMessageRef = useRef(onMessage);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);

  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const messageQueueRef = useRef([]);
  const isConnectingRef = useRef(false);
  const connectionAttemptsRef = useRef(0);
  const connectionTimeoutRef = useRef(null);

  // StrictMode / 初始化守護
  const mountedRef = useRef(false);
  const startedRef = useRef(false);

  // 記錄最近一次 token，避免不必要重連
  const lastTokenRef = useRef(localStorage.getItem('token') || null);
  const storageThrottleRef = useRef(null);

  // ✅ 使用 auth/AuthContext.js
  const { token, getValidToken, logout } = useContext(AuthCtx);

  const ensureFreshToken = useCallback(async () => {
    try {
      if (getValidToken) {
        const validToken = await getValidToken();
        if (validToken && !isExpired(validToken)) return validToken;
      }
      const currentToken = token || localStorage.getItem('token');
      if (!currentToken || isExpired(currentToken)) return null;
      return currentToken;
    } catch {
      return null;
    }
  }, [token, getValidToken]);

  /* 發送（未連線時排隊） */
  const sendMessage = useCallback((message) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      messageQueueRef.current.push(message);
      return false;
    }
    try {
      wsRef.current.send(typeof message === 'object' ? JSON.stringify(message) : message);
      return true;
    } catch {
      messageQueueRef.current.push(message);
      return false;
    }
  }, []);

  const flushMessageQueue = useCallback(() => {
    while (messageQueueRef.current.length > 0 && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const msg = messageQueueRef.current.shift();
      try {
        wsRef.current.send(typeof msg === 'object' ? JSON.stringify(msg) : msg);
      } catch {
        messageQueueRef.current.unshift(msg);
        break;
      }
    }
  }, []);

  const cleanupTimers = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  }, []);

  const connect = useCallback(async () => {
    // 已連線或正在連線就不再重複
    if (isConnectingRef.current) return;
    if (wsRef.current && (wsRef.current.readyState === WebSocket.CONNECTING || wsRef.current.readyState === WebSocket.OPEN)) {
      return;
    }

    connectionAttemptsRef.current++;
    if (connectionAttemptsRef.current > 20) {
      setWsStatus('failed');
      setLastError('Too many connection attempts');
      return;
    }

    isConnectingRef.current = true;
    setLastError(null);

    try {
      const validToken = await ensureFreshToken();
      if (!validToken) {
        setWsStatus('error');
        setLastError('Authentication required - please login again');
        setTimeout(() => logout?.(), 2000);
        return;
      }

      // 關閉既有連線
      if (wsRef.current) {
        try { wsRef.current.close(1000, 'Reconnecting'); } catch {}
        wsRef.current = null;
      }

      cleanupTimers();
      setWsStatus('connecting');

      // 首次連線時，先發送 warmup HTTP 請求確保 proxy 的 upgrade handler 已就緒
      if (connectionAttemptsRef.current <= 1) {
        try {
          await fetch('/api/health').catch(() => {});
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (e) {
          // Ignore warmup errors
        }
      }

      const wsUrl = `${WS_BASE}/realtime/pcba?token=${encodeURIComponent(validToken)}`;
      const ws = new WebSocket(wsUrl);

      connectionTimeoutRef.current = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) ws.close();
      }, 10000);

      ws.onopen = () => {
        clearTimeout(connectionTimeoutRef.current);
        setWsStatus('connected');
        reconnectAttemptRef.current = 0;
        connectionAttemptsRef.current = 0;
        setLastError(null);

        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('ping');
        }, 30000);

        setTimeout(flushMessageQueue, 300);
      };

      ws.onmessage = (event) => {
        if (event.data === 'pong' || event.data === 'heartbeat') return;
        try {
          const data = JSON.parse(event.data);
          onMessageRef.current?.(data);
        } catch {
          // 非 JSON 就忽略
        }
      };

      ws.onerror = () => {
        clearTimeout(connectionTimeoutRef.current);
        setWsStatus('error');
        setLastError('Connection error');
      };

      ws.onclose = (event) => {
        clearTimeout(connectionTimeoutRef.current);
        setWsStatus('disconnected');
        cleanupTimers();

        let shouldReconnect = true;
        if (event.code === 4003 || event.code === 1002 || event.code === 1008) {
          // 認證失敗／資料格式錯誤 → 通常不再無限重連
          setLastError('Authentication expired');
          shouldReconnect = false;
        } else if (event.code === 1000) {
          // 正常關閉 → 不重連
          shouldReconnect = false;
        } else if (event.code === 1006) {
          setLastError('Connection lost');
        }

        if (shouldReconnect && reconnectAttemptRef.current < RECONNECT_CONFIG.maxAttempts) {
          const delay = getReconnectDelay(reconnectAttemptRef.current);
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptRef.current++;
            connect();
          }, delay);
        } else if (shouldReconnect) {
          setWsStatus('failed');
          setLastError('Connection failed after multiple attempts');
        }
      };

      wsRef.current = ws;

    } catch (error) {
      setWsStatus('error');
      setLastError(`Connection failed: ${error?.message || 'unknown error'}`);
    } finally {
      isConnectingRef.current = false;
    }
  }, [ensureFreshToken, cleanupTimers, flushMessageQueue, logout]);

  const disconnect = useCallback(() => {
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    cleanupTimers();
    if (wsRef.current) {
      try { wsRef.current.close(1000, 'Manual disconnect'); } catch {}
      wsRef.current = null;
    }
    setWsStatus('disconnected');
    reconnectAttemptRef.current = 0;
    connectionAttemptsRef.current = 0;
    setLastError(null);
    isConnectingRef.current = false;
  }, [cleanupTimers]);

  const reconnect = useCallback(() => {
    reconnectAttemptRef.current = 0;
    connectionAttemptsRef.current = 0;
    disconnect();
    // 輕微延遲讓舊連線確實結束
    setTimeout(connect, 300);
  }, [connect, disconnect]);

  /* ----------------------- 掛載/拆卸 ----------------------- */
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    // 單例模式：如果已有連線，先關閉舊的（防止 HMR 重複連線）
    if (activePCBAConnection && activePCBAConnection !== disconnect) {
      console.log("[PCBA WS] Closing existing connection before creating new one");
      try {
        activePCBAConnection();
      } catch (e) {
        // 忽略關閉錯誤
      }
    }
    activePCBAConnection = disconnect;

    // 僅首次掛載時，如果已有 token，建立連線
    if (token && !startedRef.current) {
      startedRef.current = true;
      connect();
    }

    return () => {
      mountedRef.current = false;
      startedRef.current = false;
      disconnect();
      if (activePCBAConnection === disconnect) {
        activePCBAConnection = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------- 監聽 token 於同分頁變化（AuthContext 改動） -------- */
  useEffect(() => {
    // 初次 render 或 token 真的變化才處理
    const current = token || null;
    if (current !== lastTokenRef.current) {
      lastTokenRef.current = current;
      if (mountedRef.current && startedRef.current) {
        // 若已啟動過，token 真的變了才重連
        reconnect();
      } else if (current && !startedRef.current) {
        // 初次有 token
        startedRef.current = true;
        connect();
      }
    }
  }, [token, connect, reconnect]);

  /* -------- 跨分頁同步（storage event） -------- */
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "__logout_broadcast__") {
        disconnect();
        return;
      }
      if (e.key === "__token_changed__") {
        const t = localStorage.getItem("token") || null;
        if (t === lastTokenRef.current) return; // 沒變就不動
        lastTokenRef.current = t;

        // 節流，避免同時間多個 storage 事件誘發多次重連
        if (storageThrottleRef.current) return;
        storageThrottleRef.current = setTimeout(() => {
          storageThrottleRef.current = null;
        }, 1500);

        reconnect();
      }
    };
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("storage", handler);
      if (storageThrottleRef.current) clearTimeout(storageThrottleRef.current);
    };
  }, [reconnect, disconnect]);

  /* -------- 降低連線風暴：每分鐘遞減嘗試計數 -------- */
  useEffect(() => {
    const resetInterval = setInterval(() => {
      connectionAttemptsRef.current = Math.max(0, connectionAttemptsRef.current - 1);
    }, 60000);
    return () => clearInterval(resetInterval);
  }, []);

  return {
    wsStatus,
    sendMessage,
    reconnect,
    disconnect,
    isConnected: wsStatus === 'connected',
    isConnecting: wsStatus === 'connecting',
    hasError: wsStatus === 'error' || wsStatus === 'failed',
    lastError,
    reconnectAttempt: reconnectAttemptRef.current
  };
};

export default usePCBAWebSocket;
