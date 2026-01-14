# backend/api/risk_router.py
# 2025-08-11 aligned to Dashboard: same DB paths, persistent conns, local-day window, WS 'risk_update'

from __future__ import annotations

import os, json, logging, sqlite3
from datetime import datetime, time, timedelta, date
from typing import Any, Dict, List, Tuple, Optional

import pytz
from fastapi import APIRouter, BackgroundTasks, Depends

from core.deps import get_current_user
from core.ws_manager import ws_manager

# ─────────────────── 基本設定 ───────────────────
router = APIRouter(prefix="/risk", tags=["risk"])
logger = logging.getLogger(__name__)

CA_TZ = pytz.timezone("America/Los_Angeles")
UTC   = pytz.utc

# 班別
SHIFT_START      = time(7, 30)      # Mon–Fri
SHIFT_END        = time(16, 0)
SAT_SHIFT_START  = time(6, 0)       # Saturday
SAT_SHIFT_END    = time(14, 0)

LUNCH_MODEL      = (time(11, 30), time(12, 0))
LUNCH_ASSY       = (time(11, 0),  time(11, 30))

IDLE_THRESHOLD   = 12   # min
MAX_IDLE_WINDOW  = 20   # min
WORK_MIN         = 480  # 7h30 + 30min lunch

PROG_TH          = {"warning": 0.95, "critical": 0.80}   # done / expected
NEED_TH          = {"warning": 1.05, "critical": 1.30}   # need_rate / tgt_rate

# ─────────────────── DB 路徑對齊（與其他 router 一致） ───────────────────
def _resolve_db_path(default_name: str) -> str:
    """
    1) 優先使用環境變數（若存在）
    2) 專案根目錄同名檔案（assembly.db / model.db）
    3) data/ 子目錄同名檔案（最後備援）
    """
    env = os.getenv(f"{default_name.upper()}_PATH")
    if env and os.path.exists(env):
        return env
    cwd_path  = os.path.abspath(default_name + ".db")
    data_path = os.path.abspath(os.path.join("data", default_name + ".db"))
    if os.path.exists(cwd_path):
        return cwd_path
    return data_path  # 允許第一次不存在，等寫入方建立

MODEL_DB_PATH = _resolve_db_path("model")
ASSY_DB_PATH  = _resolve_db_path("assembly")

# ─────────────────── 持久連線（不即開即關；不動 WAL 設定） ───────────────────
def _open_ro(db_path: str) -> sqlite3.Connection:
    """
    以 read-only 優先；若檔案尚未建立或不支援 ro URI，回退可寫模式。
    不修改 PRAGMA（尊重現有 WAL 設定）。
    """
    try:
        uri = f"file:{db_path}?mode=ro&cache=shared"
        conn = sqlite3.connect(uri, uri=True, check_same_thread=False, timeout=15)
    except sqlite3.OperationalError:
        conn = sqlite3.connect(db_path, check_same_thread=False, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=5000")
    return conn

DB_MODEL = _open_ro(MODEL_DB_PATH)
DB_ASSY  = _open_ro(ASSY_DB_PATH)

# ─────────────────── 掃描表自動偵測（避免 no such table: scans） ───────────────────
_SCAN_TABLE_CACHE: Dict[int, str] = {}

def _pick_scan_table(conn: sqlite3.Connection) -> str:
    key = id(conn)
    if key in _SCAN_TABLE_CACHE:
        return _SCAN_TABLE_CACHE[key]
    cand = ["scans", "model_scans", "model_inventory", "inventory", "records"]
    for name in cand:
        try:
            r = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,)
            ).fetchone()
            if not r: 
                continue
            cols = conn.execute(f"PRAGMA table_info({name})").fetchall()
            if any(c["name"].lower() == "ts" for c in cols):
                _SCAN_TABLE_CACHE[key] = name
                logger.info("[risk] use table '%s' for conn %s", name, key)
                return name
        except sqlite3.OperationalError:
            continue
    raise RuntimeError("[risk] cannot find a scan table with 'ts' column")

# ─────────────────── 共用 utils ───────────────────
def _now() -> datetime:
    return datetime.now(CA_TZ)

def _parse_ts(ts: str) -> datetime:
    # 主要寫入格式：本地字串；若遇到 ISO/TZ 則轉換到 CA
    if "T" in ts:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = UTC.localize(dt)
        return dt.astimezone(CA_TZ)
    return CA_TZ.localize(datetime.strptime(ts, "%Y-%m-%d %H:%M:%S"))

def _today_range_local() -> Tuple[str, str]:
    d = _now().date().strftime("%Y-%m-%d")
    return f"{d} 00:00:00", f"{d} 23:59:59"

def _today_scans(conn: sqlite3.Connection) -> List[datetime]:
    table = _pick_scan_table(conn)
    s, e = _today_range_local()
    rows = conn.execute(f"SELECT ts FROM {table} WHERE ts BETWEEN ? AND ? ORDER BY ts", (s, e)).fetchall()
    return [_parse_ts(r["ts"]) for r in rows]

def _overlap(a1, a2, b1, b2):
    s, e = max(a1, b1), min(a2, b2)
    return max(0, int((e - s).total_seconds() / 60))

def _find_idle(ts: List[datetime]) -> List[Tuple[datetime, datetime]]:
    gaps = []
    for a, b in zip(ts, ts[1:]):
        mins = (b - a).total_seconds() / 60
        if IDLE_THRESHOLD <= mins <= MAX_IDLE_WINDOW:
            gaps.append((a, b))
    return gaps

def _break_minutes(st, en, lunch, idle):
    total = _overlap(
        st, en,
        CA_TZ.localize(datetime.combine(st.date(), lunch[0])),
        CA_TZ.localize(datetime.combine(st.date(), lunch[1]))
    )
    for bs, be in idle:
        total += _overlap(st, en, bs, be)
    return total

def _effective_minutes(start, lunch, idle, end) -> int:
    total = int((end - start).total_seconds() / 60)
    return max(1, total - _break_minutes(start, end, lunch, idle))

def _scheduled_minutes(start, now_clip, lunch) -> int:
    total = int((now_clip - start).total_seconds() / 60)
    lunch_used = _overlap(
        start, now_clip,
        CA_TZ.localize(datetime.combine(start.date(), lunch[0])),
        CA_TZ.localize(datetime.combine(start.date(), lunch[1]))
    )
    return max(0, total - lunch_used)

def _shift_bounds(day: date, is_sat: bool) -> Tuple[datetime, datetime]:
    st = CA_TZ.localize(datetime.combine(day, SAT_SHIFT_START if is_sat else SHIFT_START))
    en = CA_TZ.localize(datetime.combine(day, SAT_SHIFT_END  if is_sat else SHIFT_END))
    return st, en

def _today_plan(conn: sqlite3.Connection, tbl: str) -> int:
    today  = _now().date()
    monday = today - timedelta(days=today.weekday())
    row = conn.execute(
        f"SELECT plan_json FROM {tbl} WHERE week_start = ?",
        (monday.strftime("%Y-%m-%d"),)
    ).fetchone()
    if not row:
        return 0
    try:
        plan = json.loads(row["plan_json"])
        idx  = today.weekday()
        return int(plan[idx]) if 0 <= idx < len(plan) else 0
    except Exception:
        return 0

def _risk(done, done_used, past_sched, target, cur_rate, frozen=False):
    tgt_rate = target / (WORK_MIN / 60) if target else 0

    past_sched = max(1, past_sched)
    remain_min = max(0, WORK_MIN - past_sched)

    expected = target * (past_sched / WORK_MIN) if target else 0
    progress = (done_used / expected) if expected else 1

    if target and remain_min == 0:
        need_rate  = 0
        need_ratio = 0
    elif target:
        need_rate  = (target - done_used) / remain_min * 60
        need_ratio = (need_rate / tgt_rate) if tgt_rate else 0
    else:
        need_rate = need_ratio = 0

    if frozen and done >= target:
        lvl, rk, msg = "green", "good", f"Target achieved! ({done}/{target})"
    elif target == 0:
        lvl, rk, msg = "none", "no_plan", "No target set"
    else:
        crit = (progress < PROG_TH["critical"]) or (need_ratio >= NEED_TH["critical"])
        warn = (progress < PROG_TH["warning"])  or (need_ratio >= NEED_TH["warning"])
        if crit:
            lvl, rk, msg = "red", "critical", "Critical gap"
        elif warn:
            lvl, rk, msg = "orange", "warning", "Behind schedule"
        else:
            lvl, rk, msg = "green", "good", "On track"

    now = _now()
    rate_ratio_pct = round((cur_rate / tgt_rate) * 100, 1) if tgt_rate else None

    return dict(
        timestamp       = now.isoformat(),
        timezone        = "America/Los_Angeles",
        done            = done,
        done_display    = done_used,
        current_rate    = round(cur_rate, 2),
        target_rate     = round(tgt_rate, 2) if tgt_rate else None,
        rate_ratio      = rate_ratio_pct,               # 前端用到
        progress_ratio  = round(progress*100, 1) if target else None,
        need_rate       = round(need_rate, 2) if target else None,
        need_ratio      = round(need_ratio*100, 1) if target else None,
        past_min        = past_sched,
        remain_min      = remain_min,
        target          = target,
        risk_level      = lvl,
        risk            = rk,
        message         = msg,
        frozen          = frozen,
        achievement_pct = round(done/target*100,1) if target else 0
    )

# ─────────────────── Freeze（達標凍結） ───────────────────
_FREEZE: Dict[str, Dict[str, Any]] = {}

def _clean_freeze_cache():
    today_s = _now().date().isoformat()
    for k in list(_FREEZE):
        if _FREEZE[k].get("date") != today_s:
            del _FREEZE[k]

# ─────────────────── 核心計算 ───────────────────
async def _calc(conn: sqlite3.Connection, tbl: str, lunch: Tuple[time, time], *, key: str):
    _clean_freeze_cache()

    ts_all = _today_scans(conn)
    done   = len(ts_all)
    target = _today_plan(conn, tbl)

    if target == 0:
        _FREEZE.pop(key, None)
        return _risk(done, done, 0, target, 0, False)

    today   = _now().date()
    is_sat  = today.weekday() == 5
    shift_start, shift_end = _shift_bounds(today, is_sat)

    now_clip  = min(_now(), shift_end)                       # 班尾後不再前進
    ts_work   = [t for t in ts_all if shift_start <= t <= now_clip]
    idle      = _find_idle(ts_work)

    past_eff   = _effective_minutes(shift_start, lunch, idle, now_clip)
    past_sched = _scheduled_minutes(shift_start, now_clip, lunch)

    if done >= target:
        if key not in _FREEZE or _FREEZE[key]["date"] != today.isoformat():
            _FREEZE[key] = dict(
                done=done, past=past_sched,
                rate=(done / past_eff * 60) if past_eff else 0.0,
                timestamp=_now().isoformat(),
                date=today.isoformat()
            )
            logger.info("🎯 %s achieved target! rate frozen at %.1f/h", key, _FREEZE[key]["rate"])

        frz       = _FREEZE[key]
        frozen    = True
        done_disp = frz["done"]
        past_disp = frz["past"]
        rate_disp = frz["rate"]
    else:
        _FREEZE.pop(key, None)
        frozen    = False
        done_disp = done
        past_disp = past_sched
        rate_disp = (done / past_eff * 60) if past_eff else 0.0

    res = _risk(done, done_disp, past_disp, target, rate_disp, frozen)

    if frozen:
        res["achieved_at"] = _FREEZE[key]["timestamp"]
        res["freeze_info"] = {
            "frozen_rate": _FREEZE[key]["rate"],
            "frozen_done": _FREEZE[key]["done"],
            "frozen_time": _FREEZE[key]["past"],
            "actual_done": done,
            "actual_time": past_eff
        }
    return res

# ────────────────────────── WS broadcast ────────────────────
async def _broadcast(mod, assy):
    message = {
        "event": "risk_update",
        "timestamp": _now().isoformat(),
        "data": {
            "module": mod,
            "assembly": assy,
            "has_alerts": (
                mod.get("risk_level") in ("red", "orange") or
                assy.get("risk_level") in ("red", "orange")
            ),
            "achievements": {
                "module": mod.get("frozen", False),
                "assembly": assy.get("frozen", False)
            }
        }
    }
    await ws_manager.broadcast(message)
    if mod.get("frozen") or assy.get("frozen"):
        logger.info("📢 Broadcasting achievement: Module=%s, Assembly=%s",
                    mod.get('frozen'), assy.get('frozen'))

# ────────────────────────── API 端點 ─────────────────────────
@router.get("/module")
async def module_risk(bg: BackgroundTasks, user=Depends(get_current_user)):
    mod  = await _calc(DB_MODEL, "weekly_plan",          LUNCH_MODEL, key="module")
    assy = await _calc(DB_ASSY,  "assembly_weekly_plan", LUNCH_ASSY,  key="assembly")
    bg.add_task(_broadcast, mod, assy)
    return mod

@router.get("/assembly")
async def assembly_risk(bg: BackgroundTasks, user=Depends(get_current_user)):
    assy = await _calc(DB_ASSY,  "assembly_weekly_plan", LUNCH_ASSY,  key="assembly")
    mod  = await _calc(DB_MODEL, "weekly_plan",          LUNCH_MODEL, key="module")
    bg.add_task(_broadcast, mod, assy)
    return assy

@router.get("/alerts", summary="彙總風險警示")
async def alerts(bg: BackgroundTasks, user=Depends(get_current_user)):
    mod  = await _calc(DB_MODEL, "weekly_plan",          LUNCH_MODEL, key="module")
    assy = await _calc(DB_ASSY,  "assembly_weekly_plan", LUNCH_ASSY,  key="assembly")

    alerts = []
    for typ, res in (("module", mod), ("assembly", assy)):
        if res["risk_level"] in ("red", "orange", "yellow", "green"):
            alert = {
                "type":         typ,
                "level":        res["risk_level"],
                "risk":         res["risk"],
                "done":         res["done"],
                "target":       res["target"],
                "current_rate": res["current_rate"],
                "target_rate":  res.get("target_rate"),
                "rate_ratio":   res.get("rate_ratio"),
                "timestamp":    res["timestamp"],
                "frozen":       res.get("frozen", False),
                "message":      res.get("message", ""),
                "detail": (
                    f"目標 {res['target_rate']:.1f}/h；目前 {res['current_rate']:.1f}/h"
                    if res.get("target_rate") else "未設定今日目標"
                )
            }
            if res.get("frozen"):
                alert["achievement"] = {
                    "achieved_at": res.get("achieved_at"),
                    "actual_done": res.get("freeze_info", {}).get("actual_done", res["done"]),
                    "frozen_rate": res.get("freeze_info", {}).get("frozen_rate")
                }
            alerts.append(alert)

    if any(a["level"] in ("red", "orange") or a.get("frozen") for a in alerts):
        bg.add_task(_broadcast, mod, assy)

    summary = {
        "timestamp":      _now().isoformat(),
        "timezone":       "America/Los_Angeles",
        "total_alerts":   len(alerts),
        "critical_count": sum(a["level"] == "red"    for a in alerts),
        "warning_count":  sum(a["level"] == "orange" for a in alerts),
        "caution_count":  sum(a["level"] == "yellow" for a in alerts),
        "good_count":     sum(a["level"] == "green"  for a in alerts),
        "achievements":   sum(a.get("frozen", False) for a in alerts),
        "overall_status":
            "achieved" if all(a.get("frozen", False) for a in alerts) else
            "critical" if any(a["level"] == "red"    for a in alerts) else
            "warning"  if any(a["level"] == "orange" for a in alerts) else
            "good"
    }
    return {"summary": summary, "alerts": alerts, "module": mod, "assembly": assy}

@router.post("/reset_freeze", summary="手動重置凍結狀態")
async def reset_freeze(user=Depends(get_current_user)):
    old_freeze = dict(_FREEZE)
    _FREEZE.clear()
    logger.info("🔄 Freeze cache reset by %s", user.get("username", "unknown"))
    return {
        "status": "success",
        "message": "Freeze cache cleared",
        "cleared": list(old_freeze.keys()),
        "timestamp": _now().isoformat()
    }
