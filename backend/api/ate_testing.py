# backend/api/ate_testing.py
# ATE Testing - NG Management API
# Provides endpoints for ATE testing operators to mark/clear NG status

from fastapi import APIRouter, HTTPException, Depends
from typing import Optional, List, Dict, Any
from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo
import sqlite3
import logging
from pathlib import Path

from core.deps import require_roles, get_current_user
from core.ws_manager import ws_manager
from pydantic import BaseModel

# ─────────────────────────── Setup ───────────────────────────
logger = logging.getLogger(__name__)
router = APIRouter(tags=["ate_testing"], prefix="/ate")

TZ = ZoneInfo("America/Los_Angeles")

# Database path resolution (same as assembly_inventory.py)
def _get_db_path() -> Path:
    """Get absolute path to assembly.db in backend directory"""
    return Path(__file__).parent.parent / "assembly.db"

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

# ─────────────────────────── Database Helper ───────────────────────────
def get_db_connection() -> sqlite3.Connection:
    """Open connection to assembly.db with proper path resolution"""
    db_path = _get_db_path()
    if not db_path.exists():
        raise RuntimeError(f"Database not found at {db_path}")

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn

# ─────────────────────────── Endpoints ───────────────────────────

@router.get("/stats", response_model=StatsResponse, summary="Get today's NG statistics")
async def get_today_stats(user=Depends(get_current_user)):
    """
    Returns today's NG statistics:
    - ng_count: Records marked as NG (not fixed)
    - fixed_count: Records that were NG and now fixed
    - pass_rate: Percentage of OK records
    - total_today: Total records scanned today
    """
    try:
        conn = get_db_connection()

        # Get today's date range
        today = datetime.now(TZ).date()
        start_ts = today.strftime("%Y-%m-%d 00:00:00")
        end_ts = (today + timedelta(days=1)).strftime("%Y-%m-%d 00:00:00")

        # Query today's stats
        row = conn.execute("""
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN UPPER(status) = 'NG' THEN 1 ELSE 0 END) AS ng_count,
                SUM(CASE WHEN UPPER(status) = 'FIXED' THEN 1 ELSE 0 END) AS fixed_count
            FROM scans
            WHERE ts >= ? AND ts < ?
        """, (start_ts, end_ts)).fetchone()

        total = int(row["total"] or 0)
        ng_count = int(row["ng_count"] or 0)
        fixed_count = int(row["fixed_count"] or 0)

        # Calculate pass rate (OK records / total)
        ok_count = total - ng_count - fixed_count
        pass_rate = round((ok_count / total * 100) if total > 0 else 100.0, 1)

        conn.close()

        return StatsResponse(
            ng_count=ng_count,
            fixed_count=fixed_count,
            pass_rate=pass_rate,
            total_today=total
        )

    except Exception as e:
        logger.error(f"Error fetching ATE stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/scan/{us_sn}", response_model=ScanResponse, summary="Verify SN exists in assembly DB")
async def scan_sn(us_sn: str, user=Depends(require_roles("admin", "operator"))):
    """
    Check if a US SN exists in the assembly database.
    Returns record details if found, error if not found.
    """
    if not us_sn or not us_sn.strip():
        raise HTTPException(status_code=400, detail="US SN cannot be empty")

    us_sn = us_sn.strip()

    try:
        conn = get_db_connection()

        row = conn.execute("""
            SELECT id, ts AS timestamp, cn_sn AS china_sn, us_sn,
                   mod_a AS module_a, mod_b AS module_b,
                   au8 AS pcba_au8, am7 AS pcba_am7,
                   status, ng_reason, product_line
            FROM scans
            WHERE us_sn = ?
        """, (us_sn,)).fetchone()

        conn.close()

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
async def mark_ng(body: MarkNGRequest, user=Depends(require_roles("admin", "operator"))):
    """
    Mark an assembly record as NG with reason.
    Reuses the existing assembly_inventory mark_ng logic.
    """
    if not body.us_sn or not body.us_sn.strip():
        raise HTTPException(status_code=400, detail="US SN cannot be empty")

    if not body.reason or not body.reason.strip():
        raise HTTPException(status_code=400, detail="NG reason cannot be empty")

    us_sn = body.us_sn.strip()
    reason = body.reason.strip()

    try:
        conn = get_db_connection()

        # Check if record exists
        exists = conn.execute("SELECT 1 FROM scans WHERE us_sn = ?", (us_sn,)).fetchone()
        if not exists:
            conn.close()
            raise HTTPException(status_code=404, detail=f"Serial number {us_sn} not found")

        # Update status to NG
        cursor = conn.execute("""
            UPDATE scans
            SET status = 'NG', ng_reason = ?
            WHERE us_sn = ?
        """, (reason, us_sn))

        conn.commit()

        if cursor.rowcount == 0:
            conn.close()
            raise HTTPException(status_code=404, detail=f"Failed to update {us_sn}")

        conn.close()

        # Broadcast WebSocket update
        await ws_manager.broadcast({
            "event": "assembly_status_updated",
            "timestamp": datetime.now(TZ).strftime("%Y-%m-%d %H:%M:%S"),
            "us_sn": us_sn,
            "status": "NG",
            "reason": reason
        })

        logger.info(f"ATE: Marked {us_sn} as NG by {user.get('username', 'unknown')}")

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
async def clear_ng(body: ClearNGRequest, user=Depends(require_roles("admin", "operator"))):
    """
    Clear NG status by marking record as FIXED.
    Reuses the existing assembly_inventory clear_ng logic.
    """
    if not body.us_sn or not body.us_sn.strip():
        raise HTTPException(status_code=400, detail="US SN cannot be empty")

    us_sn = body.us_sn.strip()

    try:
        conn = get_db_connection()

        # Check if record exists and is NG
        row = conn.execute("""
            SELECT status FROM scans WHERE us_sn = ?
        """, (us_sn,)).fetchone()

        if not row:
            conn.close()
            raise HTTPException(status_code=404, detail=f"Serial number {us_sn} not found")

        if (row["status"] or "").upper() != "NG":
            conn.close()
            raise HTTPException(
                status_code=400,
                detail=f"{us_sn} is not marked as NG (current status: {row['status'] or 'OK'})"
            )

        # Update status to FIXED, optionally update module/pcba SNs
        updates = ["status = 'FIXED'"]
        params = []

        def add_update(column: str, value: Optional[str]) -> None:
            if value is None:
                return
            trimmed = value.strip()
            if not trimmed:
                return
            updates.append(f"{column} = ?")
            params.append(trimmed)

        add_update("mod_a", body.module_a)
        add_update("mod_b", body.module_b)
        add_update("au8", body.pcba_au8)
        add_update("am7", body.pcba_am7)

        params.append(us_sn)
        cursor = conn.execute(
            f"""
            UPDATE scans
            SET {", ".join(updates)}
            WHERE us_sn = ? AND UPPER(status) = 'NG'
            """,
            params,
        )

        conn.commit()

        if cursor.rowcount == 0:
            conn.close()
            raise HTTPException(status_code=400, detail=f"Failed to clear NG for {us_sn}")

        conn.close()

        # Broadcast WebSocket update
        await ws_manager.broadcast({
            "event": "assembly_status_updated",
            "timestamp": datetime.now(TZ).strftime("%Y-%m-%d %H:%M:%S"),
            "us_sn": us_sn,
            "status": "FIXED"
        })

        logger.info(f"ATE: Cleared NG for {us_sn} by {user.get('username', 'unknown')}")

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
    """
    Get recent NG records (with optional fixed records).
    Default limit: 50 records.
    """
    if limit < 1 or limit > 200:
        raise HTTPException(status_code=400, detail="Limit must be between 1 and 200")

    try:
        conn = get_db_connection()

        # Build status condition
        if include_fixed:
            status_cond = "UPPER(status) IN ('NG', 'FIXED')"
        else:
            status_cond = "UPPER(status) = 'NG'"

        rows = conn.execute(f"""
            SELECT id, ts AS timestamp, us_sn, cn_sn AS china_sn,
                   status, ng_reason, product_line
            FROM scans
            WHERE {status_cond}
            ORDER BY ts DESC
            LIMIT ?
        """, (limit,)).fetchall()

        conn.close()

        records = [dict(row) for row in rows]

        return {
            "status": "success",
            "count": len(records),
            "records": records
        }

    except Exception as e:
        logger.error(f"Error fetching recent NG records: {e}")
        raise HTTPException(status_code=500, detail=str(e))
