"""
Email Settings Database Management
Handles email configuration, recipients, and send history
"""

import sqlite3
import os
from datetime import datetime
from typing import Optional

# Database path
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "login.db")


def init_email_tables():
    """
    Initialize email-related tables in login.db
    Creates: email_config, email_recipients, email_send_history
    """
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        # Table 1: Email Configuration
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS email_config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                send_time TEXT NOT NULL DEFAULT '18:00',
                enabled INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL,
                updated_by TEXT NOT NULL
            )
        """)

        # Insert default config if table is empty
        cursor.execute("SELECT COUNT(*) FROM email_config")
        if cursor.fetchone()[0] == 0:
            cursor.execute("""
                INSERT INTO email_config (send_time, enabled, updated_at, updated_by)
                VALUES ('18:00', 1, ?, 'system')
            """, (datetime.now().isoformat(),))

        # Table 2: Email Recipients
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS email_recipients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                display_name TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                created_by TEXT NOT NULL
            )
        """)

        # Insert default recipient if table is empty
        cursor.execute("SELECT COUNT(*) FROM email_recipients")
        if cursor.fetchone()[0] == 0:
            default_email = os.getenv("DAILY_REPORT_EMAILS", "jay.chiang@leadman.com").split(",")[0].strip()
            cursor.execute("""
                INSERT INTO email_recipients (email, display_name, is_active, created_at, created_by)
                VALUES (?, 'Jay Chiang', 1, ?, 'system')
            """, (default_email, datetime.now().isoformat()))

        # Table 3: Email Send History
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS email_send_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sent_at TEXT NOT NULL,
                recipients TEXT NOT NULL,
                status TEXT NOT NULL,
                error_message TEXT,
                triggered_by TEXT NOT NULL
            )
        """)

        conn.commit()
        print("[SUCCESS] Email database tables initialized successfully")

    except Exception as e:
        conn.rollback()
        print(f"[ERROR] Error initializing email tables: {e}")
        raise
    finally:
        conn.close()


def get_email_config() -> Optional[dict]:
    """Get current email configuration"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    try:
        cursor.execute("SELECT * FROM email_config ORDER BY id DESC LIMIT 1")
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def update_email_config(send_time: str, enabled: bool, updated_by: str) -> bool:
    """Update email configuration"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        cursor.execute("""
            UPDATE email_config
            SET send_time = ?, enabled = ?, updated_at = ?, updated_by = ?
            WHERE id = (SELECT MAX(id) FROM email_config)
        """, (send_time, 1 if enabled else 0, datetime.now().isoformat(), updated_by))

        conn.commit()
        return cursor.rowcount > 0
    except Exception as e:
        conn.rollback()
        print(f"Error updating email config: {e}")
        return False
    finally:
        conn.close()


def get_active_recipients() -> list[dict]:
    """Get all active email recipients"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    try:
        cursor.execute("""
            SELECT * FROM email_recipients
            WHERE is_active = 1
            ORDER BY created_at ASC
        """)
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()


def get_all_recipients(limit: int = 100, offset: int = 0) -> dict:
    """
    Get all email recipients (active and inactive) with pagination

    Args:
        limit: Maximum number of records to return (default: 100)
        offset: Number of records to skip (default: 0)

    Returns:
        Dictionary with 'items', 'total', 'limit', and 'offset'
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    try:
        # Get total count
        cursor.execute("SELECT COUNT(*) FROM email_recipients")
        total = cursor.fetchone()[0]

        # Get paginated results
        cursor.execute("""
            SELECT * FROM email_recipients
            ORDER BY created_at ASC
            LIMIT ? OFFSET ?
        """, (limit, offset))
        items = [dict(row) for row in cursor.fetchall()]

        return {
            "items": items,
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": (offset + len(items)) < total
        }
    finally:
        conn.close()


def add_recipient(email: str, display_name: str, created_by: str) -> Optional[int]:
    """Add new email recipient"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        cursor.execute("""
            INSERT INTO email_recipients (email, display_name, is_active, created_at, created_by)
            VALUES (?, ?, 1, ?, ?)
        """, (email, display_name, datetime.now().isoformat(), created_by))

        conn.commit()
        return cursor.lastrowid
    except sqlite3.IntegrityError:
        print(f"Email {email} already exists")
        return None
    except Exception as e:
        conn.rollback()
        print(f"Error adding recipient: {e}")
        return None
    finally:
        conn.close()


def delete_recipient(recipient_id: int) -> bool:
    """Delete email recipient"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        cursor.execute("DELETE FROM email_recipients WHERE id = ?", (recipient_id,))
        conn.commit()
        return cursor.rowcount > 0
    except Exception as e:
        conn.rollback()
        print(f"Error deleting recipient: {e}")
        return False
    finally:
        conn.close()


def toggle_recipient(recipient_id: int, is_active: bool) -> bool:
    """Toggle recipient active status"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        cursor.execute("""
            UPDATE email_recipients
            SET is_active = ?
            WHERE id = ?
        """, (1 if is_active else 0, recipient_id))

        conn.commit()
        return cursor.rowcount > 0
    except Exception as e:
        conn.rollback()
        print(f"Error toggling recipient: {e}")
        return False
    finally:
        conn.close()


def log_email_send(recipients: list[str], status: str, error_message: Optional[str], triggered_by: str) -> Optional[int]:
    """Log email send attempt"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        cursor.execute("""
            INSERT INTO email_send_history (sent_at, recipients, status, error_message, triggered_by)
            VALUES (?, ?, ?, ?, ?)
        """, (
            datetime.now().isoformat(),
            ",".join(recipients),
            status,
            error_message,
            triggered_by
        ))

        conn.commit()
        return cursor.lastrowid
    except Exception as e:
        conn.rollback()
        print(f"Error logging email send: {e}")
        return None
    finally:
        conn.close()


def get_email_history(limit: int = 50) -> list[dict]:
    """Get email send history"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    try:
        cursor.execute("""
            SELECT * FROM email_send_history
            ORDER BY sent_at DESC
            LIMIT ?
        """, (limit,))
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()


# Initialize tables on module import
if __name__ == "__main__":
    init_email_tables()
