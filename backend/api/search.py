# api/search.py — PostgreSQL version (optimised)
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional, Any

import pytz
from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import JSONResponse

from core.pg import get_cursor

logger = logging.getLogger(__name__)
router = APIRouter(tags=["search"])


# ── Plan C: pg_trgm GIN indexes (lazy, idempotent) ───────────────────────────
_TRGM_DONE: set[str] = set()

_TRGM_COLS: dict[str, list[str]] = {
    "assembly": ["us_sn", "cn_sn", "au8", "am7", "mod_a", "mod_b"],
    "model":    ["sn"],
}

_TRGM_PREFIX: dict[str, str] = {
    "assembly": "idx_scans",
    "model":    "idx_model_scans",
}


def _ensure_trgm_for(schema: str) -> None:
    """Create pg_trgm extension + GIN indexes for a schema (once per process).

    The extension is always placed in `public` so gin_trgm_ops is findable
    regardless of which schema's search_path is active.
    """
    if schema in _TRGM_DONE:
        return
    try:
        # Step 1: ensure extension lands in public (no schema-specific search_path)
        with get_cursor(None) as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public")

        # Step 2: create GIN indexes inside the target schema
        with get_cursor(schema) as cur:
            prefix = _TRGM_PREFIX.get(schema, "idx_scans")
            for col in _TRGM_COLS.get(schema, []):
                cur.execute(
                    f"CREATE INDEX IF NOT EXISTS {prefix}_{col}_trgm "
                    f"ON scans USING GIN ({col} gin_trgm_ops)"
                )
        _TRGM_DONE.add(schema)
        logger.info("pg_trgm indexes ready for schema '%s'", schema)
    except Exception as exc:
        logger.warning("pg_trgm index setup ('%s') skipped: %s", schema, exc)


# ── Factory timezone map ──────────────────────────────────────────────────────
_LINE_TZ: dict[str, str] = {
    "assembly": "America/Los_Angeles",
    "module":   "America/Los_Angeles",
}


# ── Helpers ──────────────────────────────────────────────────────────────────
def _serialize(rows: list[dict]) -> list[dict]:
    """Serialize row values; naive datetimes (post AT TIME ZONE) as ISO strings."""
    result = []
    for row in rows:
        new_row = {}
        for k, v in row.items():
            if isinstance(v, datetime):
                # naive → already converted to local tz in SQL; just format as ISO
                # aware → convert to UTC-string (fallback, shouldn't normally happen)
                if v.tzinfo is None:
                    new_row[k] = v.strftime("%Y-%m-%dT%H:%M:%S")
                else:
                    new_row[k] = v.isoformat()
            else:
                new_row[k] = v
        result.append(new_row)
    return result


def _tz_day_bounds(day: str, tz_name: str) -> tuple[str, str]:
    """Convert a local-date string to UTC bounds for a TIMESTAMPTZ WHERE clause.

    Returns (start_utc, end_utc) as 'YYYY-MM-DD HH:MM:SS' strings (UTC).
    This ensures that filtering by "today" respects the factory's local timezone.
    """
    try:
        d = datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, f"Bad date format: {day!r}, need YYYY-MM-DD")
    tz = pytz.timezone(tz_name)
    start_local = tz.localize(d.replace(hour=0,  minute=0,  second=0))
    end_local   = tz.localize(d.replace(hour=23, minute=59, second=59))
    utc = pytz.utc
    start_utc = start_local.astimezone(utc).strftime("%Y-%m-%d %H:%M:%S")
    end_utc   = end_local.astimezone(utc).strftime("%Y-%m-%d %H:%M:%S")
    return start_utc, end_utc


# ── Plan B: multi-field search whitelists ─────────────────────────────────────
_ASM_SEARCH: dict[str, list[str]] = {
    "any":      ["us_sn", "cn_sn", "au8", "am7", "mod_a", "mod_b"],
    "us_sn":    ["us_sn"],
    "china_sn": ["cn_sn"],
    "pcba_au8": ["au8"],
    "pcba_am7": ["am7"],
    "module_a": ["mod_a"],
    "module_b": ["mod_b"],
}

_MOD_SEARCH: dict[str, list[str]] = {
    "any":  ["sn"],
    "sn":   ["sn"],
    "kind": ["kind"],
}

# ── Plan D: server-side sort whitelists ───────────────────────────────────────
_ASM_SORT: dict[str, str] = {
    "ts":           "scanned_at",
    "us_sn":        "us_sn",
    "china_sn":     "cn_sn",
    "pcba_au8":     "au8",
    "pcba_am7":     "am7",
    "module_a":     "mod_a",
    "module_b":     "mod_b",
    "status":       "status",
    "product_line": "product_line",
}

_MOD_SORT: dict[str, str] = {
    "ts":     "scanned_at",
    "sn":     "sn",
    "kind":   "kind",
    "status": "status",
}

# product_line COALESCE expression (shared between SELECT and WHERE)
_PL_EXPR = (
    "COALESCE(product_line, CASE"
    "  WHEN us_sn LIKE '10050019%%' THEN 'apower_s'"
    "  WHEN us_sn LIKE '10050022%%' THEN 'apower_s'"
    "  WHEN us_sn LIKE '10050018%%' THEN 'apower2'"
    "  WHEN us_sn LIKE '10050028%%' THEN 'apower2'"
    "  WHEN us_sn LIKE '10050030%%' THEN 'apower2'"
    "  WHEN us_sn LIKE '10050014%%' THEN 'apower'"
    "  ELSE NULL END)"
)


# ── Search endpoint ───────────────────────────────────────────────────────────
@router.get("/search", summary="Search Records")
def search_records(
    line:         str           = Query(..., pattern="^(module|assembly)$"),
    from_:        str           = Query(..., alias="from_"),
    to:           str           = Query(...),
    sn:           Optional[str] = Query("", max_length=100),
    search_field: str           = Query("any", max_length=20),
    product_line: Optional[str] = Query(None, max_length=50),
    ng_only:      int           = Query(0, ge=0, le=1),
    # Plan A: server-side pagination
    limit:        int           = Query(50, ge=1, le=500),
    offset:       int           = Query(0, ge=0),
    # Plan D: server-side sort
    order_by:     str           = Query("ts", max_length=20),
    order_dir:    str           = Query("desc", pattern="^(asc|desc)$"),
) -> JSONResponse:
    """Search module / assembly records with server-side pagination, sort, and multi-field ILIKE."""
    where: list[str] = []
    params: list[Any] = []

    # Use factory-local timezone for correct day-boundary filtering
    tz_name   = _LINE_TZ.get(line, "UTC")
    start_ts, _ = _tz_day_bounds(from_, tz_name)
    _,   end_ts = _tz_day_bounds(to,    tz_name)
    where.append("scanned_at BETWEEN %s AND %s")
    params.extend([start_ts, end_ts])

    if line == "module":
        schema    = "model"
        # AT TIME ZONE converts TIMESTAMPTZ → TIMESTAMP in factory local time (naive)
        base_sql  = f"SELECT sn, kind, status, (scanned_at AT TIME ZONE '{tz_name}') AS ts FROM scans"
        sort_map  = _MOD_SORT
        field_map = _MOD_SEARCH
    else:
        schema    = "assembly"
        base_sql  = (
            f"SELECT id, {_PL_EXPR} AS product_line,"
            " cn_sn AS china_sn, us_sn,"
            " mod_a AS module_a, mod_b AS module_b,"
            " au8 AS pcba_au8, am7 AS pcba_am7,"
            f" status, ng_reason, (scanned_at AT TIME ZONE '{tz_name}') AS ts"
            " FROM scans"
        )
        sort_map  = _ASM_SORT
        field_map = _ASM_SEARCH

    # Plan C: ensure pg_trgm indexes exist (lazy, once per schema)
    _ensure_trgm_for(schema)

    # Plan B: multi-field ILIKE search with trgm acceleration
    if sn and sn.strip():
        s    = sn.strip().upper()
        cols = field_map.get(search_field) or field_map["any"]
        if len(cols) == 1:
            where.append(f"{cols[0]} ILIKE %s")
            params.append(f"%{s}%")
        else:
            cond = " OR ".join(f"{c} ILIKE %s" for c in cols)
            where.append(f"({cond})")
            params.extend([f"%{s}%"] * len(cols))

    # Product line filter (assembly only; replaces old SN-hack)
    if line == "assembly" and product_line and product_line not in ("all", ""):
        where.append(f"{_PL_EXPR} = %s")
        params.append(product_line)

    if ng_only:
        where.append("status = 'NG'")

    # Plan D: server-side ORDER BY (whitelist-validated)
    safe_col = sort_map.get(order_by, "scanned_at")
    safe_dir = "DESC" if order_dir.lower() == "desc" else "ASC"

    where_sql = " AND ".join(where)
    sql = (
        f"{base_sql} WHERE {where_sql}"
        f" ORDER BY {safe_col} {safe_dir}"
        f" LIMIT %s OFFSET %s"
    )
    count_sql = f"SELECT COUNT(*) AS cnt FROM scans WHERE {where_sql}"

    with get_cursor(schema) as cur:
        cur.execute(count_sql, params)
        total_count = int(cur.fetchone()["cnt"] or 0)
        cur.execute(sql, [*params, limit, offset])
        records = [dict(r) for r in cur.fetchall()]

    return JSONResponse({
        "status":      "success",
        "total_count": total_count,
        "limit":       limit,
        "offset":      offset,
        "records":     _serialize(records),
    })
