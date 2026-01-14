import sqlite3
import unittest
from datetime import date

from core.time_utils import ca_day_bounds, ca_range_bounds, normalize_to_ca_str


class TimeUtilsTests(unittest.TestCase):
    def test_ca_day_bounds(self):
        day = date(2026, 1, 8)
        start, end = ca_day_bounds(day)
        self.assertEqual(start, "2026-01-08 00:00:00")
        self.assertEqual(end, "2026-01-09 00:00:00")

    def test_ca_range_bounds(self):
        start, end = ca_range_bounds(date(2026, 1, 1), date(2026, 1, 7))
        self.assertEqual(start, "2026-01-01 00:00:00")
        self.assertEqual(end, "2026-01-08 00:00:00")

    def test_normalize_to_ca_str(self):
        out = normalize_to_ca_str("2026-01-08T08:00:00Z")
        self.assertEqual(out, "2026-01-08 00:00:00")

    def test_range_query_end_exclusive(self):
        conn = sqlite3.connect(":memory:")
        try:
            conn.execute("CREATE TABLE scans (ts TEXT)")
            day = date(2026, 1, 8)
            start, end = ca_day_bounds(day)
            conn.executemany(
                "INSERT INTO scans(ts) VALUES (?)",
                [
                    (start,),
                    ("2026-01-08 12:00:00",),
                    (end,),
                ],
            )
            count = conn.execute(
                "SELECT COUNT(*) FROM scans WHERE ts >= ? AND ts < ?",
                (start, end),
            ).fetchone()[0]
            self.assertEqual(count, 2)
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
