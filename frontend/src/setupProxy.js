const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // Proxy all /api requests to backend
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://192.168.10.100:8000',
      changeOrigin: true,
      secure: false,
      logLevel: 'warn'
    })
  );

  // Proxy WebSocket connections (for wss:// support)
  app.use(
    '/ws',
    createProxyMiddleware({
      target: 'http://192.168.10.100:8000',
      ws: true,              // Enable WebSocket proxying
      changeOrigin: true,
      secure: false,
      logLevel: 'warn'
    })
  );
};
