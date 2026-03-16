"""
core/db.py ── PostgreSQL layer for auth schema (users, tokens, audit)
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Generator

# Sentinel: distinguishes "caller didn't pass allowed_pages" from "caller passed None (→ clear)"
_UNSET = object()

from core.pg import get_conn, get_cursor

logger = logging.getLogger(__name__)

SCHEMA = "auth"


def _ensure_schema():
    """Make sure the auth tables exist (init.sql handles this normally)."""
    pass  # Tables created by init.sql at container startup


# ── FastAPI dependency ─────────────────────────────────────

def get_db() -> Generator:
    """FastAPI dependency — yields (conn, cursor) for the auth schema."""
    with get_conn(SCHEMA) as conn:
        import psycopg2.extras
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            yield conn, cur
        finally:
            cur.close()


# ══════════════════════════════════════════════
# ② User CRUD
# ══════════════════════════════════════════════
def list_users(db):
    conn, cur = db
    cur.execute("SELECT * FROM users ORDER BY username")
    return cur.fetchall()


def get_user_by_username(db, username: str):
    conn, cur = db
    cur.execute("SELECT * FROM users WHERE username = %s LIMIT 1", (username,))
    return cur.fetchone()


def get_user_by_id(db, uid: int):
    conn, cur = db
    cur.execute("SELECT * FROM users WHERE id = %s", (uid,))
    return cur.fetchone()


def create_user(db, username: str, hashed_pw: str, role: str):
    conn, cur = db
    cur.execute(
        "INSERT INTO users(username, hashed_password, role) VALUES(%s,%s,%s) RETURNING id",
        (username, hashed_pw, role),
    )
    new_id = cur.fetchone()["id"]
    conn.commit()
    cur.execute("SELECT * FROM users WHERE id = %s", (new_id,))
    return cur.fetchone()


def update_user(
    db,
    uid: int,
    *,
    username: str | None = None,
    hashed_pw: str | None = None,
    role: str | None = None,
    is_active: int | None = None,
    allowed_pages=_UNSET,  # _UNSET=no change, None=set to NULL, list=set to those pages
):
    conn, cur = db
    sets, params = [], []
    if username is not None:
        sets.append("username = %s")
        params.append(username)
    if hashed_pw is not None:
        sets.append("hashed_password = %s")
        params.append(hashed_pw)
    if role is not None:
        sets.append("role = %s")
        params.append(role)
    if is_active is not None:
        sets.append("is_active = %s")
        params.append(bool(is_active))
    if allowed_pages is not _UNSET:
        sets.append("allowed_pages = %s")
        params.append(allowed_pages)  # None → NULL, [] → {}, [...] → array

    if not sets:
        cur.execute("SELECT * FROM users WHERE id = %s", (uid,))
        return cur.fetchone()

    params.append(uid)
    cur.execute(f"UPDATE users SET {', '.join(sets)} WHERE id = %s", params)
    conn.commit()
    cur.execute("SELECT * FROM users WHERE id = %s", (uid,))
    return cur.fetchone()


def delete_user(db, uid: int) -> bool:
    conn, cur = db
    cur.execute("DELETE FROM users WHERE id = %s", (uid,))
    conn.commit()
    return cur.rowcount > 0


# ══════════════════════════════════════════════
# ③ Refresh-token helpers
# ══════════════════════════════════════════════
def save_refresh_token(db, user_id, token, expires_days):
    conn, cur = db
    exp = datetime.now(timezone.utc) + timedelta(days=expires_days)
    cur.execute(
        "INSERT INTO refresh_tokens(user_id, token, expires_at) VALUES(%s,%s,%s)",
        (user_id, token, exp),
    )
    conn.commit()


def get_refresh_token(db, token):
    conn, cur = db
    cur.execute(
        "SELECT * FROM refresh_tokens WHERE token = %s AND expires_at > %s",
        (token, datetime.now(timezone.utc)),
    )
    return cur.fetchone()


def delete_refresh_token(db, token):
    conn, cur = db
    cur.execute("DELETE FROM refresh_tokens WHERE token = %s", (token,))
    conn.commit()


def delete_user_refresh_tokens(db, user_id):
    conn, cur = db
    cur.execute("DELETE FROM refresh_tokens WHERE user_id = %s", (user_id,))
    conn.commit()


# ══════════════════════════════════════════════
# ④ Utilities / maintenance
# ══════════════════════════════════════════════
def row_to_dict(row) -> dict[str, Any] | None:
    return dict(row) if row else None


def check_database_health() -> bool:
    try:
        with get_cursor(SCHEMA) as cur:
            cur.execute("SELECT 1")
        return True
    except Exception as e:
        logger.error(f"DB health check failed: {e}")
        return False


def optimize_database():
    """Run ANALYZE on auth schema tables."""
    try:
        with get_conn(SCHEMA) as conn:
            conn.autocommit = True
            cur = conn.cursor()
            for table in ("users", "refresh_tokens", "login_audit_logs"):
                cur.execute(f"ANALYZE {table}")
            cur.close()
        logger.info("DB optimized (ANALYZE)")
    except Exception as e:
        logger.error(f"DB optimize failed: {e}")


def get_database_info() -> dict[str, Any]:
    try:
        with get_cursor(SCHEMA) as cur:
            cur.execute(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'auth' AND table_type = 'BASE TABLE'"
            )
            tables = [r["table_name"] for r in cur.fetchall()]
            cur.execute("SELECT COUNT(*) AS cnt FROM users")
            user_count = cur.fetchone()["cnt"]
            cur.execute("SELECT COUNT(*) AS cnt FROM refresh_tokens")
            token_count = cur.fetchone()["cnt"]
            return {
                "tables": tables,
                "user_count": user_count,
                "token_count": token_count,
            }
    except Exception as e:
        logger.error(f"Get DB info failed: {e}")
        return {}


# ══════════════════════════════════════════════
# ⑤ Login Audit Logs
# ══════════════════════════════════════════════
def log_login_attempt(
    db,
    username: str,
    ip_address: str | None = None,
    user_agent: str | None = None,
    success: bool = False,
    failure_reason: str | None = None,
):
    """Record a login attempt (success or failure)."""
    conn, cur = db
    cur.execute(
        """
        INSERT INTO login_audit_logs(username, ip_address, user_agent, success, failure_reason)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (username, ip_address, user_agent, success, failure_reason),
    )
    conn.commit()
    logger.info(
        "Login audit: %s from %s - %s",
        username,
        ip_address,
        "SUCCESS" if success else f"FAILED: {failure_reason or 'unknown'}",
    )


def get_login_audit_logs(
    db,
    username: str | None = None,
    limit: int = 100,
    offset: int = 0,
):
    """Query login audit logs with optional username filter."""
    conn, cur = db
    if username:
        cur.execute(
            """
            SELECT * FROM login_audit_logs
            WHERE username = %s
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s
            """,
            (username, limit, offset),
        )
    else:
        cur.execute(
            """
            SELECT * FROM login_audit_logs
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s
            """,
            (limit, offset),
        )
    return cur.fetchall()


def get_recent_failed_attempts(
    db,
    username: str,
    minutes: int = 15,
) -> int:
    """Count failed login attempts within the last N minutes."""
    conn, cur = db
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    cur.execute(
        """
        SELECT COUNT(*) AS cnt FROM login_audit_logs
        WHERE username = %s AND success = 0 AND created_at > %s
        """,
        (username, cutoff),
    )
    result = cur.fetchone()
    return result["cnt"] if result else 0
