"""
Rate Limiter - Simple in-memory rate limiting
No external dependencies required
"""

from datetime import datetime, timedelta
from collections import defaultdict
from typing import Dict, Tuple
import threading


class RateLimiter:
    """Simple in-memory rate limiter"""

    def __init__(self):
        self._requests: Dict[str, list] = defaultdict(list)
        self._lock = threading.Lock()

    def is_allowed(self, key: str, max_requests: int, window_seconds: int) -> Tuple[bool, int]:
        """
        Check if request is allowed under rate limit

        Args:
            key: Unique identifier (e.g., IP address, user ID)
            max_requests: Maximum requests allowed in window
            window_seconds: Time window in seconds

        Returns:
            Tuple of (is_allowed: bool, remaining_requests: int)
        """
        with self._lock:
            now = datetime.now()
            window_start = now - timedelta(seconds=window_seconds)

            # Remove old requests outside the window
            self._requests[key] = [
                req_time for req_time in self._requests[key]
                if req_time > window_start
            ]

            current_count = len(self._requests[key])

            if current_count < max_requests:
                self._requests[key].append(now)
                return True, max_requests - current_count - 1
            else:
                return False, 0

    def reset(self, key: str):
        """Reset rate limit for a key"""
        with self._lock:
            if key in self._requests:
                del self._requests[key]


# Global rate limiter instance
_rate_limiter = RateLimiter()


def get_rate_limiter() -> RateLimiter:
    """Get global rate limiter instance"""
    return _rate_limiter
