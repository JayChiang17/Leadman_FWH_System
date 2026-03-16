# backend/api/model_inventory.py

from fastapi import APIRouter, Request, Depends, Query
from fastapi.responses import JSONResponse
from datetime import datetime, date, timedelta
from collections import defaultdict, Counter
import psycopg2
import psycopg2.extras
import time, json, calendar
from pydantic import BaseModel
from typing import Optional

from core.pg import get_conn, get_cursor
from core.ws_manager import ws_manager
from models.model_inventory_model import InventoryScan
from core.deps import require_roles, get_current_user
from core.time_utils import ca_today, ca_now_str, ca_day_bounds
from core.cache_utils import TTLCache

# ─────────── Tunables ───────────
PURGE_DAYS  = 30
RATE_LIMIT  = 800  # ms between scans from same IP

CACHE_TTL_SECONDS = 5
_DAILY_COUNT_CACHE = TTLCache(CACHE_TTL_SECONDS)
_WEEKLY_KPI_CACHE = TTLCache(CACHE_TTL_SECONDS)

router = APIRouter(tags=["model"])

SCHEMA = "model"

def _row_to_json(row) -> dict:
    """Convert a psycopg2 row to a JSON-serializable dict (datetime → ISO string)."""
    if row is None:
        return {}
    return {k: v.isoformat() if isinstance(v, datetime) else v for k, v in dict(row).items()}

# ─────────── Backfill：啟動時自動回填 daily_summary ───────────
def backfill_daily_summary(days: int = 60):
    """開機時回填最近 N 天的 daily_summary；可重複執行（UPSERT）"""
    since = (ca_today() - timedelta(days=days)).strftime("%Y-%m-%d")
    with get_conn(SCHEMA) as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            INSERT INTO daily_summary(day, count_a, count_b, total)
            SELECT scanned_at::date AS d,
                   SUM(CASE WHEN kind='A' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN kind='B' THEN 1 ELSE 0 END),
                   COUNT(*)
            FROM scans
            WHERE scanned_at >= %s
            GROUP BY d
            ON CONFLICT(day) DO UPDATE SET
              count_a=excluded.count_a,
              count_b=excluded.count_b,
              total  =excluded.total;
        """, (since,))

# NOTE: backfill_daily_summary() is called from main.py startup_event()
# after init_pool() has been called.  Do NOT call it here at import time.

# ─────────── In-memory counters ───────────
RAM_SN: set[str] = set()
hourly = defaultdict(lambda: {"A": 0, "B": 0})
daily = Counter()
TODAY = ca_today()
last_ip: dict[str, int] = {}

def _invalidate_kpi_cache() -> None:
    _DAILY_COUNT_CACHE.clear()
    _WEEKLY_KPI_CACHE.clear()

def _load_ram_counters():
    """Load recent scans into RAM counters. Called from main.py startup_event()
    after init_pool() so that the PG pool is ready."""
    cutoff = (TODAY - timedelta(days=PURGE_DAYS)).strftime("%Y-%m-%d")
    with get_cursor(SCHEMA) as cur:
        cur.execute("SELECT sn, kind, scanned_at FROM scans WHERE scanned_at >= %s", (cutoff,))
        for r in cur.fetchall():
            RAM_SN.add(r["sn"])
            if r["scanned_at"].date() == TODAY:
                hourly[r["scanned_at"].strftime("%H")][r["kind"]] += 1
                daily[r["kind"]] += 1

# ─────────── Helpers ───────────
def _rollover():
    global TODAY
    if ca_today() == TODAY:
        return
    y = TODAY.strftime("%Y-%m-%d")
    with get_conn(SCHEMA) as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """INSERT INTO daily_summary VALUES(%s,%s,%s,%s)
               ON CONFLICT(day) DO UPDATE SET count_a=%s,count_b=%s,total=%s""",
            (
                y,
                daily["A"], daily["B"], daily["A"] + daily["B"],
                daily["A"], daily["B"], daily["A"] + daily["B"]
            )
        )
    TODAY = ca_today()
    daily.clear()
    hourly.clear()

def insert_sql(row: tuple) -> bool:
    try:
        with get_conn(SCHEMA) as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("INSERT INTO scans(sn,kind,scanned_at) VALUES(%s,%s,%s)", row)
        return True
    except psycopg2.IntegrityError:
        return False

# ─────────── Weekly-plan helpers for Module (A/B total) ───────────
def _week_start_str_for(d: date) -> str:
    mon = d - timedelta(days=d.weekday())
    return mon.strftime("%Y-%m-%d")

def _get_week_plan_json_module(week_start_str: str):
    with get_cursor(SCHEMA) as cur:
        cur.execute(
            "SELECT plan_json FROM weekly_plan WHERE week_start=%s",
            (week_start_str,)
        )
        row = cur.fetchone()
    return row["plan_json"] if row else None

def _parse_plan_json_module(plan_json):
    if not plan_json:
        return None
    if isinstance(plan_json, (list, dict)):
        return plan_json
    try:
        return json.loads(plan_json)
    except Exception:
        return None

def _plan_for_date_from_pj_module(pj, target: date) -> int:
    """
    回傳「當天總 plan」；支援：
    - list: index 0..5 = Mon..Sat（Sun 視為 0）
    - dict: key 可為 'YYYY-MM-DD'；值可為整數（總量）或 {"A":x,"B":y}
    """
    if pj is None:
        return 0

    if isinstance(pj, list):
        idx = target.weekday()  # 0=Mon..6=Sun
        if idx >= len(pj):
            return 0
        try:
            return int(pj[idx] or 0)
        except Exception:
            return 0

    if isinstance(pj, dict):
        key = target.strftime("%Y-%m-%d")
        v = pj.get(key)
        if v is None:
            return 0
        if isinstance(v, dict):
            a = int(v.get("A", 0) or 0)
            b = int(v.get("B", 0) or 0)
            return a + b
        try:
            return int(v or 0)
        except Exception:
            return 0

    return 0

def _expand_module_plan_range(start_d: date, end_d: date) -> list[dict]:
    """
    展開 weekly_plan → 逐日 plan_total（A+B）
    產出: [{"date":"YYYY-MM-DD","plan_total":N}]
    """
    out: list[dict] = []
    d = start_d
    while d <= end_d:
        ws = _week_start_str_for(d)
        pj = _parse_plan_json_module(_get_week_plan_json_module(ws))
        total = _plan_for_date_from_pj_module(pj, d)
        out.append({"date": d.strftime("%Y-%m-%d"), "plan_total": total})
        d += timedelta(days=1)
    return out

# ════════════════ API Endpoints ════════════════

@router.post("/model_inventory", dependencies=[Depends(require_roles("admin", "operator"))])
async def scan(req: Request, data: InventoryScan):
    """
    掃碼入庫：
    - 驗證 SN 格式
    - 簡單 IP 節流
    - 去重：RAM_SN 與 DB UNIQUE
    - 成功後即時推播目前計數與趨勢
    - 若重複，回 409 並攜帶既有紀錄（sn/kind/ts/status/ng_reason）
    """
    _rollover()

    sn = data.sn.strip()
    _A_PREFIXES = ("10080064", "10080104")
    _B_PREFIXES = ("10080065", "10080105")
    if not (sn.startswith(_A_PREFIXES + _B_PREFIXES) and len(sn) == 24):
        return {"status": "error", "message": "bad SN format"}

    now = int(time.time() * 1000)
    if now - last_ip.get(req.client.host, 0) < RATE_LIMIT:
        return {"status": "error", "message": "slow down"}
    last_ip[req.client.host] = now

    # —— 重複：RAM 內已有（近 30 天內掃過）——
    if sn in RAM_SN:
        with get_cursor(SCHEMA) as cur:
            cur.execute(
                "SELECT id, sn, kind, scanned_at, status, ng_reason FROM scans WHERE sn=%s",
                (sn,)
            )
            row = cur.fetchone()
        payload = {
            "status": "error",
            "message": "duplicate",
            "record": _row_to_json(row) if row else {"sn": sn}
        }
        return JSONResponse(payload, status_code=409)

    kind = "A" if sn.startswith(_A_PREFIXES) else "B"
    ts = ca_now_str()

    # —— 寫入；若 UNIQUE 衝突則回傳既有紀錄 ——
    if not insert_sql((sn, kind, ts)):
        # 將 SN 加入 RAM，避免同頁面短時間一直重送
        RAM_SN.add(sn)
        with get_cursor(SCHEMA) as cur:
            cur.execute(
                "SELECT id, sn, kind, scanned_at, status, ng_reason FROM scans WHERE sn=%s",
                (sn,)
            )
            row = cur.fetchone()
        payload = {
            "status": "error",
            "message": "duplicate",
            "record": _row_to_json(row) if row else {"sn": sn}
        }
        return JSONResponse(payload, status_code=409)

    # —— 成功寫入：更新 RAM 與今日統計、推播 ——
    RAM_SN.add(sn)
    hourly[ts[11:13]][kind] += 1
    daily[kind] += 1
    _invalidate_kpi_cache()

    hrs = sorted(hourly)
    await ws_manager.broadcast({
        "event":     "module_updated",
        "timestamp": ts,
        "count_a":   daily["A"],
        "count_b":   daily["B"],
        "labels":    [f"{h}:00" for h in hrs],
        "trend_a":   [hourly[h]["A"] for h in hrs],
        "trend_b":   [hourly[h]["B"] for h in hrs]
    })

    return {"status": "success"}

# ──────────────────────────────────────────────────────────
#  Today KPI ─ Count / Trend
# ──────────────────────────────────────────────────────────

@router.get("/model_inventory_daily_count")
def daily_count(user=Depends(get_current_user)):
    _rollover()
    day_key = ca_today().strftime("%Y-%m-%d")
    cache_key = f"daily:{day_key}"
    cached = _DAILY_COUNT_CACHE.get(cache_key)
    if cached:
        return cached
    start_ts, end_ts = ca_day_bounds(ca_today())
    with get_cursor(SCHEMA) as cur:
        cur.execute(
            """
            SELECT
              SUM(CASE WHEN kind='A' THEN 1 END) AS count_a,
              SUM(CASE WHEN kind='B' THEN 1 END) AS count_b,
              SUM(CASE WHEN kind='A' AND status='NG' THEN 1 END) AS ng_a,
              SUM(CASE WHEN kind='B' AND status='NG' THEN 1 END) AS ng_b
            FROM scans
            WHERE scanned_at >= %s AND scanned_at < %s
            """,
            (start_ts, end_ts),
        )
        row = cur.fetchone() or {}

    result = {
        "status":  "success",
        "count_a": row.get("count_a") or 0,
        "count_b": row.get("count_b") or 0,
        "ng_a":    row.get("ng_a")    or 0,
        "ng_b":    row.get("ng_b")    or 0,
    }
    _DAILY_COUNT_CACHE.set(cache_key, result)
    return result

@router.get("/model_inventory_trend")
def trend(user=Depends(get_current_user)):
    _rollover()
    hrs = sorted(hourly)
    return {
        "status":  "success",
        "labels":  [f"{h}:00" for h in hrs],
        "trend_a": [hourly[h]["A"] for h in hrs],
        "trend_b": [hourly[h]["B"] for h in hrs],
    }

# ──────────────────────────────────────────────────────────
#  NG 功能 - Mark NG / Clear NG
# ──────────────────────────────────────────────────────────

class MarkBody(BaseModel):
    sn: str
    reason: Optional[str] = None   # mark_ng 用；clear_ng 可忽略

@router.post("/model_inventory/mark_ng", dependencies=[Depends(require_roles("admin", "operator"))])
async def mark_ng(body: MarkBody):
    """
    將指定 SN 標記為 NG（必填原因）
    """
    sn = (body.sn or "").strip()
    reason = (body.reason or "").strip()
    if not sn:
        return {"status": "error", "message": "SN required"}
    if not reason:
        return {"status": "error", "message": "NG reason required"}

    with get_conn(SCHEMA) as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT id FROM scans WHERE sn=%s", (sn,))
        row = cur.fetchone()
        if not row:
            return {"status": "error", "message": f"SN {sn} not found"}

        cur.execute("UPDATE scans SET status='NG', ng_reason=%s WHERE sn=%s", (reason, sn))
    _invalidate_kpi_cache()

    await ws_manager.broadcast({
        "event": "module_status_updated",
        "sn": sn,
        "status": "NG",
        "timestamp": ca_now_str()
    })

    return {"status": "success", "message": f"SN {sn} marked as NG"}

@router.post("/model_inventory/clear_ng", dependencies=[Depends(require_roles("admin", "operator"))])
async def clear_ng(body: MarkBody):
    """
    清除指定 SN 的 NG 狀態（標記為 Fixed），並清空原因
    """
    sn = (body.sn or "").strip()
    if not sn:
        return {"status": "error", "message": "SN required"}

    with get_conn(SCHEMA) as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT id, status FROM scans WHERE sn=%s", (sn,))
        row = cur.fetchone()
        if not row:
            return {"status": "error", "message": f"SN {sn} not found"}

        cur.execute("UPDATE scans SET status='Fixed', ng_reason='' WHERE sn=%s", (sn,))
    _invalidate_kpi_cache()

    await ws_manager.broadcast({
        "event": "module_status_updated",
        "sn": sn,
        "status": "Fixed",
        "timestamp": ca_now_str()
    })

    return {"status": "success", "message": f"SN {sn} marked as Fixed"}

# ──────────────────────────────────────────────────────────
#  Weekly KPI（改為直接聚合 scans，不依賴 daily_summary）
# ──────────────────────────────────────────────────────────

@router.get("/weekly_kpi")
def weekly_kpi(user=Depends(get_current_user)):
    today   = ca_today()
    monday  = today - timedelta(days=today.weekday())
    saturday = monday + timedelta(days=5)
    cache_key = f"weekly:{monday.strftime('%Y-%m-%d')}"
    cached = _WEEKLY_KPI_CACHE.get(cache_key)
    if cached:
        return cached

    # 只有週六有資料或今天就是週六才顯示第 6 根
    sat_start, sat_end = ca_day_bounds(saturday)
    with get_cursor(SCHEMA) as cur:
        cur.execute("SELECT 1 FROM scans WHERE scanned_at >= %s AND scanned_at < %s LIMIT 1", (sat_start, sat_end))
        include_sat = today.weekday() == 6 or today.weekday() == 5 or bool(cur.fetchone())

    num_days = 6 if include_sat else 5
    labels   = [(monday + timedelta(days=i)).strftime("%m-%d") for i in range(num_days)]

    # 區間查詢以吃 idx_scans_scanned_at
    range_start = monday.strftime("%Y-%m-%d 00:00:00")
    range_end   = (monday + timedelta(days=num_days)).strftime("%Y-%m-%d 00:00:00")

    a = [0] * num_days
    b = [0] * num_days

    with get_cursor(SCHEMA) as cur:
        cur.execute("""
            SELECT TO_CHAR(scanned_at, 'YYYY-MM-DD') AS d,
                   SUM(CASE WHEN kind='A' THEN 1 ELSE 0 END) AS cnt_a,
                   SUM(CASE WHEN kind='B' THEN 1 ELSE 0 END) AS cnt_b
            FROM scans
            WHERE scanned_at >= %s AND scanned_at < %s
            GROUP BY d
            ORDER BY d
        """, (range_start, range_end))
        rows = cur.fetchall()

    for r in rows:
        mmdd = r["d"][5:]
        if mmdd in labels:
            idx    = labels.index(mmdd)
            a[idx] = int(r["cnt_a"] or 0)
            b[idx] = int(r["cnt_b"] or 0)

    total = [x + y for x, y in zip(a, b)]

    # 取出 / 補齊 / 截斷 weekly plan
    with get_cursor(SCHEMA) as cur:
        cur.execute(
            "SELECT plan_json FROM weekly_plan WHERE week_start=%s",
            (monday.strftime("%Y-%m-%d"),),
        )
        plan_row = cur.fetchone()
    if plan_row:
        try:
            pj = plan_row["plan_json"]
            plan = pj if isinstance(pj, (list, dict)) else json.loads(pj)
        except Exception:
            plan = [200] * num_days
    else:
        plan = [200] * num_days
    if len(plan) < num_days:
        plan += [0] * (num_days - len(plan))
    elif len(plan) > num_days:
        plan = plan[:num_days]

    result = {
        "status":  "success",
        "labels":  labels,
        "count_a": a,
        "count_b": b,
        "total":   total,
        "plan":    plan,
    }
    _WEEKLY_KPI_CACHE.set(cache_key, result)
    return result

# ---- Weekly Plan -------------------------------------------------

@router.post("/weekly_plan", dependencies=[Depends(require_roles("admin", "operator"))])
async def set_plan(plan: list[int]):
    """
    保存本週生產計畫。
    - 平日模式傳 5 個整數
    - 週六模式可以傳 6 個整數
    """
    if len(plan) not in (5, 6):
        return {"status": "error", "message": "need 5 or 6 numbers"}

    today = ca_today()
    monday = (today - timedelta(days=today.weekday())).strftime("%Y-%m-%d")
    with get_conn(SCHEMA) as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            INSERT INTO weekly_plan (week_start, plan_json)
            VALUES (%s, %s)
            ON CONFLICT(week_start) DO UPDATE SET plan_json = %s
            """,
            (monday, json.dumps(plan), json.dumps(plan)),
        )
    _invalidate_kpi_cache()

    # 即時通知 Dashboard 更新（可選）
    await ws_manager.broadcast({"event": "weekly_plan_updated"})

    return {"status": "success"}

# ---- View DB / Delete -------------------------------------------
#  Model-inventory API ― list_all  &  delete_scan (updated)
# ──────────────────────────────────────────────────────────────

@router.get(
    "/model_inventory/list/all",
    dependencies=[Depends(require_roles("admin", "operator", "dashboard", "viewer"))],
)
def list_all_records(
    limit: int = 1000,
    from_date: Optional[str] = None,     # YYYY-MM-DD
    to_date:   Optional[str] = None,     # YYYY-MM-DD
    status_filter: Optional[str] = None  # 'all' | 'ok' | 'NG' | 'Fixed'
):
    conds, params = ["1=1"], []

    # 使用區間條件以利用 idx_scans_scanned_at
    if from_date:
        conds.append("scanned_at >= %s"); params.append(from_date)
    if to_date:
        try:
            end_excl = (datetime.strptime(to_date, "%Y-%m-%d").date() + timedelta(days=1)).strftime("%Y-%m-%d")
            conds.append("scanned_at < %s"); params.append(end_excl)
        except ValueError:
            # 後備：若格式不正確，退回 <= 23:59:59
            conds.append("scanned_at <= %s"); params.append(to_date + " 23:59:59")

    if status_filter and status_filter.strip().lower() != "all":
        sf = status_filter.strip().lower()
        if sf == "ok":
            conds.append("(status='' OR status IS NULL)")
        elif sf == "ng":
            conds.append("status=%s"); params.append("NG")        # 與 DB 寫入一致
        elif sf == "fixed":
            conds.append("status=%s"); params.append("Fixed")     # 與 DB 寫入一致
        else:
            conds.append("status=%s"); params.append(status_filter.strip())

    params.append(limit)

    with get_cursor(SCHEMA) as cur:
        cur.execute(f"""
            SELECT id,
                   scanned_at AS timestamp,
                   sn,
                   kind,
                   status,
                   ng_reason  AS ng_reason
            FROM scans
            WHERE {' AND '.join(conds)}
            ORDER BY scanned_at DESC
            LIMIT %s
        """, params)
        rows = cur.fetchall()

    return [dict(r) for r in rows]

# ---- Delete a single scan & broadcast ----------------------------------------

@router.delete(
    "/model_inventory/delete/{scan_id}",
    dependencies=[Depends(require_roles("admin"))],
)
async def delete_scan(scan_id: int):
    """
    刪除指定掃碼紀錄、同步 in-memory 統計、並向 Dashboard 發 WS 推播
    """
    with get_conn(SCHEMA) as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT sn, kind, scanned_at FROM scans WHERE id=%s",
            (scan_id,),
        )
        row = cur.fetchone()

        if not row:
            return JSONResponse(
                {"status": "error", "message": f"No record id={scan_id}"}, 404
            )

        # ── 真正刪除 DB ───────────────────────
        cur.execute("DELETE FROM scans WHERE id=%s", (scan_id,))

    # ── 更新快取與今日統計 ───────────────
    RAM_SN.discard(row["sn"])

    if row["scanned_at"].date() == ca_today():
        hr = row["scanned_at"].strftime("%H")
        hourly[hr][row["kind"]] = max(hourly[hr][row["kind"]] - 1, 0)
        daily[row["kind"]]      = max(daily[row["kind"]]      - 1, 0)

        # 若該小時 A、B 都歸零，從 dict 移除，避免畫出空 bar
        if hourly[hr]["A"] == 0 and hourly[hr]["B"] == 0:
            del hourly[hr]
    _invalidate_kpi_cache()

    # ── 即時推播給 Dashboard ──────────────
    hrs_sorted = sorted(hourly)
    await ws_manager.broadcast(
        {
            "event":     "module_updated",
            "timestamp": ca_now_str(),
            "count_a":   daily["A"],
            "count_b":   daily["B"],
            "labels":    [f"{h}:00" for h in hrs_sorted],
            "trend_a":   [hourly[h]["A"] for h in hrs_sorted],
            "trend_b":   [hourly[h]["B"] for h in hrs_sorted],
        }
    )

    return {"status": "success", "message": f"Deleted id={scan_id}"}

# ---- Update SN --------------------------------------------------

class UpdateSNBody(BaseModel):
    old_sn: str
    new_sn: str

@router.post(
    "/model_inventory/update_sn",
    dependencies=[Depends(require_roles("admin", "operator"))],
)
async def update_sn(body: UpdateSNBody):     # ← async
    old_sn = body.old_sn.strip()
    new_sn = body.new_sn.strip()

    # ── 基本檢查 ─────────────────────────
    if not old_sn or not new_sn:
        return {"status": "error", "message": "old_sn & new_sn required"}
    _A_PREFIXES = ("10080064", "10080104")
    _B_PREFIXES = ("10080065", "10080105")
    if not (new_sn.startswith(_A_PREFIXES + _B_PREFIXES) and len(new_sn) == 24):
        return {"status": "error", "message": "new SN format invalid"}

    # ── 舊 SN 必須存在；新 SN 不得重複 ────
    with get_conn(SCHEMA) as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT kind, scanned_at FROM scans WHERE sn=%s", (old_sn,)
        )
        row = cur.fetchone()
        if not row:
            return {"status": "error", "message": f"{old_sn} not found"}
        cur.execute("SELECT 1 FROM scans WHERE sn=%s", (new_sn,))
        if cur.fetchone():
            return {"status": "error", "message": f"{new_sn} already exists"}

        # ── 更新資料庫（只動 sn / kind，不動 scanned_at） ─
        new_kind = "A" if new_sn.startswith(_A_PREFIXES) else "B"
        cur.execute(
            "UPDATE scans SET sn=%s, kind=%s WHERE sn=%s", (new_sn, new_kind, old_sn)
        )

    # ── 更新記憶體快取與即時統計 ───────────
    RAM_SN.discard(old_sn)
    RAM_SN.add(new_sn)

    ts_str = row["scanned_at"]                # 原始掃碼時間
    is_today = ts_str.date() == ca_today()
    if is_today and row["kind"] != new_kind:   # 今日且 kind 變化才調整
        hr = ts_str.strftime("%H")
        hourly[hr][row["kind"]] -= 1
        hourly[hr][new_kind]    += 1
        daily[row["kind"]]      -= 1
        daily[new_kind]         += 1
    _invalidate_kpi_cache()

    # ── WebSocket 廣播給所有 Dashboard ──────
    await ws_manager.broadcast({
        "event":     "module_updated",
        "timestamp": ca_now_str(),
        "count_a":   daily["A"],
        "count_b":   daily["B"],
        "labels":    [f"{h}:00" for h in sorted(hourly)],
        "trend_a":   [hourly[h]['A'] for h in sorted(hourly)],
        "trend_b":   [hourly[h]['B'] for h in sorted(hourly)],
    })

    return {
        "status": "success",
        "message": f"{old_sn} → {new_sn} updated",
    }

# ──────────────────────────────────────────────────────────
#  Production (Module) for charts: daily/weekly/monthly
# ──────────────────────────────────────────────────────────
@router.get("/production-charts/module/production",
            summary="Module production (A/B, with optional plan_data) for daily/weekly/monthly")
def production_charts_module_production(
    period: str = Query("daily", pattern="^(daily|weekly|monthly)$"),
    target_date: str | None = Query(None, description="YYYY-MM-DD"),
    user=Depends(get_current_user)
):
    # 解析日期
    if target_date:
        try:
            base = datetime.strptime(target_date, "%Y-%m-%d").date()
        except ValueError:
            return JSONResponse({"status": "error", "message": "target_date must be YYYY-MM-DD"}, 400)
    else:
        base = ca_today()

    if period == "daily":
        start_d = end_d = base
    elif period == "weekly":
        start_d = base - timedelta(days=base.weekday())         # Mon
        end_d   = start_d + timedelta(days=6)                   # Sun
    else:
        start_d = date(base.year, base.month, 1)
        end_d   = date(base.year, base.month, calendar.monthrange(base.year, base.month)[1])

    production_data: list[dict] = []

    if period == "daily":
        # 依小時彙總 A/B 與 NG（使用區間查詢以吃索引）
        start_str = start_d.strftime("%Y-%m-%d")
        end_excl  = (start_d + timedelta(days=1)).strftime("%Y-%m-%d")
        with get_cursor(SCHEMA) as cur:
            cur.execute("""
                SELECT TO_CHAR(scanned_at, 'HH24') AS hh,
                       SUM(CASE WHEN kind='A' THEN 1 ELSE 0 END) AS cnt_a,
                       SUM(CASE WHEN kind='B' THEN 1 ELSE 0 END) AS cnt_b,
                       SUM(CASE WHEN status='NG' THEN 1 ELSE 0 END) AS ng_cnt
                FROM   scans
                WHERE  scanned_at >= %s AND scanned_at < %s
                GROUP  BY hh
                ORDER  BY hh
            """, (start_str, end_excl))
            rows = cur.fetchall()

        for r in rows:
            a = int(r["cnt_a"] or 0)
            b = int(r["cnt_b"] or 0)
            total = a + b
            ng = int(r["ng_cnt"] or 0)
            ok = total - ng
            production_data.append({
                "hour": r["hh"],
                "count_a": a,
                "count_b": b,
                "total": total,
                "ok_count": ok,
                "ng_count": ng
            })
    else:
        # 依日期彙總 A/B 與 NG（使用區間查詢以吃索引）
        start_str = start_d.strftime("%Y-%m-%d")
        end_excl  = (end_d + timedelta(days=1)).strftime("%Y-%m-%d")
        with get_cursor(SCHEMA) as cur:
            cur.execute("""
                SELECT TO_CHAR(scanned_at, 'YYYY-MM-DD') AS d,
                       SUM(CASE WHEN kind='A' THEN 1 ELSE 0 END) AS cnt_a,
                       SUM(CASE WHEN kind='B' THEN 1 ELSE 0 END) AS cnt_b,
                       SUM(CASE WHEN status='NG' THEN 1 ELSE 0 END) AS ng_cnt
                FROM   scans
                WHERE  scanned_at >= %s AND scanned_at < %s
                GROUP  BY d
                ORDER  BY d
            """, (start_str, end_excl))
            rows = cur.fetchall()

        for r in rows:
            a = int(r["cnt_a"] or 0)
            b = int(r["cnt_b"] or 0)
            total = a + b
            ng = int(r["ng_cnt"] or 0)
            ok = total - ng
            production_data.append({
                "production_date": r["d"],
                "count_a": a,
                "count_b": b,
                "total": total,
                "ok_count": ok,
                "ng_count": ng
            })

    # Summary（再算一次範圍統計，使用區間查詢）
    start_str = start_d.strftime("%Y-%m-%d")
    end_excl  = (end_d + timedelta(days=1)).strftime("%Y-%m-%d")
    with get_cursor(SCHEMA) as cur:
        cur.execute("""
            SELECT
              SUM(CASE WHEN kind='A' THEN 1 ELSE 0 END) AS a_tot,
              SUM(CASE WHEN kind='B' THEN 1 ELSE 0 END) AS b_tot,
              SUM(CASE WHEN status='NG' THEN 1 ELSE 0 END) AS ng_all
            FROM scans
            WHERE scanned_at >= %s AND scanned_at < %s
        """, (start_str, end_excl))
        row = cur.fetchone()

    a_tot = int(row["a_tot"] or 0)
    b_tot = int(row["b_tot"] or 0)
    total = a_tot + b_tot
    ng_all = int(row["ng_all"] or 0)
    ok = total - ng_all

    summary = {
        "total": total,
        "total_a": a_tot,
        "total_b": b_tot,
        "ok_count": ok,
        "ng_count": ng_all,
        "yield_rate": round(ok / total * 100) if total else 100
    }

    # Plan（只在 weekly/monthly 回傳；daily 不需要）
    plan_data = []
    if period in ("weekly", "monthly"):
        plan_data = _expand_module_plan_range(start_d, end_d)

    # Module 端暫無 NG reasons統計（保留空陣列以對齊前端資料結構）
    ng_reasons: list[dict] = []

    return {
        "summary": summary,
        "production_data": production_data,
        "plan_data": plan_data,
        "ng_reasons": ng_reasons
    }
