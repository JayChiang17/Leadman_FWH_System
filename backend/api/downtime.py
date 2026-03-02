from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any

import pytz

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends

from core.deps import get_current_user, require_roles
from core.downtime_db import get_downtime_db
from core.ws_manager import ws_manager
from core.monitor_db import log_audit
from core.time_utils import ca_day_bounds, ca_now_str, ca_range_bounds, ca_today
from models.downtime_model import DowntimeRecord

router = APIRouter(tags=["downtime"])

# ─────────── 公用工具 ───────────

def _to_hhmm(minutes: float) -> str:
    m = round(minutes)
    return f"{m // 60:02}:{m % 60:02}"

def _parse_datetime(dt_str: str) -> datetime:
    s = (dt_str or "").strip()
    if not s:
        raise ValueError("Empty datetime string")

    if s.endswith("Z"):
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(pytz.utc)
        except ValueError:
            pass
        for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ"):
            try:
                return datetime.strptime(s, fmt).replace(tzinfo=pytz.utc)
            except ValueError:
                continue
        raise ValueError(f"Invalid ISO (with Z): {dt_str}")

    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is not None:
            return dt.astimezone(pytz.utc)
    except ValueError:
        pass

    fmts = [
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%m/%d/%Y, %I:%M:%S %p",
        "%Y-%m-%dT%H:%M",
    ]
    for fmt in fmts:
        try:
            naive = datetime.strptime(s, fmt)
            local = pytz.timezone("US/Pacific").localize(naive)
            return local.astimezone(pytz.utc)
        except ValueError:
            continue

    raise ValueError(f"Invalid datetime format: {dt_str}")

def _fmt_for_edit(dt_val) -> str:
    if isinstance(dt_val, datetime):
        return dt_val.strftime("%Y-%m-%dT%H:%M")
    try:
        return datetime.strptime(str(dt_val), "%Y-%m-%d %H:%M:%S").strftime("%Y-%m-%dT%H:%M")
    except ValueError:
        return str(dt_val)

# ═══ ① 今日摘要 ═══════════════════════════════════════

@router.get("/downtime/summary/today", dependencies=[Depends(require_roles("admin", "operator", "viewer"))])
def today_summary(db=Depends(get_downtime_db)):
    conn, cur = db
    start_ts, end_ts = ca_day_bounds(ca_today())
    try:
        cur.execute(
            """
            SELECT
                station,
                line,
                SUM(duration_min) AS total_minutes,
                COUNT(*) AS event_count,
                MAX(duration_min) AS max_single_duration
            FROM downtime_logs
            WHERE start_local >= %s AND start_local < %s
            GROUP BY station, line
            ORDER BY total_minutes DESC
            LIMIT 15
            """,
            (start_ts, end_ts),
        )
        rows = cur.fetchall()

        stations = []
        cell_total = 0
        assembly_total = 0
        total_events = 0

        for r in rows:
            total_min = round(r["total_minutes"], 2)
            count = r["event_count"]

            stations.append({
                "station": r["station"],
                "line": r["line"],
                "total_minutes": total_min,
                "total_hhmm": _to_hhmm(total_min),
                "event_count": count,
                "avg_duration": round(total_min / count, 2) if count > 0 else 0,
                "max_duration": round(r["max_single_duration"], 2)
            })

            if r["line"] == "cell":
                cell_total += total_min
            elif r["line"] == "assembly":
                assembly_total += total_min

            total_events += count

        return {
            "status": "success",
            "data": stations,
            "summary": {
                "cell_total": round(cell_total, 2),
                "cell_total_hhmm": _to_hhmm(cell_total),
                "assembly_total": round(assembly_total, 2),
                "assembly_total_hhmm": _to_hhmm(assembly_total),
                "total_downtime": round(cell_total + assembly_total, 2),
                "total_downtime_hhmm": _to_hhmm(cell_total + assembly_total),
                "total_events": total_events
            }
        }
    except Exception as e:
        return {"status": "error", "message": f"DB error: {e}"}

# ═══ ② 最近 7 天摘要 ══════════════════════════════════

@router.get("/downtime/summary/week", dependencies=[Depends(require_roles("admin", "operator", "viewer"))])
def week_summary(db=Depends(get_downtime_db)):
    conn, cur = db
    today_d = ca_today()
    start = today_d - timedelta(days=6)
    try:
        start_ts, end_ts = ca_range_bounds(start, today_d)
        cur.execute(
            """
            SELECT line, start_local, duration_min
            FROM downtime_logs
            WHERE start_local >= %s AND start_local < %s
            ORDER BY start_local ASC
            """,
            (start_ts, end_ts),
        )
        rows = cur.fetchall()

        records = [dict(r) for r in rows]

        result = {
            "status": "success",
            "records": records
        }

        logger.debug("[week_summary] returning %d records", len(records))

        return result
    except Exception as e:
        logger.error("[week_summary] error: %s", e)
        return {"status": "error", "message": f"DB error: {e}"}

# ═══ ③ 新增記錄 ═══════════════════════════════════════

@router.post("/downtime", dependencies=[Depends(require_roles("admin", "operator"))])
async def add_downtime(
    record: DowntimeRecord,
    user: Any = Depends(get_current_user),
    db=Depends(get_downtime_db),
):
    conn, cur = db
    try:
        s_utc, e_utc = _parse_datetime(record.start_time), _parse_datetime(record.end_time)
        if e_utc < s_utc:
            return {"status": "error", "message": "End time earlier than start time"}

        local_tz = pytz.timezone("US/Pacific")
        duration = round((e_utc - s_utc).total_seconds() / 60, 2)

        cur.execute(
            """
            INSERT INTO downtime_logs (
              line, station, start_local, end_local, duration_min, created_at, created_by
            ) VALUES (%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                record.line,
                record.station,
                s_utc.astimezone(local_tz),
                e_utc.astimezone(local_tz),
                duration,
                datetime.now(pytz.utc),
                getattr(user, "username", "system"),
            ),
        )
        conn.commit()

        try:
            await ws_manager.broadcast(
                {"event": "downtime_added", "line": record.line, "station": record.station, "duration": duration}
            )
        except Exception as ws_err:
            print(f"WebSocket broadcast error: {ws_err}")

        log_audit(user=getattr(user, "username", "system"), action="downtime_add",
                  target=f"{record.line}/{record.station}", new_value=f"{duration} min")

        return {"status": "success", "message": f"{record.line.upper()} – {record.station} – {duration} min"}
    except ValueError as ve:
        return {"status": "error", "message": f"Date error: {ve}"}
    except Exception as e:
        return {"status": "error", "message": f"DB error: {e}"}

# ═══ ④ 列表 ═══════════════════════════════════════════

@router.get("/downtime/list", dependencies=[Depends(require_roles("admin", "operator", "viewer"))])
def list_records(db=Depends(get_downtime_db)):
    conn, cur = db
    try:
        cur.execute(
            """
            SELECT id, line, station, start_local, end_local,
                   duration_min, created_at, created_by, modified_by
            FROM downtime_logs
            ORDER BY created_at DESC
            LIMIT 300
            """
        )
        rows = cur.fetchall()

        records = []
        for r in rows:
            rec = dict(r)
            rec["start_local_edit"] = _fmt_for_edit(rec["start_local"])
            rec["end_local_edit"] = _fmt_for_edit(rec["end_local"])
            records.append(rec)
        return {"status": "success", "records": records}
    except Exception as e:
        return {"status": "error", "message": f"DB read error: {e}"}

# ═══ ④-B 今日事件明細（用於 UPH 圖表疊加） ═══════════════
@router.get("/downtime/events/today", dependencies=[Depends(require_roles("admin", "operator", "viewer"))])
def today_events(db=Depends(get_downtime_db)):
    conn, cur = db
    start_ts, end_ts = ca_day_bounds(ca_today())
    try:
        cur.execute(
            """
            SELECT id, line, station, start_local, end_local,
                   duration_min, downtime_type, reason
            FROM downtime_logs
            WHERE start_local >= %s AND start_local < %s
            ORDER BY start_local ASC
            """,
            (start_ts, end_ts),
        )
        rows = cur.fetchall()

        records = []
        for r in rows:
            records.append({
                "id": r["id"],
                "line": r["line"],
                "station": r["station"],
                "start_local": r["start_local"],
                "end_local": r["end_local"],
                "duration_min": round(r["duration_min"], 1),
                "downtime_type": r["downtime_type"] or "Other",
                "reason": r["reason"]
            })
        return {"status": "success", "records": records}
    except Exception as e:
        return {"status": "error", "message": f"DB read error: {e}"}

# ═══ ⑤ 更新 ═══════════════════════════════════════════

@router.put("/downtime/{id}", dependencies=[Depends(require_roles("admin", "operator"))])
def update_record(
    id: int,
    updated: DowntimeRecord,
    user: Any = Depends(get_current_user),
    db=Depends(get_downtime_db),
):
    conn, cur = db
    try:
        s_utc, e_utc = _parse_datetime(updated.start_time), _parse_datetime(updated.end_time)
        if e_utc < s_utc:
            return {"status": "error", "message": "End time < start time"}

        local_tz = pytz.timezone("US/Pacific")
        duration = round((e_utc - s_utc).total_seconds() / 60, 2)

        cur.execute(
            """
            UPDATE downtime_logs
            SET line = %s, station = %s, start_local = %s, end_local = %s,
                duration_min = %s, modified_by = %s
            WHERE id = %s
            """,
            (
                updated.line,
                updated.station,
                s_utc.astimezone(local_tz),
                e_utc.astimezone(local_tz),
                duration,
                getattr(user, "username", "system"),
                id,
            ),
        )
        conn.commit()
        if cur.rowcount == 0:
            return {"status": "error", "message": f"No record id {id}"}
        return {"status": "success", "message": f"Record {id} updated", "duration_min": duration}
    except ValueError as ve:
        return {"status": "error", "message": f"Date error: {ve}"}
    except Exception as e:
        return {"status": "error", "message": f"DB error: {e}"}

# ═══ ⑥ 刪除 ═══════════════════════════════════════════

@router.delete("/downtime/{id}", dependencies=[Depends(require_roles("admin" , "operator"))])
def delete_record(id: int, user: Any = Depends(get_current_user), db=Depends(get_downtime_db)):
    conn, cur = db
    try:
        cur.execute("DELETE FROM downtime_logs WHERE id = %s", (id,))
        conn.commit()
        if cur.rowcount == 0:
            return {"status": "error", "message": f"No record id {id}"}
        log_audit(user=getattr(user, "username", "system"), action="downtime_delete", target=str(id))
        return {"status": "success", "message": f"Record {id} deleted"}
    except Exception as e:
        return {"status": "error", "message": f"DB delete error: {e}"}
