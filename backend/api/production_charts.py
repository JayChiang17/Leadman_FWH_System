from __future__ import annotations

import json, statistics
import logging
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple

import psycopg2
import psycopg2.extras
from fastapi import APIRouter, Query, Depends, HTTPException

from core.deps import get_current_user
from core.pg import get_conn, get_cursor
from core.time_utils import ca_today, ca_range_bounds
from core.cache_utils import TTLCache

# 設置日誌
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/production-charts", tags=["production-charts"])

# ========= API 快取 =========
_chart_cache = TTLCache(ttl_seconds=120, maxsize=256)

# ========= 共用工具 =========

def d_range(period: str, tgt: Optional[str] = None) -> Tuple[date, date]:
    """period=daily|weekly|monthly → (start, end)"""
    base = datetime.strptime(tgt, "%Y-%m-%d").date() if tgt else ca_today()
    if period == "daily":
        return base, base
    if period == "weekly":
        start = base - timedelta(days=base.weekday())
        return start, start + timedelta(days=6)
    if period == "monthly":
        start = base.replace(day=1)
        nxt_m = start.month % 12 + 1
        nxt_y = start.year + (start.month // 12)
        nxt = start.replace(year=nxt_y, month=nxt_m)
        return start, nxt - timedelta(days=1)
    raise ValueError("period must be daily|weekly|monthly")

def get_period_days(period: str, start_date: date, end_date: date) -> int:
    if period == "daily":
        return 1
    elif period == "weekly":
        return 7
    elif period == "monthly":
        return (end_date - start_date).days + 1
    else:
        return 30

def stats(nums: List[int]) -> Dict:
    if not nums:
        return dict(mean=0, median=0, std_dev=0, min=0, max=0)
    return dict(
        mean=statistics.mean(nums),
        median=statistics.median(nums),
        std_dev=statistics.stdev(nums) if len(nums) > 1 else 0,
        min=min(nums),
        max=max(nums),
    )

def safe_db_execute(cur, query: str, params: tuple = ()):
    try:
        cur.execute(query, params)
        return cur.fetchall()
    except psycopg2.OperationalError as e:
        if "does not exist" in str(e).lower():
            logger.warning(f"Table not found: {e}")
            return []
        logger.error(f"Database operational error: {e}")
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")
    except psycopg2.Error as e:
        logger.error(f"Database error: {e}")
        raise HTTPException(status_code=500, detail="Database error")

# ========= NG 原因正規化（後端統一口徑，含子分類） =========
def normalize_ng_reason(reason: str) -> str:
    """將常見異寫、空白與大小寫統一；含子分類。後端為唯一正規化來源。"""
    if not reason:
        return ""
    rl = reason.strip().lower()

    # Air Leak 系列（含子分類）
    if "air leak" in rl:
        if "low" in rl:
            return "Air Leak (Low)"
        if "high" in rl:
            return "Air Leak (High)"
        return "Air Leak"

    # WT333E 系列
    if "wt333e" in rl:
        if "charging" in rl and "l1" in rl:
            return "WT333E Read Charging L1 - Power"
        if "power" in rl:
            return "WT333E Power Issue"
        return "WT333E Issue"

    # 螺絲相關（含子分類）
    if "broken thread" in rl or "misthread" in rl:
        if "top" in rl:
            return "Broken Thread Side Screw (Top)"
        if "on screw" in rl:
            return "Broken Thread on Screw"
        if "side screw" in rl:
            return "Broken Thread Side Screw"
        return "Broken Thread Screw"
    if "screw" in rl and "hole" in rl and "blocked" in rl:
        return "Screw Holes Blocked"

    # Power Split（含 aPower Split 變體）
    if "power split" in rl or "apower split" in rl:
        return "Power Split"

    # BMS
    if "bms write" in rl:
        return "BMS Write Issue"

    # 其他已知
    if "waterproof" in rl and "lock" in rl:
        return "Waterproof Lock Head"
    if "red object" in rl:
        return "Red Object L1"
    if "pe write" in rl:
        return "PE Write Station"
    if "connector" in rl and "switch" in rl and "broken" in rl:
        return "Connector Switch Broken"

    # 其他：Title Case
    return reason.strip().title()

# ========= 1. Module Production =========
@router.get("/module/production")
async def module_prod(
    period: str = Query(..., regex="^(daily|weekly|monthly)$"),
    target_date: Optional[str] = Query(None, regex=r"^\d{4}-\d{2}-\d{2}$"),
    current_user: dict = Depends(get_current_user),
):
    """獲取模組生產數據（含 OK/NG 與良率趨勢）"""
    cache_key = f"mod_prod:{period}:{target_date}"
    cached = _chart_cache.get(cache_key)
    if cached:
        return cached
    start, end = d_range(period, target_date)
    range_start, range_end = ca_range_bounds(start, end)
    try:
        with get_cursor("model") as cur:

            if period == "daily":
                sql = """
                SELECT TO_CHAR(scanned_at, 'HH24') hr,
                       COUNT(*) tot,
                       SUM(CASE WHEN kind='A' THEN 1 ELSE 0 END) a,
                       SUM(CASE WHEN kind='B' THEN 1 ELSE 0 END) b,
                       SUM(CASE WHEN UPPER(status) IN ('NG','FIXED') THEN 1 ELSE 0 END) ng
                FROM scans
                WHERE scanned_at >= %s AND scanned_at < %s
                GROUP BY hr ORDER BY hr
                """
                rows = safe_db_execute(cur, sql, (range_start, range_end))
                prod = [
                    dict(
                        production_date=start.isoformat(),
                        hour=row["hr"],
                        total=row["tot"],
                        count_a=row["a"],
                        count_b=row["b"],
                        ng_count=row["ng"],
                        ok_count=row["tot"] - row["ng"],
                    )
                    for row in rows
                ]
            else:
                sql = """
                SELECT TO_CHAR(scanned_at, 'YYYY-MM-DD') d,
                       COUNT(*) tot,
                       SUM(CASE WHEN kind='A' THEN 1 ELSE 0 END) a,
                       SUM(CASE WHEN kind='B' THEN 1 ELSE 0 END) b,
                       SUM(CASE WHEN UPPER(status) IN ('NG','FIXED') THEN 1 ELSE 0 END) ng
                FROM scans
                WHERE scanned_at >= %s AND scanned_at < %s
                GROUP BY d ORDER BY d
                """
                rows = safe_db_execute(cur, sql, (range_start, range_end))
                prod = [
                    dict(
                        production_date=row["d"],
                        total=row["tot"],
                        count_a=row["a"],
                        count_b=row["b"],
                        ng_count=row["ng"],
                        ok_count=row["tot"] - row["ng"],
                    )
                    for row in rows
                ]

            # 週計畫
            plan = []
            if period == "weekly":
                try:
                    cur.execute(
                        "SELECT plan_json FROM weekly_plan WHERE week_start=%s",
                        (start.isoformat(),)
                    )
                    row = cur.fetchone()
                    if row and row["plan_json"]:
                        try:
                            pj = row["plan_json"]
                            if isinstance(pj, str):
                                pj = json.loads(pj)
                            if isinstance(pj, dict):
                                for d, v in pj.items():
                                    if isinstance(v, dict):
                                        plan.append({
                                            "date": d,
                                            "plan_a": v.get("A", 0),
                                            "plan_b": v.get("B", 0),
                                            "plan_total": v.get("A", 0) + v.get("B", 0),
                                        })
                                    else:
                                        plan.append({"date": d, "plan_total": v})
                            elif isinstance(pj, list):
                                plan = [
                                    {"date": (start + timedelta(days=i)).isoformat(), "plan_total": pj[i]}
                                    for i in range(min(len(pj), 7))
                                ]
                        except (json.JSONDecodeError, ValueError, TypeError):
                            logger.warning("Invalid plan_json format")
                except psycopg2.Error as e:
                    logger.warning(f"Failed to get weekly plan: {e}")

            tot_a = sum(p.get("count_a", 0) for p in prod)
            tot_b = sum(p.get("count_b", 0) for p in prod)
            tot_all = sum(p.get("total", 0) for p in prod)
            tot_ng = sum(p.get("ng_count", 0) for p in prod)
            tot_ok = sum(p.get("ok_count", 0) for p in prod)
            yield_rate = round(tot_ok / tot_all * 100, 2) if tot_all > 0 else 100

            if period == "daily":
                avg_daily = tot_all
                days_count = 1
            else:
                days_with_production = len([p for p in prod if p["total"] > 0])
                avg_daily = tot_all / days_with_production if days_with_production > 0 else 0
                days_count = len(prod)

            module_yield_data = []
            if period != "daily":
                for p in prod:
                    total = p.get("total", 0)
                    ok = p.get("ok_count", 0)
                    if total > 0:
                        module_yield_data.append({
                            "date": p["production_date"],
                            "yield_rate": round(ok / total * 100, 2),
                            "ok_count": ok,
                            "ng_count": p.get("ng_count", 0),
                            "total": total,
                        })

            # NG vs FIXED 分離
            try:
                cur.execute("""
                    SELECT
                        SUM(CASE WHEN UPPER(status)='NG' THEN 1 ELSE 0 END) pure_ng,
                        SUM(CASE WHEN UPPER(status)='FIXED' THEN 1 ELSE 0 END) fixed_count
                    FROM scans
                    WHERE scanned_at >= %s AND scanned_at < %s
                """, (range_start, range_end))
                status_counts = cur.fetchone()
                pure_ng = status_counts["pure_ng"] if status_counts else 0
                fixed_count = status_counts["fixed_count"] if status_counts else 0
            except psycopg2.Error as e:
                logger.warning(f"Failed to get module status counts: {e}")
                pure_ng = fixed_count = 0

            # 與前期比較（產量/良率）
            prev_s = start - (end - start + timedelta(days=1))
            prev_e = start - timedelta(days=1)
            prev_range_start, prev_range_end = ca_range_bounds(prev_s, prev_e)
            try:
                cur.execute(
                    "SELECT COUNT(*) c, SUM(CASE WHEN UPPER(status) IN ('NG','FIXED') THEN 1 ELSE 0 END) ng_c "
                    "FROM scans WHERE scanned_at >= %s AND scanned_at < %s",
                    (prev_range_start, prev_range_end),
                )
                prev_row = cur.fetchone()
                prev = prev_row["c"] if prev_row else 0
                prev_ng = prev_row["ng_c"] if prev_row else 0
            except psycopg2.Error:
                prev = prev_ng = 0
            trend_pct = ((tot_all - prev) / prev * 100) if prev > 0 else 0
            prev_yield = round((prev - prev_ng) / prev * 100, 2) if prev > 0 else 100
            yield_trend = yield_rate - prev_yield

            daily_totals = [p["total"] for p in prod]
            stat_result = stats(daily_totals)

            result = {
                "period": period,
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
                "production_data": prod,
                "plan_data": plan,
                "module_yield_data": module_yield_data,
                "summary": {
                    "total_a": tot_a,
                    "total_b": tot_b,
                    "total": tot_all,
                    "ok_count": tot_ok,
                    "ng_count": tot_ng,
                    "pure_ng_count": pure_ng,
                    "fixed_count": fixed_count,
                    "yield_rate": yield_rate,
                    "yield_trend": round(yield_trend, 2),
                    "average_daily": round(avg_daily, 2),
                    "median_daily": stat_result["median"],
                    "std_dev": stat_result["std_dev"],
                    "min_daily": stat_result["min"],
                    "max_daily": stat_result["max"],
                    "days_count": days_count,
                    "trend": round(trend_pct, 2),
                    "pairing_efficiency": round(min(tot_a, tot_b) / tot_all * 100, 2) if tot_all > 0 else 100,
                    "total_pairs": min(tot_a, tot_b),
                },
            }
            _chart_cache.set(cache_key, result)
            return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in module_prod: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# ========= 2. Assembly Production（含 NG 正規化） =========
@router.get("/assembly/production")
async def assembly_prod(
    period: str = Query(..., regex="^(daily|weekly|monthly)$"),
    target_date: Optional[str] = Query(None, regex=r"^\d{4}-\d{2}-\d{2}$"),
    current_user: dict = Depends(get_current_user),
):
    """獲取總裝生產數據（OK/NG、良率、NG 原因正規化 Top）"""
    cache_key = f"asm_prod:{period}:{target_date}"
    cached = _chart_cache.get(cache_key)
    if cached:
        return cached
    start, end = d_range(period, target_date)
    range_start, range_end = ca_range_bounds(start, end)
    try:
        with get_cursor("assembly") as cur:

            if period == "daily":
                sql = """
                SELECT TO_CHAR(scanned_at, 'HH24') hr,
                       COUNT(*) tot,
                       SUM(CASE WHEN UPPER(status) IN ('NG','FIXED') THEN 1 ELSE 0 END) ng
                FROM scans
                WHERE scanned_at >= %s AND scanned_at < %s
                GROUP BY hr ORDER BY hr
                """
                rows = safe_db_execute(cur, sql, (range_start, range_end))
                prod = [
                    dict(
                        production_date=start.isoformat(),
                        hour=row["hr"],
                        total=row["tot"],
                        ng_count=row["ng"],
                        ok_count=row["tot"] - row["ng"],
                    )
                    for row in rows
                ]
            else:
                sql = """
                SELECT TO_CHAR(scanned_at, 'YYYY-MM-DD') d,
                       COUNT(*) tot,
                       SUM(CASE WHEN UPPER(status) IN ('NG','FIXED') THEN 1 ELSE 0 END) ng
                FROM scans
                WHERE scanned_at >= %s AND scanned_at < %s
                GROUP BY d ORDER BY d
                """
                rows = safe_db_execute(cur, sql, (range_start, range_end))
                prod = [
                    dict(
                        production_date=row["d"],
                        total=row["tot"],
                        ng_count=row["ng"],
                        ok_count=row["tot"] - row["ng"],
                    )
                    for row in rows
                ]

            # NG 原因（後端正規化 + 合併 + 取前 20）
            ng_reasons: List[Dict[str, int]] = []
            try:
                ng_rows = safe_db_execute(cur, """
                    SELECT ng_reason, COUNT(*) c
                    FROM scans
                    WHERE scanned_at >= %s AND scanned_at < %s
                      AND UPPER(status) IN ('NG','FIXED') AND ng_reason!=''
                    GROUP BY ng_reason
                """, (range_start, range_end))
                reason_map: Dict[str, int] = {}
                for r in ng_rows:
                    norm = normalize_ng_reason(r["ng_reason"])
                    if not norm:
                        continue
                    reason_map[norm] = reason_map.get(norm, 0) + (r["c"] or 0)
                ng_reasons = [
                    {"reason": k, "count": v}
                    for k, v in sorted(reason_map.items(), key=lambda x: x[1], reverse=True)[:20]
                ]
            except psycopg2.Error as e:
                logger.warning(f"Failed to get NG reasons: {e}")

            # NG 與 FIXED 拆分
            try:
                cur.execute("""
                    SELECT
                        SUM(CASE WHEN UPPER(status)='NG' THEN 1 ELSE 0 END)       pure_ng,
                        SUM(CASE WHEN UPPER(status)='FIXED' THEN 1 ELSE 0 END)    fixed_count,
                        SUM(CASE WHEN UPPER(status) IN ('NG','FIXED') THEN 1 ELSE 0 END) total_ng
                    FROM scans
                    WHERE scanned_at >= %s AND scanned_at < %s
                """, (range_start, range_end))
                status_counts = cur.fetchone()
                pure_ng = status_counts["pure_ng"] if status_counts else 0
                fixed_count = status_counts["fixed_count"] if status_counts else 0
                total_ng = status_counts["total_ng"] if status_counts else 0
            except psycopg2.Error as e:
                logger.warning(f"Failed to get status counts: {e}")
                pure_ng = fixed_count = total_ng = 0

            # 週計畫
            plan = []
            if period == "weekly":
                try:
                    cur.execute(
                        "SELECT plan_json FROM assembly_weekly_plan WHERE week_start=%s",
                        (start.isoformat(),)
                    )
                    row = cur.fetchone()
                    if row and row["plan_json"]:
                        try:
                            pj = row["plan_json"]
                            if isinstance(pj, str):
                                pj = json.loads(pj)
                            if isinstance(pj, dict):
                                plan = [dict(date=k, plan_total=v) for k, v in pj.items()]
                            elif isinstance(pj, list):
                                plan = [
                                    {"date": (start + timedelta(days=i)).isoformat(), "plan_total": pj[i]}
                                    for i in range(min(len(pj), 7))
                                ]
                        except (json.JSONDecodeError, ValueError, TypeError):
                            logger.warning("Invalid assembly plan_json format")
                except psycopg2.Error as e:
                    logger.warning(f"Failed to get assembly weekly plan: {e}")

            tot = sum(p["total"] for p in prod)
            ok = sum(p["ok_count"] for p in prod)
            ng = sum(p["ng_count"] for p in prod)
            yield_rate = round(ok / tot * 100, 2) if tot else 0

            if period == "daily":
                avg_daily = tot
                days_count = 1
            else:
                days_with_production = len([p for p in prod if p["total"] > 0])
                avg_daily = tot / days_with_production if days_with_production > 0 else 0
                days_count = len(prod)

            prev_s = start - (end - start + timedelta(days=1))
            prev_e = start - timedelta(days=1)
            prev_range_start, prev_range_end = ca_range_bounds(prev_s, prev_e)
            try:
                cur.execute(
                    "SELECT COUNT(*) tot, SUM(CASE WHEN UPPER(status) IN ('NG','FIXED') THEN 1 ELSE 0 END) ng "
                    "FROM scans WHERE scanned_at >= %s AND scanned_at < %s",
                    (prev_range_start, prev_range_end),
                )
                prev_row = cur.fetchone()
                prev_tot = prev_row["tot"] if prev_row else 0
                prev_ng = prev_row["ng"] if prev_row else 0
            except psycopg2.Error:
                prev_tot = prev_ng = 0

            prev_yield = round((prev_tot - prev_ng) / prev_tot * 100, 2) if prev_tot else 0
            trend_pct = ((tot - prev_tot) / prev_tot * 100) if prev_tot else 0
            yield_trend = yield_rate - prev_yield

            daily_totals = [p["total"] for p in prod]
            stat_result = stats(daily_totals)

            result = {
                "period": period,
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
                "production_data": prod,
                "plan_data": plan,
                "ng_reasons": ng_reasons,
                "summary": {
                    "total": tot,
                    "ok_count": ok,
                    "ng_count": ng,
                    "pure_ng_count": pure_ng,
                    "fixed_count": fixed_count,
                    "yield_rate": yield_rate,
                    "average_daily": round(avg_daily, 2),
                    "median_daily": stat_result["median"],
                    "std_dev": stat_result["std_dev"],
                    "min_daily": stat_result["min"],
                    "max_daily": stat_result["max"],
                    "days_count": days_count,
                    "trend": round(trend_pct, 2),
                    "yield_trend": round(yield_trend, 2),
                },
            }
            _chart_cache.set(cache_key, result)
            return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in assembly_prod: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# ========= 3. Trend Analysis =========
@router.get("/trend-analysis")
async def trend_analysis(
    line_type: str = Query(..., regex="^(module|assembly)$"),
    days: int = Query(30, ge=7, le=90),
    current_user: dict = Depends(get_current_user),
):
    """30 天趨勢分析（含 7 日移動平均 + 線性預測）"""
    cache_key = f"trend:{line_type}:{days}"
    cached = _chart_cache.get(cache_key)
    if cached:
        return cached
    end_ = ca_today()
    start_ = end_ - timedelta(days=days)
    range_start, range_end = ca_range_bounds(start_, end_)

    schema = "model" if line_type == "module" else "assembly"
    try:
        with get_cursor(schema) as cur:

            if line_type == "module":
                sql = """
                SELECT TO_CHAR(scanned_at, 'YYYY-MM-DD') d, COUNT(*) tot,
                       SUM(CASE WHEN kind='A' THEN 1 ELSE 0 END) a,
                       SUM(CASE WHEN kind='B' THEN 1 ELSE 0 END) b
                FROM scans
                WHERE scanned_at >= %s AND scanned_at < %s
                GROUP BY d ORDER BY d
                """
            else:
                sql = """
                SELECT TO_CHAR(scanned_at, 'YYYY-MM-DD') d, COUNT(*) tot,
                       SUM(CASE WHEN UPPER(status) IN ('NG','FIXED') THEN 1 ELSE 0 END) ng
                FROM scans
                WHERE scanned_at >= %s AND scanned_at < %s
                GROUP BY d ORDER BY d
                """

            rows = safe_db_execute(cur, sql, (range_start, range_end))
            base = {}
            for row in rows:
                if line_type == "module":
                    base[row["d"]] = dict(
                        production_date=row["d"],
                        total=row["tot"],
                        count_a=row["a"],
                        count_b=row["b"],
                    )
                else:
                    tot, ng = row["tot"], row["ng"]
                    base[row["d"]] = dict(
                        production_date=row["d"],
                        total=tot,
                        ng_count=ng,
                        ok_count=tot - ng,
                        yield_rate=round((tot - ng) / tot * 100, 2) if tot else 0,
                    )

            trend = []
            for i in range(days + 1):
                d = (start_ + timedelta(i)).isoformat()
                trend.append(base.get(d, dict(production_date=d, total=0)))

            for i in range(len(trend)):
                window = [w["total"] for w in trend[max(0, i - 6): i + 1] if w["total"] > 0]
                if window:
                    trend[i]["moving_avg"] = round(statistics.mean(window), 2)

            nz_totals = [t["total"] for t in trend if t["total"] > 0]
            overall = stats(nz_totals)

            if len(nz_totals) >= 7:
                first_week_avg = statistics.mean(nz_totals[:7])
                last_week_avg = statistics.mean(nz_totals[-7:])
                change_pct = ((last_week_avg - first_week_avg) / first_week_avg * 100) if first_week_avg > 0 else 0
                if change_pct > 5:
                    overall["trend_direction"] = "increasing"
                elif change_pct < -5:
                    overall["trend_direction"] = "decreasing"
                else:
                    overall["trend_direction"] = "stable"
                overall["trend_strength"] = abs(change_pct)
            else:
                overall["trend_direction"] = "insufficient_data"
                overall["trend_strength"] = 0

            # P3: 線性回歸預測未來 5 天
            prediction = []
            recent_nonzero = [t["total"] for t in trend if t["total"] > 0][-14:]
            forecast = _linear_predict(recent_nonzero, 5)
            if forecast:
                for i, val in enumerate(forecast):
                    pred_date = (end_ + timedelta(days=i + 1)).isoformat()
                    prediction.append({"date": pred_date, "predicted_total": val})

            result = {
                "line_type": line_type,
                "start_date": start_.isoformat(),
                "end_date": end_.isoformat(),
                "days": days,
                "trend_data": trend,
                "prediction": prediction,
                "statistics": overall,
            }
            _chart_cache.set(cache_key, result, ttl_seconds=300)
            return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in trend_analysis: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# ========= 4. Comparison =========
@router.get("/comparison")
async def comparison(
    start_date: str = Query(..., regex=r"^\d{4}-\d{2}-\d{2}$"),
    end_date: str = Query(..., regex=r"^\d{4}-\d{2}-\d{2}$"),
    period: str = Query("weekly", regex="^(daily|weekly|monthly)$"),
    current_user: dict = Depends(get_current_user),
):
    """模組 vs 總裝對比（以可配對數做相關性）"""
    cache_key = f"comp:{start_date}:{end_date}:{period}"
    cached = _chart_cache.get(cache_key)
    if cached:
        return cached
    sd, ed = start_date, end_date
    start_d = datetime.strptime(sd, "%Y-%m-%d").date()
    end_d = datetime.strptime(ed, "%Y-%m-%d").date()
    range_start, range_end = ca_range_bounds(start_d, end_d)
    try:
        module_data = {}
        with get_cursor("model") as cur:
            try:
                for r in safe_db_execute(cur, """
                    SELECT TO_CHAR(scanned_at, 'YYYY-MM-DD') d, COUNT(*) tot,
                           SUM(CASE WHEN kind='A' THEN 1 ELSE 0 END) a,
                           SUM(CASE WHEN kind='B' THEN 1 ELSE 0 END) b
                    FROM scans WHERE scanned_at >= %s AND scanned_at < %s GROUP BY d
                """, (range_start, range_end)):
                    module_data[r["d"]] = dict(total=r["tot"], count_a=r["a"], count_b=r["b"])
            except Exception as e:
                logger.warning(f"Failed to get module data: {e}")

        assembly_data = {}
        with get_cursor("assembly") as cur:
            try:
                for r in safe_db_execute(cur, """
                    SELECT TO_CHAR(scanned_at, 'YYYY-MM-DD') d, COUNT(*) tot,
                           SUM(CASE WHEN UPPER(status) IN ('NG','FIXED') THEN 1 ELSE 0 END) ng
                    FROM scans WHERE scanned_at >= %s AND scanned_at < %s GROUP BY d
                """, (range_start, range_end)):
                    assembly_data[r["d"]] = dict(total=r["tot"], ng=r["ng"])
            except Exception as e:
                logger.warning(f"Failed to get assembly data: {e}")

        all_days = sorted(set(module_data) | set(assembly_data))
        comp = []
        for d in all_days:
            mod = module_data.get(d, dict(total=0, count_a=0, count_b=0))
            asm = assembly_data.get(d, dict(total=0, ng=0))
            pairs = min(mod["count_a"], mod["count_b"])
            efficiency = round(asm["total"] / pairs * 100, 2) if pairs > 0 else 0
            comp.append(dict(
                date=d,
                module=mod["total"],
                module_a=mod["count_a"],
                module_b=mod["count_b"],
                module_pairs=pairs,
                assembly=asm["total"],
                assembly_ok=asm["total"] - asm["ng"],
                assembly_ng=asm["ng"],
                assembly_yield=round((asm["total"] - asm["ng"]) / asm["total"] * 100, 2) if asm["total"] else 0,
                efficiency=efficiency,
            ))

        if len(comp) > 1:
            xs = [c["module_pairs"] for c in comp]
            ys = [c["assembly"] for c in comp]
            if any(xs) and any(ys):
                mean_x, mean_y = statistics.mean(xs), statistics.mean(ys)
                cov = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
                stdx = statistics.stdev(xs) if len(set(xs)) > 1 else 0
                stdy = statistics.stdev(ys) if len(set(ys)) > 1 else 0
                corr = cov / (len(xs) * stdx * stdy) if stdx and stdy else 0
            else:
                corr = 0
        else:
            corr = 0

        total_pairs = sum(c["module_pairs"] for c in comp)
        total_assembly = sum(c["assembly"] for c in comp)
        avg_efficiency = round(total_assembly / total_pairs * 100, 2) if total_pairs > 0 else 0

        result = {
            "start_date": sd,
            "end_date": ed,
            "period": period,
            "comparison_data": comp,
            "statistics": {
                "correlation": round(corr, 3),
                "total_module": sum(c["module"] for c in comp),
                "total_module_pairs": total_pairs,
                "total_assembly": total_assembly,
                "avg_efficiency": avg_efficiency,
            },
        }
        _chart_cache.set(cache_key, result, ttl_seconds=300)
        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in comparison: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# ========= 5. Hourly Distribution =========
@router.get("/hourly-distribution")
async def hourly_dist(
    line_type: str = Query(..., regex="^(module|assembly)$"),
    days: int = Query(7, ge=1, le=90),
    period: str = Query("weekly", regex="^(daily|weekly|monthly)$"),
    target_date: Optional[str] = Query(None, regex=r"^\d{4}-\d{2}-\d{2}$"),
    current_user: dict = Depends(get_current_user),
):
    """每小時生產分布（支援 period/target_date 僅到 target day）"""
    cache_key = f"hourly:{line_type}:{days}:{period}:{target_date}"
    cached = _chart_cache.get(cache_key)
    if cached:
        return cached
    if target_date:
        start_, end_ = d_range(period, target_date)
        actual_days = get_period_days(period, start_, end_)
    else:
        end_ = ca_today()
        start_ = end_ - timedelta(days=days)
        actual_days = days
    range_start, range_end = ca_range_bounds(start_, end_)

    schema = "model" if line_type == "module" else "assembly"
    try:
        with get_cursor(schema) as cur:

            sql = """
            SELECT TO_CHAR(scanned_at, 'YYYY-MM-DD') d, TO_CHAR(scanned_at, 'HH24') hr, COUNT(*) tot
            FROM scans
            WHERE scanned_at >= %s AND scanned_at < %s
            GROUP BY d, hr
            """
            hourly_data = {}
            try:
                for row in safe_db_execute(cur, sql, (range_start, range_end)):
                    hour = int(row["hr"])
                    hourly_data.setdefault(hour, []).append(row["tot"])
            except Exception as e:
                logger.warning(f"Failed to get hourly data: {e}")
                hourly_data = {}

            dist = []
            for h in range(24):
                if h in hourly_data:
                    values = hourly_data[h]
                    dist.append({
                        "hour": f"{h:02d}:00",
                        "average": round(sum(values) / len(values), 2),
                        "min": min(values),
                        "max": max(values),
                        "total": sum(values),
                        "count": len(values),
                    })
                else:
                    dist.append({"hour": f"{h:02d}:00", "average": 0, "min": 0, "max": 0, "total": 0, "count": 0})

            result = {
                "line_type": line_type,
                "period": period,
                "start_date": start_.isoformat(),
                "end_date": end_.isoformat(),
                "days": actual_days,
                "distribution_data": dist,
                "summary": {
                    "total_production": sum(d["total"] for d in dist),
                    "peak_hour": max(dist, key=lambda x: x["average"])["hour"] if any(d["average"] > 0 for d in dist) else "00:00",
                    "active_hours": len([d for d in dist if d["average"] > 0]),
                },
            }
            _chart_cache.set(cache_key, result)
            return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in hourly_dist: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# ========= 6. DB 狀態/摘要（原樣） =========
@router.get("/database-status")
async def get_database_status(current_user: dict = Depends(get_current_user)):
    try:
        status = {"model_db": False, "assembly_db": False, "main_db": False, "errors": []}
        try:
            with get_cursor("model") as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
                status["model_db"] = True
        except Exception as e:
            status["errors"].append(f"Model DB error: {str(e)}")
        try:
            with get_cursor("assembly") as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
                status["assembly_db"] = True
        except Exception as e:
            status["errors"].append(f"Assembly DB error: {str(e)}")
        try:
            with get_cursor("auth") as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
                status["main_db"] = True
        except Exception as e:
            status["errors"].append(f"Main DB error: {str(e)}")
        return status
    except Exception as e:
        logger.error(f"Database status check failed: {e}")
        raise HTTPException(status_code=500, detail="Status check failed")

@router.get("/data-summary")
async def get_data_summary(current_user: dict = Depends(get_current_user)):
    try:
        summary = {
            "module": {"total": 0, "last_7_days": 0},
            "assembly": {"total": 0, "last_7_days": 0, "ng_analysis": {}},
            "errors": []
        }
        start_d = ca_today() - timedelta(days=7)
        end_d = ca_today()
        range_start, range_end = ca_range_bounds(start_d, end_d)

        try:
            with get_cursor("model") as cur:
                cur.execute("SELECT COUNT(*) count FROM scans")
                total_row = cur.fetchone()
                cur.execute("SELECT COUNT(*) count FROM scans WHERE scanned_at >= %s AND scanned_at < %s", (range_start, range_end))
                recent_row = cur.fetchone()
                summary["module"]["total"] = total_row["count"] if total_row else 0
                summary["module"]["last_7_days"] = recent_row["count"] if recent_row else 0
        except Exception as e:
            summary["errors"].append(f"Module data error: {str(e)}")

        try:
            with get_cursor("assembly") as cur:
                cur.execute("SELECT COUNT(*) count FROM scans")
                total_row = cur.fetchone()
                cur.execute("SELECT COUNT(*) count FROM scans WHERE scanned_at >= %s AND scanned_at < %s", (range_start, range_end))
                recent_row = cur.fetchone()
                cur.execute("""
                    SELECT
                        COUNT(*) total,
                        SUM(CASE WHEN UPPER(status) IN ('NG','FIXED') THEN 1 ELSE 0 END) ng_count,
                        SUM(CASE WHEN UPPER(status)='NG' THEN 1 ELSE 0 END) pure_ng,
                        SUM(CASE WHEN UPPER(status)='FIXED' THEN 1 ELSE 0 END) fixed_count,
                        SUM(CASE WHEN UPPER(status)='OK' THEN 1 ELSE 0 END) ok_count
                    FROM scans
                    WHERE scanned_at >= %s AND scanned_at < %s
                """, (range_start, range_end))
                ng_analysis = cur.fetchone()
                summary["assembly"]["total"] = total_row["count"] if total_row else 0
                summary["assembly"]["last_7_days"] = recent_row["count"] if recent_row else 0
                if ng_analysis:
                    total_recent = ng_analysis["total"] or 0
                    summary["assembly"]["ng_analysis"] = {
                        "total_ng_including_fixed": ng_analysis["ng_count"] or 0,
                        "pure_ng": ng_analysis["pure_ng"] or 0,
                        "fixed": ng_analysis["fixed_count"] or 0,
                        "ok": ng_analysis["ok_count"] or 0,
                        "yield_rate": round((ng_analysis["ok_count"] or 0) / total_recent * 100, 2) if total_recent > 0 else 0,
                        "ng_rate": round((ng_analysis["ng_count"] or 0) / total_recent * 100, 2) if total_recent > 0 else 0
                    }
        except Exception as e:
            summary["errors"].append(f"Assembly data error: {str(e)}")

        return summary
    except Exception as e:
        logger.error(f"Data summary failed: {e}")
        raise HTTPException(status_code=500, detail="Summary generation failed")

# ========= 7. NG 詳細分析（支援搜尋/Top-N，含正規化） =========
@router.get("/ng-analysis")
async def ng_analysis(
    period: str = Query("weekly", regex="^(daily|weekly|monthly)$"),
    target_date: Optional[str] = Query(None, regex=r"^\d{4}-\d{2}-\d{2}$"),
    search_term: Optional[str] = Query(None, description="模糊搜尋（套用於正規化後的原因）"),
    limit: int = Query(10, ge=5, le=50),
    current_user: dict = Depends(get_current_user),
):
    """NG 詳細分析（含 FIXED，正規化彙總，支援搜尋與 Top-N）"""
    cache_key = f"ng:{period}:{target_date}:{search_term}:{limit}"
    cached = _chart_cache.get(cache_key)
    if cached:
        return cached
    start, end = d_range(period, target_date)
    range_start, range_end = ca_range_bounds(start, end)
    try:
        with get_cursor("assembly") as cur:

            cur.execute("""
                SELECT
                    UPPER(status) status_type,
                    COUNT(*) count,
                    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM scans WHERE scanned_at >= %s AND scanned_at < %s), 2) percentage
                FROM scans
                WHERE scanned_at >= %s AND scanned_at < %s
                GROUP BY UPPER(status)
                ORDER BY count DESC
            """, (range_start, range_end, range_start, range_end))
            status_breakdown = cur.fetchall()

            # 每日趨勢（非 daily）
            daily_ng_trend = []
            if period != "daily":
                cur.execute("""
                    SELECT TO_CHAR(scanned_at, 'YYYY-MM-DD') date,
                           COUNT(*) total,
                           SUM(CASE WHEN UPPER(status)='OK' THEN 1 ELSE 0 END) ok_count,
                           SUM(CASE WHEN UPPER(status)='NG' THEN 1 ELSE 0 END) pure_ng,
                           SUM(CASE WHEN UPPER(status)='FIXED' THEN 1 ELSE 0 END) fixed_count,
                           SUM(CASE WHEN UPPER(status) IN ('NG','FIXED') THEN 1 ELSE 0 END) total_ng
                    FROM scans
                    WHERE scanned_at >= %s AND scanned_at < %s
                    GROUP BY TO_CHAR(scanned_at, 'YYYY-MM-DD') ORDER BY TO_CHAR(scanned_at, 'YYYY-MM-DD')
                """, (range_start, range_end))
                daily_rows = cur.fetchall()
                for row in daily_rows:
                    total = row["total"]
                    daily_ng_trend.append({
                        "date": row["date"],
                        "total": total,
                        "ok_count": row["ok_count"],
                        "pure_ng": row["pure_ng"],
                        "fixed_count": row["fixed_count"],
                        "total_ng": row["total_ng"],
                        "yield_rate": round(row["ok_count"] / total * 100, 2) if total > 0 else 0,
                        "ng_rate": round(row["total_ng"] / total * 100, 2) if total > 0 else 0,
                        "fix_rate": round(row["fixed_count"] / total * 100, 2) if total > 0 else 0,
                    })

            # 正規化後的原因明細（純 NG 與 FIXED 拆開彙總）
            cur.execute("""
                SELECT ng_reason, UPPER(status) status_type, COUNT(*) count
                FROM scans
                WHERE scanned_at >= %s AND scanned_at < %s
                  AND UPPER(status) IN ('NG','FIXED')
                  AND ng_reason != ''
                GROUP BY ng_reason, UPPER(status)
                ORDER BY ng_reason
            """, (range_start, range_end))
            raw = cur.fetchall()

            agg: Dict[str, Dict[str, int]] = {}
            for row in raw:
                norm = normalize_ng_reason(row["ng_reason"])
                if not norm:
                    continue
                entry = agg.setdefault(norm, {"pure_ng": 0, "fixed": 0, "total": 0})
                if row["status_type"] == "NG":
                    entry["pure_ng"] += row["count"]
                elif row["status_type"] == "FIXED":
                    entry["fixed"] += row["count"]
                entry["total"] = entry["pure_ng"] + entry["fixed"]

            # 搜尋 + Top-N
            items = [
                {
                    "reason": k,
                    "pure_ng": v["pure_ng"],
                    "fixed": v["fixed"],
                    "total": v["total"],
                    "fix_rate": round(v["fixed"] / v["total"] * 100, 2) if v["total"] > 0 else 0,
                }
                for k, v in agg.items()
            ]
            if search_term:
                key = search_term.strip().lower()
                items = [x for x in items if key in x["reason"].lower()]
            items.sort(key=lambda x: x["total"], reverse=True)
            items = items[:limit]

            result = {
                "period": period,
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
                "status_breakdown": [dict(row) for row in status_breakdown],
                "daily_ng_trend": daily_ng_trend,
                "ng_reasons_detail": items,
                "summary": {
                    "total_scans": sum(row["count"] for row in status_breakdown) if status_breakdown else 0,
                    "total_ng_including_fixed": sum(row["count"] for row in status_breakdown if row["status_type"] in ("NG","FIXED")),
                    "pure_ng_count": next((row["count"] for row in status_breakdown if row["status_type"] == "NG"), 0),
                    "fixed_count": next((row["count"] for row in status_breakdown if row["status_type"] == "FIXED"), 0),
                    "ok_count": next((row["count"] for row in status_breakdown if row["status_type"] == "OK"), 0),
                },
            }
            _chart_cache.set(cache_key, result)
            return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in ng_analysis: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# ========= 線性回歸工具 =========
def _linear_predict(data_points: list, forecast_days: int = 5) -> list:
    """Simple OLS linear regression for production prediction."""
    n = len(data_points)
    if n < 3:
        return []
    x_mean = (n - 1) / 2
    y_mean = sum(data_points) / n
    numerator = sum((i - x_mean) * (y - y_mean) for i, y in enumerate(data_points))
    denominator = sum((i - x_mean) ** 2 for i in range(n))
    if denominator == 0:
        return [round(y_mean, 1)] * forecast_days
    slope = numerator / denominator
    intercept = y_mean - slope * x_mean
    return [max(0, round(slope * (n + i) + intercept, 1)) for i in range(forecast_days)]

# ========= 8. NG Timeline (Stacked Area by Reason) =========
@router.get("/ng-timeline")
async def ng_timeline(
    days: int = Query(30, ge=7, le=90),
    current_user: dict = Depends(get_current_user),
):
    """NG 原因時序圖 — Top 5 reason stacked area，其餘歸 Other"""
    cache_key = f"ng_timeline:{days}"
    cached = _chart_cache.get(cache_key)
    if cached:
        return cached

    end_ = ca_today()
    start_ = end_ - timedelta(days=days)
    range_start, range_end = ca_range_bounds(start_, end_)
    try:
        with get_cursor("assembly") as cur:
            rows = safe_db_execute(cur, """
                SELECT TO_CHAR(scanned_at, 'YYYY-MM-DD') AS date, ng_reason, COUNT(*) AS count
                FROM scans
                WHERE scanned_at >= %s AND scanned_at < %s
                  AND UPPER(status) IN ('NG','FIXED')
                  AND ng_reason != ''
                GROUP BY TO_CHAR(scanned_at, 'YYYY-MM-DD'), ng_reason
                ORDER BY TO_CHAR(scanned_at, 'YYYY-MM-DD')
            """, (range_start, range_end))

            # Normalize and aggregate
            date_reason: Dict[str, Dict[str, int]] = {}
            reason_totals: Dict[str, int] = {}
            for row in rows:
                norm = normalize_ng_reason(row["ng_reason"])
                if not norm:
                    continue
                d = row["date"]
                date_reason.setdefault(d, {})
                date_reason[d][norm] = date_reason[d].get(norm, 0) + row["count"]
                reason_totals[norm] = reason_totals.get(norm, 0) + row["count"]

            # Top 5 reasons
            sorted_reasons = sorted(reason_totals.items(), key=lambda x: x[1], reverse=True)
            top_reasons = [r[0] for r in sorted_reasons[:5]]
            if len(sorted_reasons) > 5:
                top_reasons.append("Other")

            # Build timeline data
            timeline_data = []
            for i in range(days + 1):
                d = (start_ + timedelta(i)).isoformat()
                entry = {"date": d}
                day_data = date_reason.get(d, {})
                other_sum = 0
                for reason, count in day_data.items():
                    if reason in top_reasons:
                        entry[reason] = entry.get(reason, 0) + count
                    else:
                        other_sum += count
                if "Other" in top_reasons and other_sum > 0:
                    entry["Other"] = other_sum
                # Fill missing reasons with 0
                for r in top_reasons:
                    entry.setdefault(r, 0)
                timeline_data.append(entry)

            result = {
                "days": days,
                "timeline_data": timeline_data,
                "top_reasons": top_reasons,
            }
            _chart_cache.set(cache_key, result, ttl_seconds=300)
            return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in ng_timeline: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# ========= 9. Hourly Heatmap (Hour x Weekday) =========
@router.get("/hourly-heatmap")
async def hourly_heatmap(
    line_type: str = Query(..., regex="^(module|assembly)$"),
    days: int = Query(30, ge=7, le=90),
    current_user: dict = Depends(get_current_user),
):
    """7x24 小時產能熱力圖"""
    cache_key = f"heatmap:{line_type}:{days}"
    cached = _chart_cache.get(cache_key)
    if cached:
        return cached

    end_ = ca_today()
    start_ = end_ - timedelta(days=days)
    range_start, range_end = ca_range_bounds(start_, end_)
    schema = "model" if line_type == "module" else "assembly"
    try:
        with get_cursor(schema) as cur:
            rows = safe_db_execute(cur, """
                SELECT EXTRACT(DOW FROM scanned_at)::int AS weekday,
                       TO_CHAR(scanned_at, 'HH24') AS hour,
                       COUNT(*) AS count
                FROM scans
                WHERE scanned_at >= %s AND scanned_at < %s
                GROUP BY weekday, hour
            """, (range_start, range_end))

            heatmap_data = []
            max_count = 0
            raw_map: Dict[str, int] = {}
            for row in rows:
                wd = row["weekday"]  # 0=Sun, 1=Mon ... 6=Sat
                hr = row["hour"]
                c = row["count"]
                raw_map[f"{wd}:{hr}"] = c
                if c > max_count:
                    max_count = c

            for wd in range(7):
                for hr in range(24):
                    hr_str = f"{hr:02d}"
                    c = raw_map.get(f"{wd}:{hr_str}", 0)
                    heatmap_data.append({
                        "weekday": wd,
                        "hour": hr_str,
                        "count": c,
                        "intensity": round(c / max_count, 3) if max_count > 0 else 0,
                    })

            result = {
                "line_type": line_type,
                "days": days,
                "heatmap_data": heatmap_data,
                "max_count": max_count,
            }
            _chart_cache.set(cache_key, result, ttl_seconds=300)
            return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in hourly_heatmap: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
