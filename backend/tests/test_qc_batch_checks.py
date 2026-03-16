import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from api import qc_check
from models.qc_model import BatchCheckIn


class TestBatchChecks(unittest.TestCase):
    def test_batch_fqc_check_uses_fqc_specific_rules(self):
        cur = MagicMock()
        payload = BatchCheckIn(sns=["ASM100", "ASM100", "QC200", "FQC300", "SHIP400", "MISS500"])

        status_map = {
            "QC200": {
                "created_at": "2026-03-12T08:00:00",
                "fqc_ready_at": None,
                "shipped_at": None,
            },
            "FQC300": {
                "created_at": "2026-03-11T08:00:00",
                "fqc_ready_at": "2026-03-11T09:00:00",
                "shipped_at": None,
            },
            "SHIP400": {
                "created_at": "2026-03-10T08:00:00",
                "fqc_ready_at": "2026-03-10T09:00:00",
                "shipped_at": "2026-03-10T12:00:00",
            },
        }

        with patch("api.qc_check._fetch_qc_status_map", return_value=status_map), \
             patch("api.qc_check._fetch_assembly_timestamps", return_value={"ASM100": "2026-03-12 07:30:00"}) as fetch_asm:
            result = qc_check.batch_fqc_check(payload, db=(MagicMock(), cur))

        fetch_asm.assert_called_once_with(["ASM100", "MISS500"])
        self.assertEqual(
            result["results"],
            [
                {
                    "sn": "ASM100",
                    "status": "ready_for_fqc",
                    "reason": "Found in assembly production records",
                    "production_time": "2026-03-12 07:30:00",
                    "created_at": None,
                    "fqc_ready_at": None,
                    "shipped_at": None,
                },
                {
                    "sn": "QC200",
                    "status": "ready_for_fqc",
                    "reason": "Found in QC system, FQC not completed",
                    "production_time": "2026-03-12T08:00:00",
                    "created_at": "2026-03-12T08:00:00",
                    "fqc_ready_at": None,
                    "shipped_at": None,
                },
                {
                    "sn": "FQC300",
                    "status": "already_fqc",
                    "reason": "Already FQC ready",
                    "production_time": "2026-03-11T08:00:00",
                    "created_at": "2026-03-11T08:00:00",
                    "fqc_ready_at": "2026-03-11T09:00:00",
                    "shipped_at": None,
                },
                {
                    "sn": "SHIP400",
                    "status": "already_shipped",
                    "reason": "Already shipped",
                    "production_time": "2026-03-10T08:00:00",
                    "created_at": "2026-03-10T08:00:00",
                    "fqc_ready_at": "2026-03-10T09:00:00",
                    "shipped_at": "2026-03-10T12:00:00",
                },
                {
                    "sn": "MISS500",
                    "status": "not_found",
                    "reason": "Not found in production or QC system",
                    "production_time": None,
                    "created_at": None,
                    "fqc_ready_at": None,
                    "shipped_at": None,
                },
            ],
        )

    def test_batch_ship_check_uses_shipping_specific_rules(self):
        cur = MagicMock()
        payload = BatchCheckIn(sns=["READY100", "READY100", "WAIT200", "SHIP300", "MISS400"])

        status_map = {
            "READY100": {
                "created_at": "2026-03-12T08:00:00",
                "fqc_ready_at": "2026-03-12T09:00:00",
                "shipped_at": None,
            },
            "WAIT200": {
                "created_at": "2026-03-11T08:00:00",
                "fqc_ready_at": None,
                "shipped_at": None,
            },
            "SHIP300": {
                "created_at": "2026-03-10T08:00:00",
                "fqc_ready_at": "2026-03-10T09:00:00",
                "shipped_at": "2026-03-10T12:00:00",
            },
        }

        with patch("api.qc_check._fetch_qc_status_map", return_value=status_map), \
             patch("api.qc_check._fetch_assembly_timestamps", return_value={"MISS400": "2026-03-09 07:30:00"}) as fetch_asm:
            result = qc_check.batch_ship_check(payload, db=(MagicMock(), cur))

        fetch_asm.assert_called_once_with(["MISS400"])
        self.assertEqual(
            result["results"],
            [
                {
                    "sn": "READY100",
                    "status": "ready_to_ship",
                    "reason": "FQC ready, pending shipment",
                    "production_time": "2026-03-12T08:00:00",
                    "created_at": "2026-03-12T08:00:00",
                    "fqc_ready_at": "2026-03-12T09:00:00",
                    "shipped_at": None,
                },
                {
                    "sn": "WAIT200",
                    "status": "not_ready",
                    "reason": "FQC not completed",
                    "production_time": "2026-03-11T08:00:00",
                    "created_at": "2026-03-11T08:00:00",
                    "fqc_ready_at": None,
                    "shipped_at": None,
                },
                {
                    "sn": "SHIP300",
                    "status": "already_shipped",
                    "reason": "Already shipped",
                    "production_time": "2026-03-10T08:00:00",
                    "created_at": "2026-03-10T08:00:00",
                    "fqc_ready_at": "2026-03-10T09:00:00",
                    "shipped_at": "2026-03-10T12:00:00",
                },
                {
                    "sn": "MISS400",
                    "status": "not_found",
                    "reason": "Not found in QC system",
                    "production_time": "2026-03-09 07:30:00",
                    "created_at": None,
                    "fqc_ready_at": None,
                    "shipped_at": None,
                },
            ],
        )
