# api/search.py
from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any
from contextlib import contextmanager

from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import JSONResponse

# ───────────────────────────────────────────────
# Router  →  Swagger 顯示在「search」分類
# ───────────────────────────────────────────────
router = APIRouter(tags=["search"])

# ───────────────────────────────────────────────
# ❶ DB 位置與連線管理（改為請求級，避免全域連線鎖死）
# ───────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent
DB_MODEL_PATH = BASE_DIR / "model.db"
DB_ASM_PATH = BASE_DIR / "assembly.db"


@contextmanager
def _open_db(path: Path):
    conn = sqlite3.connect(path, check_same_thread=False)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        yield conn
    finally:
        conn.close()

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
    base_sql: str
    where: list[str] = []
    params: list[Any] = []

    # ---- 日期條件 ----
    start_ts, _ = _day_bounds(from_)
    _,   end_ts = _day_bounds(to)
    where.append("ts BETWEEN ? AND ?")
    params.extend([start_ts, end_ts])

    if line == "module":
        db_path = DB_MODEL_PATH
        base_sql = "SELECT sn, kind, status, ts FROM scans"
        if sn:
            where.append("sn LIKE ?")
            params.append(f"%{sn}%")
    else:
        db_path = DB_ASM_PATH
        base_sql = (
            "SELECT "
            "  COALESCE(product_line, "
            "           CASE "
            "             WHEN us_sn LIKE '10050022%' THEN 'apower_s' "
            "             WHEN us_sn LIKE '10050018%' THEN 'apower2' "
            "             WHEN us_sn LIKE '10050028%' THEN 'apower2' "
            "             WHEN us_sn LIKE '10050014%' THEN 'apower' "
            "             ELSE NULL "
            "           END) AS product_line, "
            "  cn_sn AS china_sn, "
            "  us_sn, "
            "  mod_a AS module_a, "
            "  mod_b AS module_b, "
            "  au8   AS pcba_au8, "
            "  am7   AS pcba_am7, "
            "  status, ts "
            "FROM   scans"
        )
        if sn:
            s = sn.strip().upper()
            if s == "S":
                where.append("COALESCE(product_line, CASE WHEN us_sn LIKE '10050022%' THEN 'apower_s' END) = 'apower_s'")
            elif s == "2":
                where.append("COALESCE(product_line, CASE "
                             "WHEN us_sn LIKE '10050018%' THEN 'apower2' "
                             "WHEN us_sn LIKE '10050028%' THEN 'apower2' "
                             "END) = 'apower2'")
            else:
                where.append("us_sn LIKE ?")
                params.append(f"%{sn}%")

    if ng_only:
        where.append("status = 'NG'")

    sql = f"{base_sql} WHERE {' AND '.join(where)} ORDER BY ts DESC"

    with _open_db(db_path) as db:
        cur = db.execute(sql, params)
        records = _rows(cur)

    return JSONResponse(
        {"status": "success", "total_count": len(records), "records": records}
    )
