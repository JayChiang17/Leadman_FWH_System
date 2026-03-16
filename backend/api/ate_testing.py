# backend/api/ate_testing.py
# ATE Testing - NG Management API (PostgreSQL)

import asyncio

from fastapi import APIRouter, HTTPException, Depends, Request
from typing import Optional, List, Dict, Any
from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo
import logging

import psycopg2
import psycopg2.extras

from core.deps import require_roles, get_current_user
from core.ws_manager import ws_manager
from core.monitor_db import log_audit
from core.pg import get_conn, get_cursor
from pydantic import BaseModel

# ─────────────────────────── Setup ───────────────────────────
logger = logging.getLogger(__name__)
router = APIRouter(tags=["ate_testing"], prefix="/ate")

TZ = ZoneInfo("America/Los_Angeles")
SCHEMA = "assembly"

# ─────────────────────────── Performance: Cache ───────────────────────────
from core.cache_utils import TTLCache
_STATS_CACHE = TTLCache(ttl_seconds=3)

# ─────────────────────────── Models ───────────────────────────
class MarkNGRequest(BaseModel):
    us_sn: str
    reason: str

class ClearNGRequest(BaseModel):
    us_sn: str
    module_a: Optional[str] = None
    module_b: Optional[str] = None
    pcba_au8: Optional[str] = None
    pcba_am7: Optional[str] = None

class ScanResponse(BaseModel):
    exists: bool
    record: Optional[Dict[str, Any]] = None
    message: str

class StatsResponse(BaseModel):
    ng_count: int
    fixed_count: int
    pass_rate: float
    total_today: int

# ─────────────────────────── Endpoints ───────────────────────────

@router.get("/stats", response_model=StatsResponse, summary="Get today's NG statistics")
async def get_today_stats(user=Depends(get_current_user)):
    today = datetime.now(TZ).date()
    cache_key = f"ate_stats:{today}"
    cached = _STATS_CACHE.get(cache_key)
    if cached:
        return cached

    try:
        start_ts = today.strftime("%Y-%m-%d 00:00:00")
        end_ts = (today + timedelta(days=1)).strftime("%Y-%m-%d 00:00:00")

        with get_cursor(SCHEMA) as cur:
            cur.execute("""
                SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN UPPER(status) = 'NG' THEN 1 ELSE 0 END) AS ng_count,
                    SUM(CASE WHEN UPPER(status) = 'FIXED' THEN 1 ELSE 0 END) AS fixed_count
                FROM scans
                WHERE scanned_at >= %s AND scanned_at < %s
            """, (start_ts, end_ts))
            row = cur.fetchone()

        total = int(row["total"] or 0)
        ng_count = int(row["ng_count"] or 0)
        fixed_count = int(row["fixed_count"] or 0)

        ok_count = total - ng_count - fixed_count
        pass_rate = round((ok_count / total * 100) if total > 0 else 100.0, 1)

        result = StatsResponse(
            ng_count=ng_count,
            fixed_count=fixed_count,
            pass_rate=pass_rate,
            total_today=total
        )

        _STATS_CACHE.set(cache_key, result)
        return result

    except Exception as e:
        logger.error(f"Error fetching ATE stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/scan/{us_sn}", response_model=ScanResponse, summary="Verify SN exists in assembly DB")
async def scan_sn(us_sn: str, user=Depends(require_roles("admin", "operator"))):
    if not us_sn or not us_sn.strip():
        raise HTTPException(status_code=400, detail="US SN cannot be empty")

    us_sn = us_sn.strip()

    try:
        with get_cursor(SCHEMA) as cur:
            cur.execute("""
                SELECT id, scanned_at AS timestamp, cn_sn AS china_sn, us_sn,
                       mod_a AS module_a, mod_b AS module_b,
                       au8 AS pcba_au8, am7 AS pcba_am7,
                       status, ng_reason, product_line
                FROM scans
                WHERE us_sn = %s
            """, (us_sn,))
            row = cur.fetchone()

        if not row:
            return ScanResponse(
                exists=False,
                record=None,
                message=f"Serial number {us_sn} not found in assembly database"
            )

        record = dict(row)
        return ScanResponse(
            exists=True,
            record=record,
            message=f"Record found for {us_sn}"
        )

    except Exception as e:
        logger.error(f"Error scanning SN {us_sn}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/mark_ng", summary="Mark assembly record as NG")
async def mark_ng(body: MarkNGRequest, request: Request = None, user=Depends(require_roles("admin", "operator"))):
    if not body.us_sn or not body.us_sn.strip():
        raise HTTPException(status_code=400, detail="US SN cannot be empty")

    if not body.reason or not body.reason.strip():
        raise HTTPException(status_code=400, detail="NG reason cannot be empty")

    us_sn = body.us_sn.strip()
    reason = body.reason.strip()

    try:
        with get_conn(SCHEMA) as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

            cur.execute("SELECT 1 FROM scans WHERE us_sn = %s", (us_sn,))
            if not cur.fetchone():
                cur.close()
                raise HTTPException(status_code=404, detail=f"Serial number {us_sn} not found")

            cur.execute("""
                UPDATE scans
                SET status = 'NG', ng_reason = %s
                WHERE us_sn = %s
            """, (reason, us_sn))

            if cur.rowcount == 0:
                cur.close()
                raise HTTPException(status_code=404, detail=f"Failed to update {us_sn}")

            cur.close()

        _STATS_CACHE.clear()

        await ws_manager.broadcast({
            "event": "assembly_status_updated",
            "timestamp": datetime.now(TZ).strftime("%Y-%m-%d %H:%M:%S"),
            "us_sn": us_sn,
            "status": "NG",
            "reason": reason
        })

        # Trigger ML counter (non-blocking background task)
        try:
            from ml.ng_trigger import record_new_ng
            asyncio.create_task(record_new_ng(us_sn, reason, None))
        except Exception:
            pass  # ML is optional; never break the main flow

        uname = getattr(user, "username", "unknown")
        logger.info(f"ATE: Marked {us_sn} as NG by {uname}")
        log_audit(user=uname, action="ate_ng_mark", target=us_sn, new_value=reason,
                  ip=request.client.host if request and request.client else None)

        return {
            "status": "success",
            "message": f"Successfully marked {us_sn} as NG"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error marking NG for {us_sn}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/clear_ng", summary="Clear NG status (mark as FIXED)")
async def clear_ng(body: ClearNGRequest, request: Request = None, user=Depends(require_roles("admin", "operator"))):
    if not body.us_sn or not body.us_sn.strip():
        raise HTTPException(status_code=400, detail="US SN cannot be empty")

    us_sn = body.us_sn.strip()

    try:
        with get_conn(SCHEMA) as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

            cur.execute("SELECT status FROM scans WHERE us_sn = %s", (us_sn,))
            row = cur.fetchone()

            if not row:
                cur.close()
                raise HTTPException(status_code=404, detail=f"Serial number {us_sn} not found")

            if (row["status"] or "").upper() != "NG":
                cur.close()
                raise HTTPException(
                    status_code=400,
                    detail=f"{us_sn} is not marked as NG (current status: {row['status'] or 'OK'})"
                )

            updates = ["status = 'FIXED'"]
            params = []

            def add_update(column: str, value: Optional[str]) -> None:
                if value is None:
                    return
                trimmed = value.strip()
                if not trimmed:
                    return
                updates.append(f"{column} = %s")
                params.append(trimmed)

            add_update("mod_a", body.module_a)
            add_update("mod_b", body.module_b)
            add_update("au8", body.pcba_au8)
            add_update("am7", body.pcba_am7)

            params.append(us_sn)
            cur.execute(
                f"""
                UPDATE scans
                SET {", ".join(updates)}
                WHERE us_sn = %s AND UPPER(status) = 'NG'
                """,
                params,
            )

            if cur.rowcount == 0:
                cur.close()
                raise HTTPException(status_code=400, detail=f"Failed to clear NG for {us_sn}")

            cur.close()

        _STATS_CACHE.clear()

        await ws_manager.broadcast({
            "event": "assembly_status_updated",
            "timestamp": datetime.now(TZ).strftime("%Y-%m-%d %H:%M:%S"),
            "us_sn": us_sn,
            "status": "FIXED"
        })

        uname = getattr(user, "username", "unknown")
        logger.info(f"ATE: Cleared NG for {us_sn} by {uname}")
        log_audit(user=uname, action="ate_ng_clear", target=us_sn,
                  ip=request.client.host if request and request.client else None)

        return {
            "status": "success",
            "message": f"Successfully cleared NG status for {us_sn}"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error clearing NG for {us_sn}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/recent", summary="Get recent NG records")
async def get_recent_ng(
    limit: int = 50,
    include_fixed: bool = True,
    user=Depends(get_current_user)
):
    if limit < 1 or limit > 200:
        raise HTTPException(status_code=400, detail="Limit must be between 1 and 200")

    try:
        if include_fixed:
            status_cond = "UPPER(status) IN ('NG', 'FIXED')"
        else:
            status_cond = "UPPER(status) = 'NG'"

        with get_cursor(SCHEMA) as cur:
            cur.execute(f"""
                SELECT id, scanned_at AS timestamp, us_sn, cn_sn AS china_sn,
                       status, ng_reason, product_line
                FROM scans
                WHERE {status_cond}
                ORDER BY scanned_at DESC
                LIMIT %s
            """, (limit,))
            rows = cur.fetchall()

        records = [dict(row) for row in rows]

        return {
            "status": "success",
            "count": len(records),
            "records": records
        }

    except Exception as e:
        logger.error(f"Error fetching recent NG records: {e}")
        raise HTTPException(status_code=500, detail=str(e))
