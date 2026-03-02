"""
migrate_sqlite_to_pg.py -- One-time data migration from SQLite -> PostgreSQL.

Usage:
    # Ensure PostgreSQL is running (docker compose up -d postgres)
    cd backend
    python -m migrations.migrate_sqlite_to_pg

    # Or inside Docker:
    docker compose run --rm backend python -m migrations.migrate_sqlite_to_pg

What it does:
    1. Reads every row from each SQLite database
    2. Batch-inserts into the matching PostgreSQL schema/table
    3. Resets SERIAL sequences to max(id) + 1
    4. Skips FTS5 virtual tables (PG trigger auto-populates tsvector)
"""

import os
import sys
import sqlite3
from pathlib import Path

import psycopg2
import psycopg2.extras

# ---------------------------------------------------------------------------
# Paths -- check both backend/data/ and backend/ root for .db files
# ---------------------------------------------------------------------------
BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR    = BACKEND_DIR / "data"

# schema -> sqlite filename (without directory)
_DB_MAP = {
    "pcba":      "pcba.db",
    "assembly":  "assembly.db",
    "model":     "model.db",
    "auth":      "login.db",
    "downtime":  "downtime.db",
    "documents": "documents.db",
    "monitor":   "monitor.db",
    "qc":        "qc_v2.db",
}

def _collect_sqlite_sources() -> dict[str, list[Path]]:
    """Return {schema: [path, ...]} for all SQLite sources found in both dirs.

    backend/data/ is searched first, then backend/ root.  Duplicates are fine
    because the INSERT uses ON CONFLICT DO NOTHING.
    """
    result: dict[str, list[Path]] = {}
    for schema, filename in _DB_MAP.items():
        paths = []
        for directory in (DATA_DIR, BACKEND_DIR):
            candidate = directory / filename
            if candidate.exists():
                paths.append(candidate)
        if paths:
            result[schema] = paths
    return result

# Tables to skip (FTS5 virtual tables and their shadow tables)
SKIP_PREFIXES = (
    "chunks_fts",       # FTS5 virtual table + shadow tables
    "sqlite_",          # internal SQLite tables
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
DSN = os.getenv(
    "DATABASE_URL",
    "postgresql://leadman:leadman_dev_pw@localhost:5432/leadman",
)


def get_sqlite_tables(db_path: Path) -> list[str]:
    """Return list of real tables in a SQLite database (skip FTS5 / internal)."""
    conn = sqlite3.connect(str(db_path))
    cur = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    tables = []
    for (name,) in cur.fetchall():
        if any(name.startswith(p) for p in SKIP_PREFIXES):
            continue
        tables.append(name)
    conn.close()
    return tables


def get_sqlite_rows(db_path: Path, table: str) -> tuple[list[str], list[tuple]]:
    """Return (column_names, rows) from a SQLite table."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.execute(f"SELECT * FROM [{table}]")
    rows = cur.fetchall()
    if not rows:
        conn.close()
        return [], []
    columns = list(rows[0].keys())
    data = [tuple(row) for row in rows]
    conn.close()
    return columns, data


def pg_table_exists(pg_cur, schema: str, table: str) -> bool:
    """Check if a table exists in the PostgreSQL schema."""
    pg_cur.execute(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = %s AND table_name = %s",
        (schema, table),
    )
    return pg_cur.fetchone() is not None


def pg_get_columns(pg_cur, schema: str, table: str) -> list[str]:
    """Return column names for a PG table."""
    pg_cur.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = %s AND table_name = %s "
        "ORDER BY ordinal_position",
        (schema, table),
    )
    return [row[0] for row in pg_cur.fetchall()]


def migrate_table(
    pg_conn,
    schema: str,
    table: str,
    columns: list[str],
    rows: list[tuple],
):
    """Insert rows into PG, skipping columns that don't exist in PG schema."""
    pg_cur = pg_conn.cursor()

    # Get PG columns to filter out any SQLite-only columns
    pg_columns = pg_get_columns(pg_cur, schema, table)
    if not pg_columns:
        print(f"    [SKIP] {schema}.{table} -- not found in PG")
        pg_cur.close()
        return 0

    # Build column mapping: keep only columns that exist in both
    common_cols = []
    common_idxs = []
    for i, col in enumerate(columns):
        if col in pg_columns:
            common_cols.append(col)
            common_idxs.append(i)

    if not common_cols:
        print(f"    [SKIP] {schema}.{table} -- no matching columns")
        pg_cur.close()
        return 0

    # Filter row data to common columns only
    filtered_rows = [
        tuple(row[i] for i in common_idxs) for row in rows
    ]

    # Quoted column names (handle reserved words like "user")
    col_list = ", ".join(f'"{c}"' for c in common_cols)
    placeholders = ", ".join(["%s"] * len(common_cols))

    # Use ON CONFLICT DO NOTHING to avoid duplicate errors on re-run
    insert_sql = (
        f'INSERT INTO {schema}."{table}" ({col_list}) '
        f"VALUES ({placeholders}) "
        f"ON CONFLICT DO NOTHING"
    )

    # Batch insert
    batch_size = 500
    inserted = 0
    for start in range(0, len(filtered_rows), batch_size):
        batch = filtered_rows[start : start + batch_size]
        for row in batch:
            try:
                pg_cur.execute(insert_sql, row)
                inserted += pg_cur.rowcount
            except psycopg2.Error as e:
                # Log and skip problematic rows
                pg_conn.rollback()
                print(f"    [WARN] row insert error in {schema}.{table}: {e}")
                # Re-set search path after rollback
                pg_cur.execute("SET search_path TO %s, public", (schema,))
                continue
        pg_conn.commit()

    pg_cur.close()
    return inserted


def reset_sequences(pg_conn, schema: str):
    """Reset all SERIAL sequences in a schema to max(id) + 1."""
    cur = pg_conn.cursor()

    # Find all sequences in this schema
    cur.execute(
        "SELECT sequence_name FROM information_schema.sequences "
        "WHERE sequence_schema = %s",
        (schema,),
    )
    sequences = [row[0] for row in cur.fetchall()]

    for seq_name in sequences:
        # Derive table and column from sequence name (convention: tablename_colname_seq)
        # Try to find the table that owns this sequence
        cur.execute(
            "SELECT table_name, column_name "
            "FROM information_schema.columns "
            "WHERE table_schema = %s AND column_default LIKE %s",
            (schema, f"%{seq_name}%"),
        )
        owner = cur.fetchone()
        if owner:
            table_name, col_name = owner
            cur.execute(
                f'SELECT COALESCE(MAX("{col_name}"), 0) FROM {schema}."{table_name}"'
            )
            max_id = cur.fetchone()[0]
            if max_id and max_id > 0:
                cur.execute(
                    f"SELECT setval('{schema}.{seq_name}', %s)",
                    (max_id,),
                )
                print(f"    [SEQ] {schema}.{seq_name} -> {max_id}")

    pg_conn.commit()
    cur.close()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print("=" * 70)
    print("  SQLite -> PostgreSQL Data Migration")
    print("=" * 70)
    print(f"  DSN: {DSN.split('@')[0]}@***")
    print(f"  Search dirs: {DATA_DIR}, {BACKEND_DIR}")
    print()

    # Collect all SQLite sources from both directories
    sources = _collect_sqlite_sources()

    for schema, paths in sources.items():
        labels = ", ".join(str(p.relative_to(BACKEND_DIR)) for p in paths)
        print(f"  [OK] {schema:12s} -> {labels}")
    for schema in _DB_MAP:
        if schema not in sources:
            print(f"  [--] {schema:12s} -> (not found, skip)")
    print()

    if not sources:
        print("No SQLite databases found. Nothing to migrate.")
        return

    # Connect to PostgreSQL
    pg_conn = psycopg2.connect(DSN)
    pg_conn.autocommit = False

    total_tables = 0
    total_rows = 0

    for schema, db_paths in sources.items():
        for db_path in db_paths:
            rel = db_path.relative_to(BACKEND_DIR)
            print(f"--- {schema} ({rel}) ---")

            tables = get_sqlite_tables(db_path)
            if not tables:
                print("    (no tables)")
                continue

            for table in tables:
                columns, rows = get_sqlite_rows(db_path, table)
                if not rows:
                    print(f"    {table}: 0 rows (empty)")
                    continue

                inserted = migrate_table(pg_conn, schema, table, columns, rows)
                print(f"    {table}: {len(rows)} source -> {inserted} inserted")
                total_tables += 1
                total_rows += inserted

        # Reset sequences once per schema (after all sources merged)
        reset_sequences(pg_conn, schema)
        print()

    pg_conn.close()

    print("=" * 70)
    print(f"  Migration complete: {total_tables} tables, {total_rows} rows inserted")
    print("=" * 70)


if __name__ == "__main__":
    main()
