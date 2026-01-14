"""
Unit Tests for Rate Limiter
Tests rate limiting functionality
"""

import unittest
import time
import os
import sys

# Add parent directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from core.rate_limiter import RateLimiter


class TestRateLimiter(unittest.TestCase):
    """Test Rate Limiter"""

    def setUp(self):
        """Set up test fixtures"""
        self.limiter = RateLimiter()

    def test_first_request_allowed(self):
        """Test #6: First request is always allowed"""
        is_allowed, remaining = self.limiter.is_allowed('test_key', max_requests=5, window_seconds=60)
        self.assertTrue(is_allowed)
        self.assertEqual(remaining, 4)

    def test_rate_limit_enforced(self):
        """Test #6: Rate limit is enforced"""
        # Make 5 requests (max allowed)
        for i in range(5):
            is_allowed, remaining = self.limiter.is_allowed('test_key', max_requests=5, window_seconds=60)
            self.assertTrue(is_allowed, f"Request {i+1} should be allowed")

        # 6th request should be blocked
        is_allowed, remaining = self.limiter.is_allowed('test_key', max_requests=5, window_seconds=60)
        self.assertFalse(is_allowed)
        self.assertEqual(remaining, 0)

    def test_window_reset(self):
        """Test #6: Rate limit window resets after time"""
        # Use 1 second window for faster testing
        # Make 3 requests (max allowed)
        for i in range(3):
            self.limiter.is_allowed('test_key_2', max_requests=3, window_seconds=1)

        # 4th request blocked
        is_allowed, _ = self.limiter.is_allowed('test_key_2', max_requests=3, window_seconds=1)
        self.assertFalse(is_allowed)

        # Wait for window to reset
        time.sleep(1.1)

        # Should be allowed again
        is_allowed, remaining = self.limiter.is_allowed('test_key_2', max_requests=3, window_seconds=1)
        self.assertTrue(is_allowed)
        self.assertEqual(remaining, 2)

    def test_different_keys_independent(self):
        """Test #6: Different keys have independent limits"""
        # Max out key1
        for i in range(5):
            self.limiter.is_allowed('key1', max_requests=5, window_seconds=60)

        # key1 should be blocked
        is_allowed, _ = self.limiter.is_allowed('key1', max_requests=5, window_seconds=60)
        self.assertFalse(is_allowed)

        # key2 should still be allowed
        is_allowed, remaining = self.limiter.is_allowed('key2', max_requests=5, window_seconds=60)
        self.assertTrue(is_allowed)
        self.assertEqual(remaining, 4)

    def test_reset_key(self):
        """Test #6: reset() clears rate limit for a key"""
        # Max out the key
        for i in range(5):
            self.limiter.is_allowed('test_reset', max_requests=5, window_seconds=60)

        # Should be blocked
        is_allowed, _ = self.limiter.is_allowed('test_reset', max_requests=5, window_seconds=60)
        self.assertFalse(is_allowed)

        # Reset the key
        self.limiter.reset('test_reset')

        # Should be allowed again
        is_allowed, remaining = self.limiter.is_allowed('test_reset', max_requests=5, window_seconds=60)
        self.assertTrue(is_allowed)
        self.assertEqual(remaining, 4)

    def test_thread_safety(self):
        """Test #6: Rate limiter is thread-safe"""
        import threading

        results = []

        def make_requests():
            for i in range(3):
                is_allowed, _ = self.limiter.is_allowed('thread_test', max_requests=10, window_seconds=60)
                results.append(is_allowed)

        # Create 5 threads, each making 3 requests = 15 total
        threads = [threading.Thread(target=make_requests) for _ in range(5)]

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # Exactly 10 requests should be allowed (max_requests=10)
        allowed_count = sum(1 for r in results if r)
        self.assertEqual(allowed_count, 10)


if __name__ == '__main__':
    unittest.main()
