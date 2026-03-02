# backend/api/monitor.py — System Monitor API (admin-only, PostgreSQL)

import time
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from core.deps import require_admin, get_current_user
from core.ws_manager import ws_manager
from core.monitor_db import get_monitor_conn, log_frontend_error
from core.pg import get_cursor

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/monitor", tags=["System Monitor"])

# Schema list for health checks
PG_SCHEMAS = ["pcba", "assembly", "model", "auth", "downtime", "documents", "monitor", "qc"]

_APP_START_TIME = time.time()


# ── Models ──
class FrontendErrorReport(BaseModel):
    timestamp: Optional[str] = None
    component: Optional[str] = None
    error_message: str
    stack: Optional[str] = None
    url: Optional[str] = None


# ── Health ──
@router.get("/health", dependencies=[Depends(require_admin)])
async def health():
    import psutil

    schemas = []
    healthy_count = 0
    for schema_name in PG_SCHEMAS:
        info = {"name": schema_name, "status": "unknown"}
        try:
            with get_cursor(schema_name) as cur:
                # Check schema exists and has tables
                cur.execute(
                    "SELECT COUNT(*) AS cnt FROM information_schema.tables "
                    "WHERE table_schema = %s AND table_type = 'BASE TABLE'",
                    (schema_name,)
                )
                row = cur.fetchone()
                table_count = row["cnt"] if row else 0
                info["status"] = "ok"
                info["table_count"] = table_count
                healthy_count += 1
        except Exception as e:
            info["status"] = "error"
            info["error"] = str(e)
        schemas.append(info)

    mem = psutil.virtual_memory()
    uptime_seconds = int(time.time() - _APP_START_TIME)

    return {
        "databases": schemas,
        "healthy_db_count": healthy_count,
        "total_db_count": len(PG_SCHEMAS),
        "ws_connections": len(ws_manager.active),
        "memory": {
            "total_mb": round(mem.total / (1024 * 1024)),
            "used_mb": round(mem.used / (1024 * 1024)),
            "percent": mem.percent,
        },
        "uptime_seconds": uptime_seconds,
    }


# ── WebSocket Stats ──
@router.get("/ws-stats", dependencies=[Depends(require_admin)])
async def ws_stats():
    return ws_manager.get_stats()


# ── API Logs ──
@router.get("/api-logs", dependencies=[Depends(require_admin)])
async def api_logs(
    path: Optional[str] = None,
    user: Optional[str] = None,
    status_code: Optional[int] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
):
    limit = min(limit, 200)
    offset = (page - 1) * limit

    conditions = []
    params = []
    if path:
        conditions.append("path LIKE %s")
        params.append(f"%{path}%")
    if user:
        conditions.append("username = %s")
        params.append(user)
    if status_code:
        conditions.append("status_code = %s")
        params.append(status_code)
    if start:
        conditions.append("occurred_at >= %s")
        params.append(start)
    if end:
        conditions.append("occurred_at <= %s")
        params.append(end)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    with get_monitor_conn() as conn:
        import psycopg2.extras
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(f"SELECT COUNT(*) AS cnt FROM api_logs {where}", params)
        total = cur.fetchone()["cnt"]
        cur.execute(
            f"SELECT * FROM api_logs {where} ORDER BY id DESC LIMIT %s OFFSET %s",
            params + [limit, offset]
        )
        rows = cur.fetchall()
        cur.close()

    return {"total": total, "page": page, "limit": limit, "records": [dict(r) for r in rows]}


# ── API Stats ──
@router.get("/api-stats", dependencies=[Depends(require_admin)])
async def api_stats(start: Optional[str] = None, end: Optional[str] = None):
    conditions = []
    params = []
    if start:
        conditions.append("occurred_at >= %s")
        params.append(start)
    if end:
        conditions.append("occurred_at <= %s")
        params.append(end)
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    where_with_duration = (
        f"{where} {'AND' if where else 'WHERE'} duration_ms IS NOT NULL"
    )

    with get_monitor_conn() as conn:
        import psycopg2.extras
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        cur.execute(f"""
            SELECT
                COUNT(*) AS total_requests,
                SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END) AS error_count
            FROM api_logs {where}
        """, params)
        row = cur.fetchone()

        total = row["total_requests"] or 0
        errors = row["error_count"] or 0

        cur.execute(
            f"SELECT COUNT(*) AS cnt FROM api_logs {where_with_duration}",
            params,
        )
        n = int(cur.fetchone()["cnt"] or 0)

        def percentile(pct: int) -> float:
            if n == 0:
                return 0
            idx = min(int((n - 1) * (pct / 100.0)), n - 1)
            cur.execute(
                f"""
                SELECT duration_ms
                FROM api_logs {where_with_duration}
                ORDER BY duration_ms ASC
                LIMIT 1 OFFSET %s
                """,
                [*params, idx],
            )
            row_p = cur.fetchone()
            return round(float(row_p["duration_ms"]), 2) if row_p and row_p["duration_ms"] is not None else 0

        result = {
            "total_requests": total,
            "error_count": errors,
            "error_rate": round(errors / total * 100, 2) if total else 0,
            "p50": percentile(50),
            "p95": percentile(95),
            "p99": percentile(99),
        }
        cur.close()

    return result


# ── Top Slow ──
@router.get("/api-stats/top-slow", dependencies=[Depends(require_admin)])
async def top_slow(limit: int = 10):
    limit = min(limit, 50)
    with get_monitor_conn() as conn:
        import psycopg2.extras
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            SELECT path, method,
                   ROUND(AVG(duration_ms)::numeric, 2) AS avg_ms,
                   ROUND(MAX(duration_ms)::numeric, 2) AS max_ms,
                   COUNT(*) AS call_count
            FROM api_logs
            GROUP BY path, method
            ORDER BY avg_ms DESC
            LIMIT %s
        """, (limit,))
        rows = cur.fetchall()
        cur.close()
    return [dict(r) for r in rows]


# ── Audit Logs ──
@router.get("/audit-logs", dependencies=[Depends(require_admin)])
async def audit_logs(
    user: Optional[str] = None,
    action: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
):
    limit = min(limit, 200)
    offset = (page - 1) * limit

    conditions = []
    params = []
    if user:
        conditions.append("username = %s")
        params.append(user)
    if action:
        conditions.append("action = %s")
        params.append(action)
    if start:
        conditions.append("occurred_at >= %s")
        params.append(start)
    if end:
        conditions.append("occurred_at <= %s")
        params.append(end)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    with get_monitor_conn() as conn:
        import psycopg2.extras
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(f"SELECT COUNT(*) AS cnt FROM audit_logs {where}", params)
        total = cur.fetchone()["cnt"]
        cur.execute(
            f"SELECT * FROM audit_logs {where} ORDER BY id DESC LIMIT %s OFFSET %s",
            params + [limit, offset]
        )
        rows = cur.fetchall()
        cur.close()

    return {"total": total, "page": page, "limit": limit, "records": [dict(r) for r in rows]}


# ── Frontend Errors ──
@router.get("/frontend-errors", dependencies=[Depends(require_admin)])
async def frontend_errors(page: int = 1, limit: int = 50):
    limit = min(limit, 200)
    offset = (page - 1) * limit

    with get_monitor_conn() as conn:
        import psycopg2.extras
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT COUNT(*) AS cnt FROM frontend_errors")
        total = cur.fetchone()["cnt"]
        cur.execute(
            "SELECT * FROM frontend_errors ORDER BY id DESC LIMIT %s OFFSET %s",
            (limit, offset)
        )
        rows = cur.fetchall()
        cur.close()

    return {"total": total, "page": page, "limit": limit, "records": [dict(r) for r in rows]}


@router.post("/frontend-error", dependencies=[Depends(get_current_user)])
async def report_frontend_error(body: FrontendErrorReport, user=Depends(get_current_user)):
    username = getattr(user, "username", None) or "unknown"
    log_frontend_error(
        error_message=body.error_message,
        component=body.component,
        stack=body.stack,
        user=username,
        url=body.url,
    )
    return {"status": "ok"}
