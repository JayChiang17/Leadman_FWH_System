from fastapi import (
    APIRouter, Request, Depends, HTTPException, Query, Body
)
from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo
from collections import defaultdict
from typing import Optional, List, Dict, Any, Tuple
import json, time, logging, calendar, asyncio

import psycopg2
import psycopg2.extras

from core.pg import get_conn, get_cursor
from core.ws_manager import ws_manager
from core.deps import require_roles, get_current_user
from core.time_utils import normalize_to_ca_str
from core.cache_utils import TTLCache
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

CACHE_TTL_SECONDS = 5
_DAILY_COUNT_CACHE = TTLCache(CACHE_TTL_SECONDS)
_WEEKLY_KPI_CACHE = TTLCache(CACHE_TTL_SECONDS)

SCHEMA = "assembly"

def _invalidate_kpi_cache() -> None:
    _DAILY_COUNT_CACHE.clear()
    _WEEKLY_KPI_CACHE.clear()

# ────────────────────── PostgreSQL table setup ─────────────────────
# NOTE: The init.sql placeholder schema only has (us_sn, am7, au8, operator, scanned_at).
# The actual assembly.scans table needs the full schema below.
# TODO: Update init.sql to match this schema:
#
# CREATE SCHEMA IF NOT EXISTS assembly;
# CREATE TABLE IF NOT EXISTS assembly.scans(
#   id             SERIAL PRIMARY KEY,
#   scanned_at     TIMESTAMPTZ,
#   cn_sn          TEXT,
#   us_sn          TEXT,
#   mod_a          TEXT,
#   mod_b          TEXT,
#   au8            TEXT,
#   am7            TEXT,
#   product_line   TEXT,
#   status         TEXT DEFAULT '',
#   ng_reason      TEXT DEFAULT '',
#   start_time     TIMESTAMPTZ,
#   production_seconds INTEGER,
#   UNIQUE(cn_sn), UNIQUE(us_sn), UNIQUE(mod_a), UNIQUE(mod_b),
#   UNIQUE(au8), UNIQUE(am7)
# );
# CREATE TABLE IF NOT EXISTS assembly.daily_summary(
#   day   TEXT PRIMARY KEY,
#   total INTEGER DEFAULT 0,
#   ng    INTEGER DEFAULT 0,
#   fixed INTEGER DEFAULT 0
# );
# CREATE TABLE IF NOT EXISTS assembly.assembly_weekly_plan(
#   week_start TEXT PRIMARY KEY,
#   plan_json  TEXT
# );
# CREATE INDEX IF NOT EXISTS idx_scans_scanned_at ON assembly.scans(scanned_at);
# CREATE INDEX IF NOT EXISTS idx_scans_status ON assembly.scans(status);
# CREATE INDEX IF NOT EXISTS idx_scans_product_line ON assembly.scans(product_line);
# CREATE INDEX IF NOT EXISTS idx_scans_start_time ON assembly.scans(start_time);
# CREATE INDEX IF NOT EXISTS idx_scans_us_sn ON assembly.scans(us_sn);
# CREATE INDEX IF NOT EXISTS idx_scans_scanned_at_status ON assembly.scans(scanned_at, status);

def _ensure_tables():
    """Create assembly schema and tables if they don't exist.
    Safe to call multiple times (idempotent)."""
    with get_conn(SCHEMA) as conn:
        cur = conn.cursor()
        cur.execute("CREATE SCHEMA IF NOT EXISTS assembly")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS assembly.scans(
              id             SERIAL PRIMARY KEY,
              scanned_at     TIMESTAMPTZ,
              cn_sn          TEXT,
              us_sn          TEXT,
              mod_a          TEXT,
              mod_b          TEXT,
              au8            TEXT,
              am7            TEXT,
              product_line   TEXT,
              status         TEXT DEFAULT '',
              ng_reason      TEXT DEFAULT '',
              start_time     TIMESTAMPTZ,
              production_seconds INTEGER,
              UNIQUE(cn_sn), UNIQUE(us_sn), UNIQUE(mod_a), UNIQUE(mod_b),
              UNIQUE(au8), UNIQUE(am7)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS assembly.daily_summary(
              day   TEXT PRIMARY KEY,
              total INTEGER DEFAULT 0,
              ng    INTEGER DEFAULT 0,
              fixed INTEGER DEFAULT 0
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS assembly.assembly_weekly_plan(
              week_start TEXT PRIMARY KEY,
              plan_json  TEXT
            )
        """)
        # Indexes (IF NOT EXISTS available in PG 9.5+)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_scans_scanned_at ON assembly.scans(scanned_at)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_scans_status ON assembly.scans(status)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_scans_product_line ON assembly.scans(product_line)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_scans_start_time ON assembly.scans(start_time)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_scans_us_sn ON assembly.scans(us_sn)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_scans_scanned_at_status ON assembly.scans(scanned_at, status)")


# Mapping US SN prefixes -> product_line tags
PREFIX_PRODUCT_LINE = {
    "10050022": "apower_s",
    "10050019": "apower_s",
    "10050018": "apower2",
    "10050028": "apower2",
    "10050030": "apower2",
    "10050014": "apower",  # legacy
}

def _backfill_product_line() -> None:
    """Fill product_line for existing rows based on us_sn prefix (idempotent, safe)."""
    with get_conn(SCHEMA) as conn:
        cur = conn.cursor()
        for prefix, name in PREFIX_PRODUCT_LINE.items():
            cur.execute(
                "UPDATE scans SET product_line=%s WHERE us_sn LIKE %s AND (product_line IS NULL OR product_line = '')",
                (name, f"{prefix}%")
            )


def init_assembly_module():
    """Call at application startup after PG pool is initialised."""
    _ensure_tables()
    _backfill_product_line()
    _load_ram_cache()


# ────────────────────────── In-memory cache ──────────────────────────
RAM_SN = set()                # for fast de-duplication
hourly = defaultdict(int)     # counts for "today", grouped by hour (00..23)
TODAY  = today()              # snapshot of current local day
last_ip_time: Dict[str, float] = {}
ip_req_hist  = defaultdict(list)


def _load_ram_cache():
    """Load recent SNs into RAM and today's hourly counts on startup."""
    global TODAY
    TODAY = today()
    cut = (TODAY - timedelta(days=PURGE_DAYS)).strftime("%Y-%m-%d")

    RAM_SN.clear()
    hourly.clear()

    with get_cursor(SCHEMA) as cur:
        cur.execute("SELECT cn_sn, us_sn, mod_a, mod_b, au8, am7, scanned_at FROM scans WHERE scanned_at >= %s", (cut,))
        for r in cur.fetchall():
            for f in ("cn_sn", "us_sn", "mod_a", "mod_b", "au8", "am7"):
                v = r[f]
                if v and v.strip().upper() != "N/A":
                    RAM_SN.add(v.strip())
            if r["scanned_at"] and r["scanned_at"].date() == TODAY:
                hourly[r["scanned_at"].strftime("%H")] += 1


# ───────────────────────────── Helpers ──────────────────────────────
def clean_u(s: Optional[str]) -> Optional[str]:
    """Trim; convert empty string or 'N/A' to None (stored as NULL to avoid UNIQUE collisions)."""
    if not s:
        return None
    v = s.strip()
    if not v or v.upper() == "N/A":
        return None
    return v

def _normalize_us_sn_key(s: Optional[str]) -> Optional[str]:
    """Canonical US SN key for in-memory lookup (cache/timer operations)."""
    v = clean_u(s)
    if not v:
        return None
    return v.upper().replace("-", "").replace(" ", "")

def calc_production_seconds(start_time: Optional[str], end_time: str) -> Optional[int]:
    """Calculate production seconds between start_time and end_time.
    Returns None if invalid, negative, or exceeds 24 hours."""
    if not start_time:
        return None
    try:
        start_dt = datetime.strptime(start_time, "%Y-%m-%d %H:%M:%S")
        end_dt = datetime.strptime(end_time, "%Y-%m-%d %H:%M:%S")
        seconds = int((end_dt - start_dt).total_seconds())
        return seconds if 0 <= seconds <= 86400 else None
    except (ValueError, TypeError):
        return None

def infer_product_line(us_sn: Optional[str], explicit: Optional[str]) -> Optional[str]:
    """
    Return an explicit product_line if provided, otherwise infer by US SN prefix.
    apower     -> 10050014*
    apower2    -> 10050018*/10050028*
    apower_s   -> 10050019*/10050022*
    """
    if explicit:
        return explicit.strip()
    if not us_sn:
        return None
    s = us_sn.strip()
    for prefix, name in PREFIX_PRODUCT_LINE.items():
        if s.startswith(prefix):
            return name
    return None

def _counts_for_day(day_str: str) -> Tuple[int, int, int]:
    """Return (total, ng_including_fixed, fixed) for a YYYY-MM-DD day."""
    start_ts, end_ts = day_range_str(datetime.strptime(day_str, "%Y-%m-%d").date())
    with get_cursor(SCHEMA) as cur:
        cur.execute("""
            SELECT COUNT(*) AS tot,
                   SUM(CASE WHEN UPPER(status) IN ('NG','FIXED') THEN 1 ELSE 0 END) AS ng_all,
                   SUM(CASE WHEN UPPER(status)='FIXED' THEN 1 ELSE 0 END) AS fixed
            FROM scans WHERE scanned_at >= %s AND scanned_at < %s
        """, (start_ts, end_ts))
        row = cur.fetchone()
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
        with get_cursor(SCHEMA) as cur:
            cur.execute("""
                INSERT INTO daily_summary(day, total, ng, fixed)
                VALUES(%s, %s, %s, %s)
                ON CONFLICT(day) DO UPDATE SET total=%s, ng=%s, fixed=%s""",
                (y_str, tot, ng_all, fixed, tot, ng_all, fixed))
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

def day_range_str(d: date) -> tuple[str, str]:
    start = d.strftime("%Y-%m-%d 00:00:00")
    end = (d + timedelta(days=1)).strftime("%Y-%m-%d 00:00:00")
    return start, end

def today_range_str() -> tuple[str, str]:
    return day_range_str(today())

def _append_date_range(conds: List[str], params: List[Any], from_date: Optional[str], to_date: Optional[str]) -> None:
    if from_date:
        try:
            d = datetime.strptime(from_date, "%Y-%m-%d").date()
            start_ts, _ = day_range_str(d)
            conds.append("scanned_at >= %s")
            params.append(start_ts)
        except ValueError:
            conds.append("scanned_at >= %s")
            params.append(from_date)
    if to_date:
        try:
            d = datetime.strptime(to_date, "%Y-%m-%d").date()
            _, end_ts = day_range_str(d)
            conds.append("scanned_at < %s")
            params.append(end_ts)
        except ValueError:
            conds.append("scanned_at <= %s")
            params.append(to_date)

# ───────── PCBA live inventory/statistics (read from pcba schema) ─────────

def _normalize_serial(s: Optional[str]) -> str:
    return (s or "").upper().replace(" ", "").replace("-", "")

def _pcba_completed_serials_by_model() -> Dict[str, List[str]]:
    """Query pcba.boards for completed non-NG serials, grouped by model."""
    with get_cursor("pcba") as cur:
        cur.execute("""
            SELECT UPPER(model) AS m, serial_number
            FROM boards
            WHERE stage='completed' AND (ng_flag IS NULL OR ng_flag=0)
        """)
        rows = cur.fetchall()
    out: Dict[str, List[str]] = {"AM7": [], "AU8": []}
    for r in rows:
        out.setdefault(r["m"], []).append(_normalize_serial(r["serial_number"]))
    out.setdefault("AM7", [])
    out.setdefault("AU8", [])
    return out

def _assembly_usage_counts_limited_to_pcba() -> Dict[str, int]:
    """Only count serials that exist in PCBA completed (non-NG), DISTINCT deduped."""
    serials = _pcba_completed_serials_by_model()

    def _count_used(col: str, values: List[str]) -> int:
        if not values:
            return 0
        with get_conn(SCHEMA) as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            # Create a temp table for the PCBA serials, use ON COMMIT DROP
            cur.execute("CREATE TEMP TABLE _tmp_pcba_serials (serial TEXT PRIMARY KEY) ON COMMIT DROP")
            # Batch insert using execute_values
            psycopg2.extras.execute_values(
                cur,
                "INSERT INTO _tmp_pcba_serials(serial) VALUES %s ON CONFLICT DO NOTHING",
                [(v,) for v in values],
                page_size=1000
            )
            norm = f"REPLACE(REPLACE(UPPER(s.{col}), '-', ''), ' ', '')"
            cur.execute(f"""
                SELECT COUNT(DISTINCT {norm}) AS c
                FROM scans s
                JOIN _tmp_pcba_serials t ON t.serial = {norm}
                WHERE s.{col} IS NOT NULL AND TRIM(UPPER(s.{col})) <> 'N/A'
            """)
            used = int(cur.fetchone()["c"] or 0)
            return used

    return {
        "AM7": _count_used("am7", serials["AM7"]),
        "AU8": _count_used("au8", serials["AU8"]),
    }

# Fallback simple counts (no PCBA cross-reference)
def _assembly_usage_counts() -> Dict[str, int]:
    with get_cursor(SCHEMA) as cur:
        cur.execute(
            "SELECT COUNT(*) AS c FROM scans WHERE am7 IS NOT NULL AND TRIM(UPPER(am7)) <> 'N/A'"
        )
        am7_used = int(cur.fetchone()["c"] or 0)
        cur.execute(
            "SELECT COUNT(*) AS c FROM scans WHERE au8 IS NOT NULL AND TRIM(UPPER(au8)) <> 'N/A'"
        )
        au8_used = int(cur.fetchone()["c"] or 0)
    return {"AM7": am7_used, "AU8": au8_used}

def _pcba_completed_by_model_ex_ng() -> Dict[str, int]:
    """PCBA Completed (excluding NG) grouped by model."""
    with get_cursor("pcba") as cur:
        cur.execute("""
            SELECT UPPER(model) AS m, COUNT(*) AS c
            FROM boards
            WHERE stage='completed' AND (ng_flag IS NULL OR ng_flag=0)
            GROUP BY UPPER(model)
        """)
        rows = cur.fetchall()
    out: Dict[str, int] = {"AM7": 0, "AU8": 0}
    for r in rows:
        out[r["m"]] = int(r["c"] or 0)
    return out

def _pcba_stage_totals() -> Tuple[int, int, int, int]:
    with get_cursor("pcba") as cur:
        cur.execute("""
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN stage='aging'     THEN 1 ELSE 0 END) AS aging,
                   SUM(CASE WHEN stage='coating'   THEN 1 ELSE 0 END) AS coating,
                   SUM(CASE WHEN stage='completed' THEN 1 ELSE 0 END) AS completed
            FROM boards
        """)
        r = cur.fetchone()
    return int(r["total"] or 0), int(r["aging"] or 0), int(r["coating"] or 0), int(r["completed"] or 0)

def _pcba_by_model() -> Dict[str, Dict[str, int]]:
    """Unfiltered byModel aggregation (total/aging/coating/completed)."""
    with get_cursor("pcba") as cur:
        cur.execute("""
            SELECT UPPER(model) AS m,
                   COUNT(*) AS total,
                   SUM(CASE WHEN stage='aging'     THEN 1 ELSE 0 END) AS aging,
                   SUM(CASE WHEN stage='coating'   THEN 1 ELSE 0 END) AS coating,
                   SUM(CASE WHEN stage='completed' THEN 1 ELSE 0 END) AS completed
            FROM boards
            GROUP BY UPPER(model)
        """)
        rows = cur.fetchall()
    out: Dict[str, Dict[str, int]] = {}
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
        total, aging, coating, completed = _pcba_stage_totals()
        by_model = _pcba_by_model()
        completed_by_model = _pcba_completed_by_model_ex_ng()

        # used = only count PCBA completed serials + DISTINCT
        used = _assembly_usage_counts_limited_to_pcba()
        am7_used, au8_used = used["AM7"], used["AU8"]

        avail_am7 = max(completed_by_model["AM7"] - am7_used, 0)
        avail_au8 = max(completed_by_model["AU8"] - au8_used, 0)
        payload = {
            "total": total,
            "aging": aging,
            "coating": coating,
            "completed": completed,
            "efficiency": round(completed / total * 100, 1) if total else 0.0,
            "byModel": {k: {"total": v["total"], "aging": v["aging"], "coating": v["coating"], "completed": v["completed"]} for k, v in by_model.items()},
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
    except Exception as e:
        logger.error("_compute_pcba_statistics_payload failed: %s", e)
        used = _assembly_usage_counts()
        return {
            "total": 0, "aging": 0, "coating": 0, "completed": 0, "efficiency": 0.0,
            "byModel": {},
            "completedByModel": {"AM7": 0, "AU8": 0},
            "consumedAM7": used["AM7"], "consumedAU8": used["AU8"], "consumedTotal": used["AM7"] + used["AU8"],
            "availableAM7": 0, "availableAU8": 0, "availableTotal": 0,
            "pairsDone": 0,
        }

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
    with get_cursor(SCHEMA) as cur:
        cur.execute(
            "SELECT plan_json FROM assembly_weekly_plan WHERE week_start=%s",
            (week_start_str,)
        )
        row = cur.fetchone()
    return row["plan_json"] if row else None

def _parse_plan_json(plan_json):
    if not plan_json:
        return None
    if isinstance(plan_json, (list, dict)):
        return plan_json
    try:
        return json.loads(plan_json)
    except Exception:
        return None

def _plan_for_date_from_pj(pj, target: date) -> Tuple[int, Optional[int], Optional[int]]:
    """
    Return (plan_total, plan_a, plan_b) for a target date given a parsed plan_json.
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
            return (a + b, a, b)
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

# ───────────────────────────── ⓪ Start Timer (First Station) ───────────────────────────
class StartTimerRequest(BaseModel):
    us_sn: str

# In-memory storage for start times (cleared on restart, but that's acceptable)
_start_time_cache: Dict[str, str] = {}

@router.post("/assembly/start-timer", dependencies=[Depends(require_roles("admin","operator"))])
async def start_timer(req: Request, body: StartTimerRequest):
    """
    First station scans US_SN to start the production timer.
    Stores start_time in memory cache for later retrieval during completion.
    """
    client_ip = req.client.host if req.client else "unknown"
    if not check_rate_limit(client_ip):
        raise HTTPException(status_code=429, detail="Too many requests, wait a moment.")

    us_sn = clean_u(body.us_sn)
    us_sn_key = _normalize_us_sn_key(us_sn)
    if not us_sn_key:
        return {"status": "error", "message": "US SN is required"}

    # Check if this US_SN already exists in the database (already completed)
    with get_cursor(SCHEMA) as cur:
        cur.execute(
            "SELECT id FROM scans WHERE REPLACE(REPLACE(UPPER(us_sn), '-', ''), ' ', '') = %s",
            (us_sn_key,),
        )
        existing = cur.fetchone()
    if existing:
        return {"status": "error", "message": f"US SN {us_sn} already exists in records"}

    # Record start time
    start_time = now_str()
    _start_time_cache[us_sn_key] = start_time

    # Broadcast timer started event
    await ws_manager.broadcast({
        "event": "timer_started",
        "us_sn": us_sn_key,
        "start_time": start_time
    })

    return {
        "status": "success",
        "message": f"Timer started for {us_sn_key}",
        "us_sn": us_sn_key,
        "start_time": start_time
    }

@router.get("/assembly/start-timer/{us_sn}", dependencies=[Depends(require_roles("admin","operator"))])
def get_start_time(us_sn: str):
    """Get the start time for a US_SN if it exists in cache."""
    us_sn_key = _normalize_us_sn_key(us_sn)
    if not us_sn_key:
        return {"status": "error", "message": "US SN is required"}

    start_time = _start_time_cache.get(us_sn_key)
    if not start_time:
        return {"status": "not_found", "message": f"No timer found for {us_sn_key}"}

    return {
        "status": "success",
        "us_sn": us_sn_key,
        "start_time": start_time
    }

@router.get("/assembly/active-timers", dependencies=[Depends(require_roles("admin","operator"))])
def get_active_timers():
    """Get all active timers (started but not completed)."""
    timers = [
        {"us_sn": sn, "start_time": st}
        for sn, st in _start_time_cache.items()
    ]
    # Sort by start_time descending (most recent first)
    timers.sort(key=lambda x: x["start_time"], reverse=True)
    return {"status": "success", "timers": timers, "count": len(timers)}

@router.delete("/assembly/timer/{us_sn}", dependencies=[Depends(require_roles("admin"))])
def delete_timer(us_sn: str):
    """Delete an active timer by US SN (admin only)."""
    us_sn_key = _normalize_us_sn_key(us_sn)
    if not us_sn_key:
        return {"status": "error", "message": "US SN is required"}
    if us_sn_key in _start_time_cache:
        del _start_time_cache[us_sn_key]
        return {"status": "success", "message": f"Timer deleted: {us_sn_key}"}
    return {"status": "not_found", "message": f"No timer found for {us_sn_key}"}

@router.get("/assembly/production-stats", summary="Get production time statistics for today")
def get_production_stats(user=Depends(get_current_user)):
    """Get production time statistics for today (Start Assembly -> Submit Production)."""
    start_ts, end_ts = today_range_str()
    with get_cursor(SCHEMA) as cur:
        cur.execute("""
            SELECT
                COUNT(*) as total_with_time,
                AVG(production_seconds) as avg_seconds,
                MIN(production_seconds) as min_seconds,
                MAX(production_seconds) as max_seconds
            FROM scans
            WHERE scanned_at >= %s AND scanned_at < %s
              AND production_seconds IS NOT NULL
              AND production_seconds > 0
        """, (start_ts, end_ts))
        row = cur.fetchone()

    return {
        "status": "success",
        "total_with_time": int(row["total_with_time"] or 0),
        "avg_seconds": round(float(row["avg_seconds"] or 0), 1),
        "min_seconds": int(row["min_seconds"] or 0),
        "max_seconds": int(row["max_seconds"] or 0),
        "active_timers": len(_start_time_cache)
    }


@router.get("/assembly/production-times", summary="Individual production times (latest N)")
def get_production_times(limit: int = 50, user=Depends(get_current_user)):
    """Return the most recent N production times for today (Start Assembly -> Submit)."""
    start_ts, end_ts = today_range_str()
    with get_cursor(SCHEMA) as cur:
        cur.execute("""
            SELECT us_sn, production_seconds, scanned_at
            FROM scans
            WHERE scanned_at >= %s AND scanned_at < %s
              AND production_seconds IS NOT NULL
              AND production_seconds > 0
            ORDER BY scanned_at DESC
            LIMIT %s
        """, (start_ts, end_ts, min(limit, 200)))
        rows = cur.fetchall()
    # Reverse so chart shows oldest->newest (left->right)
    items = [{"sn": r["us_sn"], "seconds": int(r["production_seconds"]), "ts": r["scanned_at"].strftime("%Y-%m-%d %H:%M:%S") if r["scanned_at"] else None} for r in reversed(rows)]
    return {"status": "success", "items": items}


# ───────────────────────────── ① Add Scan ───────────────────────────
@router.post("/assembly_inventory", dependencies=[Depends(require_roles("admin","operator"))])
async def add_scan(req: Request, rec: AssemblyRecordIn):
    rollover()
    client_ip = req.client.host if req.client else "unknown"
    if not check_rate_limit(client_ip):
        raise HTTPException(status_code=429, detail="Too many requests, wait a moment.")

    ts = rec.timestamp or now_str()
    if rec.timestamp:
        try:
            ts = normalize_to_ca_str(rec.timestamp)
        except ValueError:
            ts = rec.timestamp
    product_line = infer_product_line(rec.us_sn, rec.product_line)

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
            return {"status": "error", "message": f"Duplicate {name}: {s}"}

    # Check for start_time in cache and calculate production_seconds
    us_sn_cleaned = clean_u(rec.us_sn)
    us_sn_key = _normalize_us_sn_key(rec.us_sn)
    start_time = _start_time_cache.pop(us_sn_key, None) if us_sn_key else None
    production_seconds = calc_production_seconds(start_time, ts)
    if production_seconds is None:
        start_time = None  # Clear invalid start_time

    row = (
        ts,
        clean_u(rec.china_sn),
        clean_u(rec.us_sn),
        clean_u(rec.module_a),
        clean_u(rec.module_b),
        clean_u(rec.pcba_au8),
        clean_u(rec.pcba_am7),
        product_line,
        start_time,
        production_seconds,
    )

    try:
        with get_cursor(SCHEMA) as cur:
            cur.execute(
                """INSERT INTO scans(scanned_at, cn_sn, us_sn, mod_a, mod_b, au8, am7, product_line, start_time, production_seconds)
                   VALUES(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                row
            )
        _invalidate_kpi_cache()
    except psycopg2.IntegrityError as e:
        err = str(e)
        if "unique" in err.lower() or "duplicate" in err.lower():
            # Try to extract which column caused the conflict
            col_map = {"cn_sn": "china_sn", "us_sn": "us_sn", "mod_a": "module_a",
                       "mod_b": "module_b", "au8": "pcba_au8", "am7": "pcba_am7"}
            dup_col = "unknown"
            for db_col, api_col in col_map.items():
                if db_col in err:
                    dup_col = api_col
                    break
            return {"status": "error",
                    "message": f"Duplicate value in field '{dup_col}'"}
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

    # Include production_seconds in broadcast if available
    broadcast_data = {
        "event": "assembly_updated", "timestamp": ts,
        "count": sum(hourly.values()),
        "labels": [f"{h}:00" for h in hrs],
        "trend": [hourly[h] for h in hrs]
    }
    if production_seconds is not None:
        broadcast_data["production_seconds"] = production_seconds
        broadcast_data["us_sn"] = us_sn_key or us_sn_cleaned

    await ws_manager.broadcast(broadcast_data)
    # Assembly usage affects PCBA availability -> broadcast statistics
    await _broadcast_pcba_statistics()

    response = {"status": "success", "message": "Record added successfully"}
    if production_seconds is not None:
        response["production_seconds"] = production_seconds
        response["start_time"] = start_time

    return response

# ───────────────────────────── ② Get single ─────────────────────────
@router.get("/assembly_inventory/{us_sn}", response_model=AssemblyRecordOut,
            dependencies=[Depends(require_roles("admin","operator"))])
def get_one(us_sn: str):
    with get_cursor(SCHEMA) as cur:
        cur.execute("""SELECT id, scanned_at AS timestamp,
                   cn_sn AS china_sn, us_sn,
                   mod_a AS module_a, mod_b AS module_b,
                   au8 AS pcba_au8, am7 AS pcba_am7,
                   product_line,
                   status, ng_reason FROM scans WHERE us_sn=%s""",
                   (us_sn.strip(),))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, f"{us_sn} not found")
    return dict(row)

# ───────────────────────────── ③ Update ─────────────────────────────
class AssemblyUpdate(BaseModel):
    module_a: Optional[str] = None
    module_b: Optional[str] = None
    pcba_au8: Optional[str] = None
    pcba_am7: Optional[str] = None
    status:   Optional[str] = None
    ng_reason: Optional[str] = None
    product_line: Optional[str] = None

@router.put("/assembly_inventory/{us_sn}", dependencies=[Depends(require_roles("admin","operator"))])
async def update_one(us_sn: str, body: AssemblyUpdate):
    col = {"module_a": "mod_a", "module_b": "mod_b",
           "pcba_au8": "au8", "pcba_am7": "am7",
           "status": "status", "ng_reason": "ng_reason",
           "product_line": "product_line"}
    sets, vals = [], []
    impact_pcba = False
    for k, v in body.model_dump(exclude_none=True).items():
        dbcol = col[k]
        if dbcol in ("mod_a", "mod_b", "au8", "am7"):
            cv = clean_u(v)  # None will be stored as NULL
        elif dbcol == "product_line":
            cv = infer_product_line(us_sn, v)
        else:
            cv = v.strip() if isinstance(v, str) else v
        sets.append(f"{dbcol}=%s")
        vals.append(cv)
        if dbcol in ("mod_a", "mod_b", "au8", "am7") and cv:
            RAM_SN.add(cv)
        if dbcol in ("au8", "am7"):
            impact_pcba = True
    if not sets:
        return {"status": "error", "message": "No field to update"}
    vals.append(us_sn.strip())
    try:
        with get_conn(SCHEMA) as conn:
            cur = conn.cursor()
            cur.execute(f"UPDATE scans SET {', '.join(sets)} WHERE us_sn=%s", vals)
            rowcount = cur.rowcount
    except psycopg2.IntegrityError as e:
        err = str(e)
        if "unique" in err.lower() or "duplicate" in err.lower():
            dup_col = "unknown"
            for db_col in ("cn_sn", "us_sn", "mod_a", "mod_b", "au8", "am7"):
                if db_col in err:
                    dup_col = db_col
                    break
            return {"status": "error", "message": f"Duplicate value in '{dup_col}'"}
        raise
    if rowcount == 0:
        raise HTTPException(404, f"{us_sn} not found")
    _invalidate_kpi_cache()

    # If fields that affect PCBA availability changed -> broadcast statistics
    if impact_pcba:
        await _broadcast_pcba_statistics()

    return {"status": "success", "message": "Record updated"}

# ───────────────────────────── ④ Mark / Clear NG ────────────────────
class MarkBody(BaseModel):  us_sn: str; reason: str
class ClearBody(BaseModel): us_sn: str

@router.post("/assembly_inventory/mark_ng", dependencies=[Depends(require_roles("admin","operator"))])
async def mark_ng(body: MarkBody):
    if not body.us_sn or not body.reason:
        return {"status": "error", "message": "us_sn and reason are required"}
    with get_conn(SCHEMA) as conn:
        cur = conn.cursor()
        cur.execute("UPDATE scans SET status='NG', ng_reason=%s WHERE us_sn=%s",
                     (body.reason.strip(), body.us_sn.strip()))
        rowcount = cur.rowcount
    if rowcount == 0:
        return {"status": "error", "message": f"{body.us_sn} not found"}
    _invalidate_kpi_cache()

    # Broadcast WebSocket update for NG Dashboard
    await ws_manager.broadcast({
        "event": "assembly_status_updated",
        "timestamp": now_str(),
        "us_sn": body.us_sn.strip(),
        "status": "NG",
        "reason": body.reason.strip()
    })

    return {"status": "success", "message": f"{body.us_sn} marked NG"}

@router.post("/assembly_inventory/clear_ng", dependencies=[Depends(require_roles("admin","operator"))])
async def clear_ng(body: ClearBody):
    with get_conn(SCHEMA) as conn:
        cur = conn.cursor()
        cur.execute("UPDATE scans SET status='FIXED' WHERE us_sn=%s AND UPPER(status)='NG'",
                     (body.us_sn.strip(),))
        rowcount = cur.rowcount
    if rowcount == 0:
        return {"status": "error", "message": f"{body.us_sn} not NG or not found"}
    _invalidate_kpi_cache()

    # Broadcast WebSocket update for NG Dashboard
    await ws_manager.broadcast({
        "event": "assembly_status_updated",
        "timestamp": now_str(),
        "us_sn": body.us_sn.strip(),
        "status": "FIXED"
    })

    return {"status": "success", "message": f"{body.us_sn} marked FIXED"}

# ───────────────────────────── ⑤ Daily KPI ──────────────────────────
@router.get("/assembly_inventory_daily_count")
def today_count(user=Depends(get_current_user)):
    rollover()
    day_key = today().strftime("%Y-%m-%d")
    cache_key = f"daily:{day_key}"
    cached = _DAILY_COUNT_CACHE.get(cache_key)
    if cached:
        return cached
    start_ts, end_ts = today_range_str()
    with get_cursor(SCHEMA) as cur:
        cur.execute("""SELECT COUNT(*) AS c,
            SUM(CASE WHEN UPPER(status)='NG' THEN 1 ELSE 0 END)     AS pure_ng,
            SUM(CASE WHEN UPPER(status)='FIXED' THEN 1 ELSE 0 END)  AS fixed,
            SUM(CASE WHEN UPPER(status) IN ('NG','FIXED') THEN 1 ELSE 0 END) AS ng_all,
            SUM(CASE WHEN product_line='apower' THEN 1 ELSE 0 END) AS apower_cnt,
            SUM(CASE WHEN product_line='apower2' THEN 1 ELSE 0 END) AS apower2_cnt,
            SUM(CASE WHEN product_line='apower_s' THEN 1 ELSE 0 END) AS apower_s_cnt
            FROM scans WHERE scanned_at >= %s AND scanned_at < %s""", (start_ts, end_ts))
        row = cur.fetchone()
    result = {
        "status": "success",
        "count": int(row["c"] or 0),
        "ng":    int(row["ng_all"] or 0),
        "pure_ng": int(row["pure_ng"] or 0),
        "fixed": int(row["fixed"] or 0),
        "apower": int(row["apower_cnt"] or 0),
        "apower2": int(row["apower2_cnt"] or 0),
        "apower_s": int(row["apower_s_cnt"] or 0)
    }
    _DAILY_COUNT_CACHE.set(cache_key, result)
    return result

@router.get("/assembly_inventory_trend")
def trend(user=Depends(get_current_user)):
    rollover()
    start_ts, end_ts = today_range_str()

    # Query hourly data with product line breakdown
    # PG TO_CHAR for TIMESTAMPTZ: TO_CHAR(scanned_at, 'HH24') extracts hour
    with get_cursor(SCHEMA) as cur:
        cur.execute("""
            SELECT TO_CHAR(scanned_at, 'HH24') AS hr,
                   SUM(CASE WHEN product_line='apower' THEN 1 ELSE 0 END) AS apower_cnt,
                   SUM(CASE WHEN product_line='apower2' THEN 1 ELSE 0 END) AS apower2_cnt,
                   SUM(CASE WHEN product_line='apower_s' THEN 1 ELSE 0 END) AS apower_s_cnt,
                   COUNT(*) AS total
            FROM scans
            WHERE scanned_at >= %s AND scanned_at < %s
            GROUP BY hr
            ORDER BY hr
        """, (start_ts, end_ts))
        rows = cur.fetchall()

    # Build hour-indexed dictionaries
    apower_data = {}
    apower2_data = {}
    apower_s_data = {}
    total_data = {}

    for r in rows:
        hr = r["hr"]
        apower_data[hr] = int(r["apower_cnt"] or 0)
        apower2_data[hr] = int(r["apower2_cnt"] or 0)
        apower_s_data[hr] = int(r["apower_s_cnt"] or 0)
        total_data[hr] = int(r["total"] or 0)

    hrs = sorted(set(list(apower_data.keys()) + list(apower2_data.keys()) + list(apower_s_data.keys()) + list(total_data.keys())))

    return {
        "status": "success",
        "labels": [f"{h}:00" for h in hrs],
        "trend": [total_data.get(h, 0) for h in hrs],
        "apower": [apower_data.get(h, 0) for h in hrs],
        "apower2": [apower2_data.get(h, 0) for h in hrs],
        "apower_s": [apower_s_data.get(h, 0) for h in hrs]
    }

# ───────────────────────────── ⑦ Weekly KPI ─────────────────────────
@router.get("/assembly_weekly_kpi")
def weekly_kpi(user=Depends(get_current_user)):
    t = today()
    monday = t - timedelta(days=t.weekday())
    cache_key = f"weekly:{monday.strftime('%Y-%m-%d')}"
    cached = _WEEKLY_KPI_CACHE.get(cache_key)
    if cached:
        return cached
    labels = [(monday + timedelta(days=i)).strftime("%m-%d") for i in range(6)]  # Mon..Sat

    totals = [0]*6
    apower_counts = [0]*6
    apower2_counts = [0]*6
    apower_s_counts = [0]*6

    start_ts = monday.strftime("%Y-%m-%d 00:00:00")
    end_ts = (monday + timedelta(days=6)).strftime("%Y-%m-%d 00:00:00")
    with get_cursor(SCHEMA) as cur:
        cur.execute("""
            SELECT TO_CHAR(scanned_at, 'MM-DD') AS mmdd,
                   COUNT(*) AS cnt,
                   SUM(CASE WHEN product_line='apower' THEN 1 ELSE 0 END) AS apower_cnt,
                   SUM(CASE WHEN product_line='apower2' THEN 1 ELSE 0 END) AS apower2_cnt,
                   SUM(CASE WHEN product_line='apower_s' THEN 1 ELSE 0 END) AS apower_s_cnt
            FROM scans
            WHERE scanned_at >= %s AND scanned_at < %s
            GROUP BY mmdd
        """, (start_ts, end_ts))
        rows = cur.fetchall()

    for r in rows:
        if r["mmdd"] in labels:
            idx = labels.index(r["mmdd"])
            totals[idx] = r["cnt"]
            apower_counts[idx] = int(r["apower_cnt"] or 0)
            apower2_counts[idx] = int(r["apower2_cnt"] or 0)
            apower_s_counts[idx] = int(r["apower_s_cnt"] or 0)

    # Show Saturday only if there is data
    include_sat = totals[5] > 0
    if not include_sat:
        labels = labels[:5]
        totals = totals[:5]
        apower_counts = apower_counts[:5]
        apower2_counts = apower2_counts[:5]
        apower_s_counts = apower_s_counts[:5]

    # Planned values: array or dict(A/B or total), pad to match length
    with get_cursor(SCHEMA) as cur:
        cur.execute(
            "SELECT plan_json FROM assembly_weekly_plan WHERE week_start=%s",
            (monday.strftime("%Y-%m-%d"),)
        )
        plan_row = cur.fetchone()

    def _sum_ab(v):
        if isinstance(v, dict):
            return int(v.get("A", 0)) + int(v.get("B", 0))
        return int(v or 0)

    if plan_row and plan_row["plan_json"]:
        try:
            pj = plan_row["plan_json"]
            if isinstance(pj, str):
                pj = json.loads(pj)
            if isinstance(pj, list):
                def to_int_or_default(v, default=95):
                    if v is None:
                        return default
                    if isinstance(v, str) and v.strip() == "":
                        return default
                    try:
                        return int(v)
                    except Exception:
                        return default
                plan = [to_int_or_default(x) for x in pj]
            elif isinstance(pj, dict):
                plan = []
                for i in range(6):
                    d = (monday + timedelta(days=i)).strftime("%Y-%m-%d")
                    plan.append(_sum_ab(pj.get(d, 95)))
            else:
                plan = [95]*len(labels)
        except Exception:
            plan = [95]*len(labels)
    else:
        plan = [95]*len(labels)

    if len(plan) < len(labels):
        plan.extend([95] * (len(labels) - len(plan)))

    result = {
        "status": "success",
        "labels": labels,
        "total": totals,
        "apower": apower_counts,
        "apower2": apower2_counts,
        "apower_s": apower_s_counts,
        "plan": plan[:len(labels)]
    }
    _WEEKLY_KPI_CACHE.set(cache_key, result)
    return result

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
    with get_cursor(SCHEMA) as cur:
        cur.execute("SELECT plan_json FROM assembly_weekly_plan WHERE week_start=%s", (ws,))
        row = cur.fetchone()
    if row:
        try:
            pj = row["plan_json"]
            plan = pj if isinstance(pj, (list, dict)) else json.loads(pj)
        except Exception:
            plan = [95, 95, 95, 95, 95]
    else:
        plan = [95, 95, 95, 95, 95]
    return {"status": "success", "week_start": ws, "plan": plan}

@router.post("/assembly_weekly_plan", summary="Set plan for current week (array)",
             dependencies=[Depends(require_roles("admin","operator"))])
async def set_assy_plan(plan: List[int] = Body(..., embed=False)):
    """
    Frontend posts a raw array: e.g. [60,60,60,60,60] or [60,60,60,60,60,40]
    Length must be 5 or 6.
    """
    if len(plan) not in (5, 6):
        return {"status": "error", "message": "need 5 or 6 numbers"}
    ws = this_monday().strftime("%Y-%m-%d")
    with get_cursor(SCHEMA) as cur:
        cur.execute("""
            INSERT INTO assembly_weekly_plan (week_start, plan_json)
            VALUES (%s, %s)
            ON CONFLICT(week_start) DO UPDATE SET plan_json=EXCLUDED.plan_json
        """, (ws, json.dumps([int(x) for x in plan])))
    _invalidate_kpi_cache()

    # Broadcast (reuse existing frontend events so no UI change is required)
    await ws_manager.broadcast({"event": "weekly_plan_updated"})
    await ws_manager.broadcast({"event": "assembly_updated", "timestamp": now_str()})

    return {"status": "success", "week_start": ws, "plan": plan}

@router.patch("/assembly_weekly_plan", summary="Patch a single day for current (or specified) week",
              dependencies=[Depends(require_roles("admin","operator"))])
async def patch_assy_plan(body: AssyPlanPatch):
    ws = _week_start_str(body.week_start)
    with get_cursor(SCHEMA) as cur:
        cur.execute("SELECT plan_json FROM assembly_weekly_plan WHERE week_start=%s", (ws,))
        row = cur.fetchone()

    if row:
        try:
            pj = row["plan_json"]
            plan = pj if isinstance(pj, (list, dict)) else json.loads(pj)
        except Exception:
            plan = [95, 95, 95, 95, 95]
    else:
        plan = [95, 95, 95, 95, 95]

    if body.day < 0 or body.day >= max(6, len(plan)):
        raise HTTPException(400, "day must be in 0..5 (Mon..Sat)")

    # Ensure array length if we want to update Saturday (index 5)
    while len(plan) <= body.day:
        plan.append(95)

    plan[body.day] = int(body.value)

    with get_cursor(SCHEMA) as cur:
        cur.execute("""
            INSERT INTO assembly_weekly_plan (week_start, plan_json)
            VALUES (%s, %s)
            ON CONFLICT(week_start) DO UPDATE SET plan_json=EXCLUDED.plan_json
        """, (ws, json.dumps(plan)))
    _invalidate_kpi_cache()

    await ws_manager.broadcast({"event": "weekly_plan_updated"})
    await ws_manager.broadcast({"event": "assembly_updated", "timestamp": now_str()})

    return {"status": "success", "week_start": ws, "plan": plan}

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
    return {"status": "success", "plan_data": plan_data}

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
      "production_data": [  # daily => hourly rows; weekly/monthly => daily rows
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

    range_start, _ = day_range_str(start_d)
    _, range_end = day_range_str(end_d)

    # Fetch production_data
    production_data: List[Dict[str, Any]] = []

    with get_cursor(SCHEMA) as cur:
        if period == "daily":
            cur.execute("""
              SELECT TO_CHAR(scanned_at, 'HH24') AS hh,
                     COUNT(*) AS total,
                     SUM(CASE WHEN UPPER(status) IN ('NG','FIXED') THEN 1 ELSE 0 END) AS ng_all,
                     SUM(CASE WHEN UPPER(status)='FIXED' THEN 1 ELSE 0 END) AS fixed
              FROM scans
              WHERE scanned_at >= %s AND scanned_at < %s
              GROUP BY hh
              ORDER BY hh
            """, (range_start, range_end))
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
            # Aggregate by day; scanned_at is TIMESTAMPTZ so use TO_CHAR to extract date part
            cur.execute("""
              SELECT TO_CHAR(scanned_at, 'YYYY-MM-DD') AS d,
                     COUNT(*) AS total,
                     SUM(CASE WHEN UPPER(status) IN ('NG','FIXED') THEN 1 ELSE 0 END) AS ng_all,
                     SUM(CASE WHEN UPPER(status)='FIXED' THEN 1 ELSE 0 END) AS fixed
              FROM scans
              WHERE scanned_at >= %s AND scanned_at < %s
              GROUP BY d
              ORDER BY d
            """, (range_start, range_end))
            by_day = {r["d"]: r for r in cur.fetchall()}

            # Fill in all days in range (even those with 0 scans)
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

        # Summary (aggregate entire range)
        cur.execute("""
          SELECT COUNT(*) AS total,
                 SUM(CASE WHEN UPPER(status) IN ('NG','FIXED') THEN 1 ELSE 0 END) AS ng_all,
                 SUM(CASE WHEN UPPER(status)='FIXED' THEN 1 ELSE 0 END) AS fixed
          FROM scans WHERE scanned_at >= %s AND scanned_at < %s
        """, (range_start, range_end))
        row = cur.fetchone()
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
        }

        # NG reasons (for the same range)
        cur.execute("""
          SELECT ng_reason AS reason, COUNT(*) AS cnt
          FROM scans
          WHERE scanned_at >= %s AND scanned_at < %s AND UPPER(status)='NG' AND ng_reason IS NOT NULL AND TRIM(ng_reason) <> ''
          GROUP BY ng_reason
          ORDER BY cnt DESC
        """, (range_start, range_end))
        ng_reasons = [{"reason": r["reason"], "count": int(r["cnt"] or 0)} for r in cur.fetchall()]

    # Plan data (weekly/monthly expand; default Mon-Fri=90, Sat/Sun=0)
    plan_data: List[Dict[str, Any]] = []
    if period in ("weekly", "monthly"):
        plan_data = _expand_plan_range(start_d, end_d)

    return {
        "summary": summary,
        "production_data": production_data,
        "plan_data": plan_data,
        "ng_reasons": ng_reasons
    }

# ───────────────────────────── ⑨ NG list / ⑩ List all ──────────────
@router.get("/assembly_inventory/list/ng",
            dependencies=[Depends(require_roles("admin","operator","dashboard","viewer"))])
def list_ng(limit: int = 500, include_fixed: bool = True,
            from_date: Optional[str] = None, to_date: Optional[str] = None):
    status_cond = "UPPER(status) IN ('NG','FIXED')" if include_fixed else "UPPER(status)='NG'"
    conds, params = [status_cond], []
    _append_date_range(conds, params, from_date, to_date)
    params.append(limit)
    with get_cursor(SCHEMA) as cur:
        cur.execute(f"""
            SELECT id, scanned_at AS timestamp, us_sn, cn_sn, status, ng_reason
            FROM scans WHERE {' AND '.join(conds)} ORDER BY scanned_at DESC LIMIT %s""", params)
        return [dict(r) for r in cur.fetchall()]

@router.get("/assembly_inventory/list/all",
            dependencies=[Depends(require_roles("admin","operator"))])
def list_all(limit: int = 1000, status_filter: Optional[str] = None,
             from_date: Optional[str] = None, to_date: Optional[str] = None):
    conds, params = [], []
    if status_filter and status_filter != "all":
        if status_filter.lower() == "ok":
            conds.append("(status='' OR status IS NULL)")
        elif status_filter.lower() == "ng":
            conds.append("UPPER(status)='NG'")
        elif status_filter.lower() == "fixed":
            conds.append("UPPER(status)='FIXED'")
        else:
            conds.append("status=%s"); params.append(status_filter)
    _append_date_range(conds, params, from_date, to_date)
    params.append(limit)
    where = " AND ".join(conds) if conds else "1=1"
    with get_cursor(SCHEMA) as cur:
        cur.execute(f"""
            SELECT id, scanned_at AS timestamp, cn_sn AS china_sn, us_sn, mod_a AS module_a,
                   mod_b AS module_b, au8 AS pcba_au8, am7 AS pcba_am7,
                   status, ng_reason
            FROM scans WHERE {where} ORDER BY scanned_at DESC LIMIT %s""", params)
        return [dict(r) for r in cur.fetchall()]

# ───────────────────────────── ⑪ Delete ────────────────────────────
@router.delete("/assembly_inventory/delete/{scan_id}", dependencies=[Depends(require_roles("admin"))])
async def delete_scan(scan_id: int):
    with get_conn(SCHEMA) as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT scanned_at, cn_sn, us_sn, mod_a, mod_b, au8, am7 FROM scans WHERE id=%s", (scan_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, f"id={scan_id} not found")
        cur.execute("DELETE FROM scans WHERE id=%s", (scan_id,))

    if row["scanned_at"] and row["scanned_at"].date() == TODAY:
        hr = row["scanned_at"].strftime("%H")
        hourly[hr] -= 1
        if hourly[hr] <= 0:
            hourly.pop(hr, None)

    for f in ("cn_sn", "us_sn", "mod_a", "mod_b", "au8", "am7"):
        v = row[f]
        if v:
            RAM_SN.discard(v)

    _invalidate_kpi_cache()

    hrs = sorted(hourly.keys())
    await ws_manager.broadcast({
        "event": "assembly_updated", "timestamp": now_str(),
        "count": sum(hourly.values()),
        "labels": [f"{h}:00" for h in hrs],
        "trend": [hourly[h] for h in hrs]
    })

    # If AM7/AU8 were present, PCBA availability is affected -> broadcast statistics
    if (row["am7"] and row["am7"].strip().upper() != "N/A") or (row["au8"] and row["au8"].strip().upper() != "N/A"):
        await _broadcast_pcba_statistics()

    return {"status": "success", "message": f"Deleted id={scan_id}"}

# ───────────────────────────── ⑬ Admin - edit timestamp ─────────────
class AdminPatch(BaseModel): timestamp: str  # YYYY-MM-DD HH:MM:SS

@router.patch("/assembly_inventory/admin_edit/{us_sn}", dependencies=[Depends(require_roles("admin"))])
async def admin_edit(us_sn: str, body: AdminPatch):
    with get_cursor(SCHEMA) as cur:
        cur.execute("SELECT scanned_at FROM scans WHERE us_sn=%s", (us_sn.strip(),))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, f"{us_sn} not found")
    old_ts = row["scanned_at"]; new_ts = body.timestamp.strip()
    try:
        datetime.strptime(new_ts, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        raise HTTPException(400, "timestamp must be YYYY-MM-DD HH:MM:SS")
    if old_ts and new_ts == old_ts.strftime("%Y-%m-%d %H:%M:%S"):
        return {"status": "success", "message": "Unchanged"}
    with get_cursor(SCHEMA) as cur:
        cur.execute("UPDATE scans SET scanned_at=%s WHERE us_sn=%s", (new_ts, us_sn.strip()))

    # Repair in-memory only for today
    today_str_val = TODAY.strftime("%Y-%m-%d")
    old_day = old_ts.strftime("%Y-%m-%d") if old_ts else ""
    new_day = new_ts[:10]
    old_hr = old_ts.strftime("%H") if old_ts else ""
    new_hr = new_ts[11:13]
    if old_day == today_str_val and old_hr in hourly:
        hourly[old_hr] -= 1
        if hourly[old_hr] <= 0:
            hourly.pop(old_hr, None)
    if new_day == today_str_val:
        hourly[new_hr] += 1

    def bump(day_val):
        if day_val > today_str_val:
            return
        tot, ng_all, fixed = _counts_for_day(day_val)
        with get_cursor(SCHEMA) as cur:
            cur.execute("""
              INSERT INTO daily_summary(day, total, ng, fixed)
              VALUES(%s, %s, %s, %s)
              ON CONFLICT(day) DO UPDATE SET total=%s, ng=%s, fixed=%s""",
              (day_val, tot, ng_all, fixed, tot, ng_all, fixed))

    bump(old_day)
    bump(new_day)
    _invalidate_kpi_cache()

    hrs = sorted(hourly.keys())
    await ws_manager.broadcast({
        "event": "assembly_updated", "timestamp": new_ts,
        "count": sum(hourly.values()),
        "labels": [f"{h}:00" for h in hrs],
        "trend": [hourly[h] for h in hrs]
    })
    return {"status": "success", "message": "Timestamp updated"}

# ───────────────────────────── ⑬b Admin - full edit ─────────────────
class AdminFullEdit(BaseModel):
    timestamp: Optional[str] = None
    china_sn:  Optional[str] = None
    us_sn:     Optional[str] = None
    module_a:  Optional[str] = None
    module_b:  Optional[str] = None
    pcba_au8:  Optional[str] = None
    pcba_am7:  Optional[str] = None
    status:    Optional[str] = None
    ng_reason: Optional[str] = None

@router.put("/assembly_inventory/admin_full_edit/{record_id}", dependencies=[Depends(require_roles("admin"))])
async def admin_full_edit(record_id: int, body: AdminFullEdit):
    """Admin-only: update any field of a scan record by ID."""
    with get_cursor(SCHEMA) as cur:
        cur.execute("SELECT * FROM scans WHERE id=%s", (record_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, f"id={record_id} not found")

    sets, vals = [], []
    col_map = {
        "timestamp": "scanned_at",
        "china_sn": "cn_sn",
        "us_sn": "us_sn",
        "module_a": "mod_a",
        "module_b": "mod_b",
        "pcba_au8": "au8",
        "pcba_am7": "am7",
        "status": "status",
        "ng_reason": "ng_reason",
    }

    for field, dbcol in col_map.items():
        val = getattr(body, field, None)
        if val is None:
            continue
        val = val.strip() if isinstance(val, str) else val
        # Validate timestamp format
        if field == "timestamp":
            try:
                datetime.strptime(val, "%Y-%m-%d %H:%M:%S")
            except ValueError:
                raise HTTPException(400, "timestamp must be YYYY-MM-DD HH:MM:SS")
        # Clean serial numbers
        if dbcol in ("mod_a", "mod_b", "au8", "am7", "cn_sn", "us_sn"):
            val = val.upper().replace("-", "").replace(" ", "") if val else val
        sets.append(f"{dbcol}=%s")
        vals.append(val)

    if not sets:
        return {"status": "error", "message": "No field to update"}

    vals.append(record_id)
    try:
        with get_conn(SCHEMA) as conn:
            cur = conn.cursor()
            cur.execute(f"UPDATE scans SET {', '.join(sets)} WHERE id=%s", vals)
    except psycopg2.IntegrityError as e:
        err = str(e)
        if "unique" in err.lower() or "duplicate" in err.lower():
            dup_col = "unknown"
            for db_col in ("cn_sn", "us_sn", "mod_a", "mod_b", "au8", "am7"):
                if db_col in err:
                    dup_col = db_col
                    break
            return {"status": "error", "message": f"Duplicate value in '{dup_col}'"}
        raise

    _invalidate_kpi_cache()
    # Rebuild RAM_SN for updated serials
    for field in ("us_sn", "china_sn", "module_a", "module_b", "pcba_au8", "pcba_am7"):
        v = getattr(body, field, None)
        if v:
            RAM_SN.add(v.strip().upper().replace("-", "").replace(" ", ""))

    await ws_manager.broadcast({
        "event": "assembly_updated", "timestamp": now_str(),
        "count": sum(hourly.values()),
    })
    return {"status": "success", "message": f"Record {record_id} updated"}

# ───────────────────────────── ⑭ Admin - rebuild_cache ─────────────
@router.post("/assembly_inventory/rebuild_cache",
             dependencies=[Depends(require_roles("admin"))])
async def rebuild_cache(day: Optional[str] = Query(None, description="YYYY-MM-DD, default=today")):
    """
    Rebuild global de-dup cache (RAM_SN), and recompute hourly & daily_summary for the specified day only.
    TODAY is not changed; if the target day is TODAY, in-memory hourly is replaced and a chart update is broadcast.
    """
    # Parse date
    try:
        target = datetime.strptime(day, "%Y-%m-%d").date() if day else today()
    except ValueError:
        raise HTTPException(400, "day must be YYYY-MM-DD")

    prefix = target.strftime("%Y-%m-%d")

    # 1) Rebuild RAM_SN (all history)
    RAM_SN.clear()
    with get_cursor(SCHEMA) as cur:
        cur.execute("SELECT cn_sn, us_sn, mod_a, mod_b, au8, am7 FROM scans")
        for r in cur.fetchall():
            for f in ("cn_sn", "us_sn", "mod_a", "mod_b", "au8", "am7"):
                v = r[f]
                if v and v.strip().upper() != "N/A":
                    RAM_SN.add(v.strip())

    # 2) Recompute hourly for target date
    new_hourly = defaultdict(int)
    start_ts, end_ts = day_range_str(target)
    with get_cursor(SCHEMA) as cur:
        cur.execute("SELECT scanned_at FROM scans WHERE scanned_at >= %s AND scanned_at < %s", (start_ts, end_ts))
        for r in cur.fetchall():
            new_hourly[r["scanned_at"].strftime("%H")] += 1

    # 3) Backfill daily_summary(total/ng/fixed)
    tot, ng_all, fixed = _counts_for_day(prefix)
    with get_cursor(SCHEMA) as cur:
        cur.execute("""
            INSERT INTO daily_summary(day, total, ng, fixed)
            VALUES(%s, %s, %s, %s)
            ON CONFLICT(day) DO UPDATE SET total=%s, ng=%s, fixed=%s""",
            (prefix, tot, ng_all, fixed, tot, ng_all, fixed))
    _invalidate_kpi_cache()

    # 4) If the target is TODAY -> swap in-memory and broadcast
    if target == TODAY:
        hourly.clear()
        for k, v in new_hourly.items():
            hourly[k] = v
        hrs = sorted(hourly.keys())
        await ws_manager.broadcast({
            "event": "assembly_updated", "timestamp": now_str(),
            "count": sum(hourly.values()),
            "labels": [f"{h}:00" for h in hrs],
            "trend": [hourly[h] for h in hrs]
        })
    logger.info("Cache rebuilt for %s (total=%d)", prefix, sum(new_hourly.values()))
    return {"status": "success", "message": f"Cache rebuilt for {prefix}"}

# ───────────────────────────── ⑮ Live API: Available for Assembly ──────────────────────────
@router.get("/assembly/pcba_inventory", summary="Live calc: PCBA Completed(ex NG) - Assembly usage (no DB writes)")
def get_pcba_inventory(user=Depends(get_current_user)):
    """
    Returns AM7/AU8:
      - completed  = PCBA completed and not NG
      - used       = current assembly usage count (from assembly schema) for serials present in PCBA completed
      - available  = max(completed-used, 0)
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
