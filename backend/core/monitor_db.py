# core/monitor_db.py — Monitor database (api_logs, audit_logs, frontend_errors)
# Uses a background thread + queue for non-blocking writes via PostgreSQL.

import logging
import threading
import queue
from datetime import datetime, timezone, timedelta

from core.pg import get_conn

logger = logging.getLogger(__name__)

SCHEMA = "monitor"

_lock = threading.Lock()
_initialized = False

# ── Background write queue ──
_write_queue: queue.Queue = queue.Queue()
_writer_thread: threading.Thread | None = None
_writer_stop = threading.Event()


def _writer_loop():
    """Background thread: batch-flush queued writes every 2 seconds or 50 items."""
    batch: list[tuple[str, tuple]] = []

    while not _writer_stop.is_set():
        # Drain queue (block up to 2s)
        try:
            item = _write_queue.get(timeout=2.0)
            batch.append(item)
        except queue.Empty:
            pass

        # Drain remaining without blocking
        while True:
            try:
                batch.append(_write_queue.get_nowait())
            except queue.Empty:
                break

        if batch:
            try:
                with get_conn(SCHEMA) as conn:
                    cur = conn.cursor()
                    for sql, params in batch:
                        cur.execute(sql, params)
                    cur.close()
            except Exception as e:
                logger.warning("Monitor batch write failed (%d items): %s", len(batch), e)
            batch.clear()

    # Final flush on shutdown
    while not _write_queue.empty():
        try:
            batch.append(_write_queue.get_nowait())
        except queue.Empty:
            break
    if batch:
        try:
            with get_conn(SCHEMA) as conn:
                cur = conn.cursor()
                for sql, params in batch:
                    cur.execute(sql, params)
                cur.close()
        except Exception:
            pass


def _ensure_writer():
    global _writer_thread
    if _writer_thread is None or not _writer_thread.is_alive():
        _writer_stop.clear()
        _writer_thread = threading.Thread(target=_writer_loop, daemon=True, name="monitor-writer")
        _writer_thread.start()


def init_monitor_db():
    global _initialized
    with _lock:
        if _initialized:
            return
        # Tables created by init.sql; just start the writer thread
        _initialized = True
        logger.info("monitor_db initialized (PostgreSQL schema=%s)", SCHEMA)
        _ensure_writer()


def log_api_request(method: str, path: str, status_code: int, duration_ms: float,
                    user: str | None = None, ip: str | None = None):
    _write_queue.put((
        'INSERT INTO api_logs (occurred_at, method, path, status_code, duration_ms, username, ip) VALUES (%s,%s,%s,%s,%s,%s,%s)',
        (datetime.now(timezone.utc), method, path, status_code, round(duration_ms, 2), user, ip)
    ))


def log_audit(user: str, action: str, target: str | None = None,
              old_value: str | None = None, new_value: str | None = None,
              ip: str | None = None):
    _write_queue.put((
        'INSERT INTO audit_logs (occurred_at, username, action, target, old_value, new_value, ip) VALUES (%s,%s,%s,%s,%s,%s,%s)',
        (datetime.now(timezone.utc), user, action, target, old_value, new_value, ip)
    ))


def log_frontend_error(error_message: str, component: str | None = None,
                       stack: str | None = None, user: str | None = None,
                       url: str | None = None):
    _write_queue.put((
        'INSERT INTO frontend_errors (occurred_at, component, error_message, stack, username, url) VALUES (%s,%s,%s,%s,%s,%s)',
        (datetime.now(timezone.utc), component, error_message, stack, user, url)
    ))


_MONITOR_TABLES = frozenset({"api_logs", "audit_logs", "frontend_errors"})


def cleanup_old_logs(days: int = 30):
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    try:
        with get_conn(SCHEMA) as conn:
            cur = conn.cursor()
            for table in _MONITOR_TABLES:
                cur.execute(f"DELETE FROM {table} WHERE occurred_at < %s", (cutoff,))
            cur.close()
        logger.info("Cleaned up monitor logs older than %d days", days)
    except Exception as e:
        logger.warning("Failed to cleanup old logs: %s", e)


def get_monitor_conn():
    """Context manager for read queries against monitor schema."""
    return get_conn(SCHEMA)
