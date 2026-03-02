# api/search.py — PostgreSQL version
from __future__ import annotations

from datetime import datetime
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import JSONResponse

from core.pg import get_cursor

# ───────────────────────────────────────────────
# Router  →  Swagger 顯示在「search」分類
# ───────────────────────────────────────────────
router = APIRouter(tags=["search"])


# ───────────────────────────────────────────────
# ❷ 共用工具
# ───────────────────────────────────────────────
def _serialize(rows: list[dict]) -> list[dict]:
    """Convert datetime objects to ISO strings for JSON serialization."""
    result = []
    for row in rows:
        result.append({
            k: v.isoformat() if isinstance(v, datetime) else v
            for k, v in row.items()
        })
    return result


def _day_bounds(day: str) -> tuple[str, str]:
    """把 YYYY-MM-DD 轉為 00:00:00 與 23:59:59。"""
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, f"Bad date format: {day}, need YYYY-MM-DD")
    return f"{day} 00:00:00", f"{day} 23:59:59"


# ───────────────────────────────────────────────
# ❸ 查詢 API
# ───────────────────────────────────────────────
@router.get(
    "/search",
    summary="Search Records",
)
def search_records(
    line: str = Query(..., pattern="^(module|assembly)$"),
    from_: str = Query(..., alias="from_"),
    to:   str  = Query(...),
    sn: Optional[str] = Query("", max_length=100),
    ng_only: int = Query(0, ge=0, le=1),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> JSONResponse:
    """
    搜尋模組 / 組裝紀錄。
    """
    base_sql: str
    where: list[str] = []
    params: list[Any] = []

    # ---- 日期條件 ----
    start_ts, _ = _day_bounds(from_)
    _,   end_ts = _day_bounds(to)
    where.append("scanned_at BETWEEN %s AND %s")
    params.extend([start_ts, end_ts])

    # ---- 選擇 schema ----
    if line == "module":
        schema = "model"
        base_sql = "SELECT sn, kind, status, scanned_at AS ts FROM scans"
        if sn:
            where.append("sn LIKE %s")
            params.append(f"%{sn}%")
    else:
        schema = "assembly"
        base_sql = (
            "SELECT id, "
            "  COALESCE(product_line, "
            "           CASE "
            "             WHEN us_sn LIKE '10050019%%' THEN 'apower_s' "
            "             WHEN us_sn LIKE '10050022%%' THEN 'apower_s' "
            "             WHEN us_sn LIKE '10050018%%' THEN 'apower2' "
            "             WHEN us_sn LIKE '10050028%%' THEN 'apower2' "
            "             WHEN us_sn LIKE '10050030%%' THEN 'apower2' "
            "             WHEN us_sn LIKE '10050014%%' THEN 'apower' "
            "             ELSE NULL "
            "           END) AS product_line, "
            "  cn_sn AS china_sn, "
            "  us_sn, "
            "  mod_a AS module_a, "
            "  mod_b AS module_b, "
            "  au8   AS pcba_au8, "
            "  am7   AS pcba_am7, "
            "  status, ng_reason, scanned_at AS ts "
            "FROM   scans"
        )
        if sn:
            s = sn.strip().upper()
            if s == "S":
                where.append("COALESCE(product_line, CASE "
                             "WHEN us_sn LIKE '10050019%%' THEN 'apower_s' "
                             "WHEN us_sn LIKE '10050022%%' THEN 'apower_s' "
                             "END) = 'apower_s'")
            elif s == "2":
                where.append("COALESCE(product_line, CASE "
                             "WHEN us_sn LIKE '10050018%%' THEN 'apower2' "
                             "WHEN us_sn LIKE '10050028%%' THEN 'apower2' "
                             "WHEN us_sn LIKE '10050030%%' THEN 'apower2' "
                             "END) = 'apower2'")
            else:
                where.append("us_sn LIKE %s")
                params.append(f"%{sn}%")

    if ng_only:
        where.append("status = 'NG'")

    where_sql = " AND ".join(where)
    sql = f"{base_sql} WHERE {where_sql} ORDER BY scanned_at DESC LIMIT %s OFFSET %s"
    count_sql = f"SELECT COUNT(*) AS cnt FROM scans WHERE {where_sql}"

    with get_cursor(schema) as cur:
        cur.execute(count_sql, params)
        total_count = int(cur.fetchone()["cnt"] or 0)
        cur.execute(sql, [*params, limit, offset])
        records = [dict(r) for r in cur.fetchall()]

    return JSONResponse(
        {
            "status": "success",
            "total_count": total_count,
            "limit": limit,
            "offset": offset,
            "records": _serialize(records),
        }
    )
