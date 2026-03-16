# ============================================================
# Data Collection Service - Provides data for email system
# PostgreSQL version
# ============================================================

import logging
from datetime import datetime, timedelta
from typing import List, Dict
import os
import json

from core.time_utils import ca_day_bounds, ca_now, ca_today
from core.pg import get_cursor

logger = logging.getLogger(__name__)

class DataCollectionService:
    """Data Collection Service using PostgreSQL connection pool"""

    def __init__(self):
        logger.info("Data collection service initialized (PostgreSQL pool)")

    @staticmethod
    def _to_int(value) -> int:
        try:
            return max(int(value), 0)
        except (TypeError, ValueError):
            return 0

    def _parse_plan_values(self, raw_plan) -> List[int]:
        """
        Normalize plan_json to a list[int].
        Supports:
        - JSONB decoded objects (list/dict)
        - JSON strings
        - list items as numbers or objects with plan_total / A+B / value
        """
        if raw_plan is None:
            return []

        parsed = raw_plan
        if isinstance(parsed, str):
            text = parsed.strip()
            if not text:
                return []
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                logger.warning("Failed to decode plan JSON string: %s", text[:100])
                return []

        if isinstance(parsed, list):
            out: List[int] = []
            for item in parsed:
                if isinstance(item, dict):
                    if "plan_total" in item:
                        out.append(self._to_int(item.get("plan_total")))
                    elif "A" in item or "B" in item:
                        out.append(self._to_int(item.get("A")) + self._to_int(item.get("B")))
                    elif "value" in item:
                        out.append(self._to_int(item.get("value")))
                    else:
                        out.append(0)
                else:
                    out.append(self._to_int(item))
            return out

        if isinstance(parsed, dict):
            numeric_items = []
            for k, v in parsed.items():
                try:
                    idx = int(k)
                except (TypeError, ValueError):
                    continue
                if idx >= 0:
                    numeric_items.append((idx, self._to_int(v)))
            if numeric_items:
                numeric_items.sort(key=lambda x: x[0])
                out = [0] * (numeric_items[-1][0] + 1)
                for idx, value in numeric_items:
                    out[idx] = value
                return out

            date_items = []
            for k, v in parsed.items():
                if not isinstance(k, str) or len(k) != 10 or k[4] != "-" or k[7] != "-":
                    continue
                if isinstance(v, dict):
                    date_items.append((k, self._to_int(v.get("plan_total"))))
                else:
                    date_items.append((k, self._to_int(v)))
            if date_items:
                date_items.sort(key=lambda x: x[0])
                return [v for _, v in date_items]

        return []

    def _extract_today_plan(self, plan_row: Dict, weekday: int) -> int:
        if not plan_row:
            return 0
        plan_values = self._parse_plan_values(plan_row.get("plan_json"))
        if 0 <= weekday < len(plan_values):
            return plan_values[weekday]
        return 0

    def _sum_plan_days(self, plan_row: Dict, plan_days_count: int) -> int:
        if not plan_row or plan_days_count <= 0:
            return 0
        plan_values = self._parse_plan_values(plan_row.get("plan_json"))
        return sum(plan_values[:plan_days_count]) if plan_values else 0

    def _get_california_date(self, days_ago: int = 0) -> str:
        """Get California time date"""
        return (ca_today() - timedelta(days=days_ago)).strftime('%Y-%m-%d')

    def get_daily_report_data(self) -> Dict:
        """
        Synchronous version of collect_daily_report_data for non-async contexts
        """
        return self._collect_report_data()

    def get_today_production_counts(self) -> Dict[str, int]:
        """
        Lightweight production counters for skip/send guard logic.
        """
        start_ts, end_ts = ca_day_bounds(ca_today())
        module_count = 0
        assembly_count = 0

        with get_cursor('model') as cur:
            cur.execute(
                "SELECT COUNT(*) AS cnt FROM scans WHERE scanned_at >= %s AND scanned_at < %s",
                (start_ts, end_ts),
            )
            row = cur.fetchone()
            module_count = int(row["cnt"] or 0) if row else 0

        with get_cursor('assembly') as cur:
            cur.execute(
                "SELECT COUNT(*) AS cnt FROM scans WHERE scanned_at >= %s AND scanned_at < %s",
                (start_ts, end_ts),
            )
            row = cur.fetchone()
            assembly_count = int(row["cnt"] or 0) if row else 0

        return {
            "module_production": module_count,
            "assembly_production": assembly_count,
        }

    def _collect_report_data(self) -> Dict:
        """Internal method to collect report data (synchronous) with error handling"""
        try:
            today = self._get_california_date(0)
            current_month = ca_now().strftime('%Y-%m')
            start_ts, end_ts = ca_day_bounds(ca_today())

            ca_now_dt = ca_now()
            weekday = ca_now_dt.weekday()
            days_since_monday = weekday
            week_start = (ca_now_dt - timedelta(days=days_since_monday)).strftime('%Y-%m-%d')

            # 1. Get today's module production
            with get_cursor('model') as cur:
                cur.execute("""
                    SELECT COUNT(*) AS cnt FROM scans
                    WHERE scanned_at >= %s AND scanned_at < %s
                """, (start_ts, end_ts))
                result = cur.fetchone()
                module_count = int(result["cnt"] or 0) if result else 0

                cur.execute("""
                    SELECT plan_json FROM weekly_plan
                    WHERE week_start = %s
                """, (week_start,))
                plan_row = cur.fetchone()

                module_plan = self._extract_today_plan(plan_row, weekday)

                cur.execute("""
                    SELECT COUNT(*) AS cnt FROM scans
                    WHERE scanned_at >= %s AND scanned_at < %s AND ng_reason IS NOT NULL AND TRIM(ng_reason) != ''
                """, (start_ts, end_ts))
                result = cur.fetchone()
                module_ng = int(result["cnt"] or 0) if result else 0

                cur.execute("""
                    SELECT MIN(TRIM(ng_reason)) AS reason, COUNT(*) as count
                    FROM scans
                    WHERE scanned_at >= %s AND scanned_at < %s AND ng_reason IS NOT NULL AND TRIM(ng_reason) != ''
                    GROUP BY UPPER(TRIM(ng_reason))
                    ORDER BY count DESC
                """, (start_ts, end_ts))
                module_reason_rows = cur.fetchall() or []

            # 2. Get today's assembly production
            with get_cursor('assembly') as cur:
                cur.execute("""
                    SELECT COUNT(*) AS cnt FROM scans
                    WHERE scanned_at >= %s AND scanned_at < %s
                """, (start_ts, end_ts))
                result = cur.fetchone()
                assembly_count = int(result["cnt"] or 0) if result else 0

                cur.execute("""
                    SELECT plan_json FROM assembly_weekly_plan
                    WHERE week_start = %s
                """, (week_start,))
                assy_plan_row = cur.fetchone()

                assembly_plan = self._extract_today_plan(assy_plan_row, weekday)

                cur.execute("""
                    SELECT COUNT(*) AS cnt FROM scans
                    WHERE scanned_at >= %s AND scanned_at < %s AND ng_reason IS NOT NULL AND TRIM(ng_reason) != ''
                """, (start_ts, end_ts))
                result = cur.fetchone()
                assembly_ng = int(result["cnt"] or 0) if result else 0

                cur.execute("""
                    SELECT MIN(TRIM(ng_reason)) AS reason, COUNT(*) as count
                    FROM scans
                    WHERE scanned_at >= %s AND scanned_at < %s AND ng_reason IS NOT NULL AND TRIM(ng_reason) != ''
                    GROUP BY UPPER(TRIM(ng_reason))
                    ORDER BY count DESC
                """, (start_ts, end_ts))
                assembly_reason_rows = cur.fetchall() or []

            # 3. Get downtime data
            with get_cursor('downtime') as cur:
                cur.execute("""
                    SELECT SUM(duration_min) as total_minutes
                    FROM downtime_logs
                    WHERE start_local >= %s AND start_local < %s
                """, (start_ts, end_ts))
                result = cur.fetchone()
                downtime_minutes = float(result["total_minutes"] or 0) if result else 0
                downtime_hours = round(downtime_minutes / 60, 1)

                cur.execute("""
                    SELECT line, station, start_local, end_local, duration_min
                    FROM downtime_logs
                    WHERE start_local >= %s AND start_local < %s
                    ORDER BY duration_min DESC
                    LIMIT 5
                """, (start_ts, end_ts))

                downtime_details = []
                for row in cur.fetchall():
                    downtime_details.append({
                        'line': row["line"] or 'Unknown',
                        'station': row["station"] or 'Unknown',
                        'start_time': row["start_local"] or '',
                        'end_time': row["end_local"] or 'Ongoing',
                        'duration_minutes': row["duration_min"] or 0
                    })

                cur.execute("""
                    SELECT line, COUNT(*) as count, SUM(duration_min) as total_minutes
                    FROM downtime_logs
                    WHERE start_local >= %s AND start_local < %s
                    GROUP BY line
                    ORDER BY total_minutes DESC
                """, (start_ts, end_ts))

                downtime_by_line = []
                for row in cur.fetchall():
                    downtime_by_line.append({
                        'line': row["line"] or 'Unknown',
                        'count': row["count"],
                        'total_minutes': row["total_minutes"],
                        'total_hours': round(float(row["total_minutes"] or 0) / 60, 1)
                    })

                # Downtime hourly breakdown for UPH vs Downtime charts
                cur.execute("""
                    SELECT line, start_local, end_local, duration_min
                    FROM downtime_logs
                    WHERE start_local >= %s AND start_local < %s
                    ORDER BY start_local ASC
                """, (start_ts, end_ts))

                day_start = datetime.strptime(start_ts, "%Y-%m-%d %H:%M:%S")
                day_end = datetime.strptime(end_ts, "%Y-%m-%d %H:%M:%S")
                cell_downtime_map = {}
                assembly_downtime_map = {}

                for row in cur.fetchall():
                    line = row["line"]
                    start_local = row["start_local"]
                    end_local = row["end_local"]
                    line_key = (line or "").lower()
                    if line_key not in ("cell", "assembly"):
                        continue
                    if not start_local or not end_local:
                        continue
                    # TIMESTAMPTZ returns datetime objects
                    start_dt = start_local if isinstance(start_local, datetime) else datetime.fromisoformat(str(start_local))
                    end_dt = end_local if isinstance(end_local, datetime) else datetime.fromisoformat(str(end_local))
                    # Strip timezone for naive comparison with day_start/day_end
                    start_dt = start_dt.replace(tzinfo=None) if start_dt.tzinfo else start_dt
                    end_dt = end_dt.replace(tzinfo=None) if end_dt.tzinfo else end_dt
                    if end_dt <= start_dt:
                        continue

                    if start_dt < day_start:
                        start_dt = day_start
                    if end_dt > day_end:
                        end_dt = day_end
                    if end_dt <= start_dt:
                        continue

                    target = cell_downtime_map if line_key == "cell" else assembly_downtime_map
                    cur_dt = start_dt
                    while cur_dt < end_dt:
                        hour_start = cur_dt.replace(minute=0, second=0, microsecond=0)
                        next_hour = hour_start + timedelta(hours=1)
                        seg_end = end_dt if end_dt < next_hour else next_hour
                        minutes = (seg_end - cur_dt).total_seconds() / 60.0
                        target[cur_dt.hour] = target.get(cur_dt.hour, 0) + minutes
                        cur_dt = seg_end

            downtime_cell_hourly = [
                {'hour': h, 'minutes': round(m, 1)}
                for h, m in sorted(cell_downtime_map.items())
                if m > 0
            ]
            downtime_assembly_hourly = [
                {'hour': h, 'minutes': round(m, 1)}
                for h, m in sorted(assembly_downtime_map.items())
                if m > 0
            ]

            # 4. Combine NG counts and reasons (case-insensitive merging)
            total_ng = module_ng + assembly_ng
            reason_counts = {}

            for row in module_reason_rows:
                reason = row["reason"]
                count = row["count"] or 0
                if reason:
                    key = reason.upper()
                    if key not in reason_counts:
                        reason_counts[key] = {'display': reason, 'count': 0}
                    reason_counts[key]['count'] += count

            for row in assembly_reason_rows:
                reason = row["reason"]
                count = row["count"] or 0
                if reason:
                    key = reason.upper()
                    if key not in reason_counts:
                        reason_counts[key] = {'display': reason, 'count': 0}
                    reason_counts[key]['count'] += count

            ng_reasons = [
                {
                    'reason': info['display'],
                    'count': info['count'],
                    'percentage': round(info['count'] * 100.0 / max(total_ng, 1), 1)
                }
                for key, info in sorted(reason_counts.items(), key=lambda item: item[1]['count'], reverse=True)[:5]
            ]

            # 5. Calculate efficiency with actual plan data
            module_efficiency = round((module_count / module_plan * 100), 1) if module_plan > 0 else 0
            assembly_efficiency = round((assembly_count / assembly_plan * 100), 1) if assembly_plan > 0 else 0

            # 6. Get hourly production data for charts (by line A/B)
            with get_cursor('model') as cur:
                cur.execute("""
                    SELECT TO_CHAR(scanned_at, 'HH24') as hour, COUNT(*) as count
                    FROM scans
                    WHERE scanned_at >= %s AND scanned_at < %s AND kind = 'A'
                    GROUP BY TO_CHAR(scanned_at, 'HH24')
                    ORDER BY hour
                """, (start_ts, end_ts))
                module_a_hourly = [{'hour': int(row["hour"]), 'count': row["count"]} for row in cur.fetchall()]

                cur.execute("""
                    SELECT TO_CHAR(scanned_at, 'HH24') as hour, COUNT(*) as count
                    FROM scans
                    WHERE scanned_at >= %s AND scanned_at < %s AND kind = 'B'
                    GROUP BY TO_CHAR(scanned_at, 'HH24')
                    ORDER BY hour
                """, (start_ts, end_ts))
                module_b_hourly = [{'hour': int(row["hour"]), 'count': row["count"]} for row in cur.fetchall()]

            module_total_map = {}
            for row in module_a_hourly:
                hour_key = int(row['hour'])
                module_total_map[hour_key] = module_total_map.get(hour_key, 0) + int(row['count'] or 0)
            for row in module_b_hourly:
                hour_key = int(row['hour'])
                module_total_map[hour_key] = module_total_map.get(hour_key, 0) + int(row['count'] or 0)
            module_total_hourly = [
                {'hour': h, 'count': module_total_map[h]}
                for h in sorted(module_total_map.keys())
            ]

            # Assembly hourly production
            with get_cursor('assembly') as cur:
                cur.execute("""
                    SELECT TO_CHAR(scanned_at, 'HH24') as hour, COUNT(*) as count
                    FROM scans
                    WHERE scanned_at >= %s AND scanned_at < %s
                    GROUP BY TO_CHAR(scanned_at, 'HH24')
                    ORDER BY hour
                """, (start_ts, end_ts))
                assembly_hourly = [{'hour': int(row["hour"]), 'count': row["count"]} for row in cur.fetchall()]

            # 7. Get weekly cumulative data
            weekly_data = self.get_weekly_cumulative_data()

            report_data = {
                'module_production': module_count,
                'module_plan': module_plan,
                'assembly_production': assembly_count,
                'assembly_plan': assembly_plan,
                'total_ng': total_ng,
                'ng_reasons': ng_reasons,
                'downtime_hours': downtime_hours,
                'downtime_details': downtime_details,
                'downtime_by_line': downtime_by_line,
                'module_efficiency': module_efficiency,
                'assembly_efficiency': assembly_efficiency,
                'module_a_hourly': module_a_hourly,
                'module_b_hourly': module_b_hourly,
                'assembly_hourly': assembly_hourly,
                'module_total_hourly': module_total_hourly,
                'assembly_total_hourly': assembly_hourly,
                'downtime_cell_hourly': downtime_cell_hourly,
                'downtime_assembly_hourly': downtime_assembly_hourly,
                'date': today,
                # Weekly cumulative data
                'weekly_module_count': weekly_data.get('weekly_module_count', 0),
                'weekly_module_plan': weekly_data.get('weekly_module_plan', 0),
                'weekly_module_efficiency': weekly_data.get('weekly_module_efficiency', 0),
                'weekly_assembly_count': weekly_data.get('weekly_assembly_count', 0),
                'weekly_assembly_plan': weekly_data.get('weekly_assembly_plan', 0),
                'weekly_assembly_efficiency': weekly_data.get('weekly_assembly_efficiency', 0),
                'weekly_total_ng': weekly_data.get('weekly_total_ng', 0),
                'week_start': weekly_data.get('week_start', ''),
                'day_range': weekly_data.get('day_range', 'N/A'),
                'days_counted': weekly_data.get('days_counted', 0),
                'plan_days': weekly_data.get('plan_days', 0)
            }

            logger.info(f"Daily report data collection completed: Module={module_count}, Assembly={assembly_count}, NG={total_ng}, Weekly Module={weekly_data.get('weekly_module_count', 0)}")
            return report_data

        except Exception as e:
            logger.error(f"Failed to collect daily report data: {e}", exc_info=True)
            return {
                'module_production': 0,
                'assembly_production': 0,
                'total_ng': 0,
                'ng_reasons': [],
                'downtime_hours': 0,
                'downtime_details': [],
                'downtime_by_line': [],
                'module_efficiency': 0,
                'assembly_efficiency': 0,
                'module_a_hourly': [],
                'module_b_hourly': [],
                'assembly_hourly': [],
                'module_total_hourly': [],
                'assembly_total_hourly': [],
                'downtime_cell_hourly': [],
                'downtime_assembly_hourly': [],
                'date': self._get_california_date(1),
                # Weekly cumulative data (fallback)
                'weekly_module_count': 0,
                'weekly_module_plan': 0,
                'weekly_module_efficiency': 0,
                'weekly_assembly_count': 0,
                'weekly_assembly_plan': 0,
                'weekly_assembly_efficiency': 0,
                'weekly_total_ng': 0,
                'week_start': '',
                'day_range': 'N/A',
                'days_counted': 0,
                'plan_days': 0,
                'error': str(e)
            }

    async def collect_daily_report_data(self) -> Dict:
        """
        Async version - runs in thread pool to avoid blocking event loop.
        """
        import asyncio
        return await asyncio.to_thread(self._collect_report_data)

    def get_weekly_cumulative_data(self) -> Dict:
        """
        Get weekly cumulative data (Monday to current day, California time)
        """
        try:
            ca_now_dt = ca_now()
            weekday = ca_now_dt.weekday()  # 0=Monday, 6=Sunday

            if weekday == 6:
                days_since_monday = 0
                week_start_date = ca_now_dt.date()
            else:
                days_since_monday = weekday
                week_start_date = (ca_now_dt - timedelta(days=days_since_monday)).date()

            week_start_str = week_start_date.strftime('%Y-%m-%d')
            week_start_ts = f"{week_start_str} 00:00:00"
            today_str = ca_now_dt.strftime('%Y-%m-%d')
            week_end_ts = f"{today_str} 23:59:59"

            plan_days_count = min(weekday + 1, 5) if weekday < 6 else 5

            weekly_module_count = 0
            weekly_module_plan = 0
            weekly_module_ng = 0
            weekly_assembly_count = 0
            weekly_assembly_plan = 0
            weekly_assembly_ng = 0

            # 1. Get weekly module production
            with get_cursor('model') as cur:
                cur.execute("""
                    SELECT COUNT(*) AS cnt FROM scans
                    WHERE scanned_at >= %s AND scanned_at <= %s
                """, (week_start_ts, week_end_ts))
                result = cur.fetchone()
                weekly_module_count = int(result["cnt"] or 0) if result else 0

                cur.execute("""
                    SELECT COUNT(*) AS cnt FROM scans
                    WHERE scanned_at >= %s AND scanned_at <= %s AND ng_reason IS NOT NULL AND TRIM(ng_reason) != ''
                """, (week_start_ts, week_end_ts))
                result = cur.fetchone()
                weekly_module_ng = int(result["cnt"] or 0) if result else 0

                cur.execute("""
                    SELECT plan_json FROM weekly_plan
                    WHERE week_start = %s
                """, (week_start_str,))
                plan_row = cur.fetchone()

                weekly_module_plan = self._sum_plan_days(plan_row, plan_days_count)

            # 2. Get weekly assembly production
            with get_cursor('assembly') as cur:
                cur.execute("""
                    SELECT COUNT(*) AS cnt FROM scans
                    WHERE scanned_at >= %s AND scanned_at <= %s
                """, (week_start_ts, week_end_ts))
                result = cur.fetchone()
                weekly_assembly_count = int(result["cnt"] or 0) if result else 0

                cur.execute("""
                    SELECT COUNT(*) AS cnt FROM scans
                    WHERE scanned_at >= %s AND scanned_at <= %s AND ng_reason IS NOT NULL AND TRIM(ng_reason) != ''
                """, (week_start_ts, week_end_ts))
                result = cur.fetchone()
                weekly_assembly_ng = int(result["cnt"] or 0) if result else 0

                cur.execute("""
                    SELECT plan_json FROM assembly_weekly_plan
                    WHERE week_start = %s
                """, (week_start_str,))
                assy_plan_row = cur.fetchone()

                weekly_assembly_plan = self._sum_plan_days(assy_plan_row, plan_days_count)

            weekly_module_efficiency = round((weekly_module_count / weekly_module_plan * 100), 1) if weekly_module_plan > 0 else 0
            weekly_assembly_efficiency = round((weekly_assembly_count / weekly_assembly_plan * 100), 1) if weekly_assembly_plan > 0 else 0
            weekly_total_ng = weekly_module_ng + weekly_assembly_ng

            day_names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
            if weekday == 0:
                day_range = 'Mon'
            elif weekday == 6:
                day_range = 'Sun (Week Start)'
            else:
                day_range = f"Mon-{day_names[weekday]}"

            weekly_data = {
                'weekly_module_count': weekly_module_count,
                'weekly_module_plan': weekly_module_plan,
                'weekly_module_ng': weekly_module_ng,
                'weekly_module_efficiency': weekly_module_efficiency,
                'weekly_assembly_count': weekly_assembly_count,
                'weekly_assembly_plan': weekly_assembly_plan,
                'weekly_assembly_ng': weekly_assembly_ng,
                'weekly_assembly_efficiency': weekly_assembly_efficiency,
                'weekly_total_ng': weekly_total_ng,
                'week_start': week_start_str,
                'day_range': day_range,
                'days_counted': weekday + 1 if weekday < 6 else 0,
                'plan_days': plan_days_count
            }

            logger.info(f"Weekly cumulative data: Module={weekly_module_count}/{weekly_module_plan}, Assembly={weekly_assembly_count}/{weekly_assembly_plan}, NG={weekly_total_ng}")
            return weekly_data

        except Exception as e:
            logger.error(f"Failed to collect weekly cumulative data: {e}", exc_info=True)
            return {
                'weekly_module_count': 0,
                'weekly_module_plan': 0,
                'weekly_module_ng': 0,
                'weekly_module_efficiency': 0,
                'weekly_assembly_count': 0,
                'weekly_assembly_plan': 0,
                'weekly_assembly_ng': 0,
                'weekly_assembly_efficiency': 0,
                'weekly_total_ng': 0,
                'week_start': '',
                'day_range': 'N/A',
                'days_counted': 0,
                'plan_days': 0,
                'error': str(e)
            }

    async def get_production_risks(self) -> List[Dict]:
        """Get current production risks"""
        try:
            logger.info("Production risks method called")
            return []
        except Exception as e:
            logger.error(f"Failed to get production risks: {e}", exc_info=True)
            return []
