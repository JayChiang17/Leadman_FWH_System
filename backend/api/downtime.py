
from __future__ import annotations

from datetime import date, datetime, timedelta
import sqlite3
import pytz

from fastapi import APIRouter, Depends

from core.deps import get_current_user, require_roles
from core.downtime_db import get_downtime_db  # ⬅️ 使用統一連線池
from core.ws_manager import ws_manager
from models.downtime_model import DowntimeRecord

router = APIRouter(tags=["downtime"])

# ─────────── 公用工具 ───────────

def _to_hhmm(minutes: float) -> str:
    m = round(minutes)
    return f"{m // 60:02}:{m % 60:02}"

def _parse_datetime(dt_str: str) -> datetime:
    """接受多種格式並回傳 **UTC aware** datetime。"""
    fmts = [
        "%Y-%m-%dT%H:%M:%S.%fZ",  # ISO w/ microseconds
        "%Y-%m-%dT%H:%M:%SZ",     # ISO w/o microseconds
        "%Y-%m-%dT%H:%M:%S",      # HTML datetime‑local
        "%Y-%m-%d %H:%M:%S",      # SQL standard
        "%m/%d/%Y, %I:%M:%S %p",  # US w/ AM‑PM
        "%Y-%m-%dT%H:%M",         # HTML datetime‑local (min precision)
    ]
    for fmt in fmts:
        try:
            dt = datetime.strptime(dt_str, fmt)
            if dt.tzinfo is None:  # no tz ⇒ assume local (US/Pacific)
                dt = pytz.timezone("US/Pacific").localize(dt)
            return dt.astimezone(pytz.utc)
        except ValueError:
            continue
    raise ValueError(f"Invalid datetime format: {dt_str}")

def _fmt_for_edit(dt_str: str) -> str:
    """將 SQL datetime 轉 HTML <input type=datetime‑local> 字串"""
    try:
        return datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S").strftime("%Y-%m-%dT%H:%M")
    except ValueError:
        return dt_str  # 已經是正確格式

# ═══ ① 今日摘要 ═══════════════════════════════════════

@router.get("/downtime/summary/today", dependencies=[Depends(require_roles("admin", "operator", "viewer"))])
def today_summary(db: sqlite3.Connection = Depends(get_downtime_db)):
    today_iso = date.today().strftime("%Y-%m-%d")
    try:
        db.row_factory = sqlite3.Row
        rows = db.execute(
            """
            SELECT station, SUM(duration_min) AS minutes
            FROM downtime_logs
            WHERE start_local >= ?
            GROUP BY station
            ORDER BY minutes DESC
            """,
            (today_iso,),
        ).fetchall()

        labels, minutes, hhmm = [], [], []
        for r in rows:
            m = int(round(r["minutes"]))
            labels.append(r["station"])
            minutes.append(m)
            hhmm.append(_to_hhmm(m))

        return {
            "status": "success",
            "total_hh": _to_hhmm(sum(minutes)),
            "labels": labels,
            "minutes": minutes,
            "hhmm": hhmm,
        }
    except Exception as e:
        return {"status": "error", "message": f"❌ DB error: {e}"}

# ═══ ② 最近 7 天摘要 ══════════════════════════════════

@router.get("/downtime/summary/week", dependencies=[Depends(require_roles("admin", "operator", "viewer"))])
def week_summary(db: sqlite3.Connection = Depends(get_downtime_db)):
    today = date.today()
    start = today - timedelta(days=6)
    try:
        db.row_factory = sqlite3.Row
        rows = db.execute(
            """
            SELECT substr(start_local,1,10) AS day, SUM(duration_min) AS minutes
            FROM downtime_logs
            WHERE start_local BETWEEN ? AND ?
            GROUP BY day
            """,
            (start.strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d")),
        ).fetchall()

        day_map = {r["day"]: r["minutes"] for r in rows}
        labels, minutes, hhmm = [], [], []
        for i in range(7):
            d = start + timedelta(days=i)
            iso = d.strftime("%Y-%m-%d")
            m = round(day_map.get(iso, 0), 2)
            labels.append(iso[5:])
            minutes.append(m)
            hhmm.append(_to_hhmm(m))

        return {"status": "success", "labels": labels, "minutes": minutes, "hhmm": hhmm}
    except Exception as e:
        return {"status": "error", "message": f"❌ DB error: {e}"}

# ═══ ③ 新增記錄 ═══════════════════════════════════════

@router.post("/downtime", dependencies=[Depends(require_roles("admin", "operator"))])
async def add_downtime(
    record: DowntimeRecord,
    user: any = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_downtime_db),
):
    try:
        s_utc, e_utc = _parse_datetime(record.start_time), _parse_datetime(record.end_time)
        if e_utc < s_utc:
            return {"status": "error", "message": "❌ End time earlier than start time"}

        local_tz = pytz.timezone("US/Pacific")
        duration = round((e_utc - s_utc).total_seconds() / 60, 2)

        db.execute(
            """
            INSERT INTO downtime_logs (
              line, station, start_local, end_local, duration_min, created_at, created_by
            ) VALUES (?,?,?,?,?,?,?)
            """,
            (
                record.line,
                record.station,
                s_utc.astimezone(local_tz).strftime("%Y-%m-%d %H:%M:%S"),
                e_utc.astimezone(local_tz).strftime("%Y-%m-%d %H:%M:%S"),
                duration,
                datetime.now(local_tz).strftime("%Y-%m-%d %H:%M:%S"),
                user.username,
            ),
        )

        # WebSocket broadcast (best‑effort)
        try:
            await ws_manager.broadcast(
                {"event": "downtime_added", "line": record.line, "station": record.station, "duration": duration}
            )
        except Exception as ws_err:
            print(f"WebSocket broadcast error: {ws_err}")

        return {"status": "success", "message": f"{record.line.upper()} – {record.station} – {duration} min"}
    except ValueError as ve:
        return {"status": "error", "message": f"❌ Date error: {ve}"}
    except Exception as e:
        return {"status": "error", "message": f"❌ DB error: {e}"}

# ═══ ④ 列表 ═══════════════════════════════════════════

@router.get("/downtime/list", dependencies=[Depends(require_roles("admin", "operator", "viewer"))])
def list_records(db: sqlite3.Connection = Depends(get_downtime_db)):
    try:
        db.row_factory = sqlite3.Row
        rows = db.execute(
            """
            SELECT id, line, station, start_local, end_local,
                   duration_min, created_at, created_by, modified_by
            FROM downtime_logs
            ORDER BY created_at DESC
            LIMIT 300
            """
        ).fetchall()

        records = []
        for r in rows:
            rec = dict(r)
            rec["start_local_edit"] = _fmt_for_edit(rec["start_local"])
            rec["end_local_edit"] = _fmt_for_edit(rec["end_local"])
            records.append(rec)
        return {"status": "success", "records": records}
    except Exception as e:
        return {"status": "error", "message": f"❌ DB read error: {e}"}

# ═══ ⑤ 更新 ═══════════════════════════════════════════

@router.put("/downtime/{id}", dependencies=[Depends(require_roles("admin", "operator"))])
def update_record(
    id: int,
    updated: DowntimeRecord,
    user: any = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_downtime_db),
):
    try:
        s_utc, e_utc = _parse_datetime(updated.start_time), _parse_datetime(updated.end_time)
        if e_utc < s_utc:
            return {"status": "error", "message": "❌ End time < start time"}

        local_tz = pytz.timezone("US/Pacific")
        duration = round((e_utc - s_utc).total_seconds() / 60, 2)

        cur = db.execute(
            """
            UPDATE downtime_logs
            SET line = ?, station = ?, start_local = ?, end_local = ?,
                duration_min = ?, modified_by = ?
            WHERE id = ?
            """,
            (
                updated.line,
                updated.station,
                s_utc.astimezone(local_tz).strftime("%Y-%m-%d %H:%M:%S"),
                e_utc.astimezone(local_tz).strftime("%Y-%m-%d %H:%M:%S"),
                duration,
                user.username,
                id,
            ),
        )
        if cur.rowcount == 0:
            return {"status": "error", "message": f"❌ No record id {id}"}
        return {"status": "success", "message": f"✅ Record {id} updated", "duration_min": duration}
    except Exception as e:
        return {"status": "error", "message": f"❌ DB error: {e}"}

# ═══ ⑥ 刪除 ═══════════════════════════════════════════

@router.delete("/downtime/{id}", dependencies=[Depends(require_roles("admin" , "operator"))])
def delete_record(id: int, db: sqlite3.Connection = Depends(get_downtime_db)):
    try:
        cur = db.execute("DELETE FROM downtime_logs WHERE id = ?", (id,))
        if cur.rowcount == 0:
            return {"status": "error", "message": f"❌ No record id {id}"}
        return {"status": "success", "message": f"✅ Record {id} deleted"}
    except Exception as e:
        return {"status": "error", "message": f"❌ DB delete error: {e}"}
