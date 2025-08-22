from __future__ import annotations

import json, sqlite3, statistics
import logging
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Query, Depends, HTTPException

from core.deps import get_current_user
from core.db import db_manager

# 設置日誌
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/production-charts", tags=["production-charts"])

# ========= 共用工具 =========
def get_model_db():
    """獲取模組數據庫連接"""
    return sqlite3.connect("model.db", timeout=30.0, check_same_thread=False)

def get_assembly_db():
    """獲取總裝數據庫連接"""
    return sqlite3.connect("assembly.db", timeout=30.0, check_same_thread=False)

def d_range(period: str, tgt: Optional[str] = None) -> Tuple[date, date]:
    """period=daily|weekly|monthly → (start, end)"""
    base = datetime.strptime(tgt, "%Y-%m-%d").date() if tgt else date.today()
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

def safe_db_execute(db, query: str, params: tuple = ()):
    try:
        return db.execute(query, params)
    except sqlite3.OperationalError as e:
        if "no such table" in str(e).lower():
            logger.warning(f"Table not found: {e}")
            return []
        logger.error(f"Database operational error: {e}")
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")
    except sqlite3.Error as e:
        logger.error(f"Database error: {e}")
        raise HTTPException(status_code=500, detail="Database error")

# ========= NG 原因正規化（後端統一口徑） =========
def normalize_ng_reason(reason: str) -> str:
    """將常見異寫、空白與大小寫統一；若無匹配則回傳 Title Case"""
    if not reason:
        return ""
    rl = reason.strip().lower()

    # Air Leak 系列
    if "air leak" in rl:
        return "Air Leak"

    # WT333E 系列（電源讀值等）
    if "wt333e" in rl and "power" in rl:
        return "WT333E Power Issue"

    # 螺絲/牙損
    if "broken thread" in rl or "misthread" in rl or "thread side screw" in rl:
        return "Broken Thread Screw"

    # Power Split
    if "power split" in rl:
        return "Power Split"

    # BMS
    if "bms write" in rl:
        return "BMS Write Issue"

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
    start, end = d_range(period, target_date)
    db = None
    try:
        db = get_model_db()
        db.row_factory = sqlite3.Row

        if period == "daily":
            sql = """
            SELECT strftime('%H', ts) hr,
                   COUNT(*) tot,
                   SUM(kind='A') a,
                   SUM(kind='B') b,
                   SUM(UPPER(status) IN ('NG','FIXED')) ng
            FROM scans
            WHERE DATE(ts)=?
            GROUP BY hr ORDER BY hr
            """
            rows = safe_db_execute(db, sql, (start.isoformat(),))
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
            SELECT DATE(ts) d,
                   COUNT(*) tot,
                   SUM(kind='A') a,
                   SUM(kind='B') b,
                   SUM(UPPER(status) IN ('NG','FIXED')) ng
            FROM scans
            WHERE DATE(ts) BETWEEN ? AND ?
            GROUP BY d ORDER BY d
            """
            rows = safe_db_execute(db, sql, (start.isoformat(), end.isoformat()))
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
                row = db.execute(
                    "SELECT plan_json FROM weekly_plan WHERE DATE(week_start)=?",
                    (start.isoformat(),)
                ).fetchone()
                if row and row["plan_json"]:
                    try:
                        pj = json.loads(row["plan_json"])
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
                    except json.JSONDecodeError:
                        logger.warning("Invalid plan_json format")
            except sqlite3.Error as e:
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
            status_counts = safe_db_execute(db, """
                SELECT 
                    SUM(UPPER(status)='NG') pure_ng,
                    SUM(UPPER(status)='FIXED') fixed_count
                FROM scans
                WHERE DATE(ts) BETWEEN ? AND ?
            """, (start.isoformat(), end.isoformat())).fetchone()
            pure_ng = status_counts["pure_ng"] if status_counts else 0
            fixed_count = status_counts["fixed_count"] if status_counts else 0
        except sqlite3.Error as e:
            logger.warning(f"Failed to get module status counts: {e}")
            pure_ng = fixed_count = 0

        # 與前期比較（產量/良率）
        prev_s = start - (end - start + timedelta(days=1))
        prev_e = start - timedelta(days=1)
        try:
            prev_row = db.execute(
                "SELECT COUNT(*) c, SUM(UPPER(status) IN ('NG','FIXED')) ng_c "
                "FROM scans WHERE DATE(ts) BETWEEN ? AND ?",
                (prev_s.isoformat(), prev_e.isoformat()),
            ).fetchone()
            prev = prev_row["c"] if prev_row else 0
            prev_ng = prev_row["ng_c"] if prev_row else 0
        except sqlite3.Error:
            prev = prev_ng = 0
        trend_pct = ((tot_all - prev) / prev * 100) if prev > 0 else 0
        prev_yield = round((prev - prev_ng) / prev * 100, 2) if prev > 0 else 100
        yield_trend = yield_rate - prev_yield

        daily_totals = [p["total"] for p in prod]
        stat_result = stats(daily_totals)

        return {
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

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in module_prod: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        if db:
            db.close()

# ========= 2. Assembly Production（含 NG 正規化） =========
@router.get("/assembly/production")
async def assembly_prod(
    period: str = Query(..., regex="^(daily|weekly|monthly)$"),
    target_date: Optional[str] = Query(None, regex=r"^\d{4}-\d{2}-\d{2}$"),
    current_user: dict = Depends(get_current_user),
):
    """獲取總裝生產數據（OK/NG、良率、NG 原因正規化 Top）"""
    start, end = d_range(period, target_date)
    db = None
    try:
        db = get_assembly_db()
        db.row_factory = sqlite3.Row

        if period == "daily":
            sql = """
            SELECT strftime('%H', ts) hr,
                   COUNT(*) tot,
                   SUM(UPPER(status) IN ('NG','FIXED')) ng
            FROM scans
            WHERE DATE(ts)=?
            GROUP BY hr ORDER BY hr
            """
            rows = safe_db_execute(db, sql, (start.isoformat(),))
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
            SELECT DATE(ts) d,
                   COUNT(*) tot,
                   SUM(UPPER(status) IN ('NG','FIXED')) ng
            FROM scans
            WHERE DATE(ts) BETWEEN ? AND ?
            GROUP BY d ORDER BY d
            """
            rows = safe_db_execute(db, sql, (start.isoformat(), end.isoformat()))
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
            ng_rows = safe_db_execute(db, """
                SELECT ng_reason, COUNT(*) c
                FROM scans
                WHERE DATE(ts) BETWEEN ? AND ?
                  AND UPPER(status) IN ('NG','FIXED') AND ng_reason!=''
                GROUP BY ng_reason
            """, (start.isoformat(), end.isoformat()))
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
        except sqlite3.Error as e:
            logger.warning(f"Failed to get NG reasons: {e}")

        # NG 與 FIXED 拆分
        try:
            status_counts = safe_db_execute(db, """
                SELECT 
                    SUM(UPPER(status)='NG')       pure_ng,
                    SUM(UPPER(status)='FIXED')    fixed_count,
                    SUM(UPPER(status) IN ('NG','FIXED')) total_ng
                FROM scans
                WHERE DATE(ts) BETWEEN ? AND ?
            """, (start.isoformat(), end.isoformat())).fetchone()
            pure_ng = status_counts["pure_ng"] if status_counts else 0
            fixed_count = status_counts["fixed_count"] if status_counts else 0
            total_ng = status_counts["total_ng"] if status_counts else 0
        except sqlite3.Error as e:
            logger.warning(f"Failed to get status counts: {e}")
            pure_ng = fixed_count = total_ng = 0

        # 週計畫
        plan = []
        if period == "weekly":
            try:
                row = db.execute(
                    "SELECT plan_json FROM assembly_weekly_plan WHERE DATE(week_start)=?",
                    (start.isoformat(),)
                ).fetchone()
                if row and row["plan_json"]:
                    try:
                        pj = json.loads(row["plan_json"])
                        if isinstance(pj, dict):
                            plan = [dict(date=k, plan_total=v) for k, v in pj.items()]
                    except json.JSONDecodeError:
                        logger.warning("Invalid assembly plan_json format")
            except sqlite3.Error as e:
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
        try:
            prev_row = db.execute(
                "SELECT COUNT(*) tot, SUM(UPPER(status) IN ('NG','FIXED')) ng "
                "FROM scans WHERE DATE(ts) BETWEEN ? AND ?",
                (prev_s.isoformat(), prev_e.isoformat()),
            ).fetchone()
            prev_tot = prev_row["tot"] if prev_row else 0
            prev_ng = prev_row["ng"] if prev_row else 0
        except sqlite3.Error:
            prev_tot = prev_ng = 0

        prev_yield = round((prev_tot - prev_ng) / prev_tot * 100, 2) if prev_tot else 0
        trend_pct = ((tot - prev_tot) / prev_tot * 100) if prev_tot else 0
        yield_trend = yield_rate - prev_yield

        daily_totals = [p["total"] for p in prod]
        stat_result = stats(daily_totals)

        return {
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

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in assembly_prod: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        if db:
            db.close()

# ========= 3. Trend Analysis =========
@router.get("/trend-analysis")
async def trend_analysis(
    line_type: str = Query(..., regex="^(module|assembly)$"),
    days: int = Query(30, ge=7, le=90),
    current_user: dict = Depends(get_current_user),
):
    """30 天趨勢分析（含 7 日移動平均）"""
    end_ = date.today()
    start_ = end_ - timedelta(days=days)

    db = None
    try:
        db = get_model_db() if line_type == "module" else get_assembly_db()
        db.row_factory = sqlite3.Row

        if line_type == "module":
            sql = """
            SELECT DATE(ts) d, COUNT(*) tot, SUM(kind='A') a, SUM(kind='B') b
            FROM scans
            WHERE DATE(ts) BETWEEN ? AND ?
            GROUP BY d ORDER BY d
            """
        else:
            sql = """
            SELECT DATE(ts) d, COUNT(*) tot, SUM(UPPER(status) IN ('NG','FIXED')) ng
            FROM scans
            WHERE DATE(ts) BETWEEN ? AND ?
            GROUP BY d ORDER BY d
            """

        rows = safe_db_execute(db, sql, (start_.isoformat(), end_.isoformat()))
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

        return {
            "line_type": line_type,
            "start_date": start_.isoformat(),
            "end_date": end_.isoformat(),
            "days": days,
            "trend_data": trend,
            "statistics": overall,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in trend_analysis: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        if db:
            db.close()

# ========= 4. Comparison =========
@router.get("/comparison")
async def comparison(
    start_date: str = Query(..., regex=r"^\d{4}-\d{2}-\d{2}$"),
    end_date: str = Query(..., regex=r"^\d{4}-\d{2}-\d{2}$"),
    period: str = Query("weekly", regex="^(daily|weekly|monthly)$"),
    current_user: dict = Depends(get_current_user),
):
    """模組 vs 總裝對比（以可配對數做相關性）"""
    sd, ed = start_date, end_date
    mod_db = asm_db = None
    try:
        mod_db = get_model_db()
        asm_db = get_assembly_db()
        mod_db.row_factory = sqlite3.Row
        asm_db.row_factory = sqlite3.Row

        module_data = {}
        try:
            for r in safe_db_execute(mod_db, """
                SELECT DATE(ts) d, COUNT(*) tot, SUM(kind='A') a, SUM(kind='B') b
                FROM scans WHERE DATE(ts) BETWEEN ? AND ? GROUP BY d
            """, (sd, ed)):
                module_data[r["d"]] = dict(total=r["tot"], count_a=r["a"], count_b=r["b"])
        except Exception as e:
            logger.warning(f"Failed to get module data: {e}")

        assembly_data = {}
        try:
            for r in safe_db_execute(asm_db, """
                SELECT DATE(ts) d, COUNT(*) tot, SUM(UPPER(status) IN ('NG','FIXED')) ng
                FROM scans WHERE DATE(ts) BETWEEN ? AND ? GROUP BY d
            """, (sd, ed)):
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

        return {
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

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in comparison: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        if mod_db:
            mod_db.close()
        if asm_db:
            asm_db.close()

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
    if target_date:
        start_, end_ = d_range(period, target_date)
        actual_days = get_period_days(period, start_, end_)
    else:
        end_ = date.today()
        start_ = end_ - timedelta(days=days)
        actual_days = days

    db = None
    try:
        db = get_model_db() if line_type == "module" else get_assembly_db()
        db.row_factory = sqlite3.Row

        sql = """
        SELECT DATE(ts) d, strftime('%H', ts) hr, COUNT(*) tot
        FROM scans 
        WHERE DATE(ts) BETWEEN ? AND ?
        GROUP BY d, hr
        """
        hourly_data = {}
        try:
            for row in safe_db_execute(db, sql, (start_.isoformat(), end_.isoformat())):
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

        return {
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

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in hourly_dist: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        if db:
            db.close()

# ========= 6. DB 狀態/摘要（原樣） =========
@router.get("/database-status")
async def get_database_status(current_user: dict = Depends(get_current_user)):
    try:
        status = {"model_db": False, "assembly_db": False, "main_db": False, "errors": []}
        try:
            db = get_model_db(); db.execute("SELECT 1").fetchone(); db.close(); status["model_db"] = True
        except Exception as e:
            status["errors"].append(f"Model DB error: {str(e)}")
        try:
            db = get_assembly_db(); db.execute("SELECT 1").fetchone(); db.close(); status["assembly_db"] = True
        except Exception as e:
            status["errors"].append(f"Assembly DB error: {str(e)}")
        try:
            with db_manager.get_connection() as db:
                db.execute("SELECT 1").fetchone()
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
        seven_days_ago = (date.today() - timedelta(days=7)).isoformat()
        today = date.today().isoformat()

        try:
            db = get_model_db(); db.row_factory = sqlite3.Row
            total_row = db.execute("SELECT COUNT(*) count FROM scans").fetchone()
            recent_row = db.execute("SELECT COUNT(*) count FROM scans WHERE DATE(ts) BETWEEN ? AND ?", (seven_days_ago, today)).fetchone()
            summary["module"]["total"] = total_row["count"] if total_row else 0
            summary["module"]["last_7_days"] = recent_row["count"] if recent_row else 0
            db.close()
        except Exception as e:
            summary["errors"].append(f"Module data error: {str(e)}")

        try:
            db = get_assembly_db(); db.row_factory = sqlite3.Row
            total_row = db.execute("SELECT COUNT(*) count FROM scans").fetchone()
            recent_row = db.execute("SELECT COUNT(*) count FROM scans WHERE DATE(ts) BETWEEN ? AND ?", (seven_days_ago, today)).fetchone()
            ng_analysis = db.execute("""
                SELECT 
                    COUNT(*) total,
                    SUM(UPPER(status) IN ('NG','FIXED')) ng_count,
                    SUM(UPPER(status)='NG') pure_ng,
                    SUM(UPPER(status)='FIXED') fixed_count,
                    SUM(UPPER(status)='OK') ok_count
                FROM scans 
                WHERE DATE(ts) BETWEEN ? AND ?
            """, (seven_days_ago, today)).fetchone()
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
            db.close()
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
    start, end = d_range(period, target_date)
    db = None
    try:
        db = get_assembly_db(); db.row_factory = sqlite3.Row

        status_breakdown = db.execute("""
            SELECT 
                UPPER(status) status_type,
                COUNT(*) count,
                ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM scans WHERE DATE(ts) BETWEEN ? AND ?), 2) percentage
            FROM scans
            WHERE DATE(ts) BETWEEN ? AND ?
            GROUP BY UPPER(status)
            ORDER BY count DESC
        """, (start.isoformat(), end.isoformat(), start.isoformat(), end.isoformat())).fetchall()

        # 每日趨勢（非 daily）
        daily_ng_trend = []
        if period != "daily":
            daily_rows = db.execute("""
                SELECT DATE(ts) date,
                       COUNT(*) total,
                       SUM(UPPER(status)='OK') ok_count,
                       SUM(UPPER(status)='NG') pure_ng,
                       SUM(UPPER(status)='FIXED') fixed_count,
                       SUM(UPPER(status) IN ('NG','FIXED')) total_ng
                FROM scans
                WHERE DATE(ts) BETWEEN ? AND ?
                GROUP BY DATE(ts) ORDER BY DATE(ts)
            """, (start.isoformat(), end.isoformat())).fetchall()
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
        raw = db.execute("""
            SELECT ng_reason, UPPER(status) status_type, COUNT(*) count
            FROM scans
            WHERE DATE(ts) BETWEEN ? AND ?
              AND UPPER(status) IN ('NG','FIXED')
              AND ng_reason != ''
            GROUP BY ng_reason, UPPER(status)
            ORDER BY ng_reason
        """, (start.isoformat(), end.isoformat())).fetchall()

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

        return {
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

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in ng_analysis: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        if db:
            db.close()
