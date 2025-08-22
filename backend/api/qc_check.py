"""QC Check REST router – prefix=/api/qc  (optimized)"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Dict, Optional, List, Generator

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
)

# ─────────────────────────── DB & helpers ──────────────────────────────
ROOT_HINT = "qc_v2.db"
BACKEND_ROOT = Path(__file__).resolve().parents[1]  # …/backend
DB_PATH = BACKEND_ROOT / ROOT_HINT  # backend/qc_v2.db

# SQLite – 每次請求開一條連線，並啟用 WAL 以提升並發寫入
def get_db() -> Generator[sqlite3.Connection, None, None]:
    """FastAPI dependency that yields database connection"""
    # 加入 check_same_thread=False 解決線程問題
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
        conn.commit()
    finally:
        conn.close()

_init_schema()

# 時間工具
now_iso = lambda: datetime.now().isoformat()

# ────────────────────────── Dashboard 快取 ────────────────────────────
_DASHBOARD_CACHE: Dict[str, any] = {}
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


# ④  Records 查詢 ----------------------------------------------
@router.get("/records")
def records(
    status: str | None = Query(None, description="all|pending|shipped"),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    db: sqlite3.Connection = Depends(get_db),
):
    where = ""
    if status == "pending":
        where = "WHERE fqc_ready_at IS NOT NULL AND shipped_at IS NULL"
    elif status == "shipped":
        where = "WHERE shipped_at IS NOT NULL"
    elif status and status != "all":
        raise HTTPException(400, "invalid status")

    total = db.execute(f"SELECT COUNT(*) FROM qc_records {where}").fetchone()[0]
    rows = db.execute(
        f"""
        SELECT * FROM qc_records {where}
        ORDER BY COALESCE(shipped_at, fqc_ready_at, created_at) DESC
        LIMIT ? OFFSET ?""",
        (limit, offset),
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
        "total": total,
        "limit": limit,
        "offset": offset,
        "records": [fmt(r) for r in rows],
    }


# ⑤  匯出 Excel -------------------------------------------------
@router.get("/export")
def export(
    from_date: str = Query(..., pattern=r"\d{4}-\d{2}-\d{2}"),
    to_date: str = Query(..., pattern=r"\d{4}-\d{2}-\d{2}"),
    export_type: str = Query("all", regex="^(all|fqc_only|shipped_only)$"),
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
    rows = db.execute(
        f"SELECT * FROM qc_records {where} ORDER BY sn", params
    ).fetchall()
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

    # 寫入臨時檔，避免全部吃進記憶體
    tmp = None
    try:
        tmp = NamedTemporaryFile(delete=False, suffix=".xlsx")
        with pd.ExcelWriter(tmp.name, engine="openpyxl") as w:
            df.to_excel(w, index=False, sheet_name="QC Records")

        fn = f"qc_export_{from_date}_to_{to_date}_{export_type}.xlsx"
        return FileResponse(
            tmp.name,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename=fn,
        )
    finally:
        # 交給 FileResponse 下載完後系統自動清理 (linux), windows 需手動或排程刪
        pass


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