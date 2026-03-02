"""
core/downtime_db.py
──────────────────────────────────────────────
Downtime DB — now backed by PostgreSQL schema 'downtime'.
Tables and indexes created by init.sql.
"""
from typing import Generator

import psycopg2.extras
from core.pg import get_conn

SCHEMA = "downtime"


def get_downtime_db() -> Generator:
    """
    FastAPI dependency — yields (conn, cursor) for the downtime schema.

    Usage:
        def some_api(db=Depends(get_downtime_db)):
            conn, cur = db
            ...
    """
    with get_conn(SCHEMA) as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            yield conn, cur
        finally:
            cur.close()
