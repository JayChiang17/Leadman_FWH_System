from fastapi import (
    APIRouter, Request, Depends, HTTPException, Query, Body
)
from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo
from collections import defaultdict
from typing import Optional, List, Dict, Any, Tuple
import sqlite3, json, time, logging, os, calendar

from core.ws_manager import ws_manager
from core.deps import require_roles, get_current_user
from models.assembly_inventory_model import AssemblyRecordIn, AssemblyRecordOut
from pydantic import BaseModel

# ─────────────────────────── Base setup ───────────────────────────
logger = logging.getLogger(__name__)
router = APIRouter(tags=["assembly"])

TZ = ZoneInfo("America/Los_Angeles")
def today()   -> date:   return datetime.now(TZ).date()
def now_str() -> str:    return datetime.now(TZ).strftime("%Y-%m-%d %H:%M:%S")

PURGE_DAYS = 30
RATE_LIMIT_MS = 300
MAX_REQUESTS_PER_MIN = 60

# ────────────────────── SQLite & table initialization ─────────────────────
DB = sqlite3.connect("assembly.db", check_same_thread=False)
DB.row_factory = sqlite3.Row
DB.execute("PRAGMA journal_mode=WAL")
DB.executescript("""
CREATE TABLE IF NOT EXISTS scans(
  id        INTEGER PRIMARY KEY,
  ts        TEXT,
  cn_sn     TEXT,
  us_sn     TEXT,
  mod_a     TEXT,
  mod_b     TEXT,
  au8       TEXT,
  am7       TEXT,
  status    TEXT DEFAULT '',
  ng_reason TEXT DEFAULT '',
  UNIQUE(cn_sn), UNIQUE(us_sn), UNIQUE(mod_a), UNIQUE(mod_b),
  UNIQUE(au8), UNIQUE(am7)
);
CREATE TABLE IF NOT EXISTS daily_summary(
  day   TEXT PRIMARY KEY,
  total INTEGER DEFAULT 0,
  ng    INTEGER DEFAULT 0,
  fixed INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS assembly_weekly_plan(
  week_start TEXT PRIMARY KEY,
  plan_json  TEXT
);
""")
# Backfill columns for older schemas
for col in ("ng", "fixed"):
    try:
        DB.execute(f"ALTER TABLE daily_summary ADD COLUMN {col} INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
try:
    DB.execute("ALTER TABLE scans ADD COLUMN ng_reason TEXT DEFAULT ''")
except sqlite3.OperationalError:
    pass
DB.commit()

# ────────────────────────── In-memory cache ──────────────────────────
RAM_SN = set()                # for fast de-duplication
hourly = defaultdict(int)     # counts for "today", grouped by hour (00..23)
TODAY  = today()              # snapshot of current local day
last_ip_time: Dict[str, float] = {}
ip_req_hist  = defaultdict(list)

# Load recent SNs into RAM and today's hourly counts on startup
cut = (TODAY - timedelta(days=PURGE_DAYS)).strftime("%Y-%m-%d")
for r in DB.execute("SELECT * FROM scans WHERE ts >= ?", (cut,)):
    for f in ("cn_sn","us_sn","mod_a","mod_b","au8","am7"):
        v = r[f]
        if v and v.strip().upper() != "N/A":
            RAM_SN.add(v.strip())
    if r["ts"].startswith(TODAY.strftime("%Y-%m-%d")):
        hourly[r["ts"][11:13]] += 1

# ───────────────────────────── Helpers ──────────────────────────────
def clean_u(s: Optional[str]) -> Optional[str]:
    """Trim; convert empty string or 'N/A' to None (stored as NULL to avoid UNIQUE collisions)."""
    if not s:
        return None
    v = s.strip()
    if not v or v.upper() == "N/A":
        return None
    return v

def _counts_for_day(day_str: str) -> Tuple[int,int,int]:
    """Return (total, ng_including_fixed, fixed) for a YYYY-MM-DD day."""
    row = DB.execute("""
        SELECT COUNT(*) AS tot,
               SUM(CASE WHEN UPPER(status) IN ('NG','FIXED') THEN 1 ELSE 0 END) AS ng_all,
               SUM(CASE WHEN UPPER(status)='FIXED' THEN 1 ELSE 0 END) AS fixed
        FROM scans WHERE date(ts)=?
    """, (day_str,)).fetchone()
    return int(row["tot"] or 0), int(row["ng_all"] or 0), int(row["fixed"] or 0)

def rollover() -> None:
    """
    Day rollover: persist yesterday's totals (total/ng/fixed) into daily_summary
    and reset in-memory hourly.
    Called opportunistically at the beginning of read/write endpoints.
    """
    global TODAY, hourly
    now_day = today()
    if now_day != TODAY:
        y_str = TODAY.strftime("%Y-%m-%d")
        tot, ng_all, fixed = _counts_for_day(y_str)
        DB.execute("""
            INSERT INTO daily_summary(day,total,ng,fixed)
            VALUES(?,?,?,?)
            ON CONFLICT(day) DO UPDATE SET total=?, ng=?, fixed=?""",
            (y_str, tot, ng_all, fixed, tot, ng_all, fixed))
        DB.commit()
        TODAY = now_day
        hourly.clear()

def check_rate_limit(ip: str) -> bool:
    """Simple per-IP sliding-window limiter and minimal inter-request spacing."""
    now = time.time()
    ip_req_hist[ip] = [t for t in ip_req_hist[ip] if t > now - 60]
    if len(ip_req_hist[ip]) >= MAX_REQUESTS_PER_MIN:
        return False
    if ip in last_ip_time and (now - last_ip_time[ip])*1000 < RATE_LIMIT_MS:
        return False
    ip_req_hist[ip].append(now)
    last_ip_time[ip] = now
    return True

def this_monday(d: Optional[date]=None) -> date:
    t = d or today()
    return t - timedelta(days=t.weekday())

def today_range_str() -> tuple[str, str]:
    d = today().strftime("%Y-%m-%d")
    return f"{d} 00:00:00", f"{d} 23:59:59"

# ───────── PCBA live inventory/statistics (read from pcba.db) ─────────
def _pcba_db_path() -> str:
    return str((os.getenv("PCBA_DB_PATH") or "pcba.db"))

# === Utils for PCBA serials normalization ===
def _normalize_serial(s: Optional[str]) -> str:
    return (s or "").upper().replace(" ", "").replace("-", "")

def _pcba_completed_serials_by_model(conn_pcba: sqlite3.Connection) -> Dict[str, List[str]]:
    conn_pcba.row_factory = sqlite3.Row
    rows = conn_pcba.execute("""
        SELECT UPPER(model) AS m, serial_number
        FROM boards
        WHERE stage='completed' AND (ng_flag IS NULL OR ng_flag=0)
    """).fetchall()
    out: Dict[str, List[str]] = {"AM7": [], "AU8": []}
    for r in rows:
        norm = _normalize_serial(r["serial_number"])
        if not norm:
            continue
        out.setdefault(r["m"], []).append(norm)
    out.setdefault("AM7", [])
    out.setdefault("AU8", [])
    return out

def _assembly_usage_counts_limited_to_pcba(conn_pcba: sqlite3.Connection) -> Dict[str, int]:
    """
    只計算『存在於 PCBA 且已完成(非 NG)』的序號在 assembly.db 被掃描過的數量，
    使用 CTE (WITH ... VALUES ...) 做序號清單，不建立任何暫存表，並做 DISTINCT 去重。
    """
    serials = _pcba_completed_serials_by_model(conn_pcba)

    def _count_used(col: str, values: List[str]) -> int:
        vals_norm = [_normalize_serial(v) for v in values if v]
        if not vals_norm:
            return 0
        placeholders = ",".join(["(?)"] * len(vals_norm))
        sql = f"""
            WITH s(serial) AS (VALUES {placeholders})
            SELECT COUNT(DISTINCT REPLACE(REPLACE(UPPER(scn), '-', ''), ' ', '')) AS c
            FROM (
                SELECT {col} AS scn
                FROM scans
                WHERE {col} IS NOT NULL AND TRIM(UPPER({col})) <> 'N/A'
            )
            JOIN s ON REPLACE(REPLACE(UPPER(scn), '-', ''), ' ', '') = s.serial
        """
        row = DB.execute(sql, vals_norm).fetchone()
        return int((row["c"] if isinstance(row, sqlite3.Row) else row[0]) or 0)

    return {
        "AM7": _count_used("am7", serials.get("AM7", [])),
        "AU8": _count_used("au8", serials.get("AU8", [])),
    }

# 舊的簡單統計（保留做為 fallback）
def _assembly_usage_counts() -> Dict[str, int]:
    am7_used = int(DB.execute(
        "SELECT COUNT(*) AS c FROM scans WHERE am7 IS NOT NULL AND TRIM(UPPER(am7)) <> 'N/A'"
    ).fetchone()["c"] or 0)
    au8_used = int(DB.execute(
        "SELECT COUNT(*) AS c FROM scans WHERE au8 IS NOT NULL AND TRIM(UPPER(au8)) <> 'N/A'"
    ).fetchone()["c"] or 0)
    return {"AM7": am7_used, "AU8": au8_used}

def _pcba_completed_by_model_ex_ng(conn: sqlite3.Connection) -> Dict[str, int]:
    """PCBA Completed (excluding NG) grouped by model."""
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT UPPER(model) AS m, COUNT(*) AS c
        FROM boards
        WHERE stage='completed' AND (ng_flag IS NULL OR ng_flag=0)
        GROUP BY UPPER(model)
    """).fetchall()
    out = {"AM7": 0, "AU8": 0}
    for r in rows:
        out[r["m"]] = int(r["c"] or 0)
    return out

def _pcba_stage_totals(conn: sqlite3.Connection) -> Tuple[int,int,int,int]:
    r = conn.execute("""
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN stage='aging'     THEN 1 ELSE 0 END) AS aging,
               SUM(CASE WHEN stage='coating'   THEN 1 ELSE 0 END) AS coating,
               SUM(CASE WHEN stage='completed' THEN 1 ELSE 0 END) AS completed
        FROM boards
    """).fetchone()
    return int(r["total"] or 0), int(r["aging"] or 0), int(r["coating"] or 0), int(r["completed"] or 0)

def _pcba_by_model(conn: sqlite3.Connection) -> Dict[str, Dict[str, int]]:
    """Unfiltered byModel aggregation (total/aging/coating/completed)."""
    rows = conn.execute("""
        SELECT UPPER(model) AS m,
               COUNT(*) AS total,
               SUM(CASE WHEN stage='aging'     THEN 1 ELSE 0 END) AS aging,
               SUM(CASE WHEN stage='coating'   THEN 1 ELSE 0 END) AS coating,
               SUM(CASE WHEN stage='completed' THEN 1 ELSE 0 END) AS completed
        FROM boards
        GROUP BY UPPER(model)
    """).fetchall()
    out: Dict[str, Dict[str,int]] = {}
    for r in rows:
        out[r["m"]] = {
            "total": int(r["total"] or 0),
            "aging": int(r["aging"] or 0),
            "coating": int(r["coating"] or 0),
            "completed": int(r["completed"] or 0),
        }
    return out

def _compute_pcba_statistics_payload() -> Dict[str, Any]:
    """
    Build a payload compatible with /pcba/statistics for broadcasting.
    NOTE: pairsDone is based on *available* pairs (min of available AM7/AU8).
    """
    try:
        pcba = sqlite3.connect(_pcba_db_path())
        pcba.row_factory = sqlite3.Row
    except Exception as e:
        logger.error("open pcba.db failed: %s", e)
        used = _assembly_usage_counts()
        return {
            "total":0,"aging":0,"coating":0,"completed":0,"efficiency":0.0,
            "byModel":{},
            "completedByModel":{"AM7":0,"AU8":0},
            "consumedAM7":used["AM7"],"consumedAU8":used["AU8"],"consumedTotal":used["AM7"]+used["AU8"],
            "availableAM7":0,"availableAU8":0,"availableTotal":0,
            "pairsDone":0,
        }

    try:
        total, aging, coating, completed = _pcba_stage_totals(pcba)
        by_model = _pcba_by_model(pcba)
        completed_by_model = _pcba_completed_by_model_ex_ng(pcba)

        # ★ used 改為「僅計 PCBA 完成清單 + DISTINCT」（CTE，無 TEMP 表）
        used = _assembly_usage_counts_limited_to_pcba(pcba)
        am7_used, au8_used = used["AM7"], used["AU8"]

        avail_am7 = max(completed_by_model["AM7"] - am7_used, 0)
        avail_au8 = max(completed_by_model["AU8"] - au8_used, 0)
        payload = {
            "total": total,
            "aging": aging,
            "coating": coating,
            "completed": completed,
            "efficiency": round(completed / total * 100, 1) if total else 0.0,
            "byModel": {k: {"total":v["total"],"aging":v["aging"],"coating":v["coating"],"completed":v["completed"]} for k,v in by_model.items() },
            "completedByModel": completed_by_model,
            "consumedAM7": am7_used,
            "consumedAU8": au8_used,
            "consumedTotal": am7_used + au8_used,
            "availableAM7": avail_am7,
            "availableAU8": avail_au8,
            "availableTotal": avail_am7 + avail_au8,
            "pairsDone": min(avail_am7, avail_au8),
        }
        return payload
    finally:
        try: pcba.close()
        except Exception: pass

async def _broadcast_pcba_statistics():
    """Broadcast PCBA statistics so dashboards update immediately when assembly usage changes."""
    payload = _compute_pcba_statistics_payload()
    try:
        await ws_manager.broadcast({"type": "statistics_update", "statistics": payload})
    except Exception as e:
        logger.warning("broadcast statistics_update failed: %s", e)

# ──────────────────────── Plan expansion helpers (UPDATED) ────────────────────────

def _week_start_str_for(d: date) -> str:
    mon = d - timedelta(days=d.weekday())
    return mon.strftime("%Y-%m-%d")

def _get_week_plan_json(week_start_str: str) -> Optional[str]:
    row = DB.execute(
        "SELECT plan_json FROM assembly_weekly_plan WHERE week_start=?",
        (week_start_str,)
    ).fetchone()
    return row["plan_json"] if row else None

def _parse_plan_json(plan_json: Optional[str]):
    if not plan_json:
        return None
    try:
        return json.loads(plan_json)
    except Exception:
        return None

def _plan_for_date_from_pj(pj, target: date) -> Tuple[int, Optional[int], Optional[int]]:
    """
    Return (plan_total, plan_a, plan_b) for a target date given a parsed plan_json.
    - If pj is a list: index 0..6 = Mon..Sun (若只有 5/6 天則未提供的日為 0)
    - If pj is a dict:
        - key could be 'YYYY-MM-DD' -> value can be total int OR {"A":x,"B":y}.
    - If no plan configured, use default Mon–Fri=90, Sat=0, Sun=0.
    """
    default_week = [90, 90, 90, 90, 90, 0, 0]  # Mon..Sun

    if pj is None:
        return (default_week[target.weekday()], None, None)

    # List form
    if isinstance(pj, list):
        idx = target.weekday()  # 0=Mon..6=Sun
        if idx >= len(pj):
            return (0, None, None)
        try:
            total = int(pj[idx] or 0)
        except Exception:
            total = 0
        return (total, None, None)

    # Dict form
    if isinstance(pj, dict):
        key = target.strftime("%Y-%m-%d")
        v = pj.get(key)
        if v is None:
            return (0, None, None)
        if isinstance(v, dict):
            a = int(v.get("A", 0) or 0)
            b = int(v.get("B", 0) or 0)
            return (a+b, a, b)
        try:
            total = int(v or 0)
        except Exception:
            total = 0
        return (total, None, None)

    return (0, None, None)

def _expand_plan_range(start_d: date, end_d: date) -> List[Dict[str, Any]]:
    """
    Expand weekly plans into per-day plans between [start_d, end_d].
    Output items: {"date":"YYYY-MM-DD", "plan_total":N, ("plan_a":x,"plan_b":y)? }
    """
    out: List[Dict[str, Any]] = []
    d = start_d
    while d <= end_d:
        ws = _week_start_str_for(d)
        pj = _parse_plan_json(_get_week_plan_json(ws))
        total, a, b = _plan_for_date_from_pj(pj, d)
        item = {"date": d.strftime("%Y-%m-%d"), "plan_total": total}
        if a is not None or b is not None:
            item["plan_a"] = a or 0
            item["plan_b"] = b or 0
        out.append(item)
        d += timedelta(days=1)
    return out

# ───────────────────────────── ① Add Scan ───────────────────────────
@router.post("/assembly_inventory", dependencies=[Depends(require_roles("admin","operator"))])
async def add_scan(req: Request, rec: AssemblyRecordIn):
    rollover()
    if not check_rate_limit(req.client.host):
        return {"status":"error","message":"Too many requests, wait a moment."}

    ts = rec.timestamp or now_str()

    # RAM fast de-dup check (only for non-empty / non-'N/A')
    fields = [
        ("china_sn",  rec.china_sn),
        ("us_sn",     rec.us_sn),
        ("module_a",  rec.module_a),
        ("module_b",  rec.module_b),
        ("pcba_au8",  rec.pcba_au8),
        ("pcba_am7",  rec.pcba_am7),
    ]
    for name, val in fields:
        s = clean_u(val)
        if s and s in RAM_SN:
            return {"status":"error","message":f"Duplicate {name}: {s}"}

    row = (
        ts,
        clean_u(rec.china_sn),
        clean_u(rec.us_sn),
        clean_u(rec.module_a),
        clean_u(rec.module_b),
        clean_u(rec.pcba_au8),
        clean_u(rec.pcba_am7),
    )

    try:
        DB.execute("""INSERT INTO scans(ts,cn_sn,us_sn,mod_a,mod_b,au8,am7)
                      VALUES(?,?,?,?,?,?,?)""", row)
        DB.commit()
    except sqlite3.IntegrityError as e:
        err = str(e)
        if "UNIQUE constraint failed: scans." in err:
            dup_col = err.split("scans.")[-1]
            col_map = {"cn_sn":"china_sn","us_sn":"us_sn","mod_a":"module_a",
                       "mod_b":"module_b","au8":"pcba_au8","am7":"pcba_am7"}
            return {"status":"error",
                    "message":f"Duplicate value in field '{col_map.get(dup_col, dup_col)}'"}
        raise

    # Update RAM de-dup (only add non-empty / non-'N/A')
    for _, v in fields:
        sv = clean_u(v)
        if sv:
            RAM_SN.add(sv)

    # Update today's hourly + broadcast
    if ts.startswith(TODAY.strftime("%Y-%m-%d")):
        hourly[ts[11:13]] += 1
    hrs = sorted(hourly.keys())
    await ws_manager.broadcast({
        "event":"assembly_updated","timestamp":ts,
        "count":sum(hourly.values()),
        "labels":[f"{h}:00" for h in hrs],
        "trend":[hourly[h] for h in hrs]
    })
    # Assembly usage affects PCBA availability → broadcast statistics
    await _broadcast_pcba_statistics()

    return {"status":"success","message":"Record added successfully"}

# ───────────────────────────── ② Get single ─────────────────────────
@router.get("/assembly_inventory/{us_sn}", response_model=AssemblyRecordOut,
            dependencies=[Depends(require_roles("admin","operator"))])
def get_one(us_sn:str):
    row = DB.execute("""SELECT id,ts AS timestamp,
               cn_sn AS china_sn,us_sn,
               mod_a AS module_a,mod_b AS module_b,
               au8 AS pcba_au8,am7 AS pcba_am7,
               status,ng_reason FROM scans WHERE us_sn=?""",
               (us_sn.strip(),)).fetchone()
    if not row:
        raise HTTPException(404,f"{us_sn} not found")
    return dict(row)

# ───────────────────────────── ③ Update ─────────────────────────────
class AssemblyUpdate(BaseModel):
    module_a: Optional[str] = None
    module_b: Optional[str] = None
    pcba_au8: Optional[str] = None
    pcba_am7: Optional[str] = None
    status:   Optional[str] = None
    ng_reason:Optional[str] = None

@router.put("/assembly_inventory/{us_sn}", dependencies=[Depends(require_roles("admin","operator"))])
async def update_one(us_sn:str, body:AssemblyUpdate):
    col = {"module_a":"mod_a","module_b":"mod_b",
           "pcba_au8":"au8","pcba_am7":"am7",
           "status":"status","ng_reason":"ng_reason"}
    sets, vals = [], []
    impact_pcba = False
    for k, v in body.model_dump(exclude_none=True).items():
        dbcol = col[k]
        if dbcol in ("mod_a","mod_b","au8","am7"):
            cv = clean_u(v)  # None will be stored as NULL
        else:
            cv = v.strip() if isinstance(v, str) else v
        sets.append(f"{dbcol}=?")
        vals.append(cv)
        if dbcol in ("mod_a","mod_b","au8","am7") and cv:
            RAM_SN.add(cv)
        if dbcol in ("au8","am7"):
            impact_pcba = True
    if not sets:
        return {"status":"error","message":"No field to update"}
    vals.append(us_sn.strip())
    try:
        cur = DB.execute(f"UPDATE scans SET {', '.join(sets)} WHERE us_sn=?", vals)
        DB.commit()
    except sqlite3.IntegrityError as e:
        err = str(e)
        if "UNIQUE constraint failed: scans." in err:
            dup_col = err.split("scans.")[-1]
            return {"status":"error","message":f"Duplicate value in '{dup_col}'"}
        raise
    if cur.rowcount==0:
        raise HTTPException(404,f"{us_sn} not found")

    # If fields that affect PCBA availability changed → broadcast statistics
    if impact_pcba:
        await _broadcast_pcba_statistics()

    return {"status":"success","message":"Record updated"}

# ───────────────────────────── ④ Mark / Clear NG ────────────────────
class MarkBody(BaseModel):  us_sn:str; reason:str
class ClearBody(BaseModel): us_sn:str

@router.post("/assembly_inventory/mark_ng", dependencies=[Depends(require_roles("admin","operator"))])
def mark_ng(body:MarkBody):
    if not body.us_sn or not body.reason:
        return {"status":"error","message":"us_sn and reason are required"}
    cur = DB.execute("UPDATE scans SET status='NG',ng_reason=? WHERE us_sn=?",
                     (body.reason.strip(), body.us_sn.strip()))
    DB.commit()
    if cur.rowcount==0: return {"status":"error","message":f"{body.us_sn} not found"}
    return {"status":"success","message":f"{body.us_sn} marked NG"}

@router.post("/assembly_inventory/clear_ng", dependencies=[Depends(require_roles("admin","operator"))])
def clear_ng(body:ClearBody):
    # 統一寫 'FIXED'（配合查詢用 UPPER(status)）
    cur = DB.execute("UPDATE scans SET status='FIXED' WHERE us_sn=? AND UPPER(status)='NG'",
                     (body.us_sn.strip(),))
    DB.commit()
    if cur.rowcount==0: return {"status":"error","message":f"{body.us_sn} not NG or not found"}
    return {"status":"success","message":f"{body.us_sn} marked FIXED"}

# ───────────────────────────── ⑤ Daily KPI ──────────────────────────
@router.get("/assembly_inventory_daily_count")
def today_count(user=Depends(get_current_user)):
    rollover()
    start_ts, end_ts = today_range_str()
    row = DB.execute("""SELECT COUNT(*) AS c,
        SUM(CASE WHEN UPPER(status)='NG' THEN 1 ELSE 0 END)     AS pure_ng,
        SUM(CASE WHEN UPPER(status)='FIXED' THEN 1 ELSE 0 END)  AS fixed,
        SUM(CASE WHEN UPPER(status) IN ('NG','FIXED') THEN 1 ELSE 0 END) AS ng_all
        FROM scans WHERE ts BETWEEN ? AND ?""",(start_ts, end_ts)).fetchone()
    return {
        "status":"success",
        "count": int(row["c"] or 0),
        "ng":    int(row["ng_all"] or 0),   # 含 FIXED
        "pure_ng": int(row["pure_ng"] or 0),
        "fixed": int(row["fixed"] or 0)
    }

# ───────────────────────────── ⑥ Hourly trend ───────────────────────
@router.get("/assembly_inventory_trend")
def trend(user=Depends(get_current_user)):
    rollover()
    hrs = sorted(hourly.keys())
    return {"status":"success",
            "labels":[f"{h}:00" for h in hrs],
            "trend":[hourly[h] for h in hrs]}

# ───────────────────────────── ⑦ Weekly KPI ─────────────────────────
@router.get("/assembly_weekly_kpi")
def weekly_kpi(user=Depends(get_current_user)):
    # Use real "now" to avoid being affected by rebuild_cache
    t = today()
    monday = t - timedelta(days=t.weekday())
    labels = [(monday + timedelta(days=i)).strftime("%m-%d") for i in range(6)]  # Mon..Sat

    totals = [0]*6
    cur = DB.execute("""
        SELECT substr(ts,6,5) AS mmdd, COUNT(*) AS cnt
        FROM scans
        WHERE date(ts) BETWEEN ? AND ?
        GROUP BY mmdd
    """, (monday.strftime("%Y-%m-%d"),
          (monday + timedelta(days=5)).strftime("%Y-%m-%d")))
    for r in cur.fetchall():
        if r["mmdd"] in labels:
            totals[labels.index(r["mmdd"])] = r["cnt"]

    # Show Saturday only if there is data
    include_sat = totals[5] > 0
    if not include_sat:
        labels = labels[:5]
        totals = totals[:5]

    # Planned values: array or dict(A/B or total), pad to match length
    plan_row = DB.execute(
        "SELECT plan_json FROM assembly_weekly_plan WHERE week_start=?",
        (monday.strftime("%Y-%m-%d"),)
    ).fetchone()

    def _sum_ab(v):
        if isinstance(v, dict):
            return int(v.get("A",0)) + int(v.get("B",0))
        return int(v or 0)

    if plan_row and plan_row["plan_json"]:
        try:
            pj = json.loads(plan_row["plan_json"])
            if isinstance(pj, list):
                plan = [int(x or 90) for x in pj]
            elif isinstance(pj, dict):
                plan = []
                for i in range(6):
                    d = (monday + timedelta(days=i)).strftime("%Y-%m-%d")
                    plan.append(_sum_ab(pj.get(d, 90)))
            else:
                plan = [90]*len(labels)
        except Exception:
            plan = [90]*len(labels)
    else:
        plan = [90]*len(labels)

    if len(plan) < len(labels):
        plan.extend([90] * (len(labels) - len(plan)))

    return {"status":"success","labels":labels,"total":totals,"plan":plan[:len(labels)]}

# ─────────────────────── ⑧ Assembly Weekly Plan API ───────────────────────
class AssyPlanPatch(BaseModel):
    day: int                              # 0=Mon ... 5=Sat
    value: int
    week_start: Optional[str] = None      # YYYY-MM-DD (optional, default = current week)

def _week_start_str(s: Optional[str]) -> str:
    if s:
        try:
            d = datetime.strptime(s, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(400, "week_start must be YYYY-MM-DD")
        mon = d - timedelta(days=d.weekday())
        return mon.strftime("%Y-%m-%d")
    return this_monday().strftime("%Y-%m-%d")

@router.get("/assembly_weekly_plan", summary="Get plan for current (or specified) week")
def get_assy_plan(week_start: Optional[str] = Query(None, description="YYYY-MM-DD (Monday)")):
    ws = _week_start_str(week_start)
    row = DB.execute("SELECT plan_json FROM assembly_weekly_plan WHERE week_start=?", (ws,)).fetchone()
    plan = json.loads(row["plan_json"]) if row else [90,90,90,90,90]
    return {"status":"success","week_start":ws,"plan":plan}

@router.post("/assembly_weekly_plan", summary="Set plan for current week (array)",
             dependencies=[Depends(require_roles("admin","operator"))])
async def set_assy_plan(plan: List[int] = Body(..., embed=False)):
    """
    Frontend posts a raw array: e.g. [60,60,60,60,60] or [60,60,60,60,60,40]
    Length must be 5 or 6.
    """
    if len(plan) not in (5,6):
        return {"status":"error","message":"need 5 or 6 numbers"}
    ws = this_monday().strftime("%Y-%m-%d")
    DB.execute("""
        INSERT INTO assembly_weekly_plan (week_start, plan_json)
        VALUES (?, ?)
        ON CONFLICT(week_start) DO UPDATE SET plan_json=excluded.plan_json
    """, (ws, json.dumps([int(x) for x in plan])))
    DB.commit()

    # Broadcast (reuse existing frontend events so no UI change is required)
    await ws_manager.broadcast({"event":"weekly_plan_updated"})
    await ws_manager.broadcast({"event":"assembly_updated","timestamp":now_str()})
    # PCBA statistics are not affected by plan changes

    return {"status":"success","week_start":ws,"plan":plan}

@router.patch("/assembly_weekly_plan", summary="Patch a single day for current (or specified) week",
              dependencies=[Depends(require_roles("admin","operator"))])
async def patch_assy_plan(body: AssyPlanPatch):
    ws = _week_start_str(body.week_start)
    row = DB.execute("SELECT plan_json FROM assembly_weekly_plan WHERE week_start=?", (ws,)).fetchone()

    if row:
        plan = json.loads(row["plan_json"])
    else:
        plan = [95,95,95,95,95]

    if body.day < 0 or body.day >= max(6, len(plan)):
        raise HTTPException(400, "day must be in 0..5 (Mon..Sat)")

    # Ensure array length if we want to update Saturday (index 5)
    while len(plan) <= body.day:
        plan.append(90)

    plan[body.day] = int(body.value)

    DB.execute("""
        INSERT INTO assembly_weekly_plan (week_start, plan_json)
        VALUES (?, ?)
        ON CONFLICT(week_start) DO UPDATE SET plan_json=excluded.plan_json
    """, (ws, json.dumps(plan)))
    DB.commit()

    await ws_manager.broadcast({"event":"weekly_plan_updated"})
    await ws_manager.broadcast({"event":"assembly_updated","timestamp":now_str()})

    return {"status":"success","week_start":ws,"plan":plan}

# ───────────────────────────── NEW: Plan for arbitrary range ─────────────────────────────
@router.get("/assembly/plan/range", summary="Expand weekly plans into per-day plans for the given range")
def get_plan_range(start_date: str = Query(..., description="YYYY-MM-DD"),
                   end_date: str   = Query(..., description="YYYY-MM-DD"),
                   user=Depends(get_current_user)):
    try:
        s = datetime.strptime(start_date, "%Y-%m-%d").date()
        e = datetime.strptime(end_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(400, "start_date/end_date must be YYYY-MM-DD")
    if e < s:
        raise HTTPException(400, "end_date must be >= start_date")
    plan_data = _expand_plan_range(s, e)
    return {"status":"success","plan_data":plan_data}

# ──────────────── NEW: Production (Actual + Plan) for charts: daily/weekly/monthly ────────────────
@router.get("/production-charts/assembly/production",
            summary="Assembly production with optional plan_data for daily/weekly/monthly")
def production_charts_assembly_production(
    period: str = Query("daily", regex="^(daily|weekly|monthly)$"),
    target_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    user=Depends(get_current_user)
):
    """
    Response shape:
    {
      "summary": { total, ok_count, ng_count, fixed_count, yield_rate, trend?, yield_trend? },
      "production_data": [  # daily => hourly rows; weekly/monthly => daily rows (完整補齊)
        // daily
        {"hour":"00","total":N,"ok_count":X,"ng_count":Y,"fixed_count":Z},
        // weekly/monthly
        {"production_date":"YYYY-MM-DD","total":..,"ok_count":..,"ng_count":..,"fixed_count":..}
      ],
      "plan_data": [ {"date":"YYYY-MM-DD","plan_total":N, ("plan_a":x,"plan_b":y)? } ],  # weekly/monthly
      "ng_reasons": [ {"reason": "...", "count": N}, ... ]
    }
    """
    # Parse date
    if target_date:
        try:
            base = datetime.strptime(target_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(400, "target_date must be YYYY-MM-DD")
    else:
        base = today()

    if period == "daily":
        start_d = end_d = base
    elif period == "weekly":
        start_d = base - timedelta(days=base.weekday())  # Mon
        end_d   = start_d + timedelta(days=6)            # Sun
    else:  # monthly
        start_d = date(base.year, base.month, 1)
        last_day = calendar.monthrange(base.year, base.month)[1]
        end_d   = date(base.year, base.month, last_day)

    # Fetch production_data
    cur = DB.cursor()
    production_data: List[Dict[str, Any]] = []

    if period == "daily":
        cur.execute("""
          SELECT substr(ts,12,2) AS hh,
                 COUNT(*) AS total,
                 SUM(CASE WHEN UPPER(status) IN ('NG','FIXED') THEN 1 ELSE 0 END) AS ng_all,
                 SUM(CASE WHEN UPPER(status)='FIXED' THEN 1 ELSE 0 END) AS fixed
          FROM scans
          WHERE date(ts)=?
          GROUP BY hh
          ORDER BY hh
        """, (start_d.strftime("%Y-%m-%d"),))
        for r in cur.fetchall():
            total = int(r["total"] or 0)
            ng_all = int(r["ng_all"] or 0)
            fixed  = int(r["fixed"] or 0)
            production_data.append({
                "hour": r["hh"],
                "total": total,
                "ok_count": total - ng_all,
                "ng_count": ng_all,
                "fixed_count": fixed
            })
    else:
        # 先彙總有資料的天
        cur.execute("""
          SELECT date(ts) AS d,
                 COUNT(*) AS total,
                 SUM(CASE WHEN UPPER(status) IN ('NG','FIXED') THEN 1 ELSE 0 END) AS ng_all,
                 SUM(CASE WHEN UPPER(status)='FIXED' THEN 1 ELSE 0 END) AS fixed
          FROM scans
          WHERE date(ts) BETWEEN ? AND ?
          GROUP BY d
          ORDER BY d
        """, (start_d.strftime("%Y-%m-%d"), end_d.strftime("%Y-%m-%d")))
        by_day = {r["d"]: r for r in cur.fetchall()}

        # 逐日補齊（沒有掃碼就回 0），前端 weekly/monthly 才能穩定繪圖
        d = start_d
        while d <= end_d:
            key = d.strftime("%Y-%m-%d")
            r = by_day.get(key)
            if r:
                total = int(r["total"] or 0)
                ng_all = int(r["ng_all"] or 0)
                fixed  = int(r["fixed"] or 0)
            else:
                total = ng_all = fixed = 0
            production_data.append({
                "production_date": key,
                "total": total,
                "ok_count": total - ng_all,
                "ng_count": ng_all,
                "fixed_count": fixed
            })
            d += timedelta(days=1)

    # Summary（聚合整段）
    row = DB.execute("""
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN UPPER(status) IN ('NG','FIXED') THEN 1 ELSE 0 END) AS ng_all,
             SUM(CASE WHEN UPPER(status)='FIXED' THEN 1 ELSE 0 END) AS fixed
      FROM scans WHERE date(ts) BETWEEN ? AND ?
    """, (start_d.strftime("%Y-%m-%d"), end_d.strftime("%Y-%m-%d"))).fetchone()
    ttot = int(row["total"] or 0)
    ng_all = int(row["ng_all"] or 0)
    fixed = int(row["fixed"] or 0)
    ok = ttot - ng_all
    summary = {
        "total": ttot,
        "ok_count": ok,
        "ng_count": ng_all,
        "fixed_count": fixed,
        "yield_rate": round(ok / ttot * 100) if ttot else 100
        # "trend" / "yield_trend" 可視需要再加（前端會判斷 null 不顯示箭頭）
    }

    # NG reasons (for the same range)
    ng_reasons_rows = DB.execute("""
      SELECT ng_reason AS reason, COUNT(*) AS cnt
      FROM scans
      WHERE date(ts) BETWEEN ? AND ? AND UPPER(status)='NG' AND ng_reason IS NOT NULL AND TRIM(ng_reason) <> ''
      GROUP BY ng_reason
      ORDER BY cnt DESC
    """, (start_d.strftime("%Y-%m-%d"), end_d.strftime("%Y-%m-%d"))).fetchall()
    ng_reasons = [{"reason": r["reason"], "count": int(r["cnt"] or 0)} for r in ng_reasons_rows]

    # Plan data（weekly/monthly 展開；未設定用預設 Mon–Fri=90, Sat/Sun=0）
    plan_data: List[Dict[str, Any]] = []
    if period in ("weekly","monthly"):
        plan_data = _expand_plan_range(start_d, end_d)

    return {
        "summary": summary,
        "production_data": production_data,
        "plan_data": plan_data,
        "ng_reasons": ng_reasons
    }

# ───────────────────────────── ⑨ NG list / ⑩ List all ──────────────
@router.get("/assembly_inventory/list/ng")
def list_ng(limit:int=500, include_fixed:bool=True,
            from_date:Optional[str]=None, to_date:Optional[str]=None,
            user=Depends(get_current_user)):
    status_cond = "UPPER(status) IN ('NG','FIXED')" if include_fixed else "UPPER(status)='NG'"
    conds,params=[status_cond],[]
    if from_date: conds.append("date(ts)>=?"); params.append(from_date)
    if to_date  : conds.append("date(ts)<=?"); params.append(to_date)
    params.append(limit)
    rows = DB.execute(f"""
        SELECT id,ts AS timestamp,us_sn,cn_sn,status,ng_reason
        FROM scans WHERE {' AND '.join(conds)} ORDER BY ts DESC LIMIT ?""", params)
    return [dict(r) for r in rows]

@router.get("/assembly_inventory/list/all",
            dependencies=[Depends(require_roles("admin","operator"))])
def list_all(limit:int=1000, status_filter:Optional[str]=None,
             from_date:Optional[str]=None, to_date:Optional[str]=None):
    conds,params=[],[]
    if status_filter and status_filter!="all":
        if status_filter.lower()=="ok":
            conds.append("(status='' OR status IS NULL)")
        elif status_filter.lower()=="ng":
            conds.append("UPPER(status)='NG'")
        elif status_filter.lower()=="fixed":
            conds.append("UPPER(status)='FIXED'")
        else:
            conds.append("status=?"); params.append(status_filter)
    if from_date: conds.append("date(ts)>=?"); params.append(from_date)
    if to_date  : conds.append("date(ts)<=?"); params.append(to_date)
    params.append(limit)
    where = " AND ".join(conds) if conds else "1=1"
    rows = DB.execute(f"""
        SELECT id,ts AS timestamp,cn_sn,us_sn,mod_a AS module_a,
               mod_b AS module_b,au8 AS pcba_au8,am7 AS pcba_am7,
               status,ng_reason
        FROM scans WHERE {where} ORDER BY ts DESC LIMIT ?""", params)
    return [dict(r) for r in rows]

# ───────────────────────────── ⑪ Delete ────────────────────────────
@router.delete("/assembly_inventory/delete/{scan_id}", dependencies=[Depends(require_roles("admin"))])
async def delete_scan(scan_id:int):
    row = DB.execute("SELECT ts,cn_sn,us_sn,mod_a,mod_b,au8,am7 FROM scans WHERE id=?", (scan_id,)).fetchone()
    if not row: raise HTTPException(404,f"id={scan_id} not found")
    DB.execute("DELETE FROM scans WHERE id=?", (scan_id,)); DB.commit()

    if row["ts"].startswith(TODAY.strftime("%Y-%m-%d")):
        hr = row["ts"][11:13]
        hourly[hr] -= 1
        if hourly[hr] <= 0:
            hourly.pop(hr, None)

    for f in ("cn_sn","us_sn","mod_a","mod_b","au8","am7"):
        v = row[f]
        if v:
            RAM_SN.discard(v)

    hrs = sorted(hourly.keys())
    await ws_manager.broadcast({
        "event":"assembly_updated","timestamp":now_str(),
        "count":sum(hourly.values()),
        "labels":[f"{h}:00" for h in hrs],
        "trend":[hourly[h] for h in hrs]
    })

    # If AM7/AU8 were present, PCBA availability is affected → broadcast statistics
    if (row["am7"] and row["am7"].strip().upper() != "N/A") or (row["au8"] and row["au8"].strip().upper() != "N/A"):
        await _broadcast_pcba_statistics()

    return {"status":"success","message":f"Deleted id={scan_id}"}

# ───────────────────────────── ⑬ Admin – edit timestamp ─────────────
class AdminPatch(BaseModel): timestamp:str  # YYYY-MM-DD HH:MM:SS

@router.patch("/assembly_inventory/admin_edit/{us_sn}", dependencies=[Depends(require_roles("admin"))])
async def admin_edit(us_sn:str, body:AdminPatch):
    row=DB.execute("SELECT ts FROM scans WHERE us_sn=?",(us_sn.strip(),)).fetchone()
    if not row: raise HTTPException(404,f"{us_sn} not found")
    old_ts=row["ts"]; new_ts=body.timestamp.strip()
    try: datetime.strptime(new_ts,"%Y-%m-%d %H:%M:%S")
    except ValueError: raise HTTPException(400,"timestamp must be YYYY-MM-DD HH:MM:SS")
    if new_ts==old_ts: return {"status":"success","message":"Unchanged"}
    DB.execute("UPDATE scans SET ts=? WHERE us_sn=?",(new_ts,us_sn.strip())); DB.commit()

    # Repair in-memory only for today
    today_str = TODAY.strftime("%Y-%m-%d")
    old_day,new_day=old_ts[:10],new_ts[:10]
    old_hr,new_hr  =old_ts[11:13],new_ts[11:13]
    if old_day==today_str and old_hr in hourly:
        hourly[old_hr]-=1
        if hourly[old_hr]<=0: hourly.pop(old_hr,None)
    if new_day==today_str: hourly[new_hr]+=1
    def bump(day,delta):
        if day>today_str: return
        tot, ng_all, fixed = _counts_for_day(day)  # compute from DB
        DB.execute("""
          INSERT INTO daily_summary(day,total,ng,fixed)
          VALUES(?,?,?,?)
          ON CONFLICT(day) DO UPDATE SET total=?, ng=?, fixed=?""",
          (day, tot, ng_all, fixed, tot, ng_all, fixed))
    bump(old_day,0); bump(new_day,0); DB.commit()

    hrs=sorted(hourly.keys())
    await ws_manager.broadcast({
        "event":"assembly_updated","timestamp":new_ts,
        "count":sum(hourly.values()),
        "labels":[f"{h}:00" for h in hrs],
        "trend":[hourly[h] for h in hrs]
    })
    # Timestamp only → no impact on PCBA availability
    return {"status":"success","message":"Timestamp updated"}

# ───────────────────────────── ⑭ Admin – rebuild_cache ─────────────
@router.post("/assembly_inventory/rebuild_cache",
             dependencies=[Depends(require_roles("admin"))])
async def rebuild_cache(day:Optional[str]=Query(None,description="YYYY-MM-DD, default=today")):
    """
    Rebuild global de-dup cache (RAM_SN), and recompute hourly & daily_summary for the specified day only.
    TODAY is not changed; if the target day is TODAY, in-memory hourly is replaced and a chart update is broadcast.
    """
    # Parse date
    try:
        target = datetime.strptime(day,"%Y-%m-%d").date() if day else today()
    except ValueError:
        raise HTTPException(400,"day must be YYYY-MM-DD")

    prefix = target.strftime("%Y-%m-%d")

    # 1) Rebuild RAM_SN (all history)
    RAM_SN.clear()
    for r in DB.execute("SELECT cn_sn,us_sn,mod_a,mod_b,au8,am7 FROM scans"):
        for f in ("cn_sn","us_sn","mod_a","mod_b","au8","am7"):
            v = r[f]
            if v and v.strip().upper() != "N/A":
                RAM_SN.add(v.strip())

    # 2) Recompute hourly for target date (buffered; only swap if target==TODAY)
    new_hourly = defaultdict(int)
    for r in DB.execute("SELECT ts FROM scans WHERE ts LIKE ?", (prefix+"%",)):
        new_hourly[r["ts"][11:13]] += 1

    # 3) Backfill daily_summary(total/ng/fixed)
    tot, ng_all, fixed = _counts_for_day(prefix)
    DB.execute("""
        INSERT INTO daily_summary(day,total,ng,fixed)
        VALUES(?,?,?,?)
        ON CONFLICT(day) DO UPDATE SET total=?, ng=?, fixed=?""",
        (prefix, tot, ng_all, fixed, tot, ng_all, fixed))
    DB.commit()

    # 4) If the target is TODAY → swap in-memory and broadcast
    if target == TODAY:
        hourly.clear()
        for k,v in new_hourly.items():
            hourly[k]=v
        hrs = sorted(hourly.keys())
        await ws_manager.broadcast({
            "event":"assembly_updated","timestamp":now_str(),
            "count":sum(hourly.values()),
            "labels":[f"{h}:00" for h in hrs],
            "trend":[hourly[h] for h in hrs]
        })
    logger.info("Cache rebuilt for %s (total=%d)", prefix, sum(new_hourly.values()))
    return {"status":"success","message":f"Cache rebuilt for {prefix}"}

# ───────────────────────────── ⑮ Live API: Available for Assembly ──────────────────────────
@router.get("/assembly/pcba_inventory", summary="Live calc: PCBA Completed(ex NG) − Assembly usage (no DB writes)")
def get_pcba_inventory(user=Depends(get_current_user)):
    """
    Returns AM7/AU8:
      - completed  = PCBA completed and not NG
      - used       = current assembly usage count (from assembly.db) for serials present in PCBA completed
      - available  = max(completed−used, 0)
      - total fields are AM7+AU8 sums (for UI display only)
    """
    payload = _compute_pcba_statistics_payload()
    return {
        "completedAM7": payload["completedByModel"]["AM7"],
        "completedAU8": payload["completedByModel"]["AU8"],
        "usedAM7": payload["consumedAM7"],
        "usedAU8": payload["consumedAU8"],
        "availableAM7": payload["availableAM7"],
        "availableAU8": payload["availableAU8"],
        "availableTotal": payload["availableTotal"],
        "usedTotal": payload["consumedTotal"],
    }
