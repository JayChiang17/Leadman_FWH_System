# backend/api/monitor.py - System Monitor API (admin-only, PostgreSQL)

import asyncio
import time
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from core.deps import require_admin, get_current_user
from core.ws_manager import ws_manager
from core.monitor_db import get_monitor_conn, log_frontend_error
from core.pg import get_cursor

try:
    import psutil as _psutil
    _PSUTIL_OK = True
except ImportError:
    _psutil = None
    _PSUTIL_OK = False

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/monitor", tags=["System Monitor"])

# Schema list for health checks
PG_SCHEMAS = ["pcba", "assembly", "model", "auth", "downtime", "documents", "monitor", "qc"]

_APP_START_TIME = time.time()

def _safe_pct(numerator: float, denominator: float) -> float:
    if not denominator:
        return 0.0
    return round((numerator / denominator) * 100.0, 2)



# Models
class FrontendErrorReport(BaseModel):
    timestamp: Optional[str] = None
    component: Optional[str] = None
    error_message: str
    stack: Optional[str] = None
    url: Optional[str] = None


# Health
@router.get("/health", dependencies=[Depends(require_admin)])
async def health():
    health_start = time.perf_counter()
    schemas = []
    healthy_count = 0
    schema_size_map: dict[str, int] = {}
    tables: list[dict] = []
    db_size_bytes = 0
    db_size_pretty = "0 bytes"
    connection_count = 0
    max_connections = 0
    cache_hit_percent = 0.0
    deadlocks = 0
    temp_bytes = 0
    temp_size_pretty = "0 bytes"

    for schema_name in PG_SCHEMAS:
        info = {"name": schema_name, "status": "unknown"}
        try:
            with get_cursor(schema_name) as cur:
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

    try:
        with get_cursor("monitor") as cur:
            cur.execute(
                """
                SELECT
                    pg_database_size(current_database()) AS db_size_bytes,
                    pg_size_pretty(pg_database_size(current_database())) AS db_size_pretty
                """
            )
            db_size_row = cur.fetchone() or {}
            db_size_bytes = int(db_size_row.get("db_size_bytes") or 0)
            db_size_pretty = db_size_row.get("db_size_pretty") or "0 bytes"

            cur.execute("SELECT setting::int AS max_connections FROM pg_settings WHERE name = 'max_connections'")
            max_connections = int((cur.fetchone() or {}).get("max_connections") or 0)

            cur.execute("SELECT COUNT(*) AS cnt FROM pg_stat_activity WHERE datname = current_database()")
            connection_count = int((cur.fetchone() or {}).get("cnt") or 0)

            cur.execute(
                """
                SELECT
                    blks_read,
                    blks_hit,
                    deadlocks,
                    temp_bytes
                FROM pg_stat_database
                WHERE datname = current_database()
                """
            )
            stat_row = cur.fetchone() or {}
            blks_read = int(stat_row.get("blks_read") or 0)
            blks_hit = int(stat_row.get("blks_hit") or 0)
            deadlocks = int(stat_row.get("deadlocks") or 0)
            temp_bytes = int(stat_row.get("temp_bytes") or 0)
            cache_hit_percent = _safe_pct(blks_hit, blks_hit + blks_read)
            cur.execute("SELECT pg_size_pretty(%s::bigint) AS pretty", (temp_bytes,))
            temp_size_pretty = (cur.fetchone() or {}).get("pretty") or "0 bytes"

            cur.execute(
                """
                SELECT
                    n.nspname AS schema_name,
                    c.relname AS table_name,
                    COALESCE(s.n_live_tup, c.reltuples)::bigint AS estimated_rows,
                    pg_relation_size(c.oid) AS table_bytes,
                    pg_indexes_size(c.oid) AS index_bytes,
                    pg_total_relation_size(c.oid) AS total_bytes,
                    pg_size_pretty(pg_relation_size(c.oid)) AS table_size_pretty,
                    pg_size_pretty(pg_indexes_size(c.oid)) AS index_size_pretty,
                    pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size_pretty
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
                WHERE c.relkind = 'r' AND n.nspname = ANY(%s)
                ORDER BY pg_total_relation_size(c.oid) DESC, n.nspname ASC, c.relname ASC
                """,
                (PG_SCHEMAS,),
            )
            rows = cur.fetchall() or []
            for row in rows:
                item = dict(row)
                schema_of_table = item.get("schema_name")
                total_bytes = int(item.get("total_bytes") or 0)
                if schema_of_table:
                    schema_size_map[schema_of_table] = schema_size_map.get(schema_of_table, 0) + total_bytes
                tables.append(item)
    except Exception:
        logger.exception("Failed to collect DB capacity metrics for monitor/health")

    for info in schemas:
        size_bytes = int(schema_size_map.get(info["name"], 0) or 0)
        info["total_size_bytes"] = size_bytes
        info["total_size_pretty"] = "0 bytes"

    if schema_size_map:
        try:
            with get_cursor("monitor") as cur:
                for info in schemas:
                    cur.execute("SELECT pg_size_pretty(%s::bigint) AS pretty", (info["total_size_bytes"],))
                    pretty_row = cur.fetchone() or {}
                    info["total_size_pretty"] = pretty_row.get("pretty") or "0 bytes"
        except Exception:
            logger.exception("Failed to format schema size for monitor/health")

    uptime_seconds = int(time.time() - _APP_START_TIME)

    if _PSUTIL_OK:
        mem = _psutil.virtual_memory()
        memory = {
            "total_mb": round(mem.total / (1024 * 1024)),
            "used_mb": round(mem.used / (1024 * 1024)),
            "percent": mem.percent,
        }
    else:
        memory = {"total_mb": 0, "used_mb": 0, "percent": 0}

    conn_usage_percent = _safe_pct(connection_count, max_connections)
    health_status = "ok" if healthy_count == len(PG_SCHEMAS) else "degraded"
    response_ms = round((time.perf_counter() - health_start) * 1000, 2)

    return {
        "databases": schemas,
        "healthy_db_count": healthy_count,
        "total_db_count": len(PG_SCHEMAS),
        "ws_connections": len(ws_manager.active),
        "memory": memory,
        "uptime_seconds": uptime_seconds,
        "database_health": {
            "status": health_status,
            "response_ms": response_ms,
            "connection_count": connection_count,
            "max_connections": max_connections,
            "connection_usage_percent": conn_usage_percent,
            "cache_hit_percent": cache_hit_percent,
            "deadlocks": deadlocks,
            "temp_bytes": temp_bytes,
            "temp_size_pretty": temp_size_pretty,
        },
        "database_capacity": {
            "database_size_bytes": db_size_bytes,
            "database_size_pretty": db_size_pretty,
            "table_count": len(tables),
            "tables": tables,
        },
    }


@router.get("/ws-stats", dependencies=[Depends(require_admin)])
async def ws_stats():
    return ws_manager.get_stats()


# API Logs
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


# API Stats
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
            f"""
            SELECT
                percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) AS p50,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
                percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99
            FROM api_logs {where_with_duration}
            """,
            params,
        )
        prow = cur.fetchone()
        p50 = round(float(prow["p50"]), 2) if prow and prow["p50"] is not None else 0
        p95 = round(float(prow["p95"]), 2) if prow and prow["p95"] is not None else 0
        p99 = round(float(prow["p99"]), 2) if prow and prow["p99"] is not None else 0

        result = {
            "total_requests": total,
            "error_count": errors,
            "error_rate": round(errors / total * 100, 2) if total else 0,
            "p50": p50,
            "p95": p95,
            "p99": p99,
        }
        cur.close()

    return result


# Top Slow
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


# Audit Logs
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


# Frontend Errors
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


# ── Docker Monitor (uses Python docker SDK via mounted socket) ──────────

def _fmt_bytes(n: float) -> str:
    """Format a raw byte count into a human-readable string."""
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if n < 1024 or unit == "TiB":
            return f"{n:.2f} {unit}"
        n /= 1024


def _docker_stats_fmt(container) -> dict:
    """
    Fetch a single stats snapshot for a running container via the SDK
    and return pre-formatted strings matching the docker CLI style.
    """
    empty = {"cpu_pct": "-", "mem_usage": "-", "mem_pct": "-",
             "net_io": "-", "block_io": "-", "pids": "-"}
    try:
        s = container.stats(stream=False)
    except Exception:
        return empty

    # CPU %
    try:
        cpu_d  = (s["cpu_stats"]["cpu_usage"]["total_usage"]
                  - s["precpu_stats"]["cpu_usage"]["total_usage"])
        sys_d  = (s["cpu_stats"]["system_cpu_usage"]
                  - s["precpu_stats"]["system_cpu_usage"])
        ncpus  = (s["cpu_stats"].get("online_cpus")
                  or len(s["cpu_stats"]["cpu_usage"].get("percpu_usage") or [1]))
        cpu_pct = round(cpu_d / sys_d * ncpus * 100, 2) if sys_d > 0 else 0.0
    except (KeyError, TypeError, ZeroDivisionError):
        cpu_pct = 0.0

    # Memory  (Docker 20.10+ uses inactive_file for cache)
    try:
        mem      = s.get("memory_stats", {})
        mem_use  = mem.get("usage", 0)
        cache    = (mem.get("stats") or {}).get("inactive_file", 0)
        mem_act  = max(mem_use - cache, 0)
        mem_lim  = mem.get("limit", 1)
        mem_pct  = round(mem_act / mem_lim * 100, 2) if mem_lim else 0.0
        mem_str  = f"{_fmt_bytes(mem_act)} / {_fmt_bytes(mem_lim)}"
    except (KeyError, TypeError):
        mem_pct, mem_str = 0.0, "-"

    # Network I/O
    try:
        rx = tx = 0
        for iface in (s.get("networks") or {}).values():
            rx += iface.get("rx_bytes", 0)
            tx += iface.get("tx_bytes", 0)
        net_str = f"{_fmt_bytes(rx)} / {_fmt_bytes(tx)}"
    except (TypeError, AttributeError):
        net_str = "-"

    # Block I/O
    try:
        blk_r = blk_w = 0
        for entry in (s.get("blkio_stats", {}).get("io_service_bytes_recursive") or []):
            op = (entry.get("op") or "").lower()
            if op == "read":
                blk_r += entry.get("value", 0)
            elif op == "write":
                blk_w += entry.get("value", 0)
        blk_str = f"{_fmt_bytes(blk_r)} / {_fmt_bytes(blk_w)}"
    except (TypeError, AttributeError):
        blk_str = "-"

    pids = str((s.get("pids_stats") or {}).get("current") or "-")

    return {
        "cpu_pct":   f"{cpu_pct:.2f}%",
        "mem_usage": mem_str,
        "mem_pct":   f"{mem_pct:.1f}%",
        "net_io":    net_str,
        "block_io":  blk_str,
        "pids":      pids,
    }


@router.get("/docker", dependencies=[Depends(require_admin)])
async def docker_monitor():
    try:
        import docker as _docker
    except ImportError:
        return {
            "available": False,
            "error": "Python 'docker' package not installed. Run: pip install docker",
            "containers": [], "total": 0, "running": 0, "exited": 0, "paused": 0,
        }

    # Use explicit socket URL + 5 s timeout per request (avoids hanging)
    try:
        client = _docker.DockerClient(
            base_url="unix:///var/run/docker.sock", timeout=5
        )
        client.ping()
    except Exception as exc:
        return {
            "available": False,
            "error": (
                f"Cannot connect to Docker daemon: {exc}. "
                "Ensure /var/run/docker.sock is mounted into this container."
            ),
            "containers": [], "total": 0, "running": 0, "exited": 0, "paused": 0,
        }

    containers = []
    try:
        raw_list = client.containers.list(all=True)

        # ── Build base info (no stats yet) ────────────────────────────────
        base_infos  = []   # dicts without stats
        running_idx = []   # indices of running containers needing stats

        for c in raw_list:
            try:
                tags = c.image.tags
                image_tag = tags[0] if tags else c.image.short_id
            except Exception:
                image_tag = "-"

            try:
                parts = []
                for cport, bindings in (c.ports or {}).items():
                    if bindings:
                        for b in bindings:
                            parts.append(
                                f"{b.get('HostIp','0.0.0.0')}:{b.get('HostPort','')}→{cport}"
                            )
                ports_str = "  ".join(parts)
            except Exception:
                ports_str = ""

            state       = (c.status or "").lower()
            created_raw = c.attrs.get("Created", "-")
            created     = created_raw[:19].replace("T", " ") if created_raw != "-" else "-"

            empty_stats = {"cpu_pct": "-", "mem_usage": "-", "mem_pct": "-",
                           "net_io": "-", "block_io": "-", "pids": "-"}
            info = {
                "id": c.short_id, "name": c.name, "image": image_tag,
                "status": c.status, "state": state, "ports": ports_str,
                "created": created, **empty_stats,
                "_container_obj": c,   # temporary, removed before response
            }
            base_infos.append(info)
            if state == "running":
                running_idx.append(len(base_infos) - 1)

        # ── Fetch stats for ALL running containers in parallel ─────────────
        # Each stats call blocks ~1-2 s waiting for Docker; running them
        # concurrently keeps total wall-clock time ≈ 1 stats call regardless
        # of how many containers are running.
        if running_idx:
            loop = asyncio.get_event_loop()
            with ThreadPoolExecutor(max_workers=len(running_idx)) as pool:
                futures = [
                    loop.run_in_executor(
                        pool, _docker_stats_fmt, base_infos[i]["_container_obj"]
                    )
                    for i in running_idx
                ]
                results = await asyncio.gather(*futures, return_exceptions=True)

            for idx, result in zip(running_idx, results):
                if isinstance(result, dict):
                    base_infos[idx].update(result)

        # Strip the temporary container object before returning
        for info in base_infos:
            info.pop("_container_obj", None)

        containers = base_infos

    except Exception as exc:
        logger.exception("Docker container listing failed")
        return {
            "available": False,
            "error": f"Failed to list containers: {exc}",
            "containers": [], "total": 0, "running": 0, "exited": 0, "paused": 0,
        }
    finally:
        try:
            client.close()
        except Exception:
            pass

    running = sum(1 for c in containers if c["state"] == "running")
    exited  = sum(1 for c in containers if c["state"] == "exited")
    paused  = sum(1 for c in containers if c["state"] == "paused")

    return {
        "available":  True,
        "error":      None,
        "containers": containers,
        "total":      len(containers),
        "running":    running,
        "exited":     exited,
        "paused":     paused,
    }


@router.get("/api-stats/response-3d", dependencies=[Depends(require_admin)])
async def response_3d():
    """API response time heatmap: Hour × Day-of-Week × Avg ms (last 30 days)."""
    with get_monitor_conn() as conn:
        import psycopg2.extras
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT
                EXTRACT(HOUR FROM occurred_at)::int  AS hour,
                EXTRACT(DOW  FROM occurred_at)::int  AS dow,
                ROUND(AVG(duration_ms)::numeric, 1)  AS avg_ms,
                COUNT(*)                             AS request_count
            FROM api_logs
            WHERE duration_ms IS NOT NULL
              AND occurred_at >= NOW() - INTERVAL '30 days'
            GROUP BY hour, dow
            ORDER BY dow, hour
            """
        )
        rows = cur.fetchall()
        cur.close()
    return {"data": [dict(r) for r in rows]}


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

