# api/search.py
from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import JSONResponse

# ───────────────────────────────────────────────
# Router  →  Swagger 顯示在「search」分類
# ───────────────────────────────────────────────
router = APIRouter(tags=["search"])

# ───────────────────────────────────────────────
# ❶ 連線池：兩顆 SQLite
# ───────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent
DB_MODEL = sqlite3.connect(BASE_DIR / "model.db",    check_same_thread=False)
DB_ASM   = sqlite3.connect(BASE_DIR / "assembly.db", check_same_thread=False)

for db in (DB_MODEL, DB_ASM):
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")

# ───────────────────────────────────────────────
# ❷ 共用工具
# ───────────────────────────────────────────────
def _day_bounds(day: str) -> tuple[str, str]:
    """把 YYYY-MM-DD 轉為 00:00:00 與 23:59:59。"""
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, f"Bad date format: {day}, need YYYY-MM-DD")
    return f"{day} 00:00:00", f"{day} 23:59:59"


def _rows(cur: sqlite3.Cursor) -> List[Dict[str, Any]]:
    return [dict(r) for r in cur.fetchall()]

# ───────────────────────────────────────────────
# ❸ 查詢 API
# ───────────────────────────────────────────────
@router.get(
    "/search",
    summary="Search Records",        # Swagger 端標題
)
def search_records(
    line: str = Query(..., pattern="^(module|assembly)$"),
    from_: str = Query(..., alias="from_"),
    to:   str  = Query(...),
    sn: Optional[str] = Query("", max_length=100),
    ng_only: int = Query(0, ge=0, le=1),
) -> JSONResponse:
    """
    搜尋模組 / 組裝紀錄。

    **參數**  
    • `line`: `"module"` or `"assembly"`  
    • `from_`, `to`: `YYYY-MM-DD` 日期區間  
    • `sn`: 模組線→`sn`；組裝線→`us_sn`  
    • `ng_only`: 1 僅查 NG
    """
    db: sqlite3.Connection
    base_sql: str
    where: list[str] = []
    params: list[Any] = []

    # ---- 日期條件 ----
    start_ts, _ = _day_bounds(from_)
    _,   end_ts = _day_bounds(to)
    where.append("ts BETWEEN ? AND ?")
    params.extend([start_ts, end_ts])

    if line == "module":
        db = DB_MODEL
        base_sql = "SELECT sn, kind, status, ts FROM scans"
        if sn:
            where.append("sn LIKE ?")
            params.append(f"%{sn}%")
    else:
        db = DB_ASM
        base_sql = (
            "SELECT cn_sn, us_sn, mod_a, mod_b, au8, am7, status, ts "
            "FROM   scans"
        )
        if sn:
            where.append("us_sn LIKE ?")
            params.append(f"%{sn}%")

    if ng_only:
        where.append("status = 'NG'")

    sql = f"{base_sql} WHERE {' AND '.join(where)} ORDER BY ts DESC"

    with db:
        cur = db.execute(sql, params)
        records = _rows(cur)

    return JSONResponse(
        {"status": "success", "total_count": len(records), "records": records}
    )
