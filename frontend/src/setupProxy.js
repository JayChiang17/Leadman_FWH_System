const { createProxyMiddleware } = require('http-proxy-middleware');
const httpProxy = require('http-proxy');

const BACKEND = 'http://192.168.10.100:8000';

// 創建原生 http-proxy 實例用於 WebSocket
const wsProxy = httpProxy.createProxyServer({
  target: BACKEND,
  ws: true,
  changeOrigin: true,
});

wsProxy.on('error', (err, req, res) => {
  if (err && (err.code === 'ECONNRESET' || err.code === 'EPIPE')) {
    return;
  }
  console.error('[WS Proxy Error]', err.message);
  if (res && typeof res.end === 'function') {
    try { res.end(); } catch {}
  }
});

// 追蹤是否已訂閱 upgrade 事件
let upgradeSubscribed = false;

module.exports = function(app) {
  // API proxy - 使用 http-proxy-middleware
  app.use('/api', createProxyMiddleware({
    target: BACKEND,
    changeOrigin: true,
  }));

  // HTTP 請求到 /realtime 的備用代理
  app.use('/realtime', createProxyMiddleware({
    target: BACKEND,
    changeOrigin: true,
  }));

  // 關鍵：透過中間件取得 server 並訂閱 upgrade 事件
  app.use((req, res, next) => {
    if (!upgradeSubscribed) {
      // 嘗試從多個來源取得 server
      const server = req.socket?.server ||
                     req.connection?.server ||
                     (req.app && req.app.get && req.app.get('server'));

      if (server) {
        console.log('[setupProxy] Found server, subscribing to upgrade events...');

        // 使用原生 http-proxy 處理 WebSocket upgrade
        server.on('upgrade', (proxyReq, socket, head) => {
          const url = proxyReq.url || '';

          // Prevent unhandled socket errors from crashing dev server
          socket.on('error', (err) => {
            if (err && (err.code === 'ECONNRESET' || err.code === 'EPIPE')) {
              return;
            }
            console.warn('[WS Upgrade] Socket error:', err.message);
            try { socket.destroy(); } catch {}
          });

          // 只處理 /realtime 開頭的路徑
          if (url.startsWith('/realtime')) {
            console.log('[WS Upgrade] Proxying:', url.split('?')[0]);
            wsProxy.ws(proxyReq, socket, head);
          }
          // 其他路徑讓 webpack-dev-server 處理 (HMR)
        });

        upgradeSubscribed = true;
        console.log('[setupProxy] ✅ WebSocket upgrade handler ready');
      }
    }
    next();
  });
};
