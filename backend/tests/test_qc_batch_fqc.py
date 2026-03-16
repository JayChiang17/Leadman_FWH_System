import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from api import qc_check
from models.qc_model import BatchShipIn


class TestBatchFqc(unittest.IsolatedAsyncioTestCase):
    async def test_batch_fqc_dedupes_and_inserts_without_on_conflict(self):
        conn = MagicMock()
        cur = MagicMock()
        ts = "2026-03-12T10:00:00"
        payload = BatchShipIn(sns=["SN100", "SN100", "SN200", "SN200", "SN300"])

        status_map = {
            "SN200": {"fqc_ready_at": None},
            "SN300": {"fqc_ready_at": "2026-03-10T08:00:00"},
        }

        with patch("api.qc_check.now_iso", return_value=ts), \
             patch("api.qc_check._fetch_qc_status_map", return_value=status_map), \
             patch("api.qc_check._invalidate_dashboard_cache"), \
             patch("api.qc_check._broadcast_dashboard_update", new=AsyncMock()):
            result = await qc_check.batch_fqc(payload, db=(conn, cur))

        cur.executemany.assert_called_once()
        insert_sql, insert_params = cur.executemany.call_args[0]
        self.assertNotIn("ON CONFLICT", insert_sql.upper())
        self.assertEqual(insert_params, [("SN100", ts, ts)])

        cur.execute.assert_called_once_with(
            "UPDATE qc_records SET fqc_ready_at=%s, updated_at=%s WHERE sn = ANY(%s)",
            (ts, ts, ["SN200"]),
        )
        conn.commit.assert_called_once()

        self.assertEqual(result["message"], "Successfully marked 2 units as FQC ready")
        self.assertEqual(
            result["results"],
            [
                {"sn": "SN100", "status": "success", "message": "FQC marked"},
                {"sn": "SN200", "status": "success", "message": "FQC marked"},
                {"sn": "SN300", "status": "warning", "message": "Already FQC ready"},
            ],
        )
