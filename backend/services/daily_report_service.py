"""
Daily Report Service - 每日数据汇总服务
从数据库获取生产数据并生成报告
"""
import sqlite3
from datetime import datetime, timedelta
from typing import Dict, List
from collections import Counter
import os

from core.time_utils import ca_now


class DailyReportService:
    """每日报告数据汇总服务"""

    def __init__(self):
        """初始化服务"""
        # 数据库路径
        self.model_db = os.path.join(os.path.dirname(__file__), '..', 'model.db')
        self.assembly_db = os.path.join(os.path.dirname(__file__), '..', 'assembly.db')
        self.downtime_db = os.path.join(os.path.dirname(__file__), '..', 'downtime.db')

    def get_daily_report_data(self) -> Dict:
        """
        获取每日报告数据

        Returns:
            dict: 包含所有报告数据的字典
        """
        print("📊 开始生成每日报告数据...")

        # 获取今天的日期范围（加州时间）
        ca_now_dt = ca_now()  # 简化版本，实际应该用加州时区
        today_start = ca_now_dt.replace(hour=0, minute=0, second=0, microsecond=0)
        today_end = ca_now_dt.replace(hour=23, minute=59, second=59, microsecond=999999)

        # 获取本月的日期范围
        month_start = ca_now_dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        # 收集数据
        data = {
            # 今日生产数量
            'module_production': self._get_module_production_count(today_start, today_end),
            'assembly_production': self._get_assembly_production_count(today_start, today_end),

            # 本月 NG 统计
            'total_ng': self._get_total_ng_count(month_start, ca_now_dt),
            'ng_reasons': self._get_ng_reasons_breakdown(month_start, ca_now_dt),

            # 停机时间
            'downtime_hours': self._get_downtime_hours(today_start, today_end),

            # 效率（简化计算）
            'module_efficiency': 95.0,  # 可以根据实际数据计算
            'assembly_efficiency': 92.0,

            # 时间信息
            'report_date': ca_now_dt.strftime('%Y-%m-%d'),
            'generated_at': ca_now_dt.strftime('%Y-%m-%d %H:%M:%S')
        }

        print(f"✅ 数据汇总完成！")
        print(f"   Module 生产: {data['module_production']} units")
        print(f"   Assembly 生产: {data['assembly_production']} units")
        print(f"   本月 NG: {data['total_ng']} units")
        print(f"   停机时间: {data['downtime_hours']:.1f} 小时")

        return data

    def _get_module_production_count(self, start_time: datetime, end_time: datetime) -> int:
        """获取 Module 生产数量"""
        try:
            conn = sqlite3.connect(self.model_db)
            cursor = conn.cursor()

            # 查询在时间范围内创建的 Module 记录
            cursor.execute("""
                SELECT COUNT(*) FROM model_inventory
                WHERE timestamp >= ? AND timestamp <= ?
                AND status != 'ng'
            """, (start_time.isoformat(), end_time.isoformat()))

            count = cursor.fetchone()[0]
            conn.close()
            return count

        except Exception as e:
            print(f"⚠️  获取 Module 生产数据失败: {e}")
            return 0

    def _get_assembly_production_count(self, start_time: datetime, end_time: datetime) -> int:
        """获取 Assembly 生产数量"""
        try:
            conn = sqlite3.connect(self.assembly_db)
            cursor = conn.cursor()

            # 查询在时间范围内创建的 Assembly 记录
            cursor.execute("""
                SELECT COUNT(*) FROM assembly_inventory
                WHERE timestamp >= ? AND timestamp <= ?
                AND status != 'ng'
            """, (start_time.isoformat(), end_time.isoformat()))

            count = cursor.fetchone()[0]
            conn.close()
            return count

        except Exception as e:
            print(f"⚠️  获取 Assembly 生产数据失败: {e}")
            return 0

    def _get_total_ng_count(self, start_time: datetime, end_time: datetime) -> int:
        """获取总 NG 数量（Module + Assembly）"""
        module_ng = 0
        assembly_ng = 0

        # Module NG
        try:
            conn = sqlite3.connect(self.model_db)
            cursor = conn.cursor()
            cursor.execute("""
                SELECT COUNT(*) FROM model_inventory
                WHERE timestamp >= ? AND timestamp <= ?
                AND status = 'ng'
            """, (start_time.isoformat(), end_time.isoformat()))
            module_ng = cursor.fetchone()[0]
            conn.close()
        except Exception as e:
            print(f"⚠️  获取 Module NG 数据失败: {e}")

        # Assembly NG
        try:
            conn = sqlite3.connect(self.assembly_db)
            cursor = conn.cursor()
            cursor.execute("""
                SELECT COUNT(*) FROM assembly_inventory
                WHERE timestamp >= ? AND timestamp <= ?
                AND (status = 'ng' OR ng_reason IS NOT NULL)
            """, (start_time.isoformat(), end_time.isoformat()))
            assembly_ng = cursor.fetchone()[0]
            conn.close()
        except Exception as e:
            print(f"⚠️  获取 Assembly NG 数据失败: {e}")

        return module_ng + assembly_ng

    def _get_ng_reasons_breakdown(self, start_time: datetime, end_time: datetime) -> List[Dict]:
        """获取 NG 原因分布"""
        all_reasons = []

        # 获取 Module NG 原因
        try:
            conn = sqlite3.connect(self.model_db)
            cursor = conn.cursor()
            cursor.execute("""
                SELECT ng_reason FROM model_inventory
                WHERE timestamp >= ? AND timestamp <= ?
                AND status = 'ng'
                AND ng_reason IS NOT NULL
            """, (start_time.isoformat(), end_time.isoformat()))
            module_reasons = [row[0] for row in cursor.fetchall()]
            all_reasons.extend(module_reasons)
            conn.close()
        except Exception as e:
            print(f"⚠️  获取 Module NG 原因失败: {e}")

        # 获取 Assembly NG 原因
        try:
            conn = sqlite3.connect(self.assembly_db)
            cursor = conn.cursor()
            cursor.execute("""
                SELECT ng_reason FROM assembly_inventory
                WHERE timestamp >= ? AND timestamp <= ?
                AND ng_reason IS NOT NULL
            """, (start_time.isoformat(), end_time.isoformat()))
            assembly_reasons = [row[0] for row in cursor.fetchall()]
            all_reasons.extend(assembly_reasons)
            conn.close()
        except Exception as e:
            print(f"⚠️  获取 Assembly NG 原因失败: {e}")

        # 统计原因分布
        if not all_reasons:
            return []

        # 标准化原因并统计
        normalized_reasons = [self._normalize_ng_reason(r) for r in all_reasons]
        reason_counts = Counter(normalized_reasons)
        total_count = sum(reason_counts.values())

        # 转换为列表并排序
        result = []
        for reason, count in reason_counts.most_common(10):  # Top 10
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

        # 原因映射规则（与前端 NGDashboard.js 一致）
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

        # 查找映射
        for key, value in reason_map.items():
            if key in normalized:
                return value

        # 如果没有匹配，首字母大写返回
        return reason.capitalize()

    def _get_downtime_hours(self, start_time: datetime, end_time: datetime) -> float:
        """获取停机时间（小时）"""
        try:
            conn = sqlite3.connect(self.downtime_db)
            cursor = conn.cursor()

            # 查询停机记录
            cursor.execute("""
                SELECT start_time, end_time FROM downtime
                WHERE start_time >= ? AND start_time <= ?
            """, (start_time.isoformat(), end_time.isoformat()))

            rows = cursor.fetchall()
            conn.close()

            total_hours = 0
            for start, end in rows:
                if start and end:
                    start_dt = datetime.fromisoformat(start)
                    end_dt = datetime.fromisoformat(end)
                    duration = (end_dt - start_dt).total_seconds() / 3600  # 转换为小时
                    total_hours += duration

            return round(total_hours, 1)

        except Exception as e:
            print(f"⚠️  获取停机时间失败: {e}")
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
