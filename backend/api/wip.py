# backend/api/wip.py
"""
WIP (Work-In-Progress) Tracking API

Visible stage logic:
  assembling  -> manual assembly stage
  aging       -> manual aging stage
  fqc_passed  -> derived live from qc.qc_records.fqc_ready_at OR stored stage
  shipped     -> derived live from qc.qc_records.shipped_at

Notes:
  - Shipped units remain visible in the final dashboard column.
  - FQC Passed is computed from QC data in real time, so the dashboard no longer
    depends on back-fill to show correct counts.
"""

import logging
from datetime import datetime
from typing import List, Optional

import psycopg2.extras
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from core.pg import get_conn, get_cursor
from core.deps import get_current_user
from core.ws_manager import ws_manager

logger = logging.getLogger(__name__)
router = APIRouter(tags=["wip"])

STORED_STAGES = ("assembling", "aging", "fqc_passed", "pending_shipment")
VISIBLE_STAGES = ("assembling", "aging", "fqc_passed", "shipped")
EDITABLE_STAGES = ("assembling", "aging", "fqc_passed")
VALID_TRANSITIONS = {
    "assembling": "aging",
    "aging": "fqc_passed",
    "fqc_passed": None,
    "pending_shipment": None,
}

BATT_A_PREFIXES = ("10080064", "10080104")
BATT_B_PREFIXES = ("10080065", "10080105")

_EFFECTIVE_STAGE_SQL = """
    CASE
      WHEN q.shipped_at IS NOT NULL THEN 'shipped'
      WHEN q.fqc_ready_at IS NOT NULL THEN 'fqc_passed'
      WHEN s.apower_stage = 'pending_shipment' THEN 'fqc_passed'
      ELSE COALESCE(NULLIF(s.apower_stage, ''), 'assembling')
    END
"""


def _row_to_dict(row) -> dict:
    return {
        k: (v.isoformat() if isinstance(v, datetime) else v)
        for k, v in dict(row).items()
    }


def _normalize_battery_sn(sn: Optional[str]) -> str:
    return (sn or "").strip().upper().replace("-", "").replace(" ", "")


def _infer_battery_kind(sn: str) -> Optional[str]:
    if sn.startswith(BATT_A_PREFIXES):
        return "A"
    if sn.startswith(BATT_B_PREFIXES):
        return "B"
    return None


def _battery_stats_snapshot() -> dict:
    result = {
        "A": {"kind": "A", "produced": 0, "consumed": 0, "manual_adj": 0, "available": 0},
        "B": {"kind": "B", "produced": 0, "consumed": 0, "manual_adj": 0, "available": 0},
    }

    with get_cursor("model") as cur:
        cur.execute(
            """
            SELECT kind, COUNT(*) AS produced
            FROM model.scans
            WHERE status IS DISTINCT FROM 'NG'
              AND kind IN ('A','B')
            GROUP BY kind
            """
        )
        for row in cur.fetchall():
            result[row["kind"]]["produced"] = row["produced"]

        cur.execute(
            """
            SELECT kind, COALESCE(SUM(delta),0) AS adj
            FROM model.battery_inventory_adj
            WHERE kind IN ('A','B')
            GROUP BY kind
            """
        )
        for row in cur.fetchall():
            result[row["kind"]]["manual_adj"] = int(row["adj"])

    with get_cursor("assembly") as cur:
        cur.execute(
            """
            SELECT
              COUNT(*) FILTER(WHERE mod_a IS NOT NULL AND mod_a <> '' AND q.shipped_at IS NULL) AS consumed_a,
              COUNT(*) FILTER(WHERE mod_b IS NOT NULL AND mod_b <> '' AND q.shipped_at IS NULL) AS consumed_b
            FROM assembly.scans s
            LEFT JOIN qc.qc_records q ON q.sn = s.us_sn
            """
        )
        row = cur.fetchone()
        if row:
            result["A"]["consumed"] = row["consumed_a"] or 0
            result["B"]["consumed"] = row["consumed_b"] or 0

    for kind in ("A", "B"):
        data = result[kind]
        data["available"] = data["produced"] - data["consumed"] + data["manual_adj"]

    return result


def _sync_qc_wip_stage() -> dict:
    """Bring stored WIP stages closer to QC truth for existing records."""
    result = {"fqc_passed": 0, "pending_shipment": 0}
    with get_conn("assembly") as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            UPDATE assembly.scans s
            SET apower_stage = 'fqc_passed',
                stage_updated_at = COALESCE(q.fqc_ready_at, NOW()),
                stage_updated_by = 'system_qc_sync'
            FROM qc.qc_records q
            WHERE s.us_sn = q.sn
              AND q.fqc_ready_at IS NOT NULL
              AND q.shipped_at IS NULL
              AND s.apower_stage IS DISTINCT FROM 'fqc_passed'
            """
        )
        result["fqc_passed"] = cur.rowcount

        cur.execute(
            """
            UPDATE assembly.scans s
            SET apower_stage = 'pending_shipment',
                stage_updated_at = COALESCE(q.shipped_at, NOW()),
                stage_updated_by = 'system_qc_sync'
            FROM qc.qc_records q
            WHERE s.us_sn = q.sn
              AND q.shipped_at IS NOT NULL
              AND s.apower_stage IS DISTINCT FROM 'pending_shipment'
            """
        )
        result["pending_shipment"] = cur.rowcount

    return result


# Schema setup + back-fill

def _ensure_wip_columns():
    """Idempotently create WIP columns/tables and back-fill stage from QC data."""
    with get_conn("assembly") as conn:
        cur = conn.cursor()

        cur.execute(
            """
            ALTER TABLE assembly.scans
              ADD COLUMN IF NOT EXISTS apower_stage TEXT NOT NULL DEFAULT 'assembling'
            """
        )
        cur.execute(
            """
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'chk_apower_stage'
                  AND conrelid = 'assembly.scans'::regclass
              ) THEN
                ALTER TABLE assembly.scans
                  ADD CONSTRAINT chk_apower_stage
                    CHECK (apower_stage IN (
                      'assembling','aging','fqc_passed','pending_shipment'
                    ));
              END IF;
            END $$
            """
        )
        cur.execute(
            """
            ALTER TABLE assembly.scans
              ADD COLUMN IF NOT EXISTS stage_updated_at TIMESTAMPTZ DEFAULT NOW()
            """
        )
        cur.execute(
            """
            ALTER TABLE assembly.scans
              ADD COLUMN IF NOT EXISTS stage_updated_by TEXT DEFAULT ''
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_assy_scans_apower_stage
              ON assembly.scans(apower_stage)
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS assembly.stage_history (
              id          SERIAL PRIMARY KEY,
              scan_id     INTEGER NOT NULL
                            REFERENCES assembly.scans(id) ON DELETE CASCADE,
              from_stage  TEXT,
              to_stage    TEXT NOT NULL,
              changed_by  TEXT NOT NULL DEFAULT '',
              changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              notes       TEXT DEFAULT ''
            )
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_stage_history_scan_id
              ON assembly.stage_history(scan_id)
            """
        )

    with get_conn("model") as conn:
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS model.battery_inventory_adj (
              id         SERIAL PRIMARY KEY,
              kind       TEXT NOT NULL CHECK(kind IN ('A','B')),
              delta      INTEGER NOT NULL,
              reason     TEXT NOT NULL DEFAULT '',
              operator   TEXT NOT NULL DEFAULT '',
              created_at TIMESTAMPTZ DEFAULT NOW()
            )
            """
        )

    sync_result = _sync_qc_wip_stage()
    logger.info("[wip] schema OK | qc sync=%s", sync_result)


try:
    _ensure_wip_columns()
except Exception as _e:
    logger.warning("[wip] startup migration deferred: %s", _e)


class StageAdvanceIn(BaseModel):
    new_stage: Optional[str] = None
    notes: Optional[str] = ""


class BatteryAdjIn(BaseModel):
    kind: str
    reason: str
    delta: Optional[int] = None
    target_available: Optional[int] = None
    scanned_sns: List[str] = Field(default_factory=list)


@router.get("/wip/stats")
async def get_wip_stats(user=Depends(get_current_user)):
    """Count APower units per visible stage, using QC data live for FQC/shipped."""
    with get_cursor("assembly") as cur:
        cur.execute(
            f"""
            SELECT
              {_EFFECTIVE_STAGE_SQL} AS effective_stage,
              COUNT(*) AS cnt,
              MAX(COALESCE(q.shipped_at, q.fqc_ready_at, s.stage_updated_at, s.scanned_at)) AS last_updated
            FROM assembly.scans s
            LEFT JOIN qc.qc_records q ON q.sn = s.us_sn
            WHERE s.us_sn IS NOT NULL
              AND s.us_sn <> ''
            GROUP BY effective_stage
            """
        )
        rows = cur.fetchall()
        cur.execute(
            """
            SELECT COUNT(*) AS today_shipped
            FROM assembly.scans s
            JOIN qc.qc_records q ON q.sn = s.us_sn
            WHERE timezone('America/Los_Angeles', q.shipped_at)::date =
                  timezone('America/Los_Angeles', NOW())::date
            """
        )
        today_shipped = cur.fetchone()["today_shipped"]
        cur.execute(
            """
            SELECT COUNT(*) AS today_fqc
            FROM assembly.scans s
            JOIN qc.qc_records q ON q.sn = s.us_sn
            WHERE timezone('America/Los_Angeles', q.fqc_ready_at)::date =
                  timezone('America/Los_Angeles', NOW())::date
            """
        )
        today_fqc = cur.fetchone()["today_fqc"]

    counts = {s: 0 for s in VISIBLE_STAGES}
    last_updated = {s: None for s in VISIBLE_STAGES}
    for row in rows:
        stage = row["effective_stage"]
        if stage in counts:
            counts[stage] = row["cnt"]
            if row["last_updated"]:
                last_updated[stage] = row["last_updated"].isoformat()

    return {
        "counts": counts,
        "last_updated": last_updated,
        "total": sum(counts.values()),
        "today_shipped": today_shipped,
        "today_fqc": today_fqc,
    }


@router.get("/wip/apower/list")
async def list_apower_by_stage(
    stage: str = Query(...),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user=Depends(get_current_user),
):
    """Paginated APower cards for one visible stage."""
    if stage not in VISIBLE_STAGES:
        raise HTTPException(400, f"Invalid stage. Must be one of: {VISIBLE_STAGES}")

    with get_cursor("assembly") as cur:
        cur.execute(
            f"""
            SELECT COUNT(*) AS cnt
            FROM assembly.scans s
            LEFT JOIN qc.qc_records q ON q.sn = s.us_sn
            WHERE s.us_sn IS NOT NULL
              AND s.us_sn <> ''
              AND {_EFFECTIVE_STAGE_SQL} = %s
            """,
            (stage,),
        )
        total = cur.fetchone()["cnt"]

        cur.execute(
            f"""
            SELECT
              s.id,
              s.us_sn,
              s.cn_sn,
              s.am7,
              s.au8,
              s.mod_a,
              s.mod_b,
              s.product_line,
              s.apower_stage,
              s.scanned_at,
              s.stage_updated_at,
              s.stage_updated_by,
              s.status AS assy_status,
              s.ng_reason,
              q.fqc_ready_at,
              q.shipped_at,
              {_EFFECTIVE_STAGE_SQL} AS effective_stage,
              p1.stage   AS am7_pcba_stage,
              p1.ng_flag AS am7_ng,
              p1.model   AS am7_model,
              p2.stage   AS au8_pcba_stage,
              p2.ng_flag AS au8_ng,
              p2.model   AS au8_model,
              COALESCE(mp.risk_score, -1) AS risk_score,
              mp.risk_level
            FROM assembly.scans s
            LEFT JOIN qc.qc_records q ON q.sn = s.us_sn
            LEFT JOIN pcba.boards p1
              ON p1.serial_normalized =
                 REPLACE(REPLACE(UPPER(COALESCE(s.am7,'')), '-', ''), ' ', '')
            LEFT JOIN pcba.boards p2
              ON p2.serial_normalized =
                 REPLACE(REPLACE(UPPER(COALESCE(s.au8,'')), '-', ''), ' ', '')
            LEFT JOIN ml.predictions mp ON mp.us_sn = s.us_sn
            WHERE s.us_sn IS NOT NULL
              AND s.us_sn <> ''
              AND {_EFFECTIVE_STAGE_SQL} = %s
            ORDER BY COALESCE(q.shipped_at, q.fqc_ready_at, s.stage_updated_at, s.scanned_at) DESC, s.scanned_at DESC
            LIMIT %s OFFSET %s
            """,
            (stage, limit, offset),
        )
        rows = cur.fetchall()

    return {
        "stage": stage,
        "total": total,
        "offset": offset,
        "limit": limit,
        "items": [_row_to_dict(r) for r in rows],
    }


@router.put("/wip/apower/{us_sn}/stage")
async def advance_stage(
    us_sn: str,
    body: StageAdvanceIn,
    user=Depends(get_current_user),
):
    """Advance or move the editable WIP stage for one APower unit."""
    with get_conn("assembly") as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT id, apower_stage FROM assembly.scans WHERE us_sn=%s",
            (us_sn,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, f"APower unit not found: {us_sn}")

        old_stage = row["apower_stage"] or "assembling"

        if body.new_stage:
            if body.new_stage not in EDITABLE_STAGES:
                raise HTTPException(400, f"Invalid editable stage: {body.new_stage}")
            new_stage = body.new_stage
        else:
            new_stage = VALID_TRANSITIONS.get(old_stage)
            if new_stage is None:
                raise HTTPException(400, f"'{old_stage}' has no next editable stage")

        if new_stage == old_stage:
            return {"us_sn": us_sn, "from_stage": old_stage, "to_stage": new_stage, "unchanged": True}

        cur.execute(
            """UPDATE assembly.scans
               SET apower_stage=%s, stage_updated_at=NOW(), stage_updated_by=%s
               WHERE us_sn=%s""",
            (new_stage, user.username, us_sn),
        )
        cur.execute(
            """INSERT INTO assembly.stage_history
                 (scan_id, from_stage, to_stage, changed_by, notes)
               VALUES (%s,%s,%s,%s,%s)""",
            (row["id"], old_stage, new_stage, user.username, body.notes or ""),
        )

    try:
        await ws_manager.broadcast(
            {
                "type": "wip_stage_update",
                "us_sn": us_sn,
                "from_stage": old_stage,
                "to_stage": new_stage,
                "changed_by": user.username,
            }
        )
    except Exception:
        pass

    return {"us_sn": us_sn, "from_stage": old_stage, "to_stage": new_stage}


@router.get("/wip/pcba/{serial}")
async def find_pcba_location(serial: str, user=Depends(get_current_user)):
    """Reverse lookup: which APower unit is this PCBA in?"""
    norm = serial.replace("-", "").replace(" ", "").upper()
    with get_cursor("assembly") as cur:
        cur.execute(
            """SELECT s.us_sn, s.cn_sn, s.am7, s.au8,
                      s.apower_stage, s.scanned_at, s.product_line
               FROM assembly.scans s
               WHERE REPLACE(REPLACE(UPPER(COALESCE(s.am7,'')),'-',''),' ','') = %s
                  OR REPLACE(REPLACE(UPPER(COALESCE(s.au8,'')),'-',''),' ','') = %s
               LIMIT 1""",
            (norm, norm),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, f"PCBA not found in any APower unit: {serial}")
    result = _row_to_dict(row)
    result["pcba_role"] = (
        "AM7" if row["am7"] and row["am7"].replace("-", "").replace(" ", "").upper() == norm
        else "AU8"
    )
    return result


@router.get("/wip/battery/stats")
async def get_battery_stats(user=Depends(get_current_user)):
    result = _battery_stats_snapshot()
    return {"batteries": list(result.values())}


@router.post("/wip/battery/adjust")
async def adjust_battery_inventory(
    body: BatteryAdjIn,
    user=Depends(get_current_user),
):
    """Manual inventory adjustment. Admin only."""
    if user.role not in ("admin",):
        raise HTTPException(403, "Admin only")
    if body.kind not in ("A", "B"):
        raise HTTPException(400, "kind must be 'A' or 'B'")
    if not body.reason.strip():
        raise HTTPException(400, "reason is required")

    scanned_sns = []
    for sn in body.scanned_sns or []:
        cleaned = _normalize_battery_sn(sn)
        if cleaned:
            scanned_sns.append(cleaned)
    scanned_sns = list(dict.fromkeys(scanned_sns))

    has_target = body.target_available is not None
    using_scan_reconcile = bool(scanned_sns)
    if has_target and body.target_available < 0:
        raise HTTPException(400, "target_available cannot be negative")
    if not using_scan_reconcile and body.delta is None and not has_target:
        raise HTTPException(400, "Provide delta, target_available, or scanned_sns")

    current_stats = _battery_stats_snapshot()
    current_available = int(current_stats[body.kind]["available"])
    target_available = None
    detail_suffix = ""

    if using_scan_reconcile:
        prefix_mismatch = [sn for sn in scanned_sns if _infer_battery_kind(sn) not in (None, body.kind)]

        with get_cursor("model") as cur:
            cur.execute(
                """
                SELECT sn, kind, COALESCE(status, '') AS status
                FROM model.scans
                WHERE sn = ANY(%s)
                """,
                (scanned_sns,),
            )
            rows = cur.fetchall()
        found_map = {row["sn"]: row for row in rows}

        missing = [sn for sn in scanned_sns if sn not in found_map]
        wrong_kind = [sn for sn, row in found_map.items() if row["kind"] != body.kind]
        ng_sns = [sn for sn, row in found_map.items() if (row["status"] or "").upper() == "NG"]

        assy_col = "mod_a" if body.kind == "A" else "mod_b"
        with get_cursor("assembly") as cur:
            cur.execute(
                f"""
                SELECT DISTINCT REPLACE(REPLACE(UPPER({assy_col}), '-', ''), ' ', '') AS sn
                FROM assembly.scans s
                LEFT JOIN qc.qc_records q ON q.sn = s.us_sn
                WHERE {assy_col} IS NOT NULL
                  AND {assy_col} <> ''
                  AND q.shipped_at IS NULL
                  AND REPLACE(REPLACE(UPPER({assy_col}), '-', ''), ' ', '') = ANY(%s)
                """,
                (scanned_sns,),
            )
            consumed = [row["sn"] for row in cur.fetchall()]

        issues = []
        if prefix_mismatch or wrong_kind:
            mixed = list(dict.fromkeys(prefix_mismatch + wrong_kind))
            issues.append(f"wrong type: {', '.join(mixed[:8])}")
        if missing:
            issues.append(f"not in model inventory: {', '.join(missing[:8])}")
        if ng_sns:
            issues.append(f"NG serials: {', '.join(ng_sns[:8])}")
        if consumed:
            issues.append(f"already consumed in assembly: {', '.join(consumed[:8])}")
        if issues:
            raise HTTPException(400, "; ".join(issues))

        target_available = len(scanned_sns)
        detail_suffix = f" | scanned SN reconcile: {target_available} pcs"
    elif has_target:
        target_available = int(body.target_available)
        detail_suffix = f" | set available to {target_available}"

    delta = int(body.delta or 0)
    if target_available is not None:
        delta = target_available - current_available

    if delta == 0:
        return {
            "id": None,
            "kind": body.kind,
            "delta": 0,
            "reason": body.reason.strip(),
            "operator": user.username,
            "created_at": None,
            "current_available": current_available,
            "target_available": current_available,
            "applied": False,
        }

    stored_reason = f"{body.reason.strip()}{detail_suffix}" if detail_suffix else body.reason.strip()

    with get_cursor("model") as cur:
        cur.execute(
            """INSERT INTO model.battery_inventory_adj (kind, delta, reason, operator)
               VALUES (%s,%s,%s,%s)
               RETURNING id, created_at""",
            (body.kind, delta, stored_reason, user.username),
        )
        row = cur.fetchone()

    return {
        "id": row["id"],
        "kind": body.kind,
        "delta": delta,
        "reason": stored_reason,
        "operator": user.username,
        "created_at": row["created_at"].isoformat(),
        "current_available": current_available,
        "target_available": current_available + delta,
        "applied": True,
    }


@router.get("/wip/battery/adj-history")
async def get_battery_adj_history(
    kind: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    user=Depends(get_current_user),
):
    with get_cursor("model") as cur:
        if kind:
            cur.execute(
                """SELECT id, kind, delta, reason, operator, created_at
                   FROM model.battery_inventory_adj
                   WHERE kind=%s ORDER BY created_at DESC LIMIT %s""",
                (kind, limit),
            )
        else:
            cur.execute(
                """SELECT id, kind, delta, reason, operator, created_at
                   FROM model.battery_inventory_adj
                   ORDER BY created_at DESC LIMIT %s""",
                (limit,),
            )
        rows = cur.fetchall()
    return {"items": [_row_to_dict(r) for r in rows]}


@router.post("/wip/backfill")
async def trigger_backfill(user=Depends(get_current_user)):
    """Manually trigger WIP schema ensure and QC->stage sync. Admin only."""
    if user.role not in ("admin",):
        raise HTTPException(403, "Admin only")
    try:
        _ensure_wip_columns()
        sync_result = _sync_qc_wip_stage()
        return {"ok": True, "message": "QC stage sync complete", "sync": sync_result}
    except Exception as e:
        raise HTTPException(500, str(e))
