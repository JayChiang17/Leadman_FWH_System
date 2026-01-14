from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

CA_TZ = ZoneInfo("America/Los_Angeles")


def ca_now() -> datetime:
    return datetime.now(CA_TZ)


def ca_today() -> date:
    return ca_now().date()


def ca_now_str() -> str:
    return ca_now().strftime("%Y-%m-%d %H:%M:%S")


def ca_day_bounds(day: date) -> tuple[str, str]:
    start = datetime(day.year, day.month, day.day, tzinfo=CA_TZ)
    end = start + timedelta(days=1)
    return start.strftime("%Y-%m-%d %H:%M:%S"), end.strftime("%Y-%m-%d %H:%M:%S")


def ca_range_bounds(start_day: date, end_day: date) -> tuple[str, str]:
    start = datetime(start_day.year, start_day.month, start_day.day, tzinfo=CA_TZ)
    end = datetime(end_day.year, end_day.month, end_day.day, tzinfo=CA_TZ) + timedelta(days=1)
    return start.strftime("%Y-%m-%d %H:%M:%S"), end.strftime("%Y-%m-%d %H:%M:%S")


def normalize_to_ca_str(ts: str) -> str:
    dt = datetime.fromisoformat(ts.strip().replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=CA_TZ)
    else:
        dt = dt.astimezone(CA_TZ)
    return dt.strftime("%Y-%m-%d %H:%M:%S")
