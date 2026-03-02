"""
Rate Limiter — Simple in-memory rate limiting.
No external dependencies required.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
import threading


_CLEANUP_INTERVAL = 500  # Purge stale keys every N calls


class RateLimiter:
    """Thread-safe in-memory sliding-window rate limiter."""

    def __init__(self):
        self._requests: dict[str, list[datetime]] = defaultdict(list)
        self._lock = threading.Lock()
        self._call_count = 0

    def is_allowed(self, key: str, max_requests: int, window_seconds: int) -> tuple[bool, int]:
        """
        Check if a request is allowed under the rate limit.

        Returns:
            (is_allowed, remaining_requests)
        """
        with self._lock:
            now = datetime.now()
            window_start = now - timedelta(seconds=window_seconds)

            # Prune expired entries for this key
            self._requests[key] = [
                t for t in self._requests[key] if t > window_start
            ]

            current_count = len(self._requests[key])

            if current_count < max_requests:
                self._requests[key].append(now)
                return True, max_requests - current_count - 1

            # Periodically purge empty keys to prevent memory leak
            self._call_count += 1
            if self._call_count >= _CLEANUP_INTERVAL:
                self._call_count = 0
                self._purge_empty_keys()

            return False, 0

    def reset(self, key: str):
        """Reset rate limit for a key."""
        with self._lock:
            self._requests.pop(key, None)

    def _purge_empty_keys(self):
        """Remove keys with no remaining timestamps (caller holds lock)."""
        empty = [k for k, v in self._requests.items() if not v]
        for k in empty:
            del self._requests[k]


# Global singleton
_rate_limiter = RateLimiter()


def get_rate_limiter() -> RateLimiter:
    return _rate_limiter
