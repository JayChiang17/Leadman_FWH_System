"""
Email Settings Database Management — PostgreSQL (auth schema)
Handles email configuration, recipients, and send history
"""

import os
import logging
from datetime import datetime
from typing import Optional

import psycopg2.errors
from core.pg import get_conn, get_cursor

# Email tables live in the 'auth' schema (same as login.db did)
SCHEMA = "auth"
logger = logging.getLogger(__name__)


def init_email_tables():
    """
    Ensure default config / recipient rows exist.
    Table DDL is handled by init.sql.
    """
    try:
        with get_conn(SCHEMA) as conn:
            cur = conn.cursor()
            # Insert default config if table is empty
            cur.execute("SELECT COUNT(*) FROM email_config")
            if cur.fetchone()[0] == 0:
                cur.execute(
                    "INSERT INTO email_config (send_time, enabled, updated_at, updated_by) "
                    "VALUES ('18:00', true, %s, 'system')",
                    (datetime.now(),),
                )

            # Insert default recipient if table is empty
            cur.execute("SELECT COUNT(*) FROM email_recipients")
            if cur.fetchone()[0] == 0:
                default_email = os.getenv("DAILY_REPORT_EMAILS", "jay.chiang@leadman.com").split(",")[0].strip()
                cur.execute(
                    "INSERT INTO email_recipients (email, display_name, is_active, created_at, created_by) "
                    "VALUES (%s, 'Jay Chiang', true, %s, 'system')",
                    (default_email, datetime.now()),
                )
            cur.close()
        logger.info("Email database tables initialized successfully")
    except Exception as e:
        logger.error("Error initializing email tables: %s", e)
        raise


def get_email_config() -> Optional[dict]:
    """Get current email configuration"""
    with get_cursor(SCHEMA) as cur:
        cur.execute("SELECT * FROM email_config ORDER BY id DESC LIMIT 1")
        row = cur.fetchone()
        return dict(row) if row else None


def update_email_config(send_time: str, enabled: bool, updated_by: str) -> bool:
    """Update email configuration"""
    try:
        with get_conn(SCHEMA) as conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE email_config SET send_time = %s, enabled = %s, updated_at = %s, updated_by = %s "
                "WHERE id = (SELECT MAX(id) FROM email_config)",
                (send_time, enabled, datetime.now(), updated_by),
            )
            ok = cur.rowcount > 0
            cur.close()
            return ok
    except Exception as e:
        logger.error("Error updating email config: %s", e)
        return False


def get_active_recipients() -> list[dict]:
    """Get all active email recipients"""
    with get_cursor(SCHEMA) as cur:
        cur.execute(
            "SELECT * FROM email_recipients WHERE is_active = true ORDER BY created_at ASC"
        )
        return [dict(row) for row in cur.fetchall()]


def get_all_recipients(limit: int = 100, offset: int = 0) -> dict:
    """Get all email recipients with pagination"""
    with get_cursor(SCHEMA) as cur:
        cur.execute("SELECT COUNT(*) AS cnt FROM email_recipients")
        total = cur.fetchone()["cnt"]

        cur.execute(
            "SELECT * FROM email_recipients ORDER BY created_at ASC LIMIT %s OFFSET %s",
            (limit, offset),
        )
        items = [dict(row) for row in cur.fetchall()]

        return {
            "items": items,
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": (offset + len(items)) < total,
        }


def add_recipient(email: str, display_name: str, created_by: str) -> Optional[int]:
    """Add new email recipient"""
    try:
        with get_conn(SCHEMA) as conn:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO email_recipients (email, display_name, is_active, created_at, created_by) "
                "VALUES (%s, %s, true, %s, %s) RETURNING id",
                (email, display_name, datetime.now(), created_by),
            )
            new_id = cur.fetchone()[0]
            cur.close()
            return new_id
    except psycopg2.errors.UniqueViolation:
        logger.warning("Email already exists: %s", email)
        return None
    except Exception as e:
        logger.error("Error adding recipient: %s", e)
        return None


def delete_recipient(recipient_id: int) -> bool:
    """Delete email recipient"""
    try:
        with get_conn(SCHEMA) as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM email_recipients WHERE id = %s", (recipient_id,))
            ok = cur.rowcount > 0
            cur.close()
            return ok
    except Exception as e:
        logger.error("Error deleting recipient: %s", e)
        return False


def toggle_recipient(recipient_id: int, is_active: bool) -> bool:
    """Toggle recipient active status"""
    try:
        with get_conn(SCHEMA) as conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE email_recipients SET is_active = %s WHERE id = %s",
                (is_active, recipient_id),
            )
            ok = cur.rowcount > 0
            cur.close()
            return ok
    except Exception as e:
        logger.error("Error toggling recipient: %s", e)
        return False


def log_email_send(recipients: list[str], status: str, error_message: Optional[str], triggered_by: str) -> Optional[int]:
    """Log email send attempt"""
    try:
        with get_conn(SCHEMA) as conn:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO email_send_history (sent_at, recipients, status, error_message, triggered_by) "
                "VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (datetime.now(), ",".join(recipients), status, error_message, triggered_by),
            )
            new_id = cur.fetchone()[0]
            cur.close()
            return new_id
    except Exception as e:
        logger.error("Error logging email send: %s", e)
        return None


def get_email_history(limit: int = 50) -> list[dict]:
    """Get email send history"""
    with get_cursor(SCHEMA) as cur:
        cur.execute(
            "SELECT * FROM email_send_history ORDER BY sent_at DESC LIMIT %s",
            (limit,),
        )
        return [dict(row) for row in cur.fetchall()]
