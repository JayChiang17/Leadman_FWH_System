# backend/api/model_inventory.py

from fastapi import APIRouter, Request, Depends, Query
from fastapi.responses import JSONResponse
from datetime import datetime, date, timedelta
from collections import defaultdict, Counter
import sqlite3, time, json, calendar
from pydantic import BaseModel
from typing import Optional

from core.ws_manager import ws_manager
from models.model_inventory_model import InventoryScan
from core.deps import require_roles, get_current_user

# ─────────── Tunables ───────────
PURGE_DAYS  = 30
RATE_LIMIT  = 800  # ms between scans from same IP

router = APIRouter(tags=["model"])

# ─────────── SQLite ───────────
DB = sqlite3.connect("model.db", check_same_thread=False)
DB.row_factory = sqlite3.Row
DB.execute("PRAGMA journal_mode=WAL")
DB.executescript("""
CREATE TABLE IF NOT EXISTS scans(
  id INTEGER PRIMARY KEY,
  sn TEXT UNIQUE,
  kind TEXT,
  ts TEXT,
  status TEXT DEFAULT '',
  ng_reason TEXT DEFAULT ''          -- ★ 新增欄位（初建就有）
);
CREATE TABLE IF NOT EXISTS daily_summary(
  day TEXT PRIMARY KEY,
  count_a INTEGER,
  count_b INTEGER,
  total   INTEGER
);
CREATE TABLE IF NOT EXISTS weekly_plan(
  week_start TEXT PRIMARY KEY,
  plan_json  TEXT
);
""")
# 針對既有 DB 的遷移（已存在則忽略錯誤）
try:
    DB.execute("ALTER TABLE scans ADD COLUMN status TEXT DEFAULT ''")
except sqlite3.OperationalError:
    pass
try:
    DB.execute("ALTER TABLE scans ADD COLUMN ng_reason TEXT DEFAULT ''")  # ★ 遷移
except sqlite3.OperationalError:
    pass
DB.commit()

# ─────────── In-memory counters ───────────
RAM_SN: set[str] = set()
hourly = defaultdict(lambda: {"A": 0, "B": 0})
daily = Counter()
TODAY = date.today()
last_ip: dict[str, int] = {}

cutoff = (TODAY - timedelta(days=PURGE_DAYS)).strftime("%Y-%m-%d")
for r in DB.execute("SELECT sn, kind, ts FROM scans WHERE ts>=?", (cutoff,)):
    RAM_SN.add(r["sn"])
    if r["ts"].startswith(TODAY.strftime("%Y-%m-%d")):
        hourly[r["ts"][11:13]][r["kind"]] += 1
        daily[r["kind"]] += 1

# ─────────── Helpers ───────────

def _rollover():
    global TODAY
    if date.today() == TODAY:
        return
    y = TODAY.strftime("%Y-%m-%d")
    DB.execute(
        """INSERT INTO daily_summary VALUES(?,?,?,?)
           ON CONFLICT(day) DO UPDATE SET count_a=?,count_b=?,total=?""",
        (
            y,
            daily["A"], daily["B"], daily["A"] + daily["B"],
            daily["A"], daily["B"], daily["A"] + daily["B"]
        )
    )
    DB.commit()
    TODAY = date.today()
    daily.clear()
    hourly.clear()

def insert_sql(row: tuple) -> bool:
    try:
        DB.execute("INSERT INTO scans(sn,kind,ts) VALUES(?,?,?)", row)
        DB.commit()
        return True
    except sqlite3.IntegrityError:
        return False

# ─────────── Weekly-plan helpers for Module (A/B total) ───────────

def _week_start_str_for(d: date) -> str:
    mon = d - timedelta(days=d.weekday())
    return mon.strftime("%Y-%m-%d")

def _get_week_plan_json_module(week_start_str: str):
    row = DB.execute(
        "SELECT plan_json FROM weekly_plan WHERE week_start=?",
        (week_start_str,)
    ).fetchone()
    return row["plan_json"] if row else None

def _parse_plan_json_module(plan_json):
    if not plan_json:
        return None
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
    _rollover()

    sn = data.sn.strip()
    if not ((sn.startswith("10080064") or sn.startswith("10080065")) and len(sn) == 24):
        return {"status": "error", "message": "bad SN format"}

    now = int(time.time() * 1000)
    if now - last_ip.get(req.client.host, 0) < RATE_LIMIT:
        return {"status": "error", "message": "slow down"}
    last_ip[req.client.host] = now

    if sn in RAM_SN:
        return {"status": "error", "message": "duplicate"}

    kind = "A" if sn.startswith("10080064") else "B"
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    if not insert_sql((sn, kind, ts)):
        RAM_SN.add(sn)
        return {"status": "error", "message": "duplicate"}

    RAM_SN.add(sn)
    hourly[ts[11:13]][kind] += 1
    daily[kind] += 1

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
    today_str = date.today().strftime("%Y-%m-%d")
    row = DB.execute(
        """
        SELECT
          SUM(CASE WHEN kind='A' THEN 1 END) AS count_a,
          SUM(CASE WHEN kind='B' THEN 1 END) AS count_b,
          SUM(CASE WHEN kind='A' AND status='NG' THEN 1 END) AS ng_a,
          SUM(CASE WHEN kind='B' AND status='NG' THEN 1 END) AS ng_b
        FROM scans
        WHERE ts >= ?
        """,
        (today_str,),
    ).fetchone() or {}

    return {
        "status":  "success",
        "count_a": row["count_a"] or 0,
        "count_b": row["count_b"] or 0,
        "ng_a":    row["ng_a"]    or 0,
        "ng_b":    row["ng_b"]    or 0,
    }

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

    row = DB.execute("SELECT id FROM scans WHERE sn=?", (sn,)).fetchone()
    if not row:
        return {"status": "error", "message": f"SN {sn} not found"}

    DB.execute("UPDATE scans SET status='NG', ng_reason=? WHERE sn=?", (reason, sn))
    DB.commit()

    await ws_manager.broadcast({
        "event": "module_status_updated",
        "sn": sn,
        "status": "NG",
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
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

    row = DB.execute("SELECT id, status FROM scans WHERE sn=?", (sn,)).fetchone()
    if not row:
        return {"status": "error", "message": f"SN {sn} not found"}

    DB.execute("UPDATE scans SET status='Fixed', ng_reason='' WHERE sn=?", (sn,))
    DB.commit()

    await ws_manager.broadcast({
        "event": "module_status_updated",
        "sn": sn,
        "status": "Fixed",
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    })

    return {"status": "success", "message": f"SN {sn} marked as Fixed"}

# ──────────────────────────────────────────────────────────
#  Weekly KPI
# ──────────────────────────────────────────────────────────

@router.get("/weekly_kpi")
def weekly_kpi(user=Depends(get_current_user)):
    today   = date.today()
    monday  = today - timedelta(days=today.weekday())

    # ────── 判斷本週是否要顯示週六 ──────
    include_sat = today.weekday() >= 5                    # 今天就是星期六
    saturday    = monday + timedelta(days=5)
    if DB.execute(
        "SELECT 1 FROM scans WHERE date(ts)=?",
        (saturday.strftime("%Y-%m-%d"),)
    ).fetchone():
        include_sat = True                                # DB 裡也有週六資料

    num_days = 6 if include_sat else 5
    labels   = [
        (monday + timedelta(days=i)).strftime("%m-%d")
        for i in range(num_days)
    ]
    a = [0] * num_days
    b = [0] * num_days

    # ────── 先填入 daily_summary 的歷史資料 ──────
    for r in DB.execute(
        """
        SELECT day,count_a,count_b
        FROM   daily_summary
        WHERE  day BETWEEN ? AND ?
        """,
        (monday.strftime("%Y-%m-%d"),
         (monday + timedelta(days=num_days - 1)).strftime("%Y-%m-%d")),
    ):
        mmdd = r["day"][5:]
        if mmdd in labels:
            idx      = labels.index(mmdd)
            a[idx]   = r["count_a"] or 0
            b[idx]   = r["count_b"] or 0

    # ────── 再即時查 DB，把「今天」補進去 ──────
    today_row = DB.execute(
        """
        SELECT
          SUM(CASE WHEN kind='A' THEN 1 END) AS cnt_a,
          SUM(CASE WHEN kind='B' THEN 1 END) AS cnt_b
        FROM scans
        WHERE date(ts)=?
        """,
        (today.strftime("%Y-%m-%d"),),
    ).fetchone()
    if today_row:
        today_md = today.strftime("%m-%d")
        if today_md in labels:
            idx    = labels.index(today_md)
            a[idx] = today_row["cnt_a"] or 0
            b[idx] = today_row["cnt_b"] or 0

    total = [x + y for x, y in zip(a, b)]

    # ────── 取出 / 補齊 / 截斷 weekly plan ──────
    plan_row = DB.execute(
        "SELECT plan_json FROM weekly_plan WHERE week_start=?",
        (monday.strftime("%Y-%m-%d"),),
    ).fetchone()
    plan = json.loads(plan_row["plan_json"]) if plan_row else [120] * num_days

    if len(plan) < num_days:                  # 不足 → 補 0
        plan += [0] * (num_days - len(plan))
    elif len(plan) > num_days:                # 太多 → 截掉
        plan = plan[:num_days]

    return {
        "status":  "success",
        "labels":  labels,
        "count_a": a,
        "count_b": b,
        "total":   total,
        "plan":    plan,
    }

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

    monday = (date.today() - timedelta(days=date.today().weekday())).strftime("%Y-%m-%d")
    DB.execute(
        """
        INSERT INTO weekly_plan (week_start, plan_json)
        VALUES (?, ?)
        ON CONFLICT(week_start) DO UPDATE SET plan_json = ?
        """,
        (monday, json.dumps(plan), json.dumps(plan)),
    )
    DB.commit()

    # 即時通知 Dashboard 更新（可選）
    await ws_manager.broadcast({"event": "weekly_plan_updated"})

    return {"status": "success"}

# ---- View DB / Delete -------------------------------------------
#  Model-inventory API ― list_all  &  delete_scan (updated)
# ──────────────────────────────────────────────────────────────

@router.get(
    "/model_inventory/list/all",
    dependencies=[Depends(require_roles("admin", "operator"))],
)
def list_all_records(
    limit: int = 1000,
    from_date: Optional[str] = None,     # YYYY-MM-DD
    to_date:   Optional[str] = None,     # YYYY-MM-DD
    status_filter: Optional[str] = None  # 'all' | 'ok' | 'NG' | 'Fixed'
):
    conds, params = ["1=1"], []

    if from_date:
        conds.append("date(ts) >= ?"); params.append(from_date)
    if to_date:
        conds.append("date(ts) <= ?"); params.append(to_date)

    if status_filter and status_filter.lower() != "all":
        sf = status_filter.lower()
        if sf == "ok":
            conds.append("(status='' OR status IS NULL)")
        elif sf in ("ng", "fixed"):
            conds.append("status=?"); params.append(sf.capitalize())
        else:
            conds.append("status=?"); params.append(status_filter)

    params.append(limit)

    rows = DB.execute(f"""
        SELECT id,
               ts         AS timestamp,
               sn,
               kind,
               status,
               ng_reason  AS ng_reason
        FROM scans
        WHERE {' AND '.join(conds)}
        ORDER BY ts DESC
        LIMIT ?
    """, params).fetchall()

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
    row = DB.execute(
        "SELECT sn, kind, ts FROM scans WHERE id=?",
        (scan_id,),
    ).fetchone()

    if not row:
        return JSONResponse(
            {"status": "error", "message": f"No record id={scan_id}"}, 404
        )

    # ── 真正刪除 DB ───────────────────────
    DB.execute("DELETE FROM scans WHERE id=?", (scan_id,))
    DB.commit()

    # ── 更新快取與今日統計 ───────────────
    RAM_SN.discard(row["sn"])

    if row["ts"].startswith(date.today().strftime("%Y-%m-%d")):
        hr = row["ts"][11:13]
        hourly[hr][row["kind"]] = max(hourly[hr][row["kind"]] - 1, 0)
        daily[row["kind"]]      = max(daily[row["kind"]]      - 1, 0)

        # 若該小時 A、B 都歸零，從 dict 移除，避免畫出空 bar
        if hourly[hr]["A"] == 0 and hourly[hr]["B"] == 0:
            del hourly[hr]

    # ── 即時推播給 Dashboard ──────────────
    hrs_sorted = sorted(hourly)
    await ws_manager.broadcast(
        {
            "event":     "module_updated",
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
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
    if not (
        (new_sn.startswith("10080064") or new_sn.startswith("10080065"))
        and len(new_sn) == 24
    ):
        return {"status": "error", "message": "new SN format invalid"}

    # ── 舊 SN 必須存在；新 SN 不得重複 ────
    row = DB.execute(
        "SELECT kind, ts FROM scans WHERE sn=?", (old_sn,)
    ).fetchone()
    if not row:
        return {"status": "error", "message": f"{old_sn} not found"}
    if DB.execute("SELECT 1 FROM scans WHERE sn=?", (new_sn,)).fetchone():
        return {"status": "error", "message": f"{new_sn} already exists"}

    # ── 更新資料庫（只動 sn / kind，不動 ts） ─
    new_kind = "A" if new_sn.startswith("10080064") else "B"
    DB.execute(
        "UPDATE scans SET sn=?, kind=? WHERE sn=?", (new_sn, new_kind, old_sn)
    )
    DB.commit()

    # ── 更新記憶體快取與即時統計 ───────────
    RAM_SN.discard(old_sn)
    RAM_SN.add(new_sn)

    ts_str = row["ts"]                # 原始掃碼時間
    is_today = ts_str.startswith(date.today().strftime("%Y-%m-%d"))
    if is_today and row["kind"] != new_kind:   # 今日且 kind 變化才調整
        hr = ts_str[11:13]
        hourly[hr][row["kind"]] -= 1
        hourly[hr][new_kind]    += 1
        daily[row["kind"]]      -= 1
        daily[new_kind]         += 1

    # ── WebSocket 廣播給所有 Dashboard ──────
    await ws_manager.broadcast({
        "event":     "module_updated",
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
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
    period: str = Query("daily", regex="^(daily|weekly|monthly)$"),
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
        base = date.today()

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
        # 依小時彙總 A/B 與 NG
        rows = DB.execute("""
            SELECT substr(ts,12,2) AS hh,
                   SUM(CASE WHEN kind='A' THEN 1 ELSE 0 END) AS cnt_a,
                   SUM(CASE WHEN kind='B' THEN 1 ELSE 0 END) AS cnt_b,
                   SUM(CASE WHEN status='NG' THEN 1 ELSE 0 END) AS ng_cnt
            FROM   scans
            WHERE  date(ts)=?
            GROUP  BY hh
            ORDER  BY hh
        """, (start_d.strftime("%Y-%m-%d"),)).fetchall()

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
        # 依日期彙總 A/B 與 NG
        rows = DB.execute("""
            SELECT date(ts) AS d,
                   SUM(CASE WHEN kind='A' THEN 1 ELSE 0 END) AS cnt_a,
                   SUM(CASE WHEN kind='B' THEN 1 ELSE 0 END) AS cnt_b,
                   SUM(CASE WHEN status='NG' THEN 1 ELSE 0 END) AS ng_cnt
            FROM   scans
            WHERE  date(ts) BETWEEN ? AND ?
            GROUP  BY d
            ORDER  BY d
        """, (start_d.strftime("%Y-%m-%d"), end_d.strftime("%Y-%m-%d"))).fetchall()

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

    # Summary（再算一次範圍統計）
    row = DB.execute("""
        SELECT
          SUM(CASE WHEN kind='A' THEN 1 ELSE 0 END) AS a_tot,
          SUM(CASE WHEN kind='B' THEN 1 ELSE 0 END) AS b_tot,
          SUM(CASE WHEN status='NG' THEN 1 ELSE 0 END) AS ng_all
        FROM scans
        WHERE date(ts) BETWEEN ? AND ?
    """, (start_d.strftime("%Y-%m-%d"), end_d.strftime("%Y-%m-%d"))).fetchone()

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
