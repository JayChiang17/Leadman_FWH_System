"""
core/paths.py — Central path registry.
DATA_DIR is used for file storage (uploads, scheduler locks, etc.).
Database connections are handled by core/pg.py (PostgreSQL pool).
"""
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)

# Legacy SQLite paths — kept only for the one-time migration script
# (backend/migrations/migrate_sqlite_to_pg.py).  No runtime code should
# import these; use core.pg.get_cursor(schema) instead.
PCBA_DB      = DATA_DIR / "pcba.db"
ASSEMBLY_DB  = DATA_DIR / "assembly.db"
MODEL_DB     = DATA_DIR / "model.db"
LOGIN_DB     = DATA_DIR / "login.db"
DOWNTIME_DB  = DATA_DIR / "downtime.db"
DOCUMENTS_DB = DATA_DIR / "documents.db"
MONITOR_DB   = DATA_DIR / "monitor.db"
QC_DB        = DATA_DIR / "qc_v2.db"
