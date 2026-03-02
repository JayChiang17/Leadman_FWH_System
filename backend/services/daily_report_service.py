"""
Daily Report Service - 每日数据汇总服务
从数据库获取生产数据并生成报告
"""
from datetime import datetime, timedelta
from typing import Dict, List
from collections import Counter
import os
import logging

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

        data = {
            'module_production': self._get_module_production_count(today_start, today_end),
            'assembly_production': self._get_assembly_production_count(today_start, today_end),
            'total_ng': self._get_total_ng_count(month_start, ca_now_dt),
            'ng_reasons': self._get_ng_reasons_breakdown(month_start, ca_now_dt),
            'downtime_hours': self._get_downtime_hours(today_start, today_end),
            'module_efficiency': 95.0,
            'assembly_efficiency': 92.0,
            'report_date': ca_now_dt.strftime('%Y-%m-%d'),
            'generated_at': ca_now_dt.strftime('%Y-%m-%d %H:%M:%S')
        }

        print(f"数据汇总完成！")
        print(f"   Module 生产: {data['module_production']} units")
        print(f"   Assembly 生产: {data['assembly_production']} units")
        print(f"   本月 NG: {data['total_ng']} units")
        print(f"   停机时间: {data['downtime_hours']:.1f} 小时")

        return data

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

    def _get_downtime_hours(self, start_time: datetime, end_time: datetime) -> float:
        """获取停机时间（小时）"""
        try:
            with get_cursor("downtime") as cur:
                cur.execute("""
                    SELECT start_local, end_local FROM downtime_logs
                    WHERE start_local >= %s AND start_local <= %s
                """, (start_time, end_time))
                rows = cur.fetchall()

            total_hours = 0
            for row in rows:
                start = row["start_local"]
                end = row["end_local"]
                if start and end:
                    if isinstance(start, datetime) and isinstance(end, datetime):
                        duration = (end - start).total_seconds() / 3600
                    else:
                        start_dt = datetime.fromisoformat(str(start))
                        end_dt = datetime.fromisoformat(str(end))
                        duration = (end_dt - start_dt).total_seconds() / 3600
                    total_hours += duration

            return round(total_hours, 1)

        except Exception as e:
            print(f"Warning  获取停机时间失败: {e}")
            return 0.0


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
