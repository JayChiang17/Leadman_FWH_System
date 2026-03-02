"""
core/pg.py — Unified PostgreSQL connection pool.

Provides:
  - init_pool(dsn)  — create a ThreadedConnectionPool on startup
  - close_pool()    — tear down on shutdown
  - get_conn(schema) — context-manager that sets search_path, auto commit/rollback
  - get_cursor(schema) — shortcut yielding a RealDictCursor
"""
from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from typing import Generator, Optional

import psycopg2
import psycopg2.extras
from psycopg2.pool import ThreadedConnectionPool

logger = logging.getLogger(__name__)

_pool: Optional[ThreadedConnectionPool] = None


def _dsn() -> str:
    """Return DATABASE_URL from env, with a sensible local-dev default."""
    return os.getenv(
        "DATABASE_URL",
        "postgresql://leadman:leadman_dev_pw@localhost:5432/leadman",
    )


def init_pool(dsn: Optional[str] = None, minconn: int = 2, maxconn: int = 20):
    """Initialise the global connection pool.  Call once at app startup."""
    global _pool
    if _pool is not None:
        return
    dsn = dsn or _dsn()
    _pool = ThreadedConnectionPool(minconn, maxconn, dsn)
    logger.info("PG pool created  min=%d max=%d", minconn, maxconn)


def close_pool():
    """Close every connection in the pool.  Call at app shutdown."""
    global _pool
    if _pool is not None:
        _pool.closeall()
        _pool = None
        logger.info("PG pool closed")


def _get_pool() -> ThreadedConnectionPool:
    if _pool is None:
        raise RuntimeError("PostgreSQL pool not initialised — call init_pool() first")
    return _pool


@contextmanager
def get_conn(schema: Optional[str] = None) -> Generator:
    """
    Yield a psycopg2 connection with *autocommit=False*.

    If *schema* is given the session ``search_path`` is set so unqualified
    table names resolve to that schema first, then ``public``.

    On normal exit the transaction is committed; on exception it is rolled back.
    The connection is always returned to the pool.

    Usage::

        with get_conn("pcba") as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM boards LIMIT 10")
            rows = cur.fetchall()  # list[RealDictRow]
    """
    pool = _get_pool()
    conn = pool.getconn()
    try:
        conn.autocommit = False
        if schema:
            with conn.cursor() as cur:
                cur.execute("SET search_path TO %s, public", (schema,))
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)


@contextmanager
def get_cursor(schema: Optional[str] = None) -> Generator:
    """
    Convenience wrapper: yields a *RealDictCursor* inside a managed
    connection.  Rows are accessible as ``row["column"]``.

    Usage::

        with get_cursor("auth") as cur:
            cur.execute("SELECT * FROM users WHERE username = %s", (name,))
            user = cur.fetchone()
    """
    with get_conn(schema) as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            yield cur


# ── FastAPI dependency ──────────────────────────────────────

def pg_connection(schema: Optional[str] = None):
    """
    Build a FastAPI ``Depends()`` that yields a (conn, cursor) tuple.

    Example::

        def get_pcba_db():
            return pg_connection("pcba")

        @router.get("/boards")
        def list_boards(db=Depends(get_pcba_db)):
            conn, cur = db
            ...
    """
    def _dep():
        with get_conn(schema) as conn:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            try:
                yield conn, cur
            finally:
                cur.close()
    return _dep
