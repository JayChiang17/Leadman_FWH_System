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
    """
    解析多種前端可能送來的格式，回傳「UTC-aware」的 datetime。
    規則：
      - 帶 Z 的字串：視為 UTC
      - 帶 +HH:MM/-HH:MM 偏移：依偏移換算
      - 沒有任何時區資訊：視為 US/Pacific 本地時間
    """
    s = (dt_str or "").strip()
    if not s:
        raise ValueError("Empty datetime string")

    # 1) Z 結尾 → UTC
    if s.endswith("Z"):
        # 優先用 fromisoformat（需將 Z 換成 +00:00）
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(pytz.utc)
        except ValueError:
            pass
        # 備援：嘗試精確格式（含/不含毫秒）
        for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ"):
            try:
                return datetime.strptime(s, fmt).replace(tzinfo=pytz.utc)
            except ValueError:
                continue
        raise ValueError(f"Invalid ISO (with Z): {dt_str}")

    # 2) 嘗試解析帶偏移（+HH:MM / -HH:MM）
    # Python 3.11 的 fromisoformat 支援 "+HH:MM" 偏移
    try:
        dt = datetime.fromisoformat(s)  # 可能 aware / naive
        if dt.tzinfo is not None:
            return dt.astimezone(pytz.utc)
    except ValueError:
        # 不是合法 ISO，往下走自定義格式
        pass

    # 3) 沒有任何時區 → 視為 US/Pacific 本地
    fmts = [
        "%Y-%m-%dT%H:%M:%S.%f",  # ISO 無 Z（有毫秒）
        "%Y-%m-%dT%H:%M:%S",     # ISO 無 Z（到秒）
        "%Y-%m-%d %H:%M:%S",     # SQL 標準
        "%m/%d/%Y, %I:%M:%S %p", # 美式 with AM/PM
        "%Y-%m-%dT%H:%M",        # datetime-local（分）
    ]
    for fmt in fmts:
        try:
            naive = datetime.strptime(s, fmt)
            local = pytz.timezone("US/Pacific").localize(naive)
            return local.astimezone(pytz.utc)
        except ValueError:
            continue

    raise ValueError(f"Invalid datetime format: {dt_str}")

def _fmt_for_edit(dt_str: str) -> str:
    """將 SQL datetime 'YYYY-MM-DD HH:MM:SS' 轉成 <input type=datetime-local> 可用的 'YYYY-MM-DDTHH:MM'。"""
    try:
        return datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S").strftime("%Y-%m-%dT%H:%M")
    except ValueError:
        return dt_str  # 已經是正確格式或異常就原樣回傳

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
            m = int(round(r["minutes"] or 0))
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
    today_d = date.today()
    start = today_d - timedelta(days=6)
    try:
        db.row_factory = sqlite3.Row
        rows = db.execute(
            """
            SELECT substr(start_local,1,10) AS day, SUM(duration_min) AS minutes
            FROM downtime_logs
            WHERE start_local BETWEEN ? AND ?
            GROUP BY day
            """,
            (start.strftime("%Y-%m-%d"), today_d.strftime("%Y-%m-%d")),
        ).fetchall()

        day_map = {r["day"]: (r["minutes"] or 0) for r in rows}
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
                getattr(user, "username", "system"),
            ),
        )
        db.commit()  # ← 確保落盤

        # WebSocket broadcast (best-effort)
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
                getattr(user, "username", "system"),
                id,
            ),
        )
        db.commit()  # ← 確保落盤
        if cur.rowcount == 0:
            return {"status": "error", "message": f"❌ No record id {id}"}
        return {"status": "success", "message": f"✅ Record {id} updated", "duration_min": duration}
    except ValueError as ve:
        return {"status": "error", "message": f"❌ Date error: {ve}"}
    except Exception as e:
        return {"status": "error", "message": f"❌ DB error: {e}"}

# ═══ ⑥ 刪除 ═══════════════════════════════════════════

@router.delete("/downtime/{id}", dependencies=[Depends(require_roles("admin" , "operator"))])
def delete_record(id: int, db: sqlite3.Connection = Depends(get_downtime_db)):
    try:
        cur = db.execute("DELETE FROM downtime_logs WHERE id = ?", (id,))
        db.commit()  # ← 確保落盤
        if cur.rowcount == 0:
            return {"status": "error", "message": f"❌ No record id {id}"}
        return {"status": "success", "message": f"✅ Record {id} deleted"}
    except Exception as e:
        return {"status": "error", "message": f"❌ DB delete error: {e}"}
