"""
core/downtime_db.py
──────────────────────────────────────────────
專門管理 downtime.db 的連線池，重用 core.db.DatabaseManager。
"""
from typing import Generator
import sqlite3
from core.db import DatabaseManager          # 直接複用你已實作好的類別

# ➊ 你的 downtime 專用 DB 路徑
DOWNTIME_DB_PATH = "downtime.db"

# ➋ 建立連線池（含 WAL / retry / check_same_thread=False 等設定）
downtime_db_manager = DatabaseManager(DOWNTIME_DB_PATH)

# ➌ 初始化 downtime_logs 表（若不存在就建立，也可補欄位）
def _init_downtime_schema() -> None:
    with downtime_db_manager.get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS downtime_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                line TEXT NOT NULL,
                station TEXT NOT NULL,
                start_local TEXT NOT NULL,
                end_local   TEXT NOT NULL,
                duration_min REAL NOT NULL,
                created_at TEXT NOT NULL,
                created_by TEXT,
                modified_by TEXT
            )
        """)
        # 舊專案若少欄位可在此補齊
        for col in ("created_by", "modified_by"):
            try:
                conn.execute(f"ALTER TABLE downtime_logs ADD COLUMN {col} TEXT")
            except sqlite3.OperationalError:  # 已存在
                pass
        conn.commit()

# ❹ 匯入時就保證 schema OK
_init_downtime_schema()

# ❺ FastAPI 依賴注入函式
def get_downtime_db() -> Generator[sqlite3.Connection, None, None]:
    """
    用法：
        def some_api(db: sqlite3.Connection = Depends(get_downtime_db)):
            ...
    """
    with downtime_db_manager.get_connection() as conn:
        yield conn
