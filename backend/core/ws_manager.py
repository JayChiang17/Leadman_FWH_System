# core/ws_manager.py
import asyncio
import json
import logging
import os
import time
import uuid
from typing import Any

from fastapi import WebSocket
from starlette.websockets import WebSocketState

try:
    import redis.asyncio as redis_async
except Exception:  # pragma: no cover - optional dependency at runtime
    redis_async = None

logger = logging.getLogger("ws_manager")


class _ConnInfo:
    __slots__ = ("ws", "user", "role", "connected_at", "msg_count", "last_active")

    def __init__(self, ws: WebSocket, user: str = "unknown", role: str = "-"):
        self.ws = ws
        self.user = user
        self.role = role
        self.connected_at = time.time()
        self.msg_count = 0
        self.last_active = time.time()


class ConnectionManager:
    def __init__(self):
        self.active: dict[int, _ConnInfo] = {}
        self._lock = asyncio.Lock()
        self._prune_task: asyncio.Task | None = None

        self._redis_lock = asyncio.Lock()
        self._redis: Any = None
        self._pubsub: Any = None
        self._redis_task: asyncio.Task | None = None
        self._started = False
        self._redis_enabled = False
        self._next_redis_retry_at = 0.0
        self._redis_retry_interval = float(os.getenv("WS_REDIS_RETRY_SECONDS", "5"))
        self._last_redis_error = ""
        base_instance_id = (os.getenv("WS_INSTANCE_ID") or str(uuid.uuid4())).strip()
        # Ensure uniqueness per worker process to avoid self-filter collisions.
        self._instance_id = f"{base_instance_id}:{os.getpid()}"
        self._redis_url = (os.getenv("WS_REDIS_URL") or "").strip()
        self._redis_channel = os.getenv("WS_REDIS_CHANNEL", "leadman:ws:broadcast").strip()

    # lifecycle

    async def start(self):
        if self._started:
            return
        self._started = True

        if not self._redis_url:
            logger.info("Redis WS bus disabled: WS_REDIS_URL is empty")
            return
        if redis_async is None:
            logger.warning("Redis WS bus requested but redis package is not installed")
            return

        await self._ensure_redis_bus(force=True)
        if self._redis_task is None:
            self._redis_task = asyncio.create_task(self._redis_listener_loop())

    async def stop(self):
        if self._prune_task:
            self._prune_task.cancel()
            try:
                await self._prune_task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
            self._prune_task = None

        if self._redis_task:
            self._redis_task.cancel()
            try:
                await self._redis_task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
            self._redis_task = None

        await self._close_redis_resources()
        self._started = False

    async def _close_redis_resources(self):
        self._redis_enabled = False
        if self._pubsub is not None:
            try:
                await self._pubsub.unsubscribe(self._redis_channel)
            except Exception:
                pass
            try:
                await self._pubsub.close()
            except Exception:
                pass
            self._pubsub = None

        if self._redis is not None:
            try:
                await self._redis.aclose()
            except Exception:
                pass
            self._redis = None

    async def _ensure_redis_bus(self, force: bool = False):
        if not self._redis_url or redis_async is None:
            return False

        now = time.time()
        if not force and self._redis_enabled:
            return True
        if not force and now < self._next_redis_retry_at:
            return False

        async with self._redis_lock:
            now = time.time()
            if not force and self._redis_enabled:
                return True
            if not force and now < self._next_redis_retry_at:
                return False

            try:
                await self._close_redis_resources()
                self._redis = redis_async.from_url(self._redis_url, decode_responses=True)
                await self._redis.ping()
                self._pubsub = self._redis.pubsub(ignore_subscribe_messages=True)
                await self._pubsub.subscribe(self._redis_channel)
                self._redis_enabled = True
                self._next_redis_retry_at = 0.0
                self._last_redis_error = ""
                logger.info(
                    "Redis WS bus enabled: channel=%s instance_id=%s",
                    self._redis_channel,
                    self._instance_id,
                )
                return True
            except Exception as e:
                self._last_redis_error = str(e)
                self._next_redis_retry_at = time.time() + self._redis_retry_interval
                logger.warning(
                    "Failed to initialize Redis WS bus, fallback to local only: %s",
                    e,
                )
                await self._close_redis_resources()
                return False

    async def _redis_listener_loop(self):
        while True:
            try:
                if not self._redis_enabled or self._pubsub is None:
                    await self._ensure_redis_bus(force=False)
                    await asyncio.sleep(0.5)
                    continue

                msg = await self._pubsub.get_message(timeout=1.0)
                if msg and msg.get("type") == "message":
                    data = msg.get("data")
                    envelope = json.loads(data) if isinstance(data, str) else data
                    if not isinstance(envelope, dict):
                        continue

                    if envelope.get("source") == self._instance_id:
                        continue

                    payload = envelope.get("payload")
                    payloads = envelope.get("payloads")
                    if isinstance(payload, dict):
                        await self._broadcast_local(payload)
                    elif isinstance(payloads, list):
                        msg_list = [m for m in payloads if isinstance(m, dict)]
                        if msg_list:
                            await self._broadcast_local_many(msg_list)

                await asyncio.sleep(0.01)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning("Redis WS listener error: %s", e)
                self._last_redis_error = str(e)
                self._next_redis_retry_at = time.time() + self._redis_retry_interval
                await self._close_redis_resources()
                await asyncio.sleep(1.0)

    async def connect(self, websocket: WebSocket, user_info: dict | None = None) -> bool:
        if not self._started:
            await self.start()

        uid = (user_info or {}).get("sub", "unknown")
        role = (user_info or {}).get("role", "-")
        async with self._lock:
            self.active[id(websocket)] = _ConnInfo(websocket, uid, role)
        logger.info("WebSocket connected: %s (%s). Total: %d", uid, role, len(self.active))
        self._ensure_prune_task()
        return True

    async def disconnect(self, websocket: WebSocket):
        async with self._lock:
            self.active.pop(id(websocket), None)
        logger.info("WebSocket disconnected. Remaining: %d", len(self.active))

    # send helpers

    def touch(self, websocket: WebSocket):
        """Update last_active for a connection (call this after any direct send that bypasses broadcast)."""
        info = self.active.get(id(websocket))
        if info:
            info.last_active = time.time()
            info.msg_count += 1

    async def _safe_send(self, ws: WebSocket, message: dict) -> bool:
        if ws.client_state != WebSocketState.CONNECTED:
            return False
        try:
            await ws.send_json(message)
            return True
        except Exception as e:
            logger.warning("send_json failed; removing socket: %s", e)
            await self.disconnect(ws)
            return False

    async def _broadcast_local(self, message: dict):
        async with self._lock:
            infos = list(self.active.values())
        if not infos:
            return

        results = await asyncio.gather(
            *(self._safe_send(info.ws, message) for info in infos),
            return_exceptions=True,
        )
        now = time.time()
        for info, result in zip(infos, results):
            if result is True:
                info.msg_count += 1
                info.last_active = now

    async def _broadcast_local_many(self, messages: list[dict]):
        if not messages:
            return
        async with self._lock:
            infos = list(self.active.values())
        if not infos:
            return

        async def _send_sequence(info):
            for message in messages:
                ok = await self._safe_send(info.ws, message)
                if not ok:
                    return False
            return True

        results = await asyncio.gather(
            *(_send_sequence(info) for info in infos),
            return_exceptions=True,
        )
        now = time.time()
        for info, result in zip(infos, results):
            if result is True:
                info.msg_count += len(messages)
                info.last_active = now

    async def _publish_redis(self, message: dict):
        if not self._redis_enabled or self._redis is None:
            await self._ensure_redis_bus(force=False)
        if not self._redis_enabled or self._redis is None:
            return
        try:
            envelope = {
                "source": self._instance_id,
                "ts": time.time(),
                "payload": message,
            }
            await self._redis.publish(
                self._redis_channel,
                json.dumps(envelope, ensure_ascii=False, default=str),
            )
        except Exception as e:
            logger.warning("Redis publish failed, local WS broadcast still succeeded: %s", e)
            self._last_redis_error = str(e)
            self._next_redis_retry_at = time.time() + self._redis_retry_interval
            await self._close_redis_resources()

    async def broadcast(self, message: dict):
        await self._broadcast_local(message)
        # Fire-and-forget Redis publish so it doesn't block local delivery
        asyncio.ensure_future(self._publish_redis(message))

    async def broadcast_many(self, messages: list[dict]):
        if not messages:
            return
        await self._broadcast_local_many(messages)
        # Fire-and-forget Redis publish so it doesn't block local delivery
        asyncio.ensure_future(self._publish_redis_many(messages))

    async def _publish_redis_many(self, messages: list[dict]):
        if not self._redis_enabled or self._redis is None:
            await self._ensure_redis_bus(force=False)
        if not self._redis_enabled or self._redis is None:
            return
        try:
            envelope = {
                "source": self._instance_id,
                "ts": time.time(),
                "payloads": messages,
            }
            await self._redis.publish(
                self._redis_channel,
                json.dumps(envelope, ensure_ascii=False, default=str),
            )
        except Exception as e:
            logger.warning("Redis publish-many failed, local WS broadcast still succeeded: %s", e)
            self._last_redis_error = str(e)
            self._next_redis_retry_at = time.time() + self._redis_retry_interval
            await self._close_redis_resources()

    # alias
    broadcast_json = broadcast

    # stats for monitoring

    def get_stats(self) -> dict:
        now = time.time()
        connections = []
        user_counts: dict[str, int] = {}
        for info in list(self.active.values()):
            dur = int(now - info.connected_at)
            idle = int(now - info.last_active)
            connections.append({
                "user": info.user,
                "role": info.role,
                "connected_seconds": dur,
                "msg_count": info.msg_count,
                "idle_seconds": idle,
            })
            user_counts[info.user] = user_counts.get(info.user, 0) + 1

        excessive = [{"user": u, "count": c} for u, c in user_counts.items() if c > 3]

        return {
            "total": len(connections),
            "connections": connections,
            "by_user": [{"user": u, "count": c} for u, c in sorted(user_counts.items(), key=lambda x: -x[1])],
            "excessive": excessive,
            "redis_enabled": self._redis_enabled,
            "redis_channel": self._redis_channel,
            "redis_retry_seconds": self._redis_retry_interval,
            "last_redis_error": self._last_redis_error,
            "instance_id": self._instance_id,
        }

    # periodic stale connection pruner

    def _ensure_prune_task(self):
        if self._prune_task is None or self._prune_task.done():
            self._prune_task = asyncio.ensure_future(self._prune_loop())

    async def _prune_loop(self):
        while True:
            await asyncio.sleep(30)
            try:
                await self._prune_stale()
            except Exception as e:
                logger.warning("Prune error: %s", e)
            if not self.active:
                break

    async def _prune_stale(self):
        now = time.time()
        async with self._lock:
            items = list(self.active.items())

        stale_ids = []
        for ws_id, info in items:
            if info.ws.client_state != WebSocketState.CONNECTED:
                stale_ids.append(ws_id)
            elif (now - info.last_active) > 300:
                # No activity for 5 minutes — close (covers both idle and direct-send connections)
                stale_ids.append(ws_id)
                try:
                    await info.ws.close(1000, "idle timeout")
                except Exception:
                    pass

        if stale_ids:
            async with self._lock:
                for ws_id in stale_ids:
                    self.active.pop(ws_id, None)
            logger.info("Pruned %d stale connection(s). Remaining: %d", len(stale_ids), len(self.active))


# global singleton
ws_manager = ConnectionManager()
