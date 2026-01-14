"""QC Check REST router – prefix=/api/qc  (optimized)"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Dict, Optional, List, Generator, Any
import calendar  # ← 可用於未來日期工具

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse, FileResponse

from core.deps import require_roles
from core.ws_manager import ws_manager
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
ROOT_HINT = "qc_v2.db"
BACKEND_ROOT = Path(__file__).resolve().parents[1]  # …/backend
DB_PATH = BACKEND_ROOT / ROOT_HINT  # backend/qc_v2.db

# SQLite – 每次請求開一條連線，並啟用 WAL 以提升並發寫入
def get_db() -> Generator[sqlite3.Connection, None, None]:
    """FastAPI dependency that yields database connection"""
    conn = sqlite3.connect(DB_PATH, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    try:
        yield conn
    finally:
        conn.close()

# 第一次啟動時確保表存在
def _init_schema() -> None:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS qc_records(
                sn            TEXT PRIMARY KEY,
                fqc_ready_at  TEXT,
                shipped_at    TEXT,
                created_at    TEXT NOT NULL,
                updated_at    TEXT
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_fqc_ready_at  ON qc_records(fqc_ready_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_shipped_at    ON qc_records(shipped_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_created_at    ON qc_records(created_at)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS qc_issues(
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                line          TEXT NOT NULL,
                title         TEXT NOT NULL,
                description   TEXT NOT NULL,
                category      TEXT,
                severity      TEXT,
                image_base64  TEXT,
                created_by    TEXT,
                created_at    TEXT NOT NULL,
                updated_at    TEXT
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_qc_issues_created_at ON qc_issues(created_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_qc_issues_line ON qc_issues(line)")
        conn.commit()
    finally:
        conn.close()

_init_schema()

# 時間工具
now_iso = lambda: datetime.now().isoformat()

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


def _compute_dashboard(db: sqlite3.Connection) -> Dict:
    """Heavy aggregate – 只在 cache 失效時執行"""
    today_s, _ = _range("today")
    week_s, _ = _range("week")
    month_s, _ = _range("month")

    row = db.execute(
        """
        SELECT
          SUM(CASE WHEN datetime(fqc_ready_at) >= datetime(?) THEN 1 ELSE 0 END) AS today_fqc,
          SUM(CASE WHEN datetime(shipped_at)   >= datetime(?) THEN 1 ELSE 0 END) AS today_shipped,
          SUM(CASE WHEN datetime(fqc_ready_at) >= datetime(?) THEN 1 ELSE 0 END) AS week_fqc,
          SUM(CASE WHEN datetime(shipped_at)   >= datetime(?) THEN 1 ELSE 0 END) AS week_shipped,
          SUM(CASE WHEN datetime(fqc_ready_at) >= datetime(?) THEN 1 ELSE 0 END) AS month_fqc,
          SUM(CASE WHEN datetime(shipped_at)   >= datetime(?) THEN 1 ELSE 0 END) AS month_shipped,
          SUM(CASE WHEN fqc_ready_at IS NOT NULL AND shipped_at IS NULL THEN 1 ELSE 0 END) AS pending
        FROM qc_records
    """,
        (today_s, today_s, week_s, week_s, month_s, month_s),
    ).fetchone()

    today_fqc = row["today_fqc"] or 0
    today_ship = row["today_shipped"] or 0
    week_fqc = row["week_fqc"] or 0
    week_ship = row["week_shipped"] or 0

    return {
        "today_fqc": today_fqc,
        "today_shipped": today_ship,
        "week_fqc": week_fqc,
        "week_shipped": week_ship,
        "month_fqc": row["month_fqc"] or 0,
        "month_shipped": row["month_shipped"] or 0,
        "pending_shipment": row["pending"] or 0,
        "shipping_rate_today": round(today_ship / today_fqc * 100, 1) if today_fqc else 0,
        "shipping_rate_week": round(week_ship / week_fqc * 100, 1) if week_fqc else 0,
    }


def _get_dashboard(db: sqlite3.Connection) -> Dict:
    global _CACHE_STALE
    if _CACHE_STALE or not _DASHBOARD_CACHE:
        _DASHBOARD_CACHE.clear()
        _DASHBOARD_CACHE.update(_compute_dashboard(db))
        _CACHE_STALE = False
    return _DASHBOARD_CACHE.copy()


def _invalidate_dashboard_cache():
    global _CACHE_STALE
    _CACHE_STALE = True


def _row_to_issue(r: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": r["id"],
        "line": r["line"],
        "title": r["title"],
        "description": r["description"],
        "category": r["category"],
        "severity": r["severity"],
        "image_base64": r["image_base64"],
        "created_by": r["created_by"],
        "created_at": r["created_at"],
        "updated_at": r["updated_at"],
    }

# 專用安全廣播
async def _broadcast_dashboard_update(db: sqlite3.Connection):
    data = _get_dashboard(db)
    try:
        await ws_manager.broadcast_json({"type": "qc_dashboard_update", "data": data})
    except Exception:
        # 忽略死連線，以免中斷請求
        pass

# ───────────────────────── Router ────────────────────────────
router = APIRouter(prefix="/qc", tags=["qc"])


# 0) QC line issues（產線問題回報）
@router.post("/issues", response_model=QCIssue, dependencies=[Depends(require_roles("admin", "qc"))])
def create_issue(
    body: QCIssueCreate,
    db: sqlite3.Connection = Depends(get_db),
    user=Depends(require_roles("admin", "qc")),
):
    """記錄產線 QC 問題，可附上 base64 圖片。"""
    now = now_iso()
    db.execute(
        """INSERT INTO qc_issues(line,title,description,category,severity,image_base64,created_by,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?)""",
        (
            body.line.strip(),
            body.title.strip(),
            body.description.strip(),
            (body.category or "").strip(),
            (body.severity or "").strip(),
            body.image_base64 or None,
            getattr(user, "username", None),
            now,
            now,
        ),
    )
    row = db.execute("SELECT * FROM qc_issues WHERE id = last_insert_rowid()").fetchone()
    return _row_to_issue(row)


@router.get("/issues", response_model=List[QCIssue], dependencies=[Depends(require_roles("admin", "qc"))])
def list_issues(
    line: Optional[str] = Query(None, description="Production line"),
    severity: Optional[str] = Query(None, description="Severity filter"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: sqlite3.Connection = Depends(get_db),
):
    where, params = [], []
    if line:
        where.append("line = ?"); params.append(line.strip())
    if severity:
        where.append("LOWER(severity) = LOWER(?)"); params.append(severity.strip())
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    sql = f"SELECT * FROM qc_issues {where_sql} ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    rows = db.execute(sql, params).fetchall()
    return [_row_to_issue(r) for r in rows]


# ①  SN 狀態查詢 ------------------------------------------------
@router.get("/check/{sn}", response_model=Optional[QCRecordOut])
def check(sn: str, db: sqlite3.Connection = Depends(get_db)):
    r = db.execute("SELECT * FROM qc_records WHERE sn = ?", (sn,)).fetchone()
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
async def action(act: QCActionIn, db: sqlite3.Connection = Depends(get_db)):
    ts = act.timestamp or now_iso()

    if act.action not in ("fqc_ready", "ship"):
        raise HTTPException(400, "invalid action")

    # 2-1 FQC Ready ------------------------------------------------
    if act.action == "fqc_ready":
        cur = db.execute(
            "SELECT fqc_ready_at FROM qc_records WHERE sn = ?", (act.sn,)
        ).fetchone()
        if cur and cur["fqc_ready_at"]:
            return JSONResponse(
                {
                    "status": "warning",
                    "message": f"SN {act.sn} already FQC ready",
                    "timestamp": cur["fqc_ready_at"],
                }
            )

        if cur:
            db.execute(
                "UPDATE qc_records SET fqc_ready_at=?, updated_at=? WHERE sn=?",
                (ts, ts, act.sn),
            )
        else:
            db.execute(
                "INSERT INTO qc_records (sn, fqc_ready_at, created_at) VALUES (?,?,?)",
                (act.sn, ts, ts),
            )
        db.commit()
        msg = f"SN {act.sn} marked FQC ready"

    # 2-2 Ship ----------------------------------------------------
    else:
        cur = db.execute(
            "SELECT fqc_ready_at, shipped_at FROM qc_records WHERE sn = ?", (act.sn,)
        ).fetchone()
        if not cur:
            raise HTTPException(404, f"SN {act.sn} not found")
        if not cur["fqc_ready_at"]:
            raise HTTPException(400, f"SN {act.sn} not FQC ready")
        if cur["shipped_at"]:
            return JSONResponse(
                {
                    "status": "warning",
                    "message": f"SN {act.sn} already shipped",
                    "timestamp": cur["shipped_at"],
                }
            )
        db.execute(
            "UPDATE qc_records SET shipped_at=?, updated_at=? WHERE sn=?",
            (ts, ts, act.sn),
        )
        db.commit()
        msg = f"SN {act.sn} shipped"

    _invalidate_dashboard_cache()
    await _broadcast_dashboard_update(db)

    return {"status": "success", "message": msg, "timestamp": ts}


# ③  Dashboard --------------------------------------------------
@router.get("/dashboard", response_model=DashboardStats)
def dashboard(db: sqlite3.Connection = Depends(get_db)):
    return _get_dashboard(db)


# ③.5 趨勢時間序列（本月每日、本年每月的「已出貨」）
@router.get("/series")
def series(db: sqlite3.Connection = Depends(get_db)):
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
    rows_m = db.execute(
        """
        SELECT DATE(shipped_at) AS d, COUNT(*) AS c
        FROM qc_records
        WHERE shipped_at IS NOT NULL
          AND datetime(shipped_at) >= datetime(?)
          AND datetime(shipped_at) <  datetime(?)
        GROUP BY DATE(shipped_at)
        ORDER BY d
        """,
        (month_start.isoformat(), next_month_start.isoformat()),
    ).fetchall()
    daily_map = {r["d"]: r["c"] for r in rows_m}

    # 補齊沒有出貨的日期
    month_days = (next_month_start - month_start).days
    month_daily = []
    for i in range(month_days):
        d = (month_start + timedelta(days=i)).date().isoformat()
        month_daily.append({"date": d, "count": int(daily_map.get(d, 0))})

    # 2) 本年每月 shipped 統計
    rows_y = db.execute(
        """
        SELECT strftime('%Y-%m', shipped_at) AS ym, COUNT(*) AS c
        FROM qc_records
        WHERE shipped_at IS NOT NULL
          AND datetime(shipped_at) >= datetime(?)
          AND datetime(shipped_at) <  datetime(?)
        GROUP BY ym
        ORDER BY ym
        """,
        (year_start.isoformat(), next_year_start.isoformat()),
    ).fetchall()
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
    db: sqlite3.Connection = Depends(get_db),
):
    where_clauses: List[str] = []
    params: List[str] = []

    # 狀態條件
    if status == "pending":
        where_clauses.append("fqc_ready_at IS NOT NULL AND shipped_at IS NULL")
    elif status == "shipped":
        where_clauses.append("shipped_at IS NOT NULL")
    elif status and status != "all":
        raise HTTPException(400, "invalid status")

    # 日期區間（採用 COALESCE(shipped_at, fqc_ready_at, created_at) 作為基準時間）
    if from_date and to_date:
        start = datetime.strptime(from_date, "%Y-%m-%d")
        end = datetime.strptime(to_date, "%Y-%m-%d") + timedelta(days=1)
        where_clauses.append(
            "datetime(COALESCE(shipped_at, fqc_ready_at, created_at)) >= datetime(?) "
            "AND datetime(COALESCE(shipped_at, fqc_ready_at, created_at)) < datetime(?)"
        )
        params.extend([start.isoformat(), end.isoformat()])
    elif from_date:
        start = datetime.strptime(from_date, "%Y-%m-%d")
        where_clauses.append(
            "datetime(COALESCE(shipped_at, fqc_ready_at, created_at)) >= datetime(?)"
        )
        params.append(start.isoformat())
    elif to_date:
        end = datetime.strptime(to_date, "%Y-%m-%d") + timedelta(days=1)
        where_clauses.append(
            "datetime(COALESCE(shipped_at, fqc_ready_at, created_at)) < datetime(?)"
        )
        params.append(end.isoformat())

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    # 正確 total（帶相同 where/params）
    total = db.execute(
        f"SELECT COUNT(*) AS c FROM qc_records {where_sql}",
        params
    ).fetchone()[0]

    # 實際資料
    rows = db.execute(
        f"""
        SELECT * FROM qc_records
        {where_sql}
        ORDER BY COALESCE(shipped_at, fqc_ready_at, created_at) DESC
        LIMIT ? OFFSET ?
        """,
        (*params, limit, offset),
    ).fetchall()

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
    # 如果你的 FastAPI/Pydantic 是 v1 系，將下一行的 pattern= 改成 regex= 也可
    export_type: str = Query("all", pattern=r"^(all|fqc_only|shipped_only)$"),
    user=Depends(require_roles("admin", "qc")),
    db: sqlite3.Connection = Depends(get_db),
):
    start = datetime.strptime(from_date, "%Y-%m-%d")
    end = datetime.strptime(to_date, "%Y-%m-%d") + timedelta(days=1)

    cond, params = [], []
    if export_type == "fqc_only":
        cond.append(
            "datetime(fqc_ready_at) >= datetime(?) AND datetime(fqc_ready_at) < datetime(?) AND shipped_at IS NULL"
        )
        params.extend([start.isoformat(), end.isoformat()])
    elif export_type == "shipped_only":
        cond.append("datetime(shipped_at) >= datetime(?) AND datetime(shipped_at) < datetime(?)")
        params.extend([start.isoformat(), end.isoformat()])
    else:  # all
        cond.append(
            """(datetime(fqc_ready_at) >= datetime(?) AND datetime(fqc_ready_at) < datetime(?)) OR
               (datetime(shipped_at) >= datetime(?) AND datetime(shipped_at) < datetime(?))"""
        )
        params.extend([start.isoformat(), end.isoformat(), start.isoformat(), end.isoformat()])

    where = "WHERE " + " AND ".join(cond)
    rows = db.execute(f"SELECT * FROM qc_records {where} ORDER BY sn", params).fetchall()
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
    )


# ⑥  刪除 -------------------------------------------------------
@router.delete("/delete/{sn}", dependencies=[Depends(require_roles("admin"))])
async def delete(sn: str, db: sqlite3.Connection = Depends(get_db)):
    cur = db.execute("DELETE FROM qc_records WHERE sn = ?", (sn,))
    db.commit()
    if cur.rowcount == 0:
        raise HTTPException(404, f"{sn} not found")

    _invalidate_dashboard_cache()
    await _broadcast_dashboard_update(db)

    return {"status": "success", "message": f"record {sn} deleted"}


# ⑦ 批量檢查 ------------------------------------------------
@router.post("/batch-check")
def batch_check(batch_data: BatchCheckIn, db: sqlite3.Connection = Depends(get_db)):
    """一次查多個 SN, 單一 SQL 完成"""
    if not batch_data.sns:
        return {"results": []}

    placeholders = ",".join(["?"] * len(batch_data.sns))
    rows = db.execute(
        f"SELECT sn, fqc_ready_at, shipped_at FROM qc_records WHERE sn IN ({placeholders})",
        batch_data.sns,
    ).fetchall()
    row_map = {r["sn"]: r for r in rows}

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
async def batch_ship(batch_data: BatchShipIn, db: sqlite3.Connection = Depends(get_db)):
    sns = batch_data.sns
    if not sns:
        return {"status": "success", "message": "no sn provided", "results": []}

    ts = now_iso()
    placeholders = ",".join(["?"] * len(sns))
    cur_rows = db.execute(
        f"SELECT sn, fqc_ready_at, shipped_at FROM qc_records WHERE sn IN ({placeholders})",
        sns,
    ).fetchall()
    cur_map = {r["sn"]: r for r in cur_rows}

    results: List[Dict] = []
    success_count = 0

    for sn in sns:
        cur = cur_map.get(sn)
        if not cur:
            results.append({"sn": sn, "status": "error", "message": "SN not found"})
        elif not cur["fqc_ready_at"]:
            results.append({"sn": sn, "status": "error", "message": "Not FQC ready"})
        elif cur["shipped_at"]:
            results.append({"sn": sn, "status": "warning", "message": "Already shipped"})
        else:
            db.execute(
                "UPDATE qc_records SET shipped_at=?, updated_at=? WHERE sn=?",
                (ts, ts, sn),
            )
            results.append({"sn": sn, "status": "success", "message": "Shipped successfully"})
            success_count += 1

    db.commit()

    _invalidate_dashboard_cache()
    await _broadcast_dashboard_update(db)

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

    輸入：{ "sns": ["US_SN_1", "US_SN_2", ...] }
    輸出：Excel 文件（US_SN, PCBA_AU8, PCBA_AM7）
    檔名格式：YYYYMMDD_數量.xlsx (例如：20260105_25.xlsx)
    """
    sns = body.sns
    if not sns:
        raise HTTPException(400, "No serial numbers provided")

    # 連接 assembly.db
    conn_asm = sqlite3.connect(BACKEND_ROOT / "assembly.db")
    conn_asm.row_factory = sqlite3.Row

    try:
        # 批量查詢
        placeholders = ",".join(["?"] * len(sns))
        rows = conn_asm.execute(
            f"SELECT us_sn, au8, am7 FROM scans WHERE us_sn IN ({placeholders}) ORDER BY us_sn",
            sns
        ).fetchall()

        if not rows:
            raise HTTPException(404, "No matching records found in assembly database")

        # 找出數據庫中已找到的 SN
        found_sns = {row["us_sn"] for row in rows}

        # 找出缺失的 SN
        missing_sns = [sn for sn in sns if sn not in found_sns]

        # 準備 Excel 數據
        data = []
        for row in rows:
            data.append({
                "US_SN": row["us_sn"],
                "PCBA_AU8": row["au8"] or "",
                "PCBA_AM7": row["am7"] or ""
            })

        # 生成 Excel
        df = pd.DataFrame(data)
        tmp = NamedTemporaryFile(delete=False, suffix=".xlsx")

        with pd.ExcelWriter(tmp.name, engine="openpyxl") as writer:
            # 主表：找到的數據
            df.to_excel(writer, sheet_name="PCBA_Export", index=False)

            # 如果有缺失的 SN，創建第二個 sheet
            if missing_sns:
                missing_df = pd.DataFrame({"Missing_SN": missing_sns, "Status": ["Not found in database"] * len(missing_sns)})
                missing_df.to_excel(writer, sheet_name="Missing_SNs", index=False)

            # 自動調整欄寬 - PCBA_Export sheet
            worksheet = writer.sheets["PCBA_Export"]
            for column in worksheet.columns:
                max_length = 0
                column_letter = column[0].column_letter
                for cell in column:
                    try:
                        if len(str(cell.value)) > max_length:
                            max_length = len(str(cell.value))
                    except:
                        pass
                adjusted_width = min(max_length + 2, 30)
                worksheet.column_dimensions[column_letter].width = adjusted_width

            # 自動調整欄寬 - Missing_SNs sheet（如果存在）
            if missing_sns and "Missing_SNs" in writer.sheets:
                missing_ws = writer.sheets["Missing_SNs"]
                for column in missing_ws.columns:
                    max_length = 0
                    column_letter = column[0].column_letter
                    for cell in column:
                        try:
                            if len(str(cell.value)) > max_length:
                                max_length = len(str(cell.value))
                        except:
                            pass
                    adjusted_width = min(max_length + 2, 30)
                    missing_ws.column_dimensions[column_letter].width = adjusted_width

        # 檔案命名：YYYYMMDD_找到數量_總數量.xlsx (例如：20260109_123_124.xlsx)
        today = datetime.now().strftime("%Y%m%d")
        found_count = len(data)
        total_count = len(sns)

        if missing_sns:
            filename = f"{today}_{found_count}_{total_count}.xlsx"
        else:
            filename = f"{today}_{found_count}.xlsx"

        return FileResponse(
            tmp.name,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename=filename,
            headers={
                "X-Missing-Count": str(len(missing_sns)),
                "X-Found-Count": str(found_count),
                "X-Total-Count": str(total_count)
            }
        )

    finally:
        conn_asm.close()
