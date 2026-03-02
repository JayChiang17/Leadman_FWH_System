"""QC Check REST router – prefix=/api/qc  (PostgreSQL)"""
from __future__ import annotations

import os
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Dict, Optional, List, Generator, Any
import calendar

import psycopg2
import psycopg2.extras
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse, FileResponse
from starlette.background import BackgroundTask

from core.deps import require_roles
from core.ws_manager import ws_manager
from core.pg import get_conn, get_cursor
from models.qc_model import (
    QCActionIn,
    QCRecordOut,
    DashboardStats,
    BatchCheckIn,
    BatchShipIn,
    QCIssueCreate,
    QCIssue,
)

# ─────────────────────────── DB & helpers ──────────────────────────────
SCHEMA = "qc"

def get_db() -> Generator:
    """FastAPI dependency that yields (conn, cursor) for qc schema."""
    with get_conn(SCHEMA) as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            yield conn, cur
        finally:
            cur.close()

# 時間工具
now_iso = lambda: datetime.now().isoformat()
PG_IN_LIMIT = 900


def _chunked(seq: List[str], size: int = PG_IN_LIMIT):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def _fetch_qc_status_map(cur, sns: List[str]) -> Dict[str, dict]:
    row_map: Dict[str, dict] = {}
    unique_sns = list(dict.fromkeys(sns))
    for chunk in _chunked(unique_sns):
        placeholders = ",".join(["%s"] * len(chunk))
        cur.execute(
            f"SELECT sn, fqc_ready_at, shipped_at FROM qc_records WHERE sn IN ({placeholders})",
            chunk,
        )
        for r in cur.fetchall():
            row_map[r["sn"]] = r
    return row_map

# ────────────────────────── Dashboard 快取 ────────────────────────────
_DASHBOARD_CACHE: Dict[str, Any] = {}
_CACHE_STALE = True  # 首次一定要算


def _range(period: str) -> tuple[str, str]:
    now = datetime.now()
    if period == "today":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "week":
        start = (now - timedelta(days=now.weekday())).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
    elif period == "month":
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        raise ValueError(period)
    return start.isoformat(), now.isoformat()


def _compute_dashboard(cur) -> Dict:
    """Heavy aggregate – 只在 cache 失效時執行"""
    today_s, _ = _range("today")
    week_s, _ = _range("week")
    month_s, _ = _range("month")

    cur.execute(
        """
        SELECT
          SUM(CASE WHEN fqc_ready_at >= %s THEN 1 ELSE 0 END) AS today_fqc,
          SUM(CASE WHEN shipped_at   >= %s THEN 1 ELSE 0 END) AS today_shipped,
          SUM(CASE WHEN fqc_ready_at >= %s THEN 1 ELSE 0 END) AS week_fqc,
          SUM(CASE WHEN shipped_at   >= %s THEN 1 ELSE 0 END) AS week_shipped,
          SUM(CASE WHEN fqc_ready_at >= %s THEN 1 ELSE 0 END) AS month_fqc,
          SUM(CASE WHEN shipped_at   >= %s THEN 1 ELSE 0 END) AS month_shipped,
          SUM(CASE WHEN fqc_ready_at IS NOT NULL AND shipped_at IS NULL THEN 1 ELSE 0 END) AS pending
        FROM qc_records
    """,
        (today_s, today_s, week_s, week_s, month_s, month_s),
    )
    row = cur.fetchone()

    today_fqc = (row["today_fqc"] or 0) if row else 0
    today_ship = (row["today_shipped"] or 0) if row else 0
    week_fqc = (row["week_fqc"] or 0) if row else 0
    week_ship = (row["week_shipped"] or 0) if row else 0

    return {
        "today_fqc": today_fqc,
        "today_shipped": today_ship,
        "week_fqc": week_fqc,
        "week_shipped": week_ship,
        "month_fqc": (row["month_fqc"] or 0) if row else 0,
        "month_shipped": (row["month_shipped"] or 0) if row else 0,
        "pending_shipment": (row["pending"] or 0) if row else 0,
        "shipping_rate_today": round(today_ship / today_fqc * 100, 1) if today_fqc else 0,
        "shipping_rate_week": round(week_ship / week_fqc * 100, 1) if week_fqc else 0,
    }


def _get_dashboard(cur) -> Dict:
    global _CACHE_STALE
    if _CACHE_STALE or not _DASHBOARD_CACHE:
        _DASHBOARD_CACHE.clear()
        _DASHBOARD_CACHE.update(_compute_dashboard(cur))
        _CACHE_STALE = False
    return _DASHBOARD_CACHE.copy()


def _invalidate_dashboard_cache():
    global _CACHE_STALE
    _CACHE_STALE = True


def _row_to_issue(r: dict) -> Dict[str, Any]:
    return {
        "id": r["id"],
        "line": r["line"],
        "title": r["title"],
        "description": r["description"],
        "category": r["category"],
        "severity": r["severity"],
        "image_path": r["image_path"],
        "created_by": r["created_by"],
        "created_at": r["created_at"],
        "updated_at": r["updated_at"],
    }

# 專用安全廣播
async def _broadcast_dashboard_update(cur):
    data = _get_dashboard(cur)
    try:
        await ws_manager.broadcast_json({"type": "qc_dashboard_update", "data": data})
    except Exception:
        pass

# ───────────────────────── Router ────────────────────────────
router = APIRouter(prefix="/qc", tags=["qc"])


# 0) QC line issues（產線問題回報）
@router.post("/issues", response_model=QCIssue, dependencies=[Depends(require_roles("admin", "qc"))])
def create_issue(
    body: QCIssueCreate,
    db=Depends(get_db),
    user=Depends(require_roles("admin", "qc")),
):
    """記錄產線 QC 問題，可附上 base64 圖片。"""
    conn, cur = db
    now = now_iso()
    cur.execute(
        """INSERT INTO qc_issues(line,title,description,category,severity,image_path,created_by,created_at,updated_at)
           VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
        (
            body.line.strip(),
            body.title.strip(),
            body.description.strip(),
            (body.category or "").strip(),
            (body.severity or "").strip(),
            body.image_path or None,
            getattr(user, "username", None),
            now,
            now,
        ),
    )
    new_id = cur.fetchone()["id"]
    conn.commit()
    cur.execute("SELECT * FROM qc_issues WHERE id = %s", (new_id,))
    row = cur.fetchone()
    return _row_to_issue(row)


@router.get("/issues", response_model=List[QCIssue], dependencies=[Depends(require_roles("admin", "qc"))])
def list_issues(
    line: Optional[str] = Query(None, description="Production line"),
    severity: Optional[str] = Query(None, description="Severity filter"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db=Depends(get_db),
):
    conn, cur = db
    where, params = [], []
    if line:
        where.append("line = %s"); params.append(line.strip())
    if severity:
        where.append("LOWER(severity) = LOWER(%s)"); params.append(severity.strip())
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    sql = f"SELECT * FROM qc_issues {where_sql} ORDER BY created_at DESC LIMIT %s OFFSET %s"
    params.extend([limit, offset])
    cur.execute(sql, params)
    rows = cur.fetchall()
    return [_row_to_issue(r) for r in rows]


# ①  SN 狀態查詢 ------------------------------------------------
@router.get("/check/{sn}", response_model=Optional[QCRecordOut])
def check(sn: str, db=Depends(get_db)):
    conn, cur = db
    cur.execute("SELECT * FROM qc_records WHERE sn = %s", (sn,))
    r = cur.fetchone()
    if not r:
        return None
    return {
        "sn": r["sn"],
        "fqc_ready": bool(r["fqc_ready_at"]),
        "fqc_ready_at": r["fqc_ready_at"],
        "shipped": bool(r["shipped_at"]),
        "shipped_at": r["shipped_at"],
    }


# ②  動作（FQC / Ship）----------------------------------------
@router.post("/action", dependencies=[Depends(require_roles("admin", "qc"))])
async def action(act: QCActionIn, db=Depends(get_db)):
    conn, cur = db
    ts = act.timestamp or now_iso()

    if act.action not in ("fqc_ready", "ship"):
        raise HTTPException(400, "invalid action")

    # 2-1 FQC Ready ------------------------------------------------
    if act.action == "fqc_ready":
        cur.execute(
            "SELECT fqc_ready_at FROM qc_records WHERE sn = %s", (act.sn,)
        )
        existing = cur.fetchone()
        if existing and existing["fqc_ready_at"]:
            return JSONResponse(
                {
                    "status": "warning",
                    "message": f"SN {act.sn} already FQC ready",
                    "timestamp": existing["fqc_ready_at"],
                }
            )

        if existing:
            cur.execute(
                "UPDATE qc_records SET fqc_ready_at=%s, updated_at=%s WHERE sn=%s",
                (ts, ts, act.sn),
            )
        else:
            cur.execute(
                "INSERT INTO qc_records (sn, fqc_ready_at, created_at) VALUES (%s,%s,%s)",
                (act.sn, ts, ts),
            )
        conn.commit()
        msg = f"SN {act.sn} marked FQC ready"

    # 2-2 Ship ----------------------------------------------------
    else:
        cur.execute(
            "SELECT fqc_ready_at, shipped_at FROM qc_records WHERE sn = %s", (act.sn,)
        )
        existing = cur.fetchone()
        if not existing:
            raise HTTPException(404, f"SN {act.sn} not found")
        if not existing["fqc_ready_at"]:
            raise HTTPException(400, f"SN {act.sn} not FQC ready")
        if existing["shipped_at"]:
            return JSONResponse(
                {
                    "status": "warning",
                    "message": f"SN {act.sn} already shipped",
                    "timestamp": existing["shipped_at"],
                }
            )
        cur.execute(
            "UPDATE qc_records SET shipped_at=%s, updated_at=%s WHERE sn=%s",
            (ts, ts, act.sn),
        )
        conn.commit()
        msg = f"SN {act.sn} shipped"

    _invalidate_dashboard_cache()
    await _broadcast_dashboard_update(cur)

    return {"status": "success", "message": msg, "timestamp": ts}


# ③  Dashboard --------------------------------------------------
@router.get("/dashboard", response_model=DashboardStats)
def dashboard(db=Depends(get_db)):
    conn, cur = db
    return _get_dashboard(cur)


# ③.5 趨勢時間序列（本月每日、本年每月的「已出貨」）
@router.get("/series")
def series(db=Depends(get_db)):
    conn, cur = db
    now = datetime.now()

    # 本月範圍
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if month_start.month == 12:
        next_month_start = month_start.replace(year=month_start.year + 1, month=1)
    else:
        next_month_start = month_start.replace(month=month_start.month + 1)

    # 本年範圍
    year_start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    next_year_start = year_start.replace(year=year_start.year + 1)

    # 1) 本月每日 shipped 統計
    cur.execute(
        """
        SELECT TO_CHAR(shipped_at, 'YYYY-MM-DD') AS d, COUNT(*) AS c
        FROM qc_records
        WHERE shipped_at IS NOT NULL
          AND shipped_at >= %s
          AND shipped_at <  %s
        GROUP BY TO_CHAR(shipped_at, 'YYYY-MM-DD')
        ORDER BY d
        """,
        (month_start.isoformat(), next_month_start.isoformat()),
    )
    rows_m = cur.fetchall()
    daily_map = {r["d"]: r["c"] for r in rows_m}

    # 補齊沒有出貨的日期
    month_days = (next_month_start - month_start).days
    month_daily = []
    for i in range(month_days):
        d = (month_start + timedelta(days=i)).date().isoformat()
        month_daily.append({"date": d, "count": int(daily_map.get(d, 0))})

    # 2) 本年每月 shipped 統計
    cur.execute(
        """
        SELECT TO_CHAR(shipped_at, 'YYYY-MM') AS ym, COUNT(*) AS c
        FROM qc_records
        WHERE shipped_at IS NOT NULL
          AND shipped_at >= %s
          AND shipped_at <  %s
        GROUP BY TO_CHAR(shipped_at, 'YYYY-MM')
        ORDER BY ym
        """,
        (year_start.isoformat(), next_year_start.isoformat()),
    )
    rows_y = cur.fetchall()
    monthly_map = {r["ym"]: r["c"] for r in rows_y}

    year_monthly = []
    for m in range(1, 13):
        ym = f"{year_start.year}-{m:02d}"
        year_monthly.append({"month": ym, "count": int(monthly_map.get(ym, 0))})

    return {
        "month_daily_shipped": month_daily,
        "year_monthly_shipped": year_monthly,
    }


# ④  Records 查詢（新增日期篩選 + 正確 total） --------------------
@router.get("/records")
def records(
    status: str | None = Query(None, description="all|pending|shipped"),
    from_date: str | None = Query(None, pattern=r"\d{4}-\d{2}-\d{2}", description="開始日期(含)"),
    to_date: str | None = Query(None, pattern=r"\d{4}-\d{2}-\d{2}", description="結束日期(含)"),
    limit: int = Query(100, le=1000),
    offset: int = Query(0, ge=0),
    db=Depends(get_db),
):
    conn, cur = db
    where_clauses: List[str] = []
    params: List = []

    # 狀態條件
    if status == "pending":
        where_clauses.append("fqc_ready_at IS NOT NULL AND shipped_at IS NULL")
    elif status == "shipped":
        where_clauses.append("shipped_at IS NOT NULL")
    elif status and status != "all":
        raise HTTPException(400, "invalid status")

    # 日期區間
    if from_date and to_date:
        start = datetime.strptime(from_date, "%Y-%m-%d")
        end = datetime.strptime(to_date, "%Y-%m-%d") + timedelta(days=1)
        where_clauses.append(
            "COALESCE(shipped_at, fqc_ready_at, created_at) >= %s "
            "AND COALESCE(shipped_at, fqc_ready_at, created_at) < %s"
        )
        params.extend([start.isoformat(), end.isoformat()])
    elif from_date:
        start = datetime.strptime(from_date, "%Y-%m-%d")
        where_clauses.append(
            "COALESCE(shipped_at, fqc_ready_at, created_at) >= %s"
        )
        params.append(start.isoformat())
    elif to_date:
        end = datetime.strptime(to_date, "%Y-%m-%d") + timedelta(days=1)
        where_clauses.append(
            "COALESCE(shipped_at, fqc_ready_at, created_at) < %s"
        )
        params.append(end.isoformat())

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    # 正確 total
    cur.execute(
        f"SELECT COUNT(*) AS c FROM qc_records {where_sql}",
        params
    )
    total = cur.fetchone()["c"]

    # 實際資料
    cur.execute(
        f"""
        SELECT * FROM qc_records
        {where_sql}
        ORDER BY COALESCE(shipped_at, fqc_ready_at, created_at) DESC
        LIMIT %s OFFSET %s
        """,
        (*params, limit, offset),
    )
    rows = cur.fetchall()

    def fmt(r):
        return {
            "sn": r["sn"],
            "fqc_ready_at": r["fqc_ready_at"],
            "shipped_at": r["shipped_at"],
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
            "status": "Shipped" if r["shipped_at"] else ("Pending" if r["fqc_ready_at"] else "Created"),
        }

    return {
        "total": int(total),
        "limit": limit,
        "offset": offset,
        "records": [fmt(r) for r in rows],
    }


# ⑤  匯出 Excel -------------------------------------------------
@router.get("/export")
def export(
    from_date: str = Query(..., pattern=r"\d{4}-\d{2}-\d{2}"),
    to_date: str = Query(..., pattern=r"\d{4}-\d{2}-\d{2}"),
    export_type: str = Query("all", pattern=r"^(all|fqc_only|shipped_only)$"),
    user=Depends(require_roles("admin", "qc")),
    db=Depends(get_db),
):
    conn, cur = db
    start = datetime.strptime(from_date, "%Y-%m-%d")
    end = datetime.strptime(to_date, "%Y-%m-%d") + timedelta(days=1)

    cond, params = [], []
    if export_type == "fqc_only":
        cond.append(
            "fqc_ready_at >= %s AND fqc_ready_at < %s AND shipped_at IS NULL"
        )
        params.extend([start.isoformat(), end.isoformat()])
    elif export_type == "shipped_only":
        cond.append("shipped_at >= %s AND shipped_at < %s")
        params.extend([start.isoformat(), end.isoformat()])
    else:  # all
        cond.append(
            """(fqc_ready_at >= %s AND fqc_ready_at < %s) OR
               (shipped_at >= %s AND shipped_at < %s)"""
        )
        params.extend([start.isoformat(), end.isoformat(), start.isoformat(), end.isoformat()])

    where = "WHERE " + " AND ".join(cond)
    cur.execute(f"SELECT * FROM qc_records {where} ORDER BY sn", params)
    rows = cur.fetchall()
    if not rows:
        raise HTTPException(404, "no data")

    df = pd.DataFrame(
        [
            {
                "Serial Number": r["sn"],
                "FQC Ready Time": r["fqc_ready_at"] or "",
                "Shipped Time": r["shipped_at"] or "",
                "Status": "Shipped" if r["shipped_at"] else "FQC Ready",
                "Created": r["created_at"],
            }
            for r in rows
        ]
    )

    tmp = NamedTemporaryFile(delete=False, suffix=".xlsx")
    with pd.ExcelWriter(tmp.name, engine="openpyxl") as w:
        df.to_excel(w, index=False, sheet_name="QC Records")

    fn = f"qc_export_{from_date}_to_{to_date}_{export_type}.xlsx"
    return FileResponse(
        tmp.name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=fn,
        background=BackgroundTask(os.unlink, tmp.name),
    )


# ⑥  刪除 -------------------------------------------------------
@router.delete("/delete/{sn}", dependencies=[Depends(require_roles("admin"))])
async def delete(sn: str, db=Depends(get_db)):
    conn, cur = db
    cur.execute("DELETE FROM qc_records WHERE sn = %s", (sn,))
    conn.commit()
    if cur.rowcount == 0:
        raise HTTPException(404, f"{sn} not found")

    _invalidate_dashboard_cache()
    await _broadcast_dashboard_update(cur)

    return {"status": "success", "message": f"record {sn} deleted"}


# ⑦ 批量檢查 ------------------------------------------------
@router.post("/batch-check")
def batch_check(batch_data: BatchCheckIn, db=Depends(get_db)):
    """一次查多個 SN, 單一 SQL 完成"""
    conn, cur = db
    if not batch_data.sns:
        return {"results": []}

    row_map = _fetch_qc_status_map(cur, batch_data.sns)

    results = []
    for sn in batch_data.sns:
        r = row_map.get(sn)
        if not r:
            results.append({"sn": sn, "fqc_ready": False, "shipped": False, "status": "not_ready"})
        elif r["shipped_at"]:
            results.append({"sn": sn, "fqc_ready": True, "shipped": True, "status": "shipped"})
        elif r["fqc_ready_at"]:
            results.append({"sn": sn, "fqc_ready": True, "shipped": False, "status": "pending"})
        else:
            results.append({"sn": sn, "fqc_ready": False, "shipped": False, "status": "not_ready"})

    return {"results": results}


# ⑧ 批量出貨 ------------------------------------------------
@router.post("/batch-ship", dependencies=[Depends(require_roles("admin", "qc"))])
async def batch_ship(batch_data: BatchShipIn, db=Depends(get_db)):
    conn, cur = db
    sns = batch_data.sns
    if not sns:
        return {"status": "success", "message": "no sn provided", "results": []}

    ts = now_iso()
    cur_map = _fetch_qc_status_map(cur, sns)

    results: List[Dict] = []
    success_count = 0
    update_targets: List[str] = []

    for sn in sns:
        existing = cur_map.get(sn)
        if not existing:
            results.append({"sn": sn, "status": "error", "message": "SN not found"})
        elif not existing["fqc_ready_at"]:
            results.append({"sn": sn, "status": "error", "message": "Not FQC ready"})
        elif existing["shipped_at"]:
            results.append({"sn": sn, "status": "warning", "message": "Already shipped"})
        else:
            update_targets.append(sn)
            results.append({"sn": sn, "status": "success", "message": "Shipped successfully"})
            success_count += 1

    unique_update_targets = list(dict.fromkeys(update_targets))
    if unique_update_targets:
        try:
            for sn in unique_update_targets:
                cur.execute(
                    "UPDATE qc_records SET shipped_at=%s, updated_at=%s WHERE sn=%s",
                    (ts, ts, sn),
                )
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise HTTPException(500, f"Batch ship update failed: {e}")

    _invalidate_dashboard_cache()
    await _broadcast_dashboard_update(cur)

    return {
        "status": "success",
        "message": f"Successfully shipped {success_count} units",
        "results": results,
    }


# ⑨ 批量匯出 PCBA 對應表 ------------------------------------------------
@router.post("/batch-export-pcba", dependencies=[Depends(require_roles("admin", "qc"))])
def batch_export_pcba(body: BatchShipIn):
    """
    批量匯出 US SN 對應的 PCBA_AU8 和 PCBA_AM7
    """
    raw_sns = body.sns or []
    sns = [s.strip() for s in raw_sns if s and s.strip()]
    if not sns:
        raise HTTPException(400, "No serial numbers provided")

    # 連接 assembly schema
    with get_cursor("assembly") as cur_asm:
        unique_sns = list(dict.fromkeys(sns))
        rows: List[dict] = []
        for chunk in _chunked(unique_sns):
            placeholders = ",".join(["%s"] * len(chunk))
            cur_asm.execute(
                f"SELECT us_sn, au8, am7 FROM scans WHERE us_sn IN ({placeholders})",
                chunk,
            )
            rows.extend(cur_asm.fetchall())

    if not rows:
        raise HTTPException(404, "No matching records found in assembly database")
    row_map = {}
    for row in rows:
        row_map[row["us_sn"]] = row

    # 準備 Excel 數據
    data = []
    missing_sns = []
    found_count = 0
    for idx, sn in enumerate(sns, start=1):
        matched = row_map.get(sn)
        if matched:
            data.append({
                "No": idx,
                "US_SN": sn,
                "PCBA_AU8": matched["au8"] or "",
                "PCBA_AM7": matched["am7"] or ""
            })
            found_count += 1
        else:
            data.append({
                "No": idx,
                "US_SN": sn,
                "PCBA_AU8": "",
                "PCBA_AM7": ""
            })
            missing_sns.append(sn)

    df = pd.DataFrame(data)
    tmp = NamedTemporaryFile(delete=False, suffix=".xlsx")

    with pd.ExcelWriter(tmp.name, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="PCBA_Export", index=False)

        if missing_sns:
            missing_df = pd.DataFrame({"Missing_SN": missing_sns, "Status": ["Not found in database"] * len(missing_sns)})
            missing_df.to_excel(writer, sheet_name="Missing_SNs", index=False)

        worksheet = writer.sheets["PCBA_Export"]
        worksheet.column_dimensions["A"].width = 8
        worksheet.column_dimensions["B"].width = 26
        worksheet.column_dimensions["C"].width = 22
        worksheet.column_dimensions["D"].width = 22

        if missing_sns and "Missing_SNs" in writer.sheets:
            missing_ws = writer.sheets["Missing_SNs"]
            missing_ws.column_dimensions["A"].width = 26
            missing_ws.column_dimensions["B"].width = 24

    today = datetime.now().strftime("%Y%m%d")
    total_count = len(sns)
    missing_count = len(missing_sns)

    if missing_count:
        filename = f"{today}_{found_count}_{total_count}.xlsx"
    else:
        filename = f"{today}_{found_count}.xlsx"

    return FileResponse(
        tmp.name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=filename,
        background=BackgroundTask(os.unlink, tmp.name),
        headers={
            "X-Missing-Count": str(missing_count),
            "X-Found-Count": str(found_count),
            "X-Total-Count": str(total_count)
        }
    )
