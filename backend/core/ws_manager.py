# core/ws_manager.py
import asyncio
import logging
from fastapi import WebSocket
from starlette.websockets import WebSocketState

logger = logging.getLogger("ws_manager")

class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, user_info: dict | None = None) -> bool:
        """
        只負責記錄，不做 websocket.accept()。
        """
        async with self._lock:
            if websocket not in self.active:
                self.active.append(websocket)
        uid = (user_info or {}).get("sub", "unknown")
        role = (user_info or {}).get("role", "-")
        logger.info("🔗 WebSocket connected: %s (%s). Total: %d", uid, role, len(self.active))
        return True

    async def disconnect(self, websocket: WebSocket):
        async with self._lock:
            if websocket in self.active:
                self.active.remove(websocket)
        logger.info("❌ WebSocket disconnected. Remaining: %d", len(self.active))

    async def _safe_send(self, ws: WebSocket, message: dict) -> bool:
        if ws.client_state != WebSocketState.CONNECTED:
            return False
        try:
            await ws.send_json(message)
            return True
        except Exception as e:
            logger.warning("⚠️ send_json failed; removing socket: %s", e)
            await self.disconnect(ws)
            return False

    async def broadcast(self, message: dict):
        async with self._lock:
            sockets = list(self.active)
        for ws in sockets:
            await self._safe_send(ws, message)

    # alias
    broadcast_json = broadcast

# 全域單例
ws_manager = ConnectionManager()
