"""
Daily Report Service - 每日数据汇总服务
从数据库获取生产数据并生成报告
"""
from datetime import datetime, timedelta
from typing import Dict, List
from collections import Counter
import os
import logging
import json

from core.time_utils import ca_now
from core.pg import get_cursor

logger = logging.getLogger(__name__)


class DailyReportService:
    """每日报告数据汇总服务"""

    def __init__(self):
        """初始化服务"""
        pass  # No longer need DB paths - using PG pool

    def get_daily_report_data(self) -> Dict:
        """获取每日报告数据"""
        print("📊 开始生成每日报告数据...")

        ca_now_dt = ca_now()
        today_start = ca_now_dt.replace(hour=0, minute=0, second=0, microsecond=0)
        today_end = ca_now_dt.replace(hour=23, minute=59, second=59, microsecond=999999)
        month_start = ca_now_dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        module_plan   = self._get_today_plan("model",    "weekly_plan")
        assembly_plan = self._get_today_plan("assembly", "assembly_weekly_plan")
        module_production   = self._get_module_production_count(today_start, today_end)
        assembly_production = self._get_assembly_production_count(today_start, today_end)

        _dt = self._get_downtime_by_line(today_start, today_end)
        mod_a_hourly, mod_b_hourly = self._get_module_hourly_by_kind(today_start, today_end)
        asm_hourly                 = self._get_assembly_hourly(today_start, today_end)
        cell_dt_hourly, asm_dt_hourly = self._get_downtime_hourly_by_line(today_start, today_end)

        data = {
            'module_production':   module_production,
            'module_plan':         module_plan,
            'assembly_production': assembly_production,
            'assembly_plan':       assembly_plan,
            'total_ng':       self._get_total_ng_count(month_start, ca_now_dt),
            'ng_reasons':     self._get_ng_reasons_breakdown(month_start, ca_now_dt),
            # downtime — total (backwards compat) + per-line breakdown
            'downtime_hours':          _dt['total'],
            'cell_downtime_hours':     _dt['cell'],
            'assembly_downtime_hours': _dt['assembly'],
            'downtime_details':        _dt['top5'],
            'cell_downtime_top5':      _dt['cell_top5'],
            'assembly_downtime_top5':  _dt['assembly_top5'],
            # hourly data for charts (previously always empty → "No hourly data")
            'module_a_hourly':         mod_a_hourly,
            'module_b_hourly':         mod_b_hourly,
            'assembly_hourly':         asm_hourly,
            'downtime_cell_hourly':    cell_dt_hourly,
            'downtime_assembly_hourly': asm_dt_hourly,
            'module_efficiency':   round(module_production   / module_plan   * 100, 1) if module_plan   else 0.0,
            'assembly_efficiency': round(assembly_production / assembly_plan * 100, 1) if assembly_plan else 0.0,
            'report_date':    ca_now_dt.strftime('%Y-%m-%d'),
            'generated_at':   ca_now_dt.strftime('%Y-%m-%d %H:%M:%S'),
        }

        print(f"数据汇总完成！")
        print(f"   Module 生产: {data['module_production']} units")
        print(f"   Assembly 生产: {data['assembly_production']} units")
        print(f"   本月 NG: {data['total_ng']} units")
        print(f"   停机时间: {data['downtime_hours']:.1f} 小时")

        return data

    def _get_today_plan(self, schema: str, table: str) -> int:
        """讀取本週計畫中今天的目標數量（與 risk_router._today_plan 邏輯一致）"""
        try:
            ca_now_dt = ca_now()
            today   = ca_now_dt.date()
            monday  = today - timedelta(days=today.weekday())
            with get_cursor(schema) as cur:
                cur.execute(
                    f"SELECT plan_json FROM {table} WHERE week_start = %s",
                    (monday.strftime("%Y-%m-%d"),)
                )
                row = cur.fetchone()
            if not row:
                return 0
            pj   = row["plan_json"]
            plan = pj if isinstance(pj, (list, dict)) else json.loads(pj)
            idx  = today.weekday()
            return int(plan[idx]) if isinstance(plan, list) and 0 <= idx < len(plan) else 0
        except Exception as e:
            print(f"Warning  讀取 {schema}.{table} 計畫失敗: {e}")
            return 0

    def _get_module_production_count(self, start_time: datetime, end_time: datetime) -> int:
        """获取 Module 生产数量"""
        try:
            with get_cursor("model") as cur:
                cur.execute("""
                    SELECT COUNT(*) AS cnt FROM scans
                    WHERE scanned_at >= %s AND scanned_at <= %s
                    AND status != 'ng'
                """, (start_time.isoformat(), end_time.isoformat()))
                row = cur.fetchone()
                return int(row["cnt"] or 0)
        except Exception as e:
            print(f"Warning  获取 Module 生产数据失败: {e}")
            return 0

    def _get_assembly_production_count(self, start_time: datetime, end_time: datetime) -> int:
        """获取 Assembly 生产数量"""
        try:
            with get_cursor("assembly") as cur:
                cur.execute("""
                    SELECT COUNT(*) AS cnt FROM scans
                    WHERE scanned_at >= %s AND scanned_at <= %s
                    AND status != 'ng'
                """, (start_time.isoformat(), end_time.isoformat()))
                row = cur.fetchone()
                return int(row["cnt"] or 0)
        except Exception as e:
            print(f"Warning  获取 Assembly 生产数据失败: {e}")
            return 0

    def _get_total_ng_count(self, start_time: datetime, end_time: datetime) -> int:
        """获取总 NG 数量（Module + Assembly）"""
        module_ng = 0
        assembly_ng = 0

        try:
            with get_cursor("model") as cur:
                cur.execute("""
                    SELECT COUNT(*) AS cnt FROM scans
                    WHERE scanned_at >= %s AND scanned_at <= %s
                    AND status = 'ng'
                """, (start_time.isoformat(), end_time.isoformat()))
                module_ng = int(cur.fetchone()["cnt"] or 0)
        except Exception as e:
            print(f"Warning  获取 Module NG 数据失败: {e}")

        try:
            with get_cursor("assembly") as cur:
                cur.execute("""
                    SELECT COUNT(*) AS cnt FROM scans
                    WHERE scanned_at >= %s AND scanned_at <= %s
                    AND (status = 'ng' OR ng_reason IS NOT NULL)
                """, (start_time.isoformat(), end_time.isoformat()))
                assembly_ng = int(cur.fetchone()["cnt"] or 0)
        except Exception as e:
            print(f"Warning  获取 Assembly NG 数据失败: {e}")

        return module_ng + assembly_ng

    def _get_ng_reasons_breakdown(self, start_time: datetime, end_time: datetime) -> List[Dict]:
        """获取 NG 原因分布"""
        all_reasons = []

        try:
            with get_cursor("model") as cur:
                cur.execute("""
                    SELECT ng_reason FROM scans
                    WHERE scanned_at >= %s AND scanned_at <= %s
                    AND status = 'ng'
                    AND ng_reason IS NOT NULL
                """, (start_time.isoformat(), end_time.isoformat()))
                module_reasons = [row["ng_reason"] for row in cur.fetchall()]
                all_reasons.extend(module_reasons)
        except Exception as e:
            print(f"Warning  获取 Module NG 原因失败: {e}")

        try:
            with get_cursor("assembly") as cur:
                cur.execute("""
                    SELECT ng_reason FROM scans
                    WHERE scanned_at >= %s AND scanned_at <= %s
                    AND ng_reason IS NOT NULL
                """, (start_time.isoformat(), end_time.isoformat()))
                assembly_reasons = [row["ng_reason"] for row in cur.fetchall()]
                all_reasons.extend(assembly_reasons)
        except Exception as e:
            print(f"Warning  获取 Assembly NG 原因失败: {e}")

        if not all_reasons:
            return []

        normalized_reasons = [self._normalize_ng_reason(r) for r in all_reasons]
        reason_counts = Counter(normalized_reasons)
        total_count = sum(reason_counts.values())

        result = []
        for reason, count in reason_counts.most_common(10):
            result.append({
                'reason': reason,
                'count': count,
                'percentage': (count / total_count * 100) if total_count > 0 else 0
            })

        return result

    def _normalize_ng_reason(self, reason: str) -> str:
        """标准化 NG 原因（与前端一致）"""
        if not reason:
            return 'Unknown'

        normalized = reason.strip().lower()

        reason_map = {
            'scratch': 'Scratch/Damage',
            'scratches': 'Scratch/Damage',
            'damage': 'Scratch/Damage',
            'damaged': 'Scratch/Damage',
            'dent': 'Scratch/Damage',
            'dented': 'Scratch/Damage',
            'function test fail': 'Function Test Failed',
            'function fail': 'Function Test Failed',
            'test fail': 'Function Test Failed',
            'test failed': 'Function Test Failed',
            'failed test': 'Function Test Failed',
            'assembly issue': 'Assembly Issue',
            'assembly problem': 'Assembly Issue',
            'assembly error': 'Assembly Issue',
            'misassembly': 'Assembly Issue',
            'wrong assembly': 'Assembly Issue',
            'missing part': 'Missing Parts',
            'missing parts': 'Missing Parts',
            'part missing': 'Missing Parts',
            'parts missing': 'Missing Parts',
            'wrong part': 'Wrong Parts',
            'wrong parts': 'Wrong Parts',
            'incorrect part': 'Wrong Parts',
            'incorrect parts': 'Wrong Parts',
            'quality issue': 'Quality Issue',
            'quality problem': 'Quality Issue',
            'poor quality': 'Quality Issue',
            'qc fail': 'Quality Issue',
            'qc failed': 'Quality Issue',
            'short circuit': 'Short Circuit',
            'short': 'Short Circuit',
            'electrical short': 'Short Circuit',
            'leakage': 'Leakage',
            'leak': 'Leakage',
            'leaking': 'Leakage',
        }

        for key, value in reason_map.items():
            if key in normalized:
                return value

        return reason.capitalize()

    def _get_module_hourly_by_kind(self, start_time: datetime, end_time: datetime):
        """每小時 Module 產量，按 kind 分 (AM7=Module A, AU8=Module B)。回傳 (am7_list, au8_list)"""
        try:
            with get_cursor("model") as cur:
                cur.execute("""
                    SELECT EXTRACT(HOUR FROM scanned_at) AS hour,
                           kind, COUNT(*) AS cnt
                    FROM scans
                    WHERE scanned_at >= %s AND scanned_at <= %s
                      AND status != 'ng'
                    GROUP BY hour, kind
                    ORDER BY hour, kind
                """, (start_time.isoformat(), end_time.isoformat()))
                rows = cur.fetchall()
            am7, au8 = {}, {}
            for r in rows:
                h = int(r["hour"])
                k = (r["kind"] or "").upper()
                c = int(r["cnt"] or 0)
                if k == "AM7":
                    am7[h] = am7.get(h, 0) + c
                else:
                    au8[h] = au8.get(h, 0) + c
            return (
                [{'hour': h, 'count': c} for h, c in sorted(am7.items())],
                [{'hour': h, 'count': c} for h, c in sorted(au8.items())],
            )
        except Exception as e:
            print(f"Warning  获取 Module 小时数据失败: {e}")
            return [], []

    def _get_assembly_hourly(self, start_time: datetime, end_time: datetime):
        """每小時 Assembly 產量"""
        try:
            with get_cursor("assembly") as cur:
                cur.execute("""
                    SELECT EXTRACT(HOUR FROM scanned_at) AS hour,
                           COUNT(*) AS cnt
                    FROM scans
                    WHERE scanned_at >= %s AND scanned_at <= %s
                      AND status != 'ng'
                    GROUP BY hour
                    ORDER BY hour
                """, (start_time.isoformat(), end_time.isoformat()))
                rows = cur.fetchall()
            return [{'hour': int(r["hour"]), 'count': int(r["cnt"] or 0)} for r in rows]
        except Exception as e:
            print(f"Warning  获取 Assembly 小时数据失败: {e}")
            return []

    def _get_downtime_hourly_by_line(self, start_time: datetime, end_time: datetime):
        """每小時停機時間，按 line 分 (cell / assembly)。回傳 (cell_list, asm_list)"""
        try:
            with get_cursor("downtime") as cur:
                cur.execute("""
                    SELECT EXTRACT(HOUR FROM start_local) AS hour,
                           line, SUM(duration_min) AS total_min
                    FROM downtime_logs
                    WHERE start_local >= %s AND start_local <= %s
                    GROUP BY hour, line
                    ORDER BY hour, line
                """, (start_time, end_time))
                rows = cur.fetchall()
            cell, asm = {}, {}
            for r in rows:
                h = int(r["hour"])
                ln = (r["line"] or "").strip().lower()
                m  = float(r["total_min"] or 0)
                if ln == "cell":
                    cell[h] = cell.get(h, 0) + m
                elif ln == "assembly":
                    asm[h] = asm.get(h, 0) + m
            return (
                [{'hour': h, 'minutes': round(m, 1)} for h, m in sorted(cell.items())],
                [{'hour': h, 'minutes': round(m, 1)} for h, m in sorted(asm.items())],
            )
        except Exception as e:
            print(f"Warning  获取停机小时数据失败: {e}")
            return [], []

    def _get_downtime_by_line(self, start_time: datetime, end_time: datetime) -> dict:
        """获取按生产线分开的停机时间，回傳 {total, cell, assembly, top5, cell_top5, assembly_top5}"""
        empty = {'total': 0.0, 'cell': 0.0, 'assembly': 0.0,
                 'top5': [], 'cell_top5': [], 'assembly_top5': []}
        try:
            with get_cursor("downtime") as cur:
                cur.execute("""
                    SELECT line, station, start_local, end_local, duration_min
                    FROM downtime_logs
                    WHERE start_local >= %s AND start_local <= %s
                    ORDER BY duration_min DESC NULLS LAST
                """, (start_time, end_time))
                rows = cur.fetchall()

            cell_hours     = 0.0
            assembly_hours = 0.0
            all_events     = []
            cell_events    = []
            asm_events     = []

            for row in rows:
                dm = row["duration_min"]
                if dm is None:
                    s, e = row["start_local"], row["end_local"]
                    if not (s and e):
                        continue
                    if isinstance(s, datetime) and isinstance(e, datetime):
                        dm = (e - s).total_seconds() / 60
                    else:
                        dm = (datetime.fromisoformat(str(e)) - datetime.fromisoformat(str(s))).total_seconds() / 60

                dm   = round(float(dm), 1)
                line = (row["line"] or "other").strip().lower()
                evt  = {'line': line, 'station': row["station"] or "", 'duration_minutes': dm}
                all_events.append(evt)

                if line == "cell":
                    cell_hours += dm / 60
                    cell_events.append(evt)
                elif line == "assembly":
                    assembly_hours += dm / 60
                    asm_events.append(evt)

            return {
                'total':          round(cell_hours + assembly_hours, 1),
                'cell':           round(cell_hours, 1),
                'assembly':       round(assembly_hours, 1),
                'top5':           all_events[:5],
                'cell_top5':      cell_events[:5],
                'assembly_top5':  asm_events[:5],
            }

        except Exception as e:
            print(f"Warning  获取分线停机时间失败: {e}")
            return empty


# 测试函数
def test_report_service():
    """测试报告服务"""
    print("=" * 60)
    print("🧪 测试数据汇总服务")
    print("=" * 60)

    service = DailyReportService()
    report_data = service.get_daily_report_data()

    print("\n📋 报告数据：")
    print(f"   日期: {report_data['report_date']}")
    print(f"   Module 生产: {report_data['module_production']}")
    print(f"   Assembly 生产: {report_data['assembly_production']}")
    print(f"   本月 NG: {report_data['total_ng']}")
    print(f"   停机时间: {report_data['downtime_hours']} 小时")

    if report_data['ng_reasons']:
        print(f"\n   Top NG 原因:")
        for idx, reason in enumerate(report_data['ng_reasons'][:3], 1):
            print(f"      {idx}. {reason['reason']}: {reason['count']} ({reason['percentage']:.1f}%)")

    print("\n" + "=" * 60)


if __name__ == "__main__":
    test_report_service()
