"""
core/db.py ── SQLite thread-safe layer (NO full_name column, NO updated_at)
"""
from __future__ import annotations

import logging
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Generator, Dict, Any

from core.config import settings  # ← 你的設定檔

logger = logging.getLogger(__name__)

# ══════════════════════════════════════════════
# ① Database manager
# ══════════════════════════════════════════════
class DatabaseManager:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._lock = threading.Lock()
        self._initialized = False
        self._init_db()

    # ───────── schema ─────────
    def _init_db(self):
        with self._lock:
            if self._initialized:
                return
            try:
                with self.get_connection() as conn:
                    # users（不含 updated_at；保留 created_at）
                    conn.execute(
                        """
                        CREATE TABLE IF NOT EXISTS users(
                            id              INTEGER PRIMARY KEY AUTOINCREMENT,
                            username        TEXT UNIQUE NOT NULL,
                            hashed_password TEXT NOT NULL,
                            role            TEXT NOT NULL DEFAULT 'viewer',
                            is_active       INTEGER NOT NULL DEFAULT 1,
                            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        );
                        """
                    )

                    # refresh_tokens（供 refresh token 使用）
                    conn.execute(
                        """
                        CREATE TABLE IF NOT EXISTS refresh_tokens(
                            id         INTEGER PRIMARY KEY AUTOINCREMENT,
                            user_id    INTEGER NOT NULL,
                            token      TEXT UNIQUE NOT NULL,
                            expires_at TIMESTAMP NOT NULL,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                        );
                        """
                    )

                    conn.commit()
                    self._initialized = True
                    logger.info("🗄️  DB schema ready (no updated_at)")
            except Exception as e:
                logger.error(f"DB init failed: {e}")
                raise

    # ───────── connection ─────────
    @contextmanager
    def get_connection(self) -> Generator[sqlite3.Connection, None, None]:
        conn: sqlite3.Connection | None = None
        for attempt in range(3):
            try:
                conn = sqlite3.connect(
                    self.db_path,
                    timeout=30.0,
                    check_same_thread=False,
                    isolation_level=None,  # autocommit
                )
                conn.row_factory = sqlite3.Row
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute("PRAGMA foreign_keys=ON")
                yield conn
                return
            except sqlite3.OperationalError as e:
                if "locked" in str(e).lower() and attempt < 2:
                    logger.warning(f"DB locked, retrying ({attempt+1}/3)…")
                    time.sleep(0.1 * (attempt + 1))
                    continue
                raise
            finally:
                if conn:
                    conn.close()


# 全域 DB 管理器
db_manager = DatabaseManager(settings.DB_PATH)


def get_db() -> Generator[sqlite3.Connection, None, None]:
    """FastAPI dependency"""
    with db_manager.get_connection() as conn:
        yield conn

# ══════════════════════════════════════════════
# ② User CRUD (no updated_at)
# ══════════════════════════════════════════════
def list_users(db: sqlite3.Connection):
    return db.execute("SELECT * FROM users ORDER BY username").fetchall()


def get_user_by_username(db: sqlite3.Connection, username: str):
    return db.execute(
        "SELECT * FROM users WHERE username = ? LIMIT 1", (username,)
    ).fetchone()


def get_user_by_id(db: sqlite3.Connection, uid: int):
    return db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()


def create_user(db: sqlite3.Connection, username: str, hashed_pw: str, role: str):
    cur = db.execute(
        "INSERT INTO users(username, hashed_password, role) VALUES(?,?,?)",
        (username, hashed_pw, role),
    )
    db.commit()
    return get_user_by_id(db, cur.lastrowid)


def update_user(
    db: sqlite3.Connection,
    uid: int,
    *,
    username: str | None = None,
    hashed_pw: str | None = None,
    role: str | None = None,
    is_active: int | None = None,
):
    sets, params = [], []
    if username is not None:
        sets.append("username = ?")
        params.append(username)
    if hashed_pw is not None:
        sets.append("hashed_password = ?")
        params.append(hashed_pw)
    if role is not None:
        sets.append("role = ?")
        params.append(role)
    if is_active is not None:
        sets.append("is_active = ?")
        params.append(int(bool(is_active)))

    if not sets:
        return get_user_by_id(db, uid)

    # 不再更新 updated_at
    params.append(uid)
    db.execute(f"UPDATE users SET {', '.join(sets)} WHERE id = ?", params)
    db.commit()
    return get_user_by_id(db, uid)


def delete_user(db: sqlite3.Connection, uid: int) -> bool:
    cur = db.execute("DELETE FROM users WHERE id = ?", (uid,))
    db.commit()
    return cur.rowcount > 0

# ══════════════════════════════════════════════
# ③ Refresh-token helpers（不變）
# ══════════════════════════════════════════════
def save_refresh_token(db, user_id, token, expires_days):
    exp = datetime.utcnow() + timedelta(days=expires_days)
    db.execute(
        "INSERT INTO refresh_tokens(user_id, token, expires_at) VALUES(?,?,?)",
        (user_id, token, exp),
    )
    db.commit()


def get_refresh_token(db, token):
    return db.execute(
        "SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > ?",
        (token, datetime.utcnow()),
    ).fetchone()


def delete_refresh_token(db, token):
    db.execute("DELETE FROM refresh_tokens WHERE token = ?", (token,))
    db.commit()


def delete_user_refresh_tokens(db, user_id):
    db.execute("DELETE FROM refresh_tokens WHERE user_id = ?", (user_id,))
    db.commit()

# ══════════════════════════════════════════════
# ④ Utilities / maintenance
# ══════════════════════════════════════════════
def row_to_dict(row: sqlite3.Row) -> Dict[str, Any] | None:
    return dict(row) if row else None


def execute_with_retry(
    db: sqlite3.Connection, query: str, params: tuple = (), max_retries: int = 3
):
    for attempt in range(max_retries):
        try:
            return db.execute(query, params)
        except sqlite3.OperationalError as e:
            if "locked" in str(e).lower() and attempt < max_retries - 1:
                time.sleep(0.1 * (attempt + 1))
                continue
            raise


def check_database_health() -> bool:
    try:
        with db_manager.get_connection() as db:
            db.execute("SELECT 1").fetchone()
        return True
    except Exception as e:
        logger.error(f"DB health check failed: {e}")
        return False


def optimize_database():
    try:
        with db_manager.get_connection() as db:
            db.execute("VACUUM")
            db.execute("ANALYZE")
        logger.info("DB optimized")
    except Exception as e:
        logger.error(f"DB optimize failed: {e}")


def get_database_info() -> Dict[str, Any]:
    try:
        with db_manager.get_connection() as db:
            tbl = db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
            return {
                "tables": [t["name"] for t in tbl],
                "user_count": db.execute("SELECT COUNT(*) FROM users").fetchone()[0],
                "token_count": db.execute("SELECT COUNT(*) FROM refresh_tokens").fetchone()[0],
            }
    except Exception as e:
        logger.error(f"Get DB info failed: {e}")
        return {}
