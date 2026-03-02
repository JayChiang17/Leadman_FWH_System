"""
test_pg_migration.py — SQLite → PostgreSQL 遷移驗證測試

驗證項目：
1. 靜態檢查：所有運行時檔案不再使用 sqlite3
2. Import 檢查：所有遷移檔案正確 import core.pg
3. SQL 語法檢查：不含 SQLite 特有語法
4. Schema 對應檢查：所有 get_cursor/get_conn 使用正確的 schema 名稱
5. init.sql 完整性檢查：所有 8 個 schema 都有定義
6. Docker 配置檢查：docker-compose.yml 正確設定 PostgreSQL
7. Mock 功能測試：核心函式可正確呼叫 PG pool
"""

import ast
import importlib
import os
import re
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock, patch, PropertyMock
from contextlib import contextmanager

import pytest

# ── Paths ──
BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

# Runtime Python files (exclude tests/ and migrations/)
RUNTIME_PY_FILES = []
for dirpath, dirnames, filenames in os.walk(BACKEND_DIR):
    rel = Path(dirpath).relative_to(BACKEND_DIR)
    parts = rel.parts
    if any(p in ("tests", "migrations", "__pycache__", ".git", "vectorstore") for p in parts):
        continue
    for fn in filenames:
        if fn.endswith(".py"):
            RUNTIME_PY_FILES.append(Path(dirpath) / fn)

# Valid PG schema names
VALID_SCHEMAS = {"pcba", "assembly", "model", "auth", "downtime", "documents", "monitor", "qc"}

# Files expected to use core.pg
PG_USER_FILES = [
    "api/pcba.py",
    "api/assembly_inventory.py",
    "api/model_inventory.py",
    "api/qc_check.py",
    "api/production_charts.py",
    "api/ate_testing.py",
    "api/search.py",
    "api/risk_router.py",
    "api/monitor.py",
    "api/downtime.py",
    "api/users.py",
    "core/db.py",
    "core/downtime_db.py",
    "core/email_db.py",
    "services/ai_service.py",
    "services/daily_report_service.py",
    "services/data_collection_service.py",
]


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 測試 1：靜態檢查 — 運行時程式碼不再 import sqlite3
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class TestNoSQLite3InRuntime:
    """確保所有運行時 .py 檔案不包含 sqlite3 引用"""

    def test_no_sqlite3_import(self):
        """運行時程式碼不應 import sqlite3"""
        violations = []
        for fpath in RUNTIME_PY_FILES:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
            for i, line in enumerate(content.splitlines(), 1):
                stripped = line.strip()
                # Skip comments
                if stripped.startswith("#"):
                    continue
                if "import sqlite3" in stripped or "from sqlite3" in stripped:
                    rel = fpath.relative_to(BACKEND_DIR)
                    violations.append(f"  {rel}:{i} → {stripped}")

        assert not violations, (
            f"以下 {len(violations)} 個檔案仍然 import sqlite3:\n"
            + "\n".join(violations)
        )

    def test_no_sqlite3_connect_call(self):
        """運行時程式碼不應呼叫 sqlite3.connect()"""
        violations = []
        for fpath in RUNTIME_PY_FILES:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
            for i, line in enumerate(content.splitlines(), 1):
                stripped = line.strip()
                if stripped.startswith("#"):
                    continue
                if "sqlite3.connect" in stripped:
                    rel = fpath.relative_to(BACKEND_DIR)
                    violations.append(f"  {rel}:{i} → {stripped}")

        assert not violations, (
            f"以下 {len(violations)} 處仍然呼叫 sqlite3.connect():\n"
            + "\n".join(violations)
        )

    def test_no_pragma_statements(self):
        """運行時程式碼不應包含 SQLite PRAGMA 語句"""
        violations = []
        for fpath in RUNTIME_PY_FILES:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
            for i, line in enumerate(content.splitlines(), 1):
                stripped = line.strip()
                if stripped.startswith("#"):
                    continue
                if re.search(r'PRAGMA\s+\w+', stripped, re.IGNORECASE):
                    rel = fpath.relative_to(BACKEND_DIR)
                    violations.append(f"  {rel}:{i} → {stripped}")

        assert not violations, (
            f"以下 {len(violations)} 處仍然包含 PRAGMA:\n"
            + "\n".join(violations)
        )

    def test_no_row_factory(self):
        """運行時程式碼不應設定 row_factory（SQLite 特有）"""
        violations = []
        for fpath in RUNTIME_PY_FILES:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
            for i, line in enumerate(content.splitlines(), 1):
                stripped = line.strip()
                if stripped.startswith("#"):
                    continue
                if "row_factory" in stripped:
                    rel = fpath.relative_to(BACKEND_DIR)
                    violations.append(f"  {rel}:{i} → {stripped}")

        assert not violations, (
            f"以下 {len(violations)} 處仍然使用 row_factory:\n"
            + "\n".join(violations)
        )

    def test_no_executescript(self):
        """運行時程式碼不應使用 executescript()（SQLite 特有）"""
        violations = []
        for fpath in RUNTIME_PY_FILES:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
            for i, line in enumerate(content.splitlines(), 1):
                stripped = line.strip()
                if stripped.startswith("#"):
                    continue
                if "executescript" in stripped:
                    rel = fpath.relative_to(BACKEND_DIR)
                    violations.append(f"  {rel}:{i} → {stripped}")

        assert not violations, (
            f"以下 {len(violations)} 處仍然使用 executescript():\n"
            + "\n".join(violations)
        )

    def test_no_lastrowid(self):
        """運行時程式碼不應使用 cur.lastrowid（應用 RETURNING id）"""
        violations = []
        for fpath in RUNTIME_PY_FILES:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
            for i, line in enumerate(content.splitlines(), 1):
                stripped = line.strip()
                if stripped.startswith("#"):
                    continue
                if "lastrowid" in stripped:
                    rel = fpath.relative_to(BACKEND_DIR)
                    violations.append(f"  {rel}:{i} → {stripped}")

        assert not violations, (
            f"以下 {len(violations)} 處仍然使用 lastrowid:\n"
            + "\n".join(violations)
        )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 測試 2：SQL 語法檢查 — 不含 SQLite 特有語法
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class TestNoSQLiteSQLSyntax:
    """確保 SQL 語句已轉為 PostgreSQL 語法"""

    def test_no_question_mark_params(self):
        """SQL 字串中不應使用 ? 作為參數佔位符（應用 %s）"""
        violations = []
        # Pattern: find SQL-like strings with ? placeholders
        # Look for execute("...", (val,)) with ? in the SQL
        for fpath in RUNTIME_PY_FILES:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
            # Find execute calls with SQL containing ?
            # Match patterns like: execute("SELECT ... WHERE x = ?", ...)
            for i, line in enumerate(content.splitlines(), 1):
                stripped = line.strip()
                if stripped.startswith("#"):
                    continue
                # Look for ? inside SQL strings in execute calls
                if ".execute(" in stripped and "?" in stripped:
                    # Exclude comments, strings that are just Python ternary, etc
                    # But include clear SQL patterns
                    if re.search(r'execute\(["\'].*\?.*["\']', stripped):
                        rel = fpath.relative_to(BACKEND_DIR)
                        violations.append(f"  {rel}:{i} → {stripped[:120]}")

        assert not violations, (
            f"以下 {len(violations)} 處 SQL 仍然使用 ? 佔位符 (應為 %s):\n"
            + "\n".join(violations)
        )

    def test_no_sqlite_strftime(self):
        """SQL 中不應使用 strftime()（SQLite 特有）"""
        violations = []
        for fpath in RUNTIME_PY_FILES:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
            for i, line in enumerate(content.splitlines(), 1):
                stripped = line.strip()
                if stripped.startswith("#"):
                    continue
                if re.search(r"strftime\s*\(", stripped, re.IGNORECASE):
                    # Skip Python's datetime.strftime (has .strftime)
                    if ".strftime(" in stripped:
                        continue
                    rel = fpath.relative_to(BACKEND_DIR)
                    violations.append(f"  {rel}:{i} → {stripped[:120]}")

        assert not violations, (
            f"以下 {len(violations)} 處 SQL 仍然使用 strftime():\n"
            + "\n".join(violations)
        )

    def test_no_insert_or_ignore(self):
        """SQL 中不應使用 INSERT OR IGNORE（應用 ON CONFLICT DO NOTHING）"""
        violations = []
        for fpath in RUNTIME_PY_FILES:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
            for i, line in enumerate(content.splitlines(), 1):
                stripped = line.strip()
                if stripped.startswith("#"):
                    continue
                if re.search(r'INSERT\s+OR\s+IGNORE', stripped, re.IGNORECASE):
                    rel = fpath.relative_to(BACKEND_DIR)
                    violations.append(f"  {rel}:{i} → {stripped[:120]}")

        assert not violations, (
            f"以下 {len(violations)} 處仍然使用 INSERT OR IGNORE:\n"
            + "\n".join(violations)
        )

    def test_no_insert_or_replace(self):
        """SQL 中不應使用 INSERT OR REPLACE（SQLite 特有）"""
        violations = []
        for fpath in RUNTIME_PY_FILES:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
            for i, line in enumerate(content.splitlines(), 1):
                stripped = line.strip()
                if stripped.startswith("#"):
                    continue
                if re.search(r'INSERT\s+OR\s+REPLACE', stripped, re.IGNORECASE):
                    rel = fpath.relative_to(BACKEND_DIR)
                    violations.append(f"  {rel}:{i} → {stripped[:120]}")

        assert not violations, (
            f"以下 {len(violations)} 處仍然使用 INSERT OR REPLACE:\n"
            + "\n".join(violations)
        )

    def test_no_autoincrement_keyword(self):
        """SQL 中不應使用 AUTOINCREMENT（PG 用 SERIAL）"""
        violations = []
        for fpath in RUNTIME_PY_FILES:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
            for i, line in enumerate(content.splitlines(), 1):
                stripped = line.strip()
                if stripped.startswith("#"):
                    continue
                if re.search(r'AUTOINCREMENT', stripped, re.IGNORECASE):
                    rel = fpath.relative_to(BACKEND_DIR)
                    violations.append(f"  {rel}:{i} → {stripped[:120]}")

        assert not violations, (
            f"以下 {len(violations)} 處仍然使用 AUTOINCREMENT:\n"
            + "\n".join(violations)
        )

    def test_no_sqlite_datetime_now(self):
        """SQL 中不應使用 datetime('now')（SQLite 特有，應用 NOW()）"""
        violations = []
        for fpath in RUNTIME_PY_FILES:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
            for i, line in enumerate(content.splitlines(), 1):
                stripped = line.strip()
                if stripped.startswith("#"):
                    continue
                if re.search(r"datetime\s*\(\s*['\"]now['\"]\s*\)", stripped, re.IGNORECASE):
                    rel = fpath.relative_to(BACKEND_DIR)
                    violations.append(f"  {rel}:{i} → {stripped[:120]}")

        assert not violations, (
            f"以下 {len(violations)} 處仍然使用 datetime('now'):\n"
            + "\n".join(violations)
        )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 測試 3：Import 正確性 — 遷移檔案 import core.pg
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class TestCorePgImport:
    """確保所有遷移過的檔案正確 import core.pg"""

    @pytest.mark.parametrize("rel_path", PG_USER_FILES)
    def test_file_imports_core_pg(self, rel_path):
        """每個遷移檔案都應 import from core.pg"""
        fpath = BACKEND_DIR / rel_path
        if not fpath.exists():
            pytest.skip(f"{rel_path} 不存在")

        content = fpath.read_text(encoding="utf-8", errors="ignore")
        has_import = (
            "from core.pg import" in content
            or "from core.pg import" in content
            or "import core.pg" in content
            # monitor.py uses get_monitor_conn from monitor_db AND get_cursor from pg
            or "from core.monitor_db import" in content
        )

        assert has_import, f"{rel_path} 沒有 import core.pg"


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 測試 4：Schema 名稱驗證
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class TestSchemaNames:
    """確保 get_cursor/get_conn 只使用有效的 schema 名稱"""

    def test_all_schema_references_valid(self):
        """所有 get_cursor() / get_conn() 呼叫使用的 schema 名稱都在有效清單中"""
        violations = []
        pattern = re.compile(r'get_(?:cursor|conn)\(\s*["\'](\w+)["\']\s*\)')

        for fpath in RUNTIME_PY_FILES:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
            for match in pattern.finditer(content):
                schema = match.group(1)
                if schema not in VALID_SCHEMAS:
                    rel = fpath.relative_to(BACKEND_DIR)
                    violations.append(f"  {rel}: 使用了無效 schema '{schema}'")

        assert not violations, (
            f"以下 {len(violations)} 處使用了無效的 schema 名稱:\n"
            + "\n".join(violations)
        )

    def test_pg_connection_uses_valid_schema(self):
        """pg_connection() 呼叫使用有效的 schema"""
        violations = []
        pattern = re.compile(r'pg_connection\(\s*["\'](\w+)["\']\s*\)')

        for fpath in RUNTIME_PY_FILES:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
            for match in pattern.finditer(content):
                schema = match.group(1)
                if schema not in VALID_SCHEMAS:
                    rel = fpath.relative_to(BACKEND_DIR)
                    violations.append(f"  {rel}: pg_connection 使用了無效 schema '{schema}'")

        assert not violations, (
            f"以下 {len(violations)} 處 pg_connection 使用了無效的 schema:\n"
            + "\n".join(violations)
        )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 測試 5：init.sql 完整性
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class TestInitSQL:
    """驗證 init.sql 定義了所有需要的 schema 和 table"""

    @pytest.fixture(autouse=True)
    def load_init_sql(self):
        init_path = BACKEND_DIR / "migrations" / "init.sql"
        assert init_path.exists(), "init.sql 不存在"
        self.sql = init_path.read_text(encoding="utf-8")

    @pytest.mark.parametrize("schema", sorted(VALID_SCHEMAS))
    def test_schema_created(self, schema):
        """每個 schema 都應有 CREATE SCHEMA IF NOT EXISTS"""
        pattern = rf"CREATE\s+SCHEMA\s+IF\s+NOT\s+EXISTS\s+{schema}"
        assert re.search(pattern, self.sql, re.IGNORECASE), (
            f"init.sql 缺少 CREATE SCHEMA {schema}"
        )

    def test_pcba_boards_table(self):
        assert "pcba.boards" in self.sql, "缺少 pcba.boards 表"
        assert "serial_number" in self.sql, "pcba.boards 缺少 serial_number 欄位"

    def test_pcba_board_history_table(self):
        assert "pcba.board_history" in self.sql, "缺少 pcba.board_history 表"

    def test_pcba_slips_table(self):
        assert "pcba.slips" in self.sql, "缺少 pcba.slips 表"

    def test_assembly_scans_table(self):
        assert "assembly.scans" in self.sql, "缺少 assembly.scans 表"
        # Check critical columns
        for col in ["cn_sn", "us_sn", "mod_a", "mod_b", "am7", "au8", "product_line", "status", "ng_reason"]:
            assert col in self.sql, f"assembly.scans 缺少 {col} 欄位"

    def test_assembly_daily_summary_table(self):
        assert "assembly.daily_summary" in self.sql, "缺少 assembly.daily_summary 表"

    def test_assembly_weekly_plan_table(self):
        assert "assembly.assembly_weekly_plan" in self.sql or "assembly_weekly_plan" in self.sql, \
            "缺少 assembly.assembly_weekly_plan 表"

    def test_model_scans_table(self):
        assert "model.scans" in self.sql, "缺少 model.scans 表"

    def test_model_daily_summary_table(self):
        assert "model.daily_summary" in self.sql, "缺少 model.daily_summary 表"

    def test_auth_users_table(self):
        assert "auth.users" in self.sql, "缺少 auth.users 表"
        assert "hashed_password" in self.sql, "auth.users 缺少 hashed_password"
        assert "role" in self.sql, "auth.users 缺少 role"

    def test_auth_refresh_tokens_table(self):
        assert "auth.refresh_tokens" in self.sql, "缺少 auth.refresh_tokens 表"

    def test_auth_email_config_table(self):
        assert "auth.email_config" in self.sql, "缺少 auth.email_config 表"

    def test_auth_email_recipients_table(self):
        assert "auth.email_recipients" in self.sql, "缺少 auth.email_recipients 表"

    def test_downtime_logs_table(self):
        assert "downtime.downtime_logs" in self.sql, "缺少 downtime.downtime_logs 表"

    def test_documents_table(self):
        assert "documents.documents" in self.sql, "缺少 documents.documents 表"

    def test_document_chunks_table(self):
        assert "documents.document_chunks" in self.sql, "缺少 documents.document_chunks 表"
        assert "search_vector" in self.sql, "document_chunks 缺少 search_vector (tsvector)"

    def test_tsvector_trigger(self):
        """確保有 tsvector 自動更新 trigger"""
        assert "TRIGGER" in self.sql.upper(), "缺少 tsvector 更新 trigger"
        assert "search_vector" in self.sql, "trigger 未涉及 search_vector"

    def test_monitor_api_logs_table(self):
        assert "monitor.api_logs" in self.sql, "缺少 monitor.api_logs 表"

    def test_monitor_audit_logs_table(self):
        assert "monitor.audit_logs" in self.sql, "缺少 monitor.audit_logs 表"

    def test_qc_issues_table(self):
        assert "qc.qc_issues" in self.sql, "缺少 qc.qc_issues 表"

    def test_qc_records_table(self):
        assert "qc.qc_records" in self.sql, "缺少 qc.qc_records 表"

    def test_default_admin_user(self):
        """確保有預設管理員帳號"""
        assert "INSERT INTO auth.users" in self.sql, "缺少預設管理員 INSERT"
        assert "admin" in self.sql, "缺少 admin 使用者名稱"

    def test_gin_index_on_documents(self):
        """確保 documents 有 GIN 全文索引"""
        assert "GIN" in self.sql.upper(), "缺少 GIN 索引"

    def test_no_sqlite_syntax_in_init_sql(self):
        """init.sql 不應包含 SQLite 語法"""
        assert "AUTOINCREMENT" not in self.sql.upper(), "init.sql 包含 AUTOINCREMENT"
        assert "INTEGER PRIMARY KEY AUTOINCREMENT" not in self.sql.upper(), "init.sql 包含 SQLite 自增語法"


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 測試 6：Docker Compose 配置
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class TestDockerCompose:
    """驗證 docker-compose.yml 正確設定 PostgreSQL"""

    @pytest.fixture(autouse=True)
    def load_compose(self):
        compose_path = ROOT_DIR / "docker-compose.yml"
        assert compose_path.exists(), "docker-compose.yml 不存在"
        self.content = compose_path.read_text(encoding="utf-8")

    def test_postgres_service_exists(self):
        assert "postgres:" in self.content, "缺少 postgres 服務"

    def test_postgres_image(self):
        assert "postgres:16" in self.content, "應使用 postgres:16 鏡像"

    def test_postgres_db_name(self):
        assert "POSTGRES_DB: leadman" in self.content, "資料庫名稱應為 leadman"

    def test_postgres_healthcheck(self):
        assert "pg_isready" in self.content, "缺少 PostgreSQL healthcheck"

    def test_backend_depends_on_postgres(self):
        assert "service_healthy" in self.content, "backend 應等待 postgres 健康後啟動"

    def test_database_url_in_backend(self):
        assert "DATABASE_URL" in self.content, "backend 環境變數缺少 DATABASE_URL"

    def test_pgdata_volume(self):
        assert "pgdata" in self.content, "缺少 pgdata volume"

    def test_init_sql_mounted(self):
        assert "init.sql" in self.content, "init.sql 未掛載到 docker-entrypoint-initdb.d"


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 測試 7：環境配置
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class TestEnvConfig:
    """驗證 .env.example 和 config.py 設定正確"""

    def test_env_example_has_database_url(self):
        env_path = BACKEND_DIR / ".env.example"
        assert env_path.exists(), ".env.example 不存在"
        content = env_path.read_text(encoding="utf-8")
        assert "DATABASE_URL" in content, ".env.example 缺少 DATABASE_URL"
        assert "postgresql://" in content, "DATABASE_URL 應為 postgresql:// 格式"

    def test_env_example_no_db_path(self):
        """不應再有舊的 DB_PATH 設定"""
        env_path = BACKEND_DIR / ".env.example"
        content = env_path.read_text(encoding="utf-8")
        assert "DB_PATH" not in content, ".env.example 不應包含舊的 DB_PATH"

    def test_config_has_database_url(self):
        config_path = BACKEND_DIR / "core" / "config.py"
        assert config_path.exists(), "config.py 不存在"
        content = config_path.read_text(encoding="utf-8")
        assert "DATABASE_URL" in content, "config.py 缺少 DATABASE_URL 設定"
        assert "postgresql://" in content, "config.py DATABASE_URL 預設值應為 postgresql://"


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 測試 8：pg.py 連線池模組結構
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class TestPgModule:
    """驗證 core/pg.py 提供了所有必要的函式"""

    @pytest.fixture(autouse=True)
    def load_pg_source(self):
        pg_path = BACKEND_DIR / "core" / "pg.py"
        assert pg_path.exists(), "core/pg.py 不存在"
        self.content = pg_path.read_text(encoding="utf-8")

    def test_has_init_pool(self):
        assert "def init_pool" in self.content, "缺少 init_pool 函式"

    def test_has_close_pool(self):
        assert "def close_pool" in self.content, "缺少 close_pool 函式"

    def test_has_get_conn(self):
        assert "def get_conn" in self.content, "缺少 get_conn 函式"

    def test_has_get_cursor(self):
        assert "def get_cursor" in self.content, "缺少 get_cursor 函式"

    def test_has_pg_connection(self):
        assert "def pg_connection" in self.content, "缺少 pg_connection 函式"

    def test_uses_threaded_pool(self):
        assert "ThreadedConnectionPool" in self.content, "應使用 ThreadedConnectionPool"

    def test_uses_real_dict_cursor(self):
        assert "RealDictCursor" in self.content, "應使用 RealDictCursor"

    def test_has_search_path_set(self):
        assert "search_path" in self.content, "get_conn 應設定 search_path"

    def test_has_commit_rollback(self):
        assert "conn.commit()" in self.content, "應有 commit"
        assert "conn.rollback()" in self.content, "應有 rollback"


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 測試 9：main.py 啟動/關閉正確呼叫 PG pool
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class TestMainPy:
    """驗證 main.py 正確管理 PG 連線池生命週期"""

    @pytest.fixture(autouse=True)
    def load_main(self):
        main_path = BACKEND_DIR / "main.py"
        assert main_path.exists(), "main.py 不存在"
        self.content = main_path.read_text(encoding="utf-8")

    def test_imports_pg_pool(self):
        assert "from core.pg import" in self.content, "main.py 應 import core.pg"
        assert "init_pool" in self.content, "main.py 應 import init_pool"
        assert "close_pool" in self.content, "main.py 應 import close_pool"

    def test_startup_calls_init_pool(self):
        assert "init_pool()" in self.content, "startup 應呼叫 init_pool()"

    def test_shutdown_calls_close_pool(self):
        assert "close_pool()" in self.content, "shutdown 應呼叫 close_pool()"


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 測試 10：deps.py 不再引用 sqlite3
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class TestDeps:
    """驗證 core/deps.py 已移除 sqlite3 依賴"""

    @pytest.fixture(autouse=True)
    def load_deps(self):
        deps_path = BACKEND_DIR / "core" / "deps.py"
        assert deps_path.exists(), "core/deps.py 不存在"
        self.content = deps_path.read_text(encoding="utf-8")

    def test_no_sqlite3_import(self):
        assert "import sqlite3" not in self.content, "deps.py 不應 import sqlite3"

    def test_no_sqlite3_connection_type(self):
        assert "sqlite3.Connection" not in self.content, "deps.py 不應引用 sqlite3.Connection"

    def test_uses_tuple_type(self):
        """get_db 現在回傳 (conn, cur) tuple"""
        assert "tuple" in self.content, "deps.py 應使用 tuple 型別"


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 測試 11：paths.py 清理
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class TestPaths:
    """驗證 paths.py 已標記 DB 常數為 legacy"""

    @pytest.fixture(autouse=True)
    def load_paths(self):
        paths_path = BACKEND_DIR / "core" / "paths.py"
        assert paths_path.exists(), "core/paths.py 不存在"
        self.content = paths_path.read_text(encoding="utf-8")

    def test_data_dir_exists(self):
        assert "DATA_DIR" in self.content, "應保留 DATA_DIR"

    def test_legacy_comment(self):
        """DB 路徑常數應標記為 legacy"""
        assert "legacy" in self.content.lower() or "migration" in self.content.lower(), \
            "DB 路徑應標記為 legacy/migration-only"

    def test_no_runtime_import_of_db_constants(self):
        """除了 scheduler(DATA_DIR) 和 ai_service 外，不應有檔案 import DB 常數"""
        violations = []
        db_const_pattern = re.compile(
            r'from core\.paths import\s+.*(?:PCBA_DB|ASSEMBLY_DB|MODEL_DB|LOGIN_DB|DOWNTIME_DB|DOCUMENTS_DB|MONITOR_DB|QC_DB)'
        )

        for fpath in RUNTIME_PY_FILES:
            # Skip ai_service.py which may still have legacy import during transition
            if "ai_service" in fpath.name:
                continue
            content = fpath.read_text(encoding="utf-8", errors="ignore")
            for i, line in enumerate(content.splitlines(), 1):
                if db_const_pattern.search(line):
                    rel = fpath.relative_to(BACKEND_DIR)
                    violations.append(f"  {rel}:{i} → {line.strip()}")

        assert not violations, (
            f"以下 {len(violations)} 處仍然 import DB 路徑常數:\n"
            + "\n".join(violations)
        )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 測試 12：遷移腳本存在且結構正確
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class TestMigrationScript:
    """驗證 migrate_sqlite_to_pg.py 存在且結構正確"""

    @pytest.fixture(autouse=True)
    def load_script(self):
        self.script_path = BACKEND_DIR / "migrations" / "migrate_sqlite_to_pg.py"
        assert self.script_path.exists(), "遷移腳本不存在"
        self.content = self.script_path.read_text(encoding="utf-8")

    def test_imports_sqlite3(self):
        """遷移腳本應 import sqlite3（用於讀取舊資料）"""
        assert "import sqlite3" in self.content

    def test_imports_psycopg2(self):
        """遷移腳本應 import psycopg2（用於寫入 PG）"""
        assert "import psycopg2" in self.content

    def test_covers_all_schemas(self):
        """遷移腳本應涵蓋所有 8 個 SQLite 資料庫"""
        for schema in VALID_SCHEMAS:
            assert schema in self.content, f"遷移腳本缺少 {schema} schema"

    def test_has_on_conflict(self):
        """應使用 ON CONFLICT DO NOTHING 避免重複"""
        assert "ON CONFLICT" in self.content

    def test_has_sequence_reset(self):
        """應有 sequence 重設邏輯"""
        assert "setval" in self.content or "sequence" in self.content.lower()

    def test_has_main_entry(self):
        """應有 main 函式入口"""
        assert "def main()" in self.content
        assert "__main__" in self.content

    def test_skips_fts5_tables(self):
        """應跳過 FTS5 虛擬表"""
        assert "chunks_fts" in self.content or "fts" in self.content.lower()


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 測試 13：Mock 功能測試 — pg.py 核心行為
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class TestPgPoolBehavior:
    """模擬測試 core/pg.py 的連線池行為"""

    def _make_mock_pool(self):
        """建立 mock connection pool"""
        mock_pool = MagicMock()
        mock_conn = MagicMock()
        mock_cursor = MagicMock()

        mock_pool.getconn.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)

        return mock_pool, mock_conn, mock_cursor

    def test_get_conn_sets_search_path(self):
        """get_conn 應設定 search_path"""
        from core import pg

        mock_pool, mock_conn, mock_cursor = self._make_mock_pool()

        old_pool = pg._pool
        pg._pool = mock_pool
        try:
            with pg.get_conn("pcba") as conn:
                pass

            # Verify search_path was set
            calls = mock_cursor.execute.call_args_list
            assert len(calls) >= 1, "應至少呼叫一次 execute"
            first_call_sql = calls[0][0][0]
            assert "search_path" in first_call_sql, "應設定 search_path"
            assert calls[0][0][1] == ("pcba",), "search_path 應設定為 'pcba'"
        finally:
            pg._pool = old_pool

    def test_get_conn_commits_on_success(self):
        """成功時 get_conn 應 commit"""
        from core import pg

        mock_pool, mock_conn, mock_cursor = self._make_mock_pool()

        old_pool = pg._pool
        pg._pool = mock_pool
        try:
            with pg.get_conn("auth") as conn:
                pass  # no error

            mock_conn.commit.assert_called_once()
            mock_conn.rollback.assert_not_called()
        finally:
            pg._pool = old_pool

    def test_get_conn_rollbacks_on_error(self):
        """錯誤時 get_conn 應 rollback"""
        from core import pg

        mock_pool, mock_conn, mock_cursor = self._make_mock_pool()

        old_pool = pg._pool
        pg._pool = mock_pool
        try:
            with pytest.raises(ValueError):
                with pg.get_conn("auth") as conn:
                    raise ValueError("test error")

            mock_conn.rollback.assert_called_once()
        finally:
            pg._pool = old_pool

    def test_get_conn_returns_conn_to_pool(self):
        """get_conn 結束後應歸還連線到 pool"""
        from core import pg

        mock_pool, mock_conn, mock_cursor = self._make_mock_pool()

        old_pool = pg._pool
        pg._pool = mock_pool
        try:
            with pg.get_conn("model") as conn:
                pass

            mock_pool.putconn.assert_called_once_with(mock_conn)
        finally:
            pg._pool = old_pool

    def test_get_cursor_yields_cursor(self):
        """get_cursor 應 yield cursor"""
        from core import pg

        mock_pool, mock_conn, mock_cursor = self._make_mock_pool()

        old_pool = pg._pool
        pg._pool = mock_pool
        try:
            with pg.get_cursor("assembly") as cur:
                assert cur is not None
        finally:
            pg._pool = old_pool

    def test_pool_not_initialized_raises(self):
        """未初始化 pool 時應拋出 RuntimeError"""
        from core import pg

        old_pool = pg._pool
        pg._pool = None
        try:
            with pytest.raises(RuntimeError, match="not initialised"):
                with pg.get_conn("pcba") as conn:
                    pass
        finally:
            pg._pool = old_pool

    def test_init_pool_idempotent(self):
        """重複呼叫 init_pool 不應重新建立 pool"""
        from core import pg

        mock_pool = MagicMock()
        old_pool = pg._pool
        pg._pool = mock_pool
        try:
            # Should not raise or replace
            pg.init_pool("postgresql://test:test@localhost/test")
            assert pg._pool is mock_pool, "不應替換已存在的 pool"
        finally:
            pg._pool = old_pool


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 測試 14：requirements.txt 檢查
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class TestRequirements:
    """驗證 requirements.txt 包含 psycopg2"""

    def test_psycopg2_in_requirements(self):
        req_path = BACKEND_DIR / "requirements.txt"
        assert req_path.exists(), "requirements.txt 不存在"
        content = req_path.read_text(encoding="utf-8")
        assert "psycopg2" in content, "requirements.txt 應包含 psycopg2 或 psycopg2-binary"


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 測試 15：FTS 遷移驗證（ai_service.py）
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class TestFTSMigration:
    """驗證 ai_service.py 已從 FTS5 遷移到 tsvector"""

    @pytest.fixture(autouse=True)
    def load_ai_service(self):
        self.ai_path = BACKEND_DIR / "services" / "ai_service.py"
        assert self.ai_path.exists(), "ai_service.py 不存在"
        self.content = self.ai_path.read_text(encoding="utf-8")

    def test_no_fts5_match(self):
        """不應使用 FTS5 MATCH 語法"""
        assert "MATCH ?" not in self.content, "仍然使用 FTS5 MATCH"
        assert "MATCH %s" not in self.content, "仍然使用 FTS5 MATCH"

    def test_no_bm25_function(self):
        """不應使用 bm25()（SQLite FTS5 特有）"""
        # Allow "bm25" in variable names, but not bm25() function call in SQL
        lines = self.content.splitlines()
        for i, line in enumerate(lines, 1):
            stripped = line.strip()
            if stripped.startswith("#"):
                continue
            if "bm25(" in stripped and "SELECT" in stripped.upper():
                pytest.fail(f"ai_service.py:{i} 仍然在 SQL 中使用 bm25() 函式")

    def test_uses_tsvector(self):
        """應使用 PostgreSQL tsvector"""
        assert "tsvector" in self.content.lower() or "ts_rank" in self.content or "plainto_tsquery" in self.content, \
            "ai_service.py 應使用 tsvector / ts_rank / plainto_tsquery"

    def test_no_virtual_table(self):
        """不應建立 VIRTUAL TABLE（FTS5）"""
        assert "VIRTUAL TABLE" not in self.content.upper(), "不應建立 VIRTUAL TABLE"

    def test_no_sqlite3_references(self):
        """不應有任何 sqlite3 引用"""
        assert "sqlite3" not in self.content, "ai_service.py 不應引用 sqlite3"

    def test_uses_core_pg(self):
        """應 import core.pg"""
        assert "from core.pg import" in self.content, "應 import core.pg"


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 測試 16：cross-schema 查詢驗證
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class TestCrossSchemaQueries:
    """驗證跨 schema 查詢已正確處理（不再使用 ATTACH DATABASE）"""

    def test_no_attach_database(self):
        """運行時程式碼不應使用 ATTACH DATABASE"""
        violations = []
        for fpath in RUNTIME_PY_FILES:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
            for i, line in enumerate(content.splitlines(), 1):
                if re.search(r'ATTACH\s+DATABASE', line, re.IGNORECASE):
                    rel = fpath.relative_to(BACKEND_DIR)
                    violations.append(f"  {rel}:{i} → {line.strip()}")

        assert not violations, (
            f"以下 {len(violations)} 處仍然使用 ATTACH DATABASE:\n"
            + "\n".join(violations)
        )

    def test_pcba_uses_assembly_cursor(self):
        """pcba.py 應使用 get_cursor('assembly') 做跨 schema 查詢"""
        pcba_path = BACKEND_DIR / "api" / "pcba.py"
        content = pcba_path.read_text(encoding="utf-8")
        assert 'get_cursor("assembly")' in content or "get_cursor('assembly')" in content, \
            "pcba.py 應使用 get_cursor('assembly') 查詢 assembly 資料"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
