# ============================================================
# Data Collection Service - Provides data for email system
# ============================================================

import logging
from datetime import datetime, timedelta
from typing import List, Dict
import sqlite3
import os
from contextlib import contextmanager
import time

from core.time_utils import ca_day_bounds, ca_now, ca_today

logger = logging.getLogger(__name__)

class DataCollectionService:
    """Data Collection Service with connection pooling"""

    def __init__(self):
        # Use model.db and assembly.db from backend root directory
        backend_dir = os.path.join(os.path.dirname(__file__), "..")
        self.model_db_path = os.path.join(backend_dir, "model.db")
        self.assembly_db_path = os.path.join(backend_dir, "assembly.db")
        self.downtime_db_path = os.path.join(backend_dir, "downtime.db")

        # Initialize connection pool
        self._connections = {
            'model': None,
            'assembly': None,
            'downtime': None
        }

        # Enable WAL mode for better concurrency
        self._enable_wal_mode()

        logger.info(f"Data collection service initialized with connection pooling")
        logger.info(f"  Model DB: {self.model_db_path}")
        logger.info(f"  Assembly DB: {self.assembly_db_path}")
        logger.info(f"  Downtime DB: {self.downtime_db_path}")

    def _enable_wal_mode(self):
        """Enable WAL mode for all databases to reduce locking"""
        for db_name, db_path in [
            ('model', self.model_db_path),
            ('assembly', self.assembly_db_path),
            ('downtime', self.downtime_db_path)
        ]:
            try:
                conn = sqlite3.connect(db_path)
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute("PRAGMA synchronous=NORMAL")
                conn.execute("PRAGMA busy_timeout=30000")  # 30 seconds timeout
                conn.close()
                logger.info(f"  WAL mode enabled for {db_name} database")
            except Exception as e:
                logger.warning(f"  Failed to enable WAL mode for {db_name}: {e}")

    @contextmanager
    def _get_connection(self, db_type: str, max_retries: int = 3):
        """
        Context manager for database connections with retry logic

        Args:
            db_type: 'model', 'assembly', or 'downtime'
            max_retries: Maximum number of retry attempts for locked database
        """
        db_paths = {
            'model': self.model_db_path,
            'assembly': self.assembly_db_path,
            'downtime': self.downtime_db_path
        }

        if db_type not in db_paths:
            raise ValueError(f"Invalid db_type: {db_type}")

        # Reuse existing connection or create new one
        if not self._connections[db_type]:
            self._connections[db_type] = sqlite3.connect(
                db_paths[db_type],
                check_same_thread=False,
                timeout=30.0
            )

        conn = self._connections[db_type]
        retry_count = 0

        while retry_count < max_retries:
            try:
                yield conn
                break
            except sqlite3.OperationalError as e:
                if "database is locked" in str(e) and retry_count < max_retries - 1:
                    retry_count += 1
                    wait_time = 0.1 * (2 ** retry_count)  # Exponential backoff
                    logger.warning(f"Database locked, retry {retry_count}/{max_retries} after {wait_time}s")
                    time.sleep(wait_time)
                else:
                    logger.error(f"Database operation failed after {retry_count} retries: {e}")
                    raise

    def _get_model_db_connection(self):
        """Legacy method - kept for compatibility"""
        return sqlite3.connect(self.model_db_path, timeout=30.0)

    def _get_assembly_db_connection(self):
        """Legacy method - kept for compatibility"""
        return sqlite3.connect(self.assembly_db_path, timeout=30.0)

    def _get_downtime_db_connection(self):
        """Legacy method - kept for compatibility"""
        return sqlite3.connect(self.downtime_db_path, timeout=30.0)

    def close_all_connections(self):
        """Close all pooled connections"""
        for db_type, conn in self._connections.items():
            if conn:
                try:
                    conn.close()
                    logger.info(f"Closed {db_type} connection")
                except Exception as e:
                    logger.warning(f"Error closing {db_type} connection: {e}")
                finally:
                    self._connections[db_type] = None

    def _get_california_date(self, days_ago: int = 0) -> str:
        """Get California time date"""
        return (ca_today() - timedelta(days=days_ago)).strftime('%Y-%m-%d')

    def get_daily_report_data(self) -> Dict:
        """
        Synchronous version of collect_daily_report_data for non-async contexts

        Returns:
            Dictionary containing report data
        """
        return self._collect_report_data()

    def _collect_report_data(self) -> Dict:
        """Internal method to collect report data (synchronous) with error handling"""
        import json

        try:
            today = self._get_california_date(0)
            current_month = ca_now().strftime('%Y-%m')
            start_ts, end_ts = ca_day_bounds(ca_today())

            ca_now_dt = ca_now()
            weekday = ca_now_dt.weekday()
            days_since_monday = weekday
            week_start = (ca_now_dt - timedelta(days=days_since_monday)).strftime('%Y-%m-%d')

            # 1. Get today's module production with connection pool
            with self._get_connection('model') as model_conn:
                model_cursor = model_conn.cursor()

                # Get module count with safe fetchone
                model_cursor.execute("""
                    SELECT COUNT(*) FROM scans
                    WHERE ts >= ? AND ts < ?
                """, (start_ts, end_ts))
                result = model_cursor.fetchone()
                module_count = result[0] if result and result[0] is not None else 0

                # Get module plan with JSON error handling
                model_cursor.execute("""
                    SELECT plan_json FROM weekly_plan
                    WHERE week_start = ?
                """, (week_start,))
                plan_row = model_cursor.fetchone()

                if plan_row and weekday < 5:
                    try:
                        plan_array = json.loads(plan_row[0])
                        module_plan = plan_array[weekday] if weekday < len(plan_array) else 120
                    except (json.JSONDecodeError, IndexError, TypeError) as e:
                        logger.warning(f"Failed to parse module plan JSON: {e}")
                        module_plan = 120
                else:
                    module_plan = 120

                # Get module NG count
                model_cursor.execute("""
                    SELECT COUNT(*) FROM scans
                    WHERE ts >= ? AND ts < ? AND ng_reason IS NOT NULL AND TRIM(ng_reason) != ''
                """, (start_ts, end_ts))
                result = model_cursor.fetchone()
                module_ng = result[0] if result and result[0] is not None else 0

                # Get NG reasons
                model_cursor.execute("""
                    SELECT MIN(TRIM(ng_reason)) AS reason, COUNT(*) as count
                    FROM scans
                    WHERE ts >= ? AND ts < ? AND ng_reason IS NOT NULL AND TRIM(ng_reason) != ''
                    GROUP BY UPPER(TRIM(ng_reason))
                    ORDER BY count DESC
                """, (start_ts, end_ts))
                module_reason_rows = model_cursor.fetchall() or []

            # 2. Get today's assembly production with connection pool
            with self._get_connection('assembly') as assy_conn:
                assy_cursor = assy_conn.cursor()

                # Get assembly count with safe fetchone
                assy_cursor.execute("""
                    SELECT COUNT(*) FROM scans
                    WHERE ts >= ? AND ts < ?
                """, (start_ts, end_ts))
                result = assy_cursor.fetchone()
                assembly_count = result[0] if result and result[0] is not None else 0

                # Get assembly plan with JSON error handling
                assy_cursor.execute("""
                    SELECT plan_json FROM assembly_weekly_plan
                    WHERE week_start = ?
                """, (week_start,))
                assy_plan_row = assy_cursor.fetchone()

                if assy_plan_row and weekday < 5:
                    try:
                        assy_plan_array = json.loads(assy_plan_row[0])
                        assembly_plan = assy_plan_array[weekday] if weekday < len(assy_plan_array) else 120
                    except (json.JSONDecodeError, IndexError, TypeError) as e:
                        logger.warning(f"Failed to parse assembly plan JSON: {e}")
                        assembly_plan = 120
                else:
                    assembly_plan = 120

                # Get assembly NG count
                assy_cursor.execute("""
                    SELECT COUNT(*) FROM scans
                    WHERE ts >= ? AND ts < ? AND ng_reason IS NOT NULL AND TRIM(ng_reason) != ''
                """, (start_ts, end_ts))
                result = assy_cursor.fetchone()
                assembly_ng = result[0] if result and result[0] is not None else 0

                # Get NG reasons
                assy_cursor.execute("""
                    SELECT MIN(TRIM(ng_reason)) AS reason, COUNT(*) as count
                    FROM scans
                    WHERE ts >= ? AND ts < ? AND ng_reason IS NOT NULL AND TRIM(ng_reason) != ''
                    GROUP BY UPPER(TRIM(ng_reason))
                    ORDER BY count DESC
                """, (start_ts, end_ts))
                assembly_reason_rows = assy_cursor.fetchall() or []

            # 3. Get downtime data with connection pool
            with self._get_connection('downtime') as downtime_conn:
                downtime_cursor = downtime_conn.cursor()

                # Get total downtime minutes with safe fetchone
                downtime_cursor.execute("""
                    SELECT SUM(duration_min) as total_minutes
                    FROM downtime_logs
                    WHERE start_local >= ? AND start_local < ?
                """, (start_ts, end_ts))
                result = downtime_cursor.fetchone()
                downtime_minutes = result[0] if result and result[0] is not None else 0
                downtime_hours = round(downtime_minutes / 60, 1)

            # Get downtime details
            downtime_cursor.execute("""
                SELECT line, station, start_local, end_local, duration_min
                FROM downtime_logs
                WHERE start_local >= ? AND start_local < ?
                ORDER BY duration_min DESC
                LIMIT 5
            """, (start_ts, end_ts))

            downtime_details = []
            for row in downtime_cursor.fetchall():
                downtime_details.append({
                    'line': row[0] or 'Unknown',
                    'station': row[1] or 'Unknown',
                    'start_time': row[2] or '',
                    'end_time': row[3] or 'Ongoing',
                    'duration_minutes': row[4] or 0
                })

            # Get downtime by line
            downtime_cursor.execute("""
                SELECT line, COUNT(*) as count, SUM(duration_min) as total_minutes
                FROM downtime_logs
                WHERE start_local >= ? AND start_local < ?
                GROUP BY line
                ORDER BY total_minutes DESC
            """, (start_ts, end_ts))

            downtime_by_line = []
            for row in downtime_cursor.fetchall():
                downtime_by_line.append({
                    'line': row[0] or 'Unknown',
                    'count': row[1],
                    'total_minutes': row[2],
                    'total_hours': round(row[2] / 60, 1)
                })

            # Downtime hourly breakdown for UPH vs Downtime charts
            downtime_cursor.execute("""
                SELECT line, start_local, end_local, duration_min
                FROM downtime_logs
                WHERE start_local >= ? AND start_local < ?
                ORDER BY start_local ASC
            """, (start_ts, end_ts))

            day_start = datetime.strptime(start_ts, "%Y-%m-%d %H:%M:%S")
            day_end = datetime.strptime(end_ts, "%Y-%m-%d %H:%M:%S")
            cell_downtime_map = {}
            assembly_downtime_map = {}

            for line, start_local, end_local, _duration_min in downtime_cursor.fetchall():
                line_key = (line or "").lower()
                if line_key not in ("cell", "assembly"):
                    continue
                if not start_local or not end_local:
                    continue
                try:
                    start_dt = datetime.strptime(start_local, "%Y-%m-%d %H:%M:%S")
                    end_dt = datetime.strptime(end_local, "%Y-%m-%d %H:%M:%S")
                except ValueError:
                    continue
                if end_dt <= start_dt:
                    continue

                if start_dt < day_start:
                    start_dt = day_start
                if end_dt > day_end:
                    end_dt = day_end
                if end_dt <= start_dt:
                    continue

                target = cell_downtime_map if line_key == "cell" else assembly_downtime_map
                cur = start_dt
                while cur < end_dt:
                    hour_start = cur.replace(minute=0, second=0, microsecond=0)
                    next_hour = hour_start + timedelta(hours=1)
                    seg_end = end_dt if end_dt < next_hour else next_hour
                    minutes = (seg_end - cur).total_seconds() / 60.0
                    target[cur.hour] = target.get(cur.hour, 0) + minutes
                    cur = seg_end

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
            downtime_conn.close()

            # 4. Combine NG counts and reasons (case-insensitive merging)
            total_ng = module_ng + assembly_ng
            reason_counts = {}  # key: uppercase reason, value: {'display': original, 'count': count}

            for row in module_reason_rows:
                reason = row[0]
                count = row[1] or 0
                if reason:
                    key = reason.upper()
                    if key not in reason_counts:
                        reason_counts[key] = {'display': reason, 'count': 0}
                    reason_counts[key]['count'] += count

            for row in assembly_reason_rows:
                reason = row[0]
                count = row[1] or 0
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
            model_conn2 = self._get_model_db_connection()
            model_cursor2 = model_conn2.cursor()

            # Module Line A hourly production
            model_cursor2.execute("""
                SELECT strftime('%H', ts) as hour, COUNT(*) as count
                FROM scans
                WHERE ts >= ? AND ts < ? AND kind = 'A'
                GROUP BY hour
                ORDER BY hour
            """, (start_ts, end_ts))
            module_a_hourly = [{'hour': int(row[0]), 'count': row[1]} for row in model_cursor2.fetchall()]

            # Module Line B hourly production
            model_cursor2.execute("""
                SELECT strftime('%H', ts) as hour, COUNT(*) as count
                FROM scans
                WHERE ts >= ? AND ts < ? AND kind = 'B'
                GROUP BY hour
                ORDER BY hour
            """, (start_ts, end_ts))
            module_b_hourly = [{'hour': int(row[0]), 'count': row[1]} for row in model_cursor2.fetchall()]
            model_conn2.close()

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
            assy_conn2 = self._get_assembly_db_connection()
            assy_cursor2 = assy_conn2.cursor()
            assy_cursor2.execute("""
                SELECT strftime('%H', ts) as hour, COUNT(*) as count
                FROM scans
                WHERE ts >= ? AND ts < ?
                GROUP BY hour
                ORDER BY hour
            """, (start_ts, end_ts))
            assembly_hourly = [{'hour': int(row[0]), 'count': row[1]} for row in assy_cursor2.fetchall()]
            assy_conn2.close()

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
                'date': today
            }

            logger.info(f"Daily report data collection completed: Module={module_count}, Assembly={assembly_count}, NG={total_ng}")
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
                'error': str(e)
            }

    async def collect_daily_report_data(self) -> Dict:
        """
        Async version of collect_daily_report_data

        Returns:
            Dictionary containing report data
        """
        return self._collect_report_data()

    async def get_production_risks(self) -> List[Dict]:
        """
        Get current production risks

        Returns:
            List of risks
        """
        try:
            logger.info("Production risks method called")
            return []
        except Exception as e:
            logger.error(f"Failed to get production risks: {e}", exc_info=True)
            return []
