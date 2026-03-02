from __future__ import annotations

import time
from typing import Any, Optional


class TTLCache:
    def __init__(self, ttl_seconds: int, maxsize: int = 1024) -> None:
        self.ttl_seconds = ttl_seconds
        self.maxsize = maxsize
        self._store: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Optional[Any]:
        item = self._store.get(key)
        if not item:
            return None
        exp, value = item
        if exp <= time.monotonic():
            self._store.pop(key, None)
            return None
        return value

    def set(self, key: str, value: Any, ttl_seconds: Optional[int] = None) -> None:
        ttl = self.ttl_seconds if ttl_seconds is None else ttl_seconds
        if ttl <= 0:
            return
        # Evict expired entries periodically and enforce maxsize
        if len(self._store) >= self.maxsize:
            self._cleanup_expired()
        if len(self._store) >= self.maxsize:
            # LRU-style: remove oldest entry
            oldest_key = next(iter(self._store))
            del self._store[oldest_key]
        self._store[key] = (time.monotonic() + ttl, value)

    def _cleanup_expired(self) -> None:
        now = time.monotonic()
        expired = [k for k, (exp, _) in self._store.items() if exp <= now]
        for k in expired:
            del self._store[k]

    def clear(self) -> None:
        self._store.clear()

    def invalidate_prefix(self, prefix: str) -> None:
        for key in list(self._store.keys()):
            if key.startswith(prefix):
                self._store.pop(key, None)
