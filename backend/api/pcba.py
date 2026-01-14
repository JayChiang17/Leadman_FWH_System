from __future__ import annotations

import logging
import os
import re
import sqlite3
import json
import hashlib
import time
import threading
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Iterable

from fastapi import APIRouter, Depends, HTTPException, Query, status, Request, Response
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
from zoneinfo import ZoneInfo

from core.deps import get_current_user, User

# === 專用 Pydantic models（你的專案已分離） ===
from models.pcba_models import (
    BoardResponse, BoardCreate, BoardUpdate, BoardAdminUpdate,
    ModelBucket, StageStats, WeeklyStats, SlipUpsert, SlipStatus, NGPatch,
    SlipListItem, SlipTargetPatch,
)

logger = logging.getLogger("api.pcba")
router = APIRouter(prefix="/pcba", tags=["PCBA Tracking"])

# ----------------------------
# A) 內建快取層（不改 .env）
# ----------------------------
# Fixes issue #8: Configurable cache TTL via environment variables
TTL_STATS       = int(os.getenv("PCBA_CACHE_TTL_STATS", "10"))
TTL_TODAY       = int(os.getenv("PCBA_CACHE_TTL_TODAY", "10"))
TTL_DAILY       = int(os.getenv("PCBA_CACHE_TTL_DAILY", "120"))
TTL_WEEKLY      = int(os.getenv("PCBA_CACHE_TTL_WEEKLY", "60"))
TTL_SUMMARY     = int(os.getenv("PCBA_CACHE_TTL_SUMMARY", "10"))
TTL_SLIP_STATUS = int(os.getenv("PCBA_CACHE_TTL_SLIP", "5"))
TTL_NG_ACTIVE   = int(os.getenv("PCBA_CACHE_TTL_NG", "10"))

CACHE_ENABLED = os.getenv("PCBA_CACHE_ENABLED", "1") == "1"


def _jdump(obj: Any) -> str:
    return json.dumps(jsonable_encoder(obj), ensure_ascii=False, separators=(",", ":"))


def _jload(s: str) -> Any:
    return json.loads(s)


def _add_cache_headers(resp: Optional[Response], ttl: int, payload: Any):
    if resp is None:
        return
    etag = hashlib.blake2b(_jdump(payload).encode("utf-8"), digest_size=8).hexdigest()
    resp.headers["ETag"] = f'W/"{etag}"'
    resp.headers["Cache-Control"] = f"public, max-age={ttl}, stale-while-revalidate=60"


def _is_not_modified(req: Optional[Request], payload: Any) -> bool:
    if not req:
        return False
    given = req.headers.get("if-none-match")
    if not given:
        return False
    etag = hashlib.blake2b(_jdump(payload).encode("utf-8"), digest_size=8).hexdigest()
    return given == f'W/"{etag}"'


class _MemoryCache:
    def __init__(self):
        # key -> (expire_monotonic, json_str)
        self._store: Dict[str, Tuple[float, str]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[Any]:
        if not CACHE_ENABLED:
            return None
        now = time.monotonic()
        with self._lock:
            item = self._store.get(key)
            if not item:
                return None
            exp, payload = item
            if exp < now:
                self._store.pop(key, None)
                return None
        return _jload(payload)

    def set(self, key: str, value: Any, ttl: int):
        if not CACHE_ENABLED or ttl <= 0:
            return
        exp = time.monotonic() + ttl
        payload = _jdump(value)
        with self._lock:
            self._store[key] = (exp, payload)

    def invalidate(self, key: str):
        with self._lock:
            self._store.pop(key, None)

    def invalidate_prefix(self, prefix: str):
        with self._lock:
            for k in list(self._store.keys()):
                if k.startswith(prefix):
                    self._store.pop(k, None)


class _RedisCache:
    def __init__(self):
        import redis  # type: ignore
        self.r = redis.Redis(host="localhost", port=6379, db=0, decode_responses=True)
        try:
            self.r.ping()
        except Exception as e:
            raise RuntimeError(f"Redis not available: {e}")

    def get(self, key: str) -> Optional[Any]:
        if not CACHE_ENABLED:
            return None
        s = self.r.get(key)
        return None if s is None else _jload(s)

    def set(self, key: str, value: Any, ttl: int):
        if not CACHE_ENABLED or ttl <= 0:
            return
        self.r.setex(key, ttl, _jdump(value))

    def invalidate(self, key: str):
        self.r.delete(key)

    def invalidate_prefix(self, prefix: str):
        cur = 0
        pattern = prefix + "*"
        while True:
            cur, keys = self.r.scan(cur, match=pattern, count=500)
            if keys:
                self.r.delete(*keys)
            if cur == 0:
                break


# 嘗試使用本機 Redis，失敗就用記憶體
try:
    CACHE = _RedisCache()
    logger.info("Cache backend: Redis@localhost")
except Exception:
    CACHE = _MemoryCache()
    logger.info("Cache backend: In-Memory")


def invalidate_after_write(affected_slips: Optional[Iterable[Optional[str]]] = None):
    """
    Invalidate cache after write operation.
    Fixes issue #6: This should always be called in finally block to ensure consistency.
    """
    for pfx in ("stats:", "daily:", "weekly:", "dash:", "inventory:", "ng:"):
        CACHE.invalidate_prefix(pfx)
    if affected_slips:
        for s in set(filter(None, affected_slips)):
            CACHE.invalidate(f"slip:status:{s}")


async def safe_broadcast_with_cache_invalidation(board_data: dict, action: str, affected_slips: Optional[list] = None):
    """
    Helper to broadcast updates and invalidate cache safely.
    Fixes issue #6: Ensures cache is invalidated even if broadcast fails.
    """
    try:
        from core.ws_manager import ws_manager
        await ws_manager.broadcast({"type": "board_update", "action": action, "board": board_data})
        await _broadcast_stats_async()
    finally:
        # Always invalidate cache, even if broadcast fails
        invalidate_after_write(affected_slips)


# ========== 權限 ==========
EDITOR_ROLES = ("admin", "operator")


def require_editor(user: User):
    if getattr(user, "role", None) not in EDITOR_ROLES:
        raise HTTPException(status_code=403, detail="Only administrators or operators can perform this action")


# ========== 規則與常數 ==========
ALLOWED_HARD_MODELS = {"AM7", "AU8"}
# Fixes issue #23: Model detection must stay in sync with frontend
# IMPORTANT: These rules must match MODEL_RULES in frontend PCBAUtils.js
MODEL_PREFIXES = {
    "AU8": [r"^10030035", r"^10030055"],  # 10030035=原版, 10030055=新版本
    "AM7": [r"^10030034"]
}
FLOW = ("aging", "coating", "completed")
FLOW_ORDER = {s: i for i, s in enumerate(FLOW)}
LA = ZoneInfo("America/Los_Angeles")
AUTO_REPAIR = os.getenv("PCBA_AUTO_REPAIR", "1") == "1"
ENFORCE_SLIP_TARGET = os.getenv("PCBA_ENFORCE_SLIP_TARGET", "1") == "1"

SERIAL_NORM_EXPR = "REPLACE(REPLACE(UPPER(serial_number), '-', ''), ' ', '')"

# board_history 中哪些 notes 算「掃描/流程」事件（用於避免 slip/NG/admin 操作灌水統計）
# - create...          : 建立(aging)
# - stage X -> Y       : 流程站別變更
# - scan <stage>       : 同站別重掃(允許跨日，但同日防重複)
_SCAN_NOTES_SQL_TPL = (
    "(COALESCE({col}, '') LIKE 'create%' "
    "OR COALESCE({col}, '') LIKE 'stage %' "
    "OR COALESCE({col}, '') LIKE 'scan %')"
)


def _scan_notes_where(col: str) -> str:
    return _SCAN_NOTES_SQL_TPL.format(col=col)


def infer_model(serial: str) -> Optional[str]:
    # Fixes issue #11: Use consistent normalization helper
    s = _normalize_serial_str(serial)
    for mdl, pats in MODEL_PREFIXES.items():
        if any(re.match(p, s) for p in pats):
            return mdl
    if "AM7" in s:
        return "AM7"
    if "AU8" in s:
        return "AU8"
    return None


def get_model_version_label(serial: str, model: str) -> str:
    """取得型號版本標籤（用於歷史記錄顯示）"""
    # Fixes issue #11: Use consistent normalization helper
    s = _normalize_serial_str(serial)
    if model == "AU8":
        if re.match(r"^10030055", s):
            return "AU8 V2"
        elif re.match(r"^10030035", s):
            return "AU8 V1"
    return model


def get_model_version(serial: str) -> Optional[str]:
    """取得型號版本（V1/V2），供前端顯示用"""
    # Fixes issue #11: Use consistent normalization helper
    s = _normalize_serial_str(serial)
    if re.match(r"^10030055", s):
        return "V2"
    elif re.match(r"^10030035", s):
        return "V1"
    return None


def _normalize_serial_str(s: str) -> str:
    return (s or "").upper().replace(" ", "").replace("-", "")


def now_utc_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def parse_to_la_date_key(iso_ts: str) -> str:
    if not iso_ts:
        return ""
    s = iso_ts.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except Exception:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(LA).date().isoformat()


def today_la_key() -> str:
    return datetime.now(timezone.utc).astimezone(LA).date().isoformat()


def next_stage_of(curr: Optional[str]) -> Optional[str]:
    try:
        i = FLOW.index((curr or "").lower())
    except ValueError:
        return None
    return FLOW[i + 1] if i + 1 < len(FLOW) else None


# ========== DB ==========
def resolve_db_path() -> Path:
    return Path(os.getenv("PCBA_DB_PATH") or "pcba.db")


def resolve_assembly_db_path() -> Path:
    """Get assembly.db path from environment or default"""
    return Path(os.getenv("ASSEMBLY_DB_PATH") or "assembly.db")


def _open_conn_raw(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path), timeout=30.0, check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    # PRAGMAs for performance & concurrency (WAL)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 8000")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA temp_store = MEMORY")
    conn.execute("PRAGMA cache_size = -20000")   # ~20MB
    try:
        conn.execute("PRAGMA mmap_size = 134217728")  # 128MB if supported
    except Exception:
        pass
    return conn


def _create_empty_schema(db_path: Path):
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(str(db_path)) as conn:
        c = conn.cursor()
        c.execute("PRAGMA foreign_keys = ON")
        c.execute("PRAGMA journal_mode = WAL")
        c.execute("""
            CREATE TABLE IF NOT EXISTS boards (
                id            TEXT PRIMARY KEY,
                serial_number TEXT UNIQUE NOT NULL,
                batch_number  TEXT NOT NULL,
                model         TEXT NOT NULL CHECK(UPPER(model) IN ('AM7','AU8')),
                stage         TEXT NOT NULL CHECK(stage IN ('aging','coating','completed')),
                start_time    TEXT NOT NULL,
                last_update   TEXT NOT NULL,
                operator      TEXT NOT NULL,
                slip_number   TEXT,
                ng_flag       INTEGER NOT NULL DEFAULT 0,
                ng_reason     TEXT,
                ng_time       TEXT,
                created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )""")
        c.execute("""
            CREATE TABLE IF NOT EXISTS board_history (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                board_id  TEXT NOT NULL,
                stage     TEXT NOT NULL CHECK(stage IN ('aging','coating','completed')),
                timestamp TEXT NOT NULL,
                operator  TEXT NOT NULL,
                notes     TEXT,
                FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
            )""")
        c.execute("""
            CREATE TABLE IF NOT EXISTS slips (
                slip_number  TEXT PRIMARY KEY,
                target_pairs INTEGER NOT NULL DEFAULT 0,
                created_at   TEXT NOT NULL,
                updated_at   TEXT NOT NULL
            )""")
        # 索引
        c.execute("CREATE INDEX IF NOT EXISTS idx_boards_serial      ON boards(serial_number)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_boards_stage       ON boards(stage)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_boards_batch       ON boards(batch_number)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_boards_model       ON boards(model)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_boards_slip        ON boards(slip_number)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_boards_last_update ON boards(last_update DESC)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_history_board      ON board_history(board_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_history_ts         ON board_history(timestamp DESC)")
        c.execute(
            "CREATE INDEX IF NOT EXISTS idx_boards_serial_norm "
            "ON boards (REPLACE(REPLACE(UPPER(serial_number), '-', ''), ' ', ''))"
        )
        conn.commit()
        logger.info("✅ ensured pcba DB at %s", db_path.resolve())


def _backup_and_recreate(db_path: Path, tag: str = "") -> sqlite3.Connection:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    for ext in ("", "-wal", "-shm"):
        p = Path(str(db_path) + ext)
        if p.exists():
            backup = Path(f"{db_path}.corrupt-{ts}{('-' + tag) if tag else ''}{ext}")
            try:
                p.replace(backup)
                logger.warning("backed up corrupt file -> %s", backup)
            except Exception as e:
                logger.error("backup failed for %s: %s", p, e)
    _create_empty_schema(db_path)
    return _open_conn_raw(db_path)


def open_conn() -> sqlite3.Connection:
    db_path = resolve_db_path()
    try:
        conn = _open_conn_raw(db_path)
        row = conn.execute("PRAGMA integrity_check").fetchone()
        ok = (row and str(row[0]).lower() == "ok")
        if not ok:
            conn.close()
            if not AUTO_REPAIR:
                raise sqlite3.DatabaseError(f"integrity_check failed: {row[0] if row else 'unknown'}")
            logger.error("PCBA DB corrupted. Auto-repairing...")
            return _backup_and_recreate(db_path, "integrity_check")
        return conn
    except sqlite3.DatabaseError as e:
        if not AUTO_REPAIR:
            raise
        logger.error("PCBA DB open failed. Auto-repairing... %s", e)
        return _backup_and_recreate(db_path, "open")


def init_pcba_database():
    try:
        _create_empty_schema(resolve_db_path())
    except sqlite3.DatabaseError as e:
        if not AUTO_REPAIR:
            raise
        logger.error("init db failed; recreating... %s", e)
        _backup_and_recreate(resolve_db_path(), "init")


init_pcba_database()


def get_pcba_db():
    conn = open_conn()
    try:
        yield conn
    finally:
        conn.close()


# ========== 內部 helpers ==========
def _row_to_board(cursor: sqlite3.Cursor, row: sqlite3.Row) -> Dict[str, Any]:
    cursor.execute(
        "SELECT stage, timestamp, operator, notes FROM board_history WHERE board_id=? ORDER BY timestamp ASC",
        (row["id"],),
    )
    history = [{"stage": h["stage"], "timestamp": h["timestamp"], "operator": h["operator"], "notes": h["notes"]}
               for h in cursor.fetchall()]
    version = get_model_version(row["serial_number"])
    return {
        "id": row["id"],
        "serialNumber": row["serial_number"],
        "batchNumber": row["batch_number"],
        "model": row["model"],
        "version": version,
        "stage": row["stage"],
        "startTime": row["start_time"],
        "lastUpdate": row["last_update"],
        "operator": row["operator"],
        "slipNumber": row["slip_number"],
        "ngFlag": int(row["ng_flag"] or 0),
        "ngReason": row["ng_reason"],
        "ngTime": row["ng_time"],
        "history": history,
    }


def _row_to_board_light(row: sqlite3.Row) -> Dict[str, Any]:
    version = get_model_version(row["serial_number"])
    return {
        "id": row["id"],
        "serialNumber": row["serial_number"],
        "batchNumber": row["batch_number"],
        "model": row["model"],
        "version": version,
        "stage": row["stage"],
        "startTime": row["start_time"],
        "lastUpdate": row["last_update"],
        "operator": row["operator"],
        "slipNumber": row["slip_number"],
        "ngFlag": int(row["ng_flag"] or 0),
        "ngReason": row["ng_reason"],
        "ngTime": row["ng_time"],
        "history": [],
    }


def _get_board_row(conn: sqlite3.Connection, serial_number: str) -> Optional[sqlite3.Row]:
    c = conn.cursor()
    s_norm = _normalize_serial_str(serial_number)
    c.execute(
        f"""SELECT id, serial_number, batch_number, model, stage, start_time, last_update,
                   operator, slip_number, ng_flag, ng_reason, ng_time
            FROM boards WHERE {SERIAL_NORM_EXPR} = ?""",
        (s_norm,),
    )
    return c.fetchone()


def _get_board_by_serial(conn: sqlite3.Connection, serial_number: str) -> Optional[Dict]:
    row = _get_board_row(conn, serial_number)
    if not row:
        return None
    return _row_to_board(conn.cursor(), row)


def _get_all_boards(
    conn: sqlite3.Connection,
    stage: Optional[str] = None,
    search: Optional[str] = None,
    model: Optional[str] = None,
    slip: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    include_history: bool = False,
) -> List[Dict]:
    """
    Get all boards with filtering, using SQL-level filtering for consumed boards.
    This avoids N+1 query pattern by using ATTACH DATABASE to filter in SQL.
    """
    c = conn.cursor()

    # Attach assembly.db if it exists to filter consumed boards at SQL level
    assembly_db_path = resolve_assembly_db_path()
    has_assembly_db = assembly_db_path.exists()

    if has_assembly_db:
        try:
            # Attach assembly.db to query consumed boards in SQL
            c.execute(f"ATTACH DATABASE ? AS assembly", (str(assembly_db_path),))
        except sqlite3.DatabaseError as e:
            logger.warning(f"Failed to attach assembly.db: {e}, filtering in Python instead")
            has_assembly_db = False

    try:
        # Build base query
        if has_assembly_db:
            # Use LEFT JOIN to filter out consumed boards at SQL level
            q = """
                SELECT b.id, b.serial_number, b.batch_number, b.model, b.stage,
                       b.start_time, b.last_update, b.operator, b.slip_number,
                       b.ng_flag, b.ng_reason, b.ng_time
                FROM boards b
                LEFT JOIN assembly.scans s_am7 ON
                    UPPER(b.model) = 'AM7' AND
                    REPLACE(REPLACE(UPPER(s_am7.am7), '-', ''), ' ', '') = REPLACE(REPLACE(UPPER(b.serial_number), '-', ''), ' ', '')
                LEFT JOIN assembly.scans s_au8 ON
                    UPPER(b.model) = 'AU8' AND
                    REPLACE(REPLACE(UPPER(s_au8.au8), '-', ''), ' ', '') = REPLACE(REPLACE(UPPER(b.serial_number), '-', ''), ' ', '')
                WHERE 1=1
                  AND (UPPER(b.model) NOT IN ('AM7', 'AU8') OR (s_am7.am7 IS NULL AND s_au8.au8 IS NULL))
            """
        else:
            # Fallback to basic query without consumed filtering
            q = ("SELECT id, serial_number, batch_number, model, stage, start_time, last_update, "
                 "operator, slip_number, ng_flag, ng_reason, ng_time FROM boards WHERE 1=1")

        params: List[Any] = []

        # Add filters
        if stage and stage != "all":
            q += " AND b.stage=?" if has_assembly_db else " AND stage=?"
            params.append(stage)
        if model and model.upper() in ALLOWED_HARD_MODELS:
            q += " AND UPPER(b.model)=?" if has_assembly_db else " AND UPPER(model)=?"
            params.append(model.upper())
        if slip:
            q += " AND b.slip_number=?" if has_assembly_db else " AND slip_number=?"
            params.append(slip)
        if search:
            like = f"%{search}%"
            q += " AND (b.serial_number LIKE ? OR b.batch_number LIKE ?)" if has_assembly_db else " AND (serial_number LIKE ? OR batch_number LIKE ?)"
            params.extend([like, like])

        q += " ORDER BY b.last_update DESC" if has_assembly_db else " ORDER BY last_update DESC"
        q += " LIMIT ? OFFSET ?"
        params.extend([int(limit), int(offset)])

        c.execute(q, params)
        rows = c.fetchall()

        # If assembly.db was not available, filter in Python (fallback)
        if not has_assembly_db:
            consumed_am7, consumed_au8 = _get_all_consumed_sns()
            filtered_rows = []
            for r in rows:
                sn = r["serial_number"].strip()
                mdl = (r["model"] or "").upper()
                if mdl == "AM7" and sn in consumed_am7:
                    continue
                if mdl == "AU8" and sn in consumed_au8:
                    continue
                filtered_rows.append(r)
            rows = filtered_rows

        return [_row_to_board(c, r) if include_history else _row_to_board_light(r) for r in rows]

    finally:
        # Detach assembly.db
        if has_assembly_db:
            try:
                c.execute("DETACH DATABASE assembly")
            except Exception:
                pass


def _ensure_slip(conn: sqlite3.Connection, slip_number: Optional[str], target_pairs: Optional[int] = None):
    if not slip_number:
        return
    c = conn.cursor()
    now = now_utc_iso()
    c.execute("SELECT slip_number, target_pairs FROM slips WHERE slip_number=?", (slip_number,))
    row = c.fetchone()
    if row:
        if target_pairs is not None and int(target_pairs) != int(row["target_pairs"] or 0):
            c.execute("UPDATE slips SET target_pairs=?, updated_at=? WHERE slip_number=?",
                      (int(target_pairs), now, slip_number))
    else:
        c.execute("INSERT INTO slips (slip_number, target_pairs, created_at, updated_at) VALUES (?, ?, ?, ?)",
                  (slip_number, int(target_pairs or 0), now, now))


def _touch_slip(conn: sqlite3.Connection, slip_number: Optional[str]):
    if not slip_number:
        return
    conn.execute("UPDATE slips SET updated_at=? WHERE slip_number=?", (now_utc_iso(), slip_number))


def _get_slip_target(conn: sqlite3.Connection, slip_number: str) -> int:
    r = conn.execute("SELECT target_pairs FROM slips WHERE slip_number=?", (slip_number,)).fetchone()
    return int(r["target_pairs"] or 0) if r else 0


def _slip_completed_counts(conn: sqlite3.Connection, slip_number: str) -> Dict[str, int]:
    res = {"AM7": 0, "AU8": 0}
    c = conn.cursor()
    c.execute("""
        SELECT UPPER(model) AS model, COUNT(*) AS cnt
          FROM boards
         WHERE stage='completed' AND (ng_flag IS NULL OR ng_flag=0) AND slip_number=?
         GROUP BY UPPER(model)
    """, (slip_number,))
    for r in c.fetchall():
        mdl = r["model"]
        if mdl in res:
            res[mdl] = int(r["cnt"] or 0)
    return res


def _validate_create_stage(stage: str):
    if stage != "aging":
        raise HTTPException(status_code=400, detail="Must start with Aging")


def _validate_update_sequential(conn: sqlite3.Connection, serial: str, new_stage: str):
    row = conn.execute(
        f"SELECT stage FROM boards WHERE {SERIAL_NORM_EXPR} = ?",
        (_normalize_serial_str(serial),)
    ).fetchone()
    if not row:
        return
    curr = row["stage"]
    if curr == "completed":
        raise HTTPException(status_code=400, detail="Board already Completed")
    # 允許同站別重掃；同日防重複由 _validate_no_duplicate_today 負責
    if new_stage == curr:
        return
    expected = next_stage_of(curr)
    if new_stage != expected:
        raise HTTPException(status_code=400, detail=f"Invalid order. Current: {curr} → Next should be {expected}")


def _validate_no_duplicate_today(conn: sqlite3.Connection, board_id: str, stage: str):
    la_today = today_la_key()
    c = conn.cursor()
    c.execute(
        f"SELECT timestamp FROM board_history "
        f"WHERE board_id=? AND stage=? AND {_scan_notes_where('notes')} "
        f"ORDER BY timestamp DESC LIMIT 5",
        (board_id, stage),
    )
    for r in c.fetchall():
        if parse_to_la_date_key(r["timestamp"]) == la_today:
            raise HTTPException(status_code=409, detail=f"Already scanned {stage} today")


def _effective_target_pairs_from_create(data: BoardCreate) -> Optional[int]:
    return data.targetPairs if data.targetPairs is not None else data.slipPairs


def _effective_target_pairs_from_admin(patch: BoardAdminUpdate) -> Optional[int]:
    return patch.targetPairs if patch.targetPairs is not None else patch.slipPairs


def _create_board_internal(conn: sqlite3.Connection, data: BoardCreate, username: str, *, commit: bool = True) -> Dict:
    c = conn.cursor()
    s_norm = _normalize_serial_str(data.serialNumber)
    if c.execute(f"SELECT 1 FROM boards WHERE {SERIAL_NORM_EXPR} = ?", (s_norm,)).fetchone():
        raise HTTPException(status_code=400, detail=f"Board {data.serialNumber} already exists")
    _validate_create_stage(data.stage)

    req_model = (data.model or "AUTO-DETECT").upper()
    inferred = infer_model(data.serialNumber)

    # Fixes issue #9: Validate model inference against provided model
    if req_model == "AUTO-DETECT":
        model = inferred
    else:
        model = req_model
        # If user provided a model explicitly, verify it matches what we infer
        if inferred and inferred != model:
            raise HTTPException(
                status_code=400,
                detail=f"Provided model '{model}' does not match serial number pattern (expected '{inferred}')"
            )

    if model not in ALLOWED_HARD_MODELS:
        raise HTTPException(status_code=400, detail="Unrecognized/invalid model (AM7/AU8 only)")

    if data.slipNumber:
        _ensure_slip(conn, data.slipNumber, _effective_target_pairs_from_create(data))

    now = now_utc_iso()
    la_day = today_la_key()
    batch = data.batchNumber or (f"{data.slipNumber}-{la_day}" if data.slipNumber else f"BATCH-{la_day}")
    ts = int(datetime.now(timezone.utc).timestamp() * 1000)
    board_id = f"{data.slipNumber}-{la_day}-{ts}" if data.slipNumber else f"PCB-{ts}"

    c.execute(
        "INSERT INTO boards (id, serial_number, batch_number, model, stage, start_time, last_update, operator, slip_number) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (board_id, data.serialNumber, batch, model, data.stage, now, now, username, data.slipNumber),
    )
    version_label = get_model_version_label(data.serialNumber, model)
    c.execute(
        "INSERT INTO board_history (board_id, stage, timestamp, operator, notes) VALUES (?, ?, ?, ?, ?)",
        (board_id, data.stage, now, username, f"create (model={version_label})"),
    )
    if commit:
        conn.commit()
    return _get_board_by_serial(conn, data.serialNumber)


def _update_board_stage_internal(
    conn: sqlite3.Connection,
    serial_number: str,
    stage: str,
    username: str,
    *,
    commit: bool = True,
) -> Dict:
    c = conn.cursor()
    row = c.execute(
        f"SELECT id, stage, model, slip_number, ng_flag FROM boards WHERE {SERIAL_NORM_EXPR} = ?",
        (_normalize_serial_str(serial_number),)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Board {serial_number} not found")

    board_id, old_stage, mdl, slip_no = row["id"], row["stage"], row["model"], row["slip_number"]
    is_ok = int(row["ng_flag"] or 0) == 0

    if old_stage == "completed":
        raise HTTPException(status_code=400, detail="Board already Completed")

    # 同站別重掃：更新 last_update + 寫入 history（同日防重複）
    if old_stage == stage:
        _validate_no_duplicate_today(conn, board_id, stage)
        now = now_utc_iso()
        c.execute("UPDATE boards SET last_update=?, operator=? WHERE id=?", (now, username, board_id))
        c.execute(
            "INSERT INTO board_history (board_id, stage, timestamp, operator, notes) VALUES (?, ?, ?, ?, ?)",
            (board_id, stage, now, username, f"scan {stage}"),
        )
        if commit:
            conn.commit()
        return _get_board_by_serial(conn, serial_number)

    _validate_update_sequential(conn, serial_number, stage)
    _validate_no_duplicate_today(conn, board_id, stage)

    if ENFORCE_SLIP_TARGET and stage == "completed" and slip_no and is_ok:
        target = _get_slip_target(conn, slip_no)
        if target > 0:
            counts = _slip_completed_counts(conn, slip_no)
            counts[(mdl or "").upper()] = counts.get((mdl or "").upper(), 0) + 1
            if min(counts.get("AM7", 0), counts.get("AU8", 0)) > target:
                raise HTTPException(status_code=409, detail=f"Slip {slip_no} target {target} reached; cannot complete more pairs")

    now = now_utc_iso()
    c.execute("UPDATE boards SET stage=?, last_update=?, operator=? WHERE id=?", (stage, now, username, board_id))
    c.execute(
        "INSERT INTO board_history (board_id, stage, timestamp, operator, notes) VALUES (?, ?, ?, ?, ?)",
        (board_id, stage, now, username, f"stage {old_stage} -> {stage}"),
    )
    if commit:
        conn.commit()
    return _get_board_by_serial(conn, serial_number)


# ===== 統計 =====
def _assembly_usage_counts_limited_to_pcba(conn_pcba: sqlite3.Connection) -> Dict[str, int]:
    # 只讀 assembly.db；失敗視為 0
    def _fetch_completed_serials_by_model() -> Dict[str, List[str]]:
        c = conn_pcba.cursor()
        result = {"AM7": [], "AU8": []}
        for mdl in ("AM7", "AU8"):
            c.execute("""SELECT serial_number FROM boards
                         WHERE stage='completed' AND (ng_flag IS NULL OR ng_flag=0) AND UPPER(model)=?""", (mdl,))
            result[mdl] = [_normalize_serial_str(r["serial_number"]) for r in c.fetchall()]
        return result

    serials = _fetch_completed_serials_by_model()

    def _count_used(column: str, values: List[str]) -> int:
        # Fixes issue #3: Validate column name against whitelist
        ALLOWED_COLUMNS = {'am7', 'au8'}
        if column.lower() not in ALLOWED_COLUMNS:
            logger.error(f"Invalid column name: {column}")
            return 0

        if not values:
            return 0
        try:
            assembly_db_path = resolve_assembly_db_path()
            if not assembly_db_path.exists():
                logger.warning(f"assembly.db not found at {assembly_db_path}")
                return 0

            with sqlite3.connect(str(assembly_db_path)) as adb:
                adb.row_factory = sqlite3.Row
                ac = adb.cursor()
                ac.execute("DROP TABLE IF EXISTS _tmp_pcba_serials")
                ac.execute("CREATE TEMP TABLE _tmp_pcba_serials (serial TEXT PRIMARY KEY)")
                ac.executemany("INSERT OR IGNORE INTO _tmp_pcba_serials(serial) VALUES (?)", [(v,) for v in values])
                # Safe to use f-string after whitelist validation
                norm = f"REPLACE(REPLACE(UPPER(s.{column}), '-', ''), ' ', '')"
                ac.execute(f"""
                    SELECT COUNT(DISTINCT {norm}) AS c
                      FROM scans s
                      JOIN _tmp_pcba_serials t ON t.serial = {norm}
                     WHERE s.{column} IS NOT NULL AND TRIM(UPPER(s.{column})) <> 'N/A'
                """)
                used = int(ac.fetchone()["c"] or 0)
                ac.execute("DROP TABLE IF EXISTS _tmp_pcba_serials")
                return used
        except sqlite3.DatabaseError as e:
            logger.error(f"Database error reading assembly.db usage: {e}")
            return 0
        except Exception as e:
            logger.warning(f"Failed to read assembly.db usage: {e}")
            return 0

    return {"AM7": _count_used("am7", serials["AM7"]), "AU8": _count_used("au8", serials["AU8"])}


def _get_statistics(conn: sqlite3.Connection) -> StageStats:
    """
    Get statistics using SQL GROUP BY for better performance.
    CRITICAL FIX: Do NOT filter consumed boards in statistics query!
    Filtering consumed boards causes massive performance issues with LEFT JOINs.
    Statistics show ALL boards regardless of consumption status.
    """
    c = conn.cursor()

    # Simple, fast GROUP BY - no consumed filtering!
    query = """
        SELECT
            model,
            stage,
            ng_flag,
            COUNT(*) as cnt
        FROM boards
        GROUP BY model, stage, ng_flag
    """

    c.execute(query)
    rows = c.fetchall()

    # Process grouped results
    total = 0
    aging = 0
    coating = 0
    completed = 0
    by_model_data = {"AM7": {"total": 0, "aging": 0, "coating": 0, "completed": 0},
                     "AU8": {"total": 0, "aging": 0, "coating": 0, "completed": 0}}
    completed_by_model = {"AM7": 0, "AU8": 0}

    for row in rows:
        mdl = (row["model"] or "").upper()
        stage = row["stage"]
        ng_flag = row["ng_flag"]
        cnt = row["cnt"]

        # Count totals
        total += cnt
        if stage == "aging":
            aging += cnt
        elif stage == "coating":
            coating += cnt
        elif stage == "completed":
            completed += cnt

        # Count by model
        if mdl in by_model_data:
            by_model_data[mdl]["total"] += cnt
            if stage == "aging":
                by_model_data[mdl]["aging"] += cnt
            elif stage == "coating":
                by_model_data[mdl]["coating"] += cnt
            elif stage == "completed":
                by_model_data[mdl]["completed"] += cnt
                # Count completed OK boards (not NG)
                if not ng_flag or ng_flag == 0:
                    completed_by_model[mdl] += cnt

    eff = round(completed / total * 100, 1) if total else 0.0

    by_model: Dict[str, ModelBucket] = {}
    for mdl, data in by_model_data.items():
        by_model[mdl] = ModelBucket(
            total=data["total"],
            aging=data["aging"],
            coating=data["coating"],
            completed=data["completed"],
        )

    used = _assembly_usage_counts_limited_to_pcba(conn)
    am7_used, au8_used = used["AM7"], used["AU8"]
    avail_am7 = max(completed_by_model["AM7"] - am7_used, 0)
    avail_au8 = max(completed_by_model["AU8"] - au8_used, 0)
    pairs_done = min(avail_am7, avail_au8)

    return StageStats(
        total=total, aging=aging, coating=coating, completed=completed, efficiency=eff, byModel=by_model,
        completedByModel=completed_by_model,
        consumedAM7=am7_used, consumedAU8=au8_used, consumedTotal=am7_used + au8_used,
        availableAM7=avail_am7, availableAU8=avail_au8, availableTotal=avail_am7 + avail_au8,
        pairsDone=pairs_done,
    )


def _current_week_range_la() -> Tuple[datetime, datetime, str]:
    now_la = datetime.now(timezone.utc).astimezone(LA)
    monday_la = (now_la - timedelta(days=now_la.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    sunday_la = monday_la + timedelta(days=6, hours=23, minutes=59, seconds=59, microseconds=999000)
    fmt = lambda d: d.strftime("%m/%d")
    return monday_la.astimezone(timezone.utc), sunday_la.astimezone(timezone.utc), f"{fmt(monday_la)} – {fmt(sunday_la)}"


def _weekly_stats(conn: sqlite3.Connection) -> WeeklyStats:
    week_start_utc, week_end_utc, label = _current_week_range_la()
    c = conn.cursor()
    c.execute(f"""
        SELECT h.stage, h.timestamp, b.serial_number, b.model
          FROM board_history h
          JOIN boards b ON b.id = h.board_id
         WHERE h.timestamp BETWEEN ? AND ?
           AND h.stage IN ('aging','coating','completed')
           AND {_scan_notes_where('h.notes')}
    """, (week_start_utc.isoformat(), week_end_utc.isoformat()))
    latest: Dict[str, Tuple[str, str]] = {}
    completed_am7, completed_au8 = set(), set()
    for r in c.fetchall():
        st, sn, ts, mdl = r["stage"], r["serial_number"], r["timestamp"], (r["model"] or "").upper()
        if sn not in latest or ts > latest[sn][1] or (ts == latest[sn][1] and FLOW_ORDER[st] > FLOW_ORDER[latest[sn][0]]):
            latest[sn] = (st, ts)
        if st == "completed":
            (completed_am7 if mdl == "AM7" else completed_au8).add(sn)
    aging_cnt = sum(1 for s, _ in latest.values() if s == "aging")
    coating_cnt = sum(1 for s, _ in latest.values() if s == "coating")
    completed_cnt = sum(1 for s, _ in latest.values() if s == "completed")
    pairs = min(len(completed_am7), len(completed_au8))
    return WeeklyStats(range=label, aging=aging_cnt, coating=coating_cnt, completed=completed_cnt,
                       pairs=pairs, completedByModel={"AM7": len(completed_am7), "AU8": len(completed_au8)})


# === 每日統計（前端用） ===
class DailyRow(BaseModel):
    date: str
    aging: int = 0
    coating: int = 0
    completed: int = 0
    completedOK: int = 0
    completedAM7: int = 0
    completedAU8: int = 0
    completedAM7OK: int = 0
    completedAU8OK: int = 0
    pairs: int = 0
    pairsOK: int = 0
    # Consumption (boards used by assembly)
    consumed: int = 0
    consumedAM7: int = 0
    consumedAU8: int = 0
    consumedPairs: int = 0


class BestDay(BaseModel):
    date: str
    pairsOK: int


class DailyStats(BaseModel):
    startDate: str
    endDate: str
    timezone: str = "America/Los_Angeles"
    rows: List[DailyRow]
    totals: Dict[str, int]
    avgPairsOKPerDay: float
    bestDay: Optional[BestDay] = None


def _la_day_bounds(date_key: str) -> Tuple[datetime, datetime]:
    y, m, d = map(int, date_key.split("-"))
    start_la = datetime(y, m, d, 0, 0, 0, tzinfo=LA)
    end_la = datetime(y, m, d, 23, 59, 59, 999000, tzinfo=LA)
    return start_la.astimezone(timezone.utc), end_la.astimezone(timezone.utc)


def _la_date_keys_between(start_key: str, end_key: str) -> List[str]:
    sy, sm, sd = map(int, start_key.split("-"))
    ey, em, ed = map(int, end_key.split("-"))
    cur = datetime(sy, sm, sd, tzinfo=LA)
    fin = datetime(ey, em, ed, tzinfo=LA)
    keys: List[str] = []
    while cur.date() <= fin.date():
        keys.append(cur.date().isoformat())
        cur += timedelta(days=1)
    return keys


def _safe_date_key_or_none(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s)
        return dt.date().isoformat()
    except Exception:
        return s if re.match(r"^\d{4}-\d{2}-\d{2}$", s) else None


def _default_last_n_days_keys(n: int = 14) -> Tuple[str, str, List[str]]:
    today_la = datetime.now(timezone.utc).astimezone(LA).date()
    start_la = today_la - timedelta(days=max(0, n - 1))
    return start_la.isoformat(), today_la.isoformat(), _la_date_keys_between(start_la.isoformat(), today_la.isoformat())


def _get_all_consumed_sns() -> Tuple[set, set]:
    """Get all consumed serial numbers from assembly.db.
    Returns: (consumed_am7_set, consumed_au8_set)
    Cache TTL: 60 seconds
    """
    # Check cache first
    cache_key = "consumed:sns_all"
    cached = CACHE.get(cache_key)
    if cached:
        return set(cached["am7"]), set(cached["au8"])

    try:
        assembly_db_path = resolve_assembly_db_path()
        if not assembly_db_path.exists():
            logger.warning(f"assembly.db not found at {assembly_db_path}")
            return set(), set()

        consumed_am7 = set()
        consumed_au8 = set()

        with sqlite3.connect(str(assembly_db_path)) as adb:
            adb.row_factory = sqlite3.Row
            ac = adb.cursor()

            # Get all AM7 consumed
            ac.execute("SELECT am7 FROM scans WHERE am7 IS NOT NULL AND am7 != ''")
            consumed_am7 = {row["am7"].strip() for row in ac.fetchall()}

            # Get all AU8 consumed
            ac.execute("SELECT au8 FROM scans WHERE au8 IS NOT NULL AND au8 != ''")
            consumed_au8 = {row["au8"].strip() for row in ac.fetchall()}

        # Cache for 60 seconds
        CACHE.set(cache_key, {"am7": list(consumed_am7), "au8": list(consumed_au8)}, 60)

        logger.info(f"Loaded consumed SNs: AM7={len(consumed_am7)}, AU8={len(consumed_au8)}")
        return consumed_am7, consumed_au8
    except sqlite3.DatabaseError as e:
        logger.error(f"Database error reading consumed SNs from assembly.db: {e}")
        return set(), set()
    except Exception as e:
        logger.warning(f"Failed to read consumed SNs from assembly.db: {e}")
        return set(), set()


def _count_consumed_by_day(date_key: str) -> Tuple[int, int]:
    """Count consumed boards from assembly.db for a specific LA date.
    Note: assembly.db ts column uses LA local time strings (YYYY-MM-DD HH:MM:SS)
    """
    try:
        assembly_db_path = resolve_assembly_db_path()
        if not assembly_db_path.exists():
            logger.warning(f"assembly.db not found at {assembly_db_path}")
            return 0, 0

        # assembly.db uses LA local time strings, so we compare with LA date bounds
        start_la = f"{date_key} 00:00:00"
        end_la = f"{date_key} 23:59:59"

        with sqlite3.connect(str(assembly_db_path)) as adb:
            adb.row_factory = sqlite3.Row
            ac = adb.cursor()
            # Count AM7 consumed
            ac.execute("""
                SELECT COUNT(*) c FROM scans
                WHERE am7 IS NOT NULL AND am7 != ''
                AND ts BETWEEN ? AND ?
            """, (start_la, end_la))
            am7_consumed = int(ac.fetchone()["c"] or 0)

            # Count AU8 consumed
            ac.execute("""
                SELECT COUNT(*) c FROM scans
                WHERE au8 IS NOT NULL AND au8 != ''
                AND ts BETWEEN ? AND ?
            """, (start_la, end_la))
            au8_consumed = int(ac.fetchone()["c"] or 0)

            return am7_consumed, au8_consumed
    except sqlite3.DatabaseError as e:
        logger.error(f"Database error reading assembly.db daily consumption: {e}")
        return 0, 0
    except Exception as e:
        logger.warning(f"Failed to read assembly.db daily consumption: {e}")
        return 0, 0


def _daily_stats(conn: sqlite3.Connection, start_key: Optional[str], end_key: Optional[str], days: int = 14) -> DailyStats:
    if not start_key or not end_key:
        start_key, end_key, keys = _default_last_n_days_keys(days)
    else:
        keys = _la_date_keys_between(start_key, end_key)

    c = conn.cursor()
    rows: List[DailyRow] = []
    totals = {k: 0 for k in ("aging", "coating", "completed", "completedOK", "completedAM7", "completedAU8",
                             "completedAM7OK", "completedAU8OK", "pairs", "pairsOK",
                             "consumed", "consumedAM7", "consumedAU8", "consumedPairs")}

    for dk in keys:
        start_utc, end_utc = _la_day_bounds(dk)
        c.execute(f"""SELECT h.stage s, COUNT(*) cnt
                       FROM board_history h
                      WHERE h.timestamp BETWEEN ? AND ?
                        AND h.stage IN ('aging','coating','completed')
                        AND {_scan_notes_where('h.notes')}
                      GROUP BY h.stage""",
                  (start_utc.isoformat(), end_utc.isoformat()))
        stage_counts = {r["s"]: int(r["cnt"] or 0) for r in c.fetchall()}

        c.execute(f"""SELECT UPPER(b.model) m, COUNT(*) cnt
                       FROM board_history h
                       JOIN boards b ON b.id = h.board_id
                      WHERE h.timestamp BETWEEN ? AND ?
                        AND h.stage='completed'
                        AND {_scan_notes_where('h.notes')}
                      GROUP BY UPPER(b.model)""",
                  (start_utc.isoformat(), end_utc.isoformat()))
        comp_by_model = {r["m"]: int(r["cnt"] or 0) for r in c.fetchall()}
        comp_am7, comp_au8 = comp_by_model.get("AM7", 0), comp_by_model.get("AU8", 0)

        c.execute(f"""SELECT UPPER(b.model) m, COUNT(*) cnt
                       FROM board_history h
                       JOIN boards b ON b.id = h.board_id
                      WHERE h.timestamp BETWEEN ? AND ?
                        AND h.stage='completed'
                        AND {_scan_notes_where('h.notes')}
                        AND (b.ng_flag IS NULL OR b.ng_flag=0)
                      GROUP BY UPPER(b.model)""",
                  (start_utc.isoformat(), end_utc.isoformat()))
        comp_ok_by_model = {r["m"]: int(r["cnt"] or 0) for r in c.fetchall()}
        comp_am7_ok, comp_au8_ok = comp_ok_by_model.get("AM7", 0), comp_ok_by_model.get("AU8", 0)

        # Get consumption data for this day
        consumed_am7, consumed_au8 = _count_consumed_by_day(dk)
        consumed_total = consumed_am7 + consumed_au8
        consumed_pairs = min(consumed_am7, consumed_au8)

        row = DailyRow(
            date=dk,
            aging=stage_counts.get("aging", 0),
            coating=stage_counts.get("coating", 0),
            completed=comp_am7 + comp_au8,
            completedOK=comp_am7_ok + comp_au8_ok,
            completedAM7=comp_am7,
            completedAU8=comp_au8,
            completedAM7OK=comp_am7_ok,
            completedAU8OK=comp_au8_ok,
            pairs=min(comp_am7, comp_au8),
            pairsOK=min(comp_am7_ok, comp_au8_ok),
            consumed=consumed_total,
            consumedAM7=consumed_am7,
            consumedAU8=consumed_au8,
            consumedPairs=consumed_pairs,
        )
        rows.append(row)
        for k in totals.keys():
            totals[k] += getattr(row, k)

    active_rows = [r for r in rows if r.pairsOK > 0]
    avg_pairs_ok = round(sum(r.pairsOK for r in active_rows) / len(active_rows), 2) if active_rows else 0.0
    best = None
    if rows:
        br = max(rows, key=lambda r: (r.pairsOK, r.date))
        best = BestDay(date=br.date, pairsOK=br.pairsOK)

    return DailyStats(
        startDate=keys[0] if keys else "",
        endDate=keys[-1] if keys else "",
        rows=rows,
        totals=totals,
        avgPairsOKPerDay=avg_pairs_ok,
        bestDay=best,
    )


# === Dashboard 補助（不公開路由） ===
class InventorySummary(BaseModel):
    availableAM7: int
    availableAU8: int
    availableTotal: int
    usedAM7: int
    usedAU8: int
    usedTotal: int
    completedAM7: int
    completedAU8: int
    pairsAvailable: int


def _inventory_summary(conn: sqlite3.Connection) -> InventorySummary:
    stats = _get_statistics(conn)
    return InventorySummary(
        availableAM7=stats.availableAM7,
        availableAU8=stats.availableAU8,
        availableTotal=stats.availableTotal,
        usedAM7=stats.consumedAM7,
        usedAU8=stats.consumedAU8,
        usedTotal=stats.consumedTotal,
        completedAM7=stats.completedByModel.get("AM7", 0),
        completedAU8=stats.completedByModel.get("AU8", 0),
        pairsAvailable=min(stats.availableAM7, stats.availableAU8),
    )


# ========== WS 廣播 ==========
async def _broadcast_stats_async():
    from core.ws_manager import ws_manager
    conn = None
    try:
        conn = open_conn()
        stats = _get_statistics(conn)
        payload = stats.model_dump() if hasattr(stats, "model_dump") else stats.__dict__
        await ws_manager.broadcast({"type": "statistics_update", "statistics": payload})
    finally:
        if conn:
            conn.close()


# ========== REST（僅保留前端需要的）==========
@router.get("/boards", response_model=List[BoardResponse])
async def get_boards(
    stage: Optional[str] = Query(None, pattern="^(all|aging|coating|completed)$"),
    search: Optional[str] = Query(None, max_length=100),
    model: Optional[str] = Query(None, pattern="^(AM7|AU8)$"),
    slip: Optional[str] = Query(None, max_length=100),
    # Fixes issue #10: Cap pagination limit at 1000 to prevent excessive memory usage
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    includeHistory: bool = Query(False),
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    mdl = model.upper() if model else None
    return _get_all_boards(db, stage, search, mdl, slip, limit, offset, include_history=includeHistory)


@router.get("/boards/{serial_number}", response_model=BoardResponse)
async def get_board(
    serial_number: str,
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    b = _get_board_by_serial(db, serial_number)
    if not b:
        raise HTTPException(status_code=404, detail=f"Board {serial_number} not found")
    return b


@router.post("/boards", response_model=BoardResponse, status_code=status.HTTP_201_CREATED)
async def create_board(
    board_data: BoardCreate,
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    """
    Create new board with proper cache invalidation.
    Fixes issue #6: Cache invalidation happens in finally to ensure consistency.
    """
    require_editor(current_user)
    b = _create_board_internal(db, board_data, current_user.username)
    await safe_broadcast_with_cache_invalidation(b, "create", [b.get("slipNumber")])
    return b


@router.put("/boards/{serial_number}", response_model=BoardResponse)
async def update_board(
    serial_number: str,
    update_data: BoardUpdate,
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    require_editor(current_user)
    b = _update_board_stage_internal(db, serial_number, update_data.stage, current_user.username)
    from core.ws_manager import ws_manager
    await ws_manager.broadcast({"type": "board_update", "action": "update", "board": b})
    await _broadcast_stats_async()
    invalidate_after_write([b.get("slipNumber")])
    return b


# 變更 / 指定 slip（明確操作，與前端詳細視窗對齊）
class SlipAssignPatch(BaseModel):
    slipNumber: Optional[str] = Field(None, description="新的 slip（空字串代表移除）")
    targetPairs: Optional[int] = Field(None, description="若提供，會同步設定新 slip 的 targetPairs")


@router.patch("/boards/{serial_number}/slip", response_model=BoardResponse)
async def change_board_slip(
    serial_number: str,
    patch: SlipAssignPatch,
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    require_editor(current_user)
    c = db.cursor()
    row = c.execute(
        f"SELECT id, slip_number, stage, model, ng_flag FROM boards WHERE {SERIAL_NORM_EXPR} = ?",
        (_normalize_serial_str(serial_number),)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Board {serial_number} not found")

    board_id, old_slip, old_stage = row["id"], row["slip_number"], row["stage"]
    mdl = (row["model"] or "").upper()
    is_ok = int(row["ng_flag"] or 0) == 0
    new_slip = patch.slipNumber if (patch.slipNumber or "") != "" else None

    if old_slip == new_slip:
        return _get_board_by_serial(db, serial_number)

    if ENFORCE_SLIP_TARGET and old_stage == "completed" and new_slip and is_ok:
        tgt = _get_slip_target(db, new_slip)
        if tgt > 0:
            counts = _slip_completed_counts(db, new_slip)
            counts[mdl] = counts.get(mdl, 0) + 1
            if min(counts.get("AM7", 0), counts.get("AU8", 0)) > tgt:
                raise HTTPException(status_code=409, detail=f"Slip {new_slip} target {tgt} reached; cannot move more pairs in")

    now = now_utc_iso()
    if new_slip:
        _ensure_slip(db, new_slip, patch.targetPairs)

    c.execute("UPDATE boards SET slip_number=?, last_update=?, operator=? WHERE id=?",
              (new_slip, now, current_user.username, board_id))

    note = ("move slip {0} -> {1}".format(old_slip, new_slip) if old_slip and new_slip
            else f"attach slip {new_slip}" if new_slip
            else f"detach slip {old_slip}")
    c.execute("INSERT INTO board_history (board_id, stage, timestamp, operator, notes) VALUES (?, ?, ?, ?, ?)",
              (board_id, old_stage, now, current_user.username, note))

    _touch_slip(db, old_slip); _touch_slip(db, new_slip)
    db.commit()

    b = _get_board_by_serial(db, serial_number)
    from core.ws_manager import ws_manager
    await ws_manager.broadcast({"type": "board_update", "action": "slip_changed", "board": b})
    await _broadcast_stats_async()
    invalidate_after_write([old_slip, b.get("slipNumber")])
    return b


@router.patch("/boards/{serial_number}/admin", response_model=BoardResponse)
async def admin_edit_board(
    serial_number: str,
    patch: BoardAdminUpdate,
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    require_editor(current_user)
    c = db.cursor()
    row = c.execute(
        f"SELECT id, serial_number, stage, slip_number, model, ng_flag FROM boards WHERE {SERIAL_NORM_EXPR} = ?",
        (_normalize_serial_str(serial_number),)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Board {serial_number} not found")

    board_id, old_sn, old_stage, old_slip = row["id"], row["serial_number"], row["stage"], row["slip_number"]
    model_before = (row["model"] or "").upper()
    model_after = model_before
    is_ok = int(row["ng_flag"] or 0) == 0

    sets: List[str] = []
    params: List[Any] = []

    if patch.batchNumber is not None:
        sets.append("batch_number=?"); params.append(patch.batchNumber)

    if patch.model is not None:
        mdl = (patch.model or "").upper()
        if mdl == "AUTO-DETECT":
            mdl = infer_model(old_sn) or mdl
        if mdl not in ALLOWED_HARD_MODELS:
            raise HTTPException(status_code=400, detail="Invalid model (AM7/AU8 only)")
        sets.append("model=?"); params.append(mdl); model_after = mdl

    stage_history: List[Tuple[str, str]] = []
    if patch.stage is not None:
        sets.append("stage=?"); params.append(patch.stage)
        if patch.stage != old_stage:
            stage_history.append((patch.stage, patch.note or "admin edit"))

    stage_after = patch.stage or old_stage

    slip_changed = False
    new_slip_value: Optional[str] = old_slip
    if patch.slipNumber is not None:
        normalized_new = patch.slipNumber if (patch.slipNumber or "") != "" else None
        if normalized_new != old_slip:
            slip_changed = True
            new_slip_value = normalized_new
            sets.append("slip_number=?"); params.append(new_slip_value)
            eff_pairs = _effective_target_pairs_from_admin(patch)
            if new_slip_value:
                _ensure_slip(db, new_slip_value, eff_pairs)

    # slip target enforcement：需用「更新後」stage/slip/model 來判斷，避免同筆 PATCH 繞過限制
    slip_after = new_slip_value
    if ENFORCE_SLIP_TARGET and is_ok and stage_after == "completed" and slip_after:
        need_target_check = (
            old_stage != "completed"
            or old_slip != slip_after
            or model_before != model_after
        )
        if need_target_check:
            tgt = _get_slip_target(db, slip_after)
            if slip_changed:
                eff_pairs = _effective_target_pairs_from_admin(patch)
                if eff_pairs is not None:
                    tgt = int(eff_pairs)

            if tgt > 0:
                counts = _slip_completed_counts(db, slip_after)
                if old_stage != "completed" or old_slip != slip_after:
                    counts[model_after] = counts.get(model_after, 0) + 1
                elif model_before != model_after:
                    counts[model_before] = max(0, counts.get(model_before, 0) - 1)
                    counts[model_after] = counts.get(model_after, 0) + 1

                if min(counts.get("AM7", 0), counts.get("AU8", 0)) > tgt:
                    raise HTTPException(
                        status_code=409,
                        detail=f"Slip {slip_after} target {tgt} reached; cannot move more pairs in",
                    )

    if patch.startTime is not None:
        sets.append("start_time=?"); params.append(patch.startTime)

    now = now_utc_iso()
    sets.append("last_update=?"); params.append(patch.lastUpdate or now)
    sets.append("operator=?");    params.append(patch.operator or current_user.username)

    if sets:
        params.append(board_id)
        c.execute(f"UPDATE boards SET {', '.join(sets)} WHERE id=?", params)

    for st, note in stage_history:
        c.execute("INSERT INTO board_history (board_id, stage, timestamp, operator, notes) VALUES (?, ?, ?, ?, ?)",
                  (board_id, st, now, current_user.username, note))

    if slip_changed:
        note = ("move slip {0} -> {1}".format(old_slip, new_slip_value) if old_slip and new_slip_value
                else f"attach slip {new_slip_value}" if new_slip_value
                else f"detach slip {old_slip}")
        c.execute("INSERT INTO board_history (board_id, stage, timestamp, operator, notes) VALUES (?, ?, ?, ?, ?)",
                  (board_id, (patch.stage or old_stage), now, current_user.username, note))
        _touch_slip(db, old_slip); _touch_slip(db, new_slip_value)

    if patch.newSerialNumber and patch.newSerialNumber != old_sn:
        if c.execute("SELECT 1 FROM boards WHERE serial_number=?", (patch.newSerialNumber,)).fetchone():
            raise HTTPException(status_code=400, detail=f"Serial {patch.newSerialNumber} already exists")
        c.execute("UPDATE boards SET serial_number=? WHERE id=?", (patch.newSerialNumber, board_id))

    db.commit()
    new_sn = patch.newSerialNumber or old_sn
    b = _get_board_by_serial(db, new_sn)

    from core.ws_manager import ws_manager
    await ws_manager.broadcast({"type": "board_update", "action": "admin_edit", "board": b})
    await _broadcast_stats_async()
    invalidate_after_write([old_slip, b.get("slipNumber")])
    return b


@router.delete("/boards/{serial_number}")
async def delete_board(
    serial_number: str,
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    require_editor(current_user)
    row = db.execute(
        f"SELECT id, slip_number FROM boards WHERE {SERIAL_NORM_EXPR} = ?",
        (_normalize_serial_str(serial_number),)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Board {serial_number} not found")
    bid, slip_no = row["id"], row["slip_number"]
    db.execute("DELETE FROM board_history WHERE board_id=?", (bid,))
    db.execute("DELETE FROM boards WHERE id=?", (bid,))
    db.commit()

    from core.ws_manager import ws_manager
    await ws_manager.broadcast({"type": "board_deleted", "serialNumber": serial_number})
    await _broadcast_stats_async()
    invalidate_after_write([slip_no])
    return {"message": f"Board {serial_number} deleted successfully"}


@router.post("/scan", response_model=BoardResponse, summary="Scan upsert（存在就更新，不存在就建立；強制流程順序＋同日防重複）")
async def scan_upsert(
    payload: BoardCreate,
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    require_editor(current_user)
    serial = payload.serialNumber
    if not serial:
        raise HTTPException(status_code=400, detail="serialNumber required")

    # ✅ 只有 Aging 允許指定/變更 slip；其他站一律忽略 slip 欄位
    req_stage = (payload.stage or "").lower()
    if req_stage != "aging":
        payload.slipNumber = None
        payload.targetPairs = None
        payload.slipPairs = None

    affected_slips: List[Optional[str]] = []
    try:
        # 一次 scan 內同時包含「站別掃描 + (aging 才允許的) slip 變更」要保持原子性
        db.execute("BEGIN")

        if req_stage == "aging" and payload.slipNumber:
            _ensure_slip(db, payload.slipNumber, _effective_target_pairs_from_create(payload))

        row = _get_board_row(db, serial)
        if row:
            old_slip = row["slip_number"]
            old_stage = row["stage"]

            # 只有在「掃 aging」且該板目前也在 aging 時，才允許用 scan 更新/附掛 slip
            if req_stage == "aging" and old_stage == "aging" and (payload.slipNumber is not None):
                new_slip = payload.slipNumber if (payload.slipNumber or "").strip() != "" else None
                if new_slip != old_slip:
                    c = db.cursor()
                    now = now_utc_iso()
                    c.execute(
                        "UPDATE boards SET slip_number=?, last_update=?, operator=? WHERE id=?",
                        (new_slip, now, current_user.username, row["id"]),
                    )
                    note = (
                        f"move slip {old_slip} -> {new_slip}" if old_slip and new_slip
                        else f"attach slip {new_slip}" if new_slip
                        else f"detach slip {old_slip}"
                    )
                    c.execute(
                        "INSERT INTO board_history (board_id, stage, timestamp, operator, notes) VALUES (?, ?, ?, ?, ?)",
                        (row["id"], old_stage, now, current_user.username, note),
                    )
                    _touch_slip(db, old_slip)
                    _touch_slip(db, new_slip)
                    affected_slips.append(old_slip)

            b = _update_board_stage_internal(db, serial, payload.stage, current_user.username, commit=False)
        else:
            b = _create_board_internal(db, payload, current_user.username, commit=False)

        db.commit()

        from core.ws_manager import ws_manager
        await ws_manager.broadcast({"type": "board_update", "board": b})
        await _broadcast_stats_async()
        affected_slips.append(b.get("slipNumber"))
        invalidate_after_write(affected_slips)
        return b

    except HTTPException:
        try:
            db.rollback()
        except Exception:
            pass
        raise
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        logger.exception("scan_upsert unexpected error | serial=%s stage=%s", serial, payload.stage)
        raise


@router.patch("/boards/{serial_number}/ng", response_model=BoardResponse, summary="標記/取消 NG（會寫入歷史）")
async def mark_ng(
    serial_number: str,
    payload: NGPatch,
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    require_editor(current_user)
    c = db.cursor()
    row = c.execute(
        f"SELECT id, stage, ng_flag, ng_reason, slip_number FROM boards WHERE {SERIAL_NORM_EXPR} = ?",
        (_normalize_serial_str(serial_number),)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Board {serial_number} not found")

    board_id, stage, prev_reason, slip_no = row["id"], row["stage"], row["ng_reason"], row["slip_number"]
    now = now_utc_iso()
    if payload.ng:
        c.execute("UPDATE boards SET ng_flag=1, ng_reason=?, ng_time=?, last_update=?, operator=? WHERE id=?",
                  (payload.reason or "", now, now, current_user.username, board_id))
        note = f"NG set: {(payload.reason or '').strip()}"
    else:
        c.execute("UPDATE boards SET ng_flag=0, ng_reason=NULL, ng_time=NULL, last_update=?, operator=? WHERE id=?",
                  (now, current_user.username, board_id))
        note = f"NG cleared (was: {(prev_reason or '').strip()})"

    c.execute("INSERT INTO board_history (board_id, stage, timestamp, operator, notes) VALUES (?, ?, ?, ?, ?)",
              (board_id, stage, now, current_user.username, note))
    db.commit()

    b = _get_board_by_serial(db, serial_number)
    from core.ws_manager import ws_manager
    await ws_manager.broadcast({"type": "board_update", "action": "ng", "board": b})
    await _broadcast_stats_async()
    invalidate_after_write([slip_no])
    return b


# ===== 統計 & 儀表板（前端用） =====
@router.get("/statistics", response_model=StageStats)
async def get_statistics(
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
    request: Request = None,
    response: Response = None,
):
    key = "stats:global"
    cached = CACHE.get(key)
    if cached:
        if _is_not_modified(request, cached):
            return Response(status_code=304)
        _add_cache_headers(response, TTL_STATS, cached)
        return cached
    v = _get_statistics(db)
    CACHE.set(key, v, TTL_STATS)
    _add_cache_headers(response, TTL_STATS, v)
    return v


@router.get("/statistics/daily", response_model=DailyStats, summary="每日統計（LA，預設最近 14 天）")
async def get_daily_stats(
    start: Optional[str] = Query(None, description="YYYY-MM-DD (LA)"),
    end: Optional[str] = Query(None, description="YYYY-MM-DD (LA)"),
    days: int = Query(14, ge=1, le=365),
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
    request: Request = None,
    response: Response = None,
):
    s_key = _safe_date_key_or_none(start)
    e_key = _safe_date_key_or_none(end)
    key = f"daily:{s_key or ''}:{e_key or ''}:{days}"
    cached = CACHE.get(key)
    if cached:
        if _is_not_modified(request, cached):
            return Response(status_code=304)
        _add_cache_headers(response, TTL_DAILY, cached)
        return cached
    v = _daily_stats(db, s_key, e_key, days)
    CACHE.set(key, v, TTL_DAILY)
    _add_cache_headers(response, TTL_DAILY, v)
    return v


@router.get("/statistics/today", response_model=DailyRow, summary="今日產出（LA）")
async def get_today_stats(
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
    request: Request = None,
    response: Response = None,
):
    today = today_la_key()
    key = f"daily:today:{today}"
    cached = CACHE.get(key)
    if cached:
        if _is_not_modified(request, cached):
            return Response(status_code=304)
        _add_cache_headers(response, TTL_TODAY, cached)
        return cached
    ds = _daily_stats(db, today, today, days=1)
    row = ds.rows[0] if ds.rows else DailyRow(date=today)
    CACHE.set(key, row, TTL_TODAY)
    _add_cache_headers(response, TTL_TODAY, row)
    return row


class ConsumptionRow(BaseModel):
    date: str
    consumed: int = 0
    consumedAM7: int = 0
    consumedAU8: int = 0
    consumedPairs: int = 0


class ConsumptionStats(BaseModel):
    startDate: str
    endDate: str
    timezone: str = "America/Los_Angeles"
    rows: List[ConsumptionRow]
    avgConsumedPerDay: float


@router.get("/statistics/consumption", response_model=ConsumptionStats, summary="每日消耗統計（Assembly usage）")
async def get_consumption_stats(
    start: Optional[str] = Query(None, description="YYYY-MM-DD (LA)"),
    end: Optional[str] = Query(None, description="YYYY-MM-DD (LA)"),
    days: int = Query(7, ge=1, le=365),
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
    request: Request = None,
    response: Response = None,
):
    s_key = _safe_date_key_or_none(start)
    e_key = _safe_date_key_or_none(end)
    key = f"consumption:{s_key or ''}:{e_key or ''}:{days}"
    cached = CACHE.get(key)
    if cached:
        if _is_not_modified(request, cached):
            return Response(status_code=304)
        _add_cache_headers(response, TTL_DAILY, cached)
        return cached

    # Get date keys
    if not s_key or not e_key:
        s_key, e_key, keys = _default_last_n_days_keys(days)
    else:
        keys = _la_date_keys_between(s_key, e_key)

    # Build consumption rows
    rows: List[ConsumptionRow] = []
    total_consumed = 0
    for dk in keys:
        am7, au8 = _count_consumed_by_day(dk)
        total = am7 + au8
        pairs = min(am7, au8)
        rows.append(ConsumptionRow(
            date=dk,
            consumed=total,
            consumedAM7=am7,
            consumedAU8=au8,
            consumedPairs=pairs
        ))
        total_consumed += total

    active_days = len([r for r in rows if r.consumed > 0])
    avg = round(total_consumed / active_days, 2) if active_days > 0 else 0.0

    result = ConsumptionStats(
        startDate=s_key,
        endDate=e_key,
        rows=rows,
        avgConsumedPerDay=avg
    )

    CACHE.set(key, result, TTL_DAILY)
    _add_cache_headers(response, TTL_DAILY, result)
    return result


class DashboardSummary(BaseModel):
    today: DailyRow
    daily: DailyStats
    weekly: WeeklyStats
    inventory: InventorySummary


@router.get("/dashboard/summary", response_model=DashboardSummary, summary="前端儀表板彙整（今日/每日/每週/庫存）")
async def get_dashboard_summary(
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
    request: Request = None,
    response: Response = None,
):
    key = "dash:summary"
    cached = CACHE.get(key)
    if cached:
        if _is_not_modified(request, cached):
            return Response(status_code=304)
        _add_cache_headers(response, TTL_SUMMARY, cached)
        return cached

    today = today_la_key()

    daily_key = "daily:::14"  # 與 /statistics/daily 的 key 規格對齊（起迄空字串＋天數）
    daily = CACHE.get(daily_key)
    if not daily:
        daily = _daily_stats(db, None, None, 14)
        CACHE.set(daily_key, daily, TTL_DAILY)
    elif isinstance(daily, dict):
        # 從緩存取出的是字典，需轉換回 Pydantic 模型
        daily = DailyStats(**daily)

    weekly_key = "weekly:current"
    weekly = CACHE.get(weekly_key)
    if not weekly:
        weekly = _weekly_stats(db)
        CACHE.set(weekly_key, weekly, TTL_WEEKLY)
    elif isinstance(weekly, dict):
        weekly = WeeklyStats(**weekly)

    inv_key = "inventory:summary"
    inventory = CACHE.get(inv_key)
    if not inventory:
        inventory = _inventory_summary(db)
        CACHE.set(inv_key, inventory, TTL_STATS)
    elif isinstance(inventory, dict):
        inventory = InventorySummary(**inventory)

    today_row = next((r for r in daily.rows if r.date == today), None)
    if not today_row:
        # 呼叫同檔函式，不帶 request/response 以取得實體資料
        today_row = await get_today_stats(db, current_user)

    out = DashboardSummary(today=today_row, daily=daily, weekly=weekly, inventory=inventory)
    CACHE.set(key, out, TTL_SUMMARY)
    _add_cache_headers(response, TTL_SUMMARY, out)
    return out


# ===== 全域 NG 清單 =====
@router.get("/ng/active", response_model=List[BoardResponse], summary="列出所有目前標記為 NG 的板")
async def list_active_ng(
    stage: Optional[str] = Query(None, pattern="^(aging|coating|completed)$"),
    model: Optional[str] = Query(None, pattern="^(AM7|AU8)$"),
    # Allow up to 5000 for NG boards (typically much fewer than total boards)
    limit: int = Query(1000, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
    request: Request = None,
    response: Response = None,
):
    key = f"ng:active:{stage or ''}:{model or ''}:{limit}:{offset}"
    cached = CACHE.get(key)
    if cached:
        if _is_not_modified(request, cached):
            return Response(status_code=304)
        _add_cache_headers(response, TTL_NG_ACTIVE, cached)
        return cached

    c = db.cursor()
    q = ("SELECT id, serial_number, batch_number, model, stage, start_time, last_update, "
         "operator, slip_number, ng_flag, ng_reason, ng_time FROM boards WHERE ng_flag=1")
    params: List[Any] = []
    if stage:
        q += " AND stage=?"; params.append(stage)
    if model:
        q += " AND UPPER(model)=?"; params.append(model.upper())
    q += " ORDER BY last_update DESC LIMIT ? OFFSET ?"
    params.extend([int(limit), int(offset)])
    c.execute(q, params)
    out = [_row_to_board_light(r) for r in c.fetchall()]

    CACHE.set(key, out, TTL_NG_ACTIVE)
    _add_cache_headers(response, TTL_NG_ACTIVE, out)
    return out


# ===== Slip APIs（前端用）=====
@router.post("/slips", summary="建立/更新 Packing Slip 目標對數")
async def upsert_slip(
    slip: SlipUpsert,
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    require_editor(current_user)
    _ensure_slip(db, slip.slipNumber, slip.targetPairs)
    db.commit()
    invalidate_after_write([slip.slipNumber])
    return {"message": "OK"}


@router.get("/slips", response_model=List[SlipListItem], summary="列出所有 Packing Slips（含分站別統計）")
async def list_slips(
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    c = db.cursor()
    c.execute("""
        SELECT s.slip_number AS slip, s.target_pairs AS target_pairs, s.updated_at AS updated_at,
               COALESCE(SUM(CASE WHEN b.stage='aging'     THEN 1 ELSE 0 END), 0) AS aging,
               COALESCE(SUM(CASE WHEN b.stage='coating'   THEN 1 ELSE 0 END), 0) AS coating,
               COALESCE(SUM(CASE WHEN b.stage='completed' THEN 1 ELSE 0 END), 0) AS completed,
               COALESCE(SUM(CASE WHEN b.stage='completed' AND (b.ng_flag IS NULL OR b.ng_flag=0) AND UPPER(b.model)='AM7' THEN 1 ELSE 0 END), 0) AS completed_am7_ok,
               COALESCE(SUM(CASE WHEN b.stage='completed' AND (b.ng_flag IS NULL OR b.ng_flag=0) AND UPPER(b.model)='AU8' THEN 1 ELSE 0 END), 0) AS completed_au8_ok
          FROM slips s
     LEFT JOIN boards b ON b.slip_number = s.slip_number
      GROUP BY s.slip_number
      ORDER BY s.updated_at DESC
    """)
    rows = c.fetchall()
    out: List[SlipListItem] = []
    for r in rows:
        out.append(SlipListItem(
            slipNumber=r["slip"],
            targetPairs=int(r["target_pairs"] or 0),
            aging=int(r["aging"] or 0),
            coating=int(r["coating"] or 0),
            completed=int(r["completed"] or 0),
            completedPairs=min(int(r["completed_am7_ok"] or 0), int(r["completed_au8_ok"] or 0)),
            updatedAt=r["updated_at"],
        ))
    return out


@router.patch("/slips/{slip_number}", summary="更新單一 slip 的 targetPairs")
async def update_slip_target(
    slip_number: str,
    patch: SlipTargetPatch,
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    require_editor(current_user)
    now = now_utc_iso()
    c = db.cursor()
    if not c.execute("SELECT 1 FROM slips WHERE slip_number=?", (slip_number,)).fetchone():
        c.execute("INSERT INTO slips (slip_number, target_pairs, created_at, updated_at) VALUES (?, ?, ?, ?)",
                  (slip_number, int(patch.targetPairs), now, now))
    else:
        c.execute("UPDATE slips SET target_pairs=?, updated_at=? WHERE slip_number=?",
                  (int(patch.targetPairs), now, slip_number))
    db.commit()
    invalidate_after_write([slip_number])
    return {"message": "OK"}


@router.delete("/slips/{slip_number}", summary="刪除 slip（無關聯板件時才允許）")
async def delete_slip(
    slip_number: str,
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    require_editor(current_user)
    c = db.cursor()
    cnt = int(c.execute("SELECT COUNT(*) AS cnt FROM boards WHERE slip_number=?", (slip_number,)).fetchone()["cnt"] or 0)
    if cnt > 0:
        raise HTTPException(status_code=409, detail="Cannot delete: related boards exist")
    c.execute("DELETE FROM slips WHERE slip_number=?", (slip_number,))
    db.commit()
    invalidate_after_write([slip_number])
    return {"message": f"Slip {slip_number} deleted"}


@router.get("/slips/status", response_model=SlipStatus, summary="查詢單一 Packing Slip 進度")
async def slip_status(
    slip_number: str = Query(..., description="Slip number (can contain '/' for combined slips like 124798/124796)"),
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
    request: Request = None,
    response: Response = None,
):
    key = f"slip:status:{slip_number}"
    cached = CACHE.get(key)
    if cached:
        if _is_not_modified(request, cached):
            return Response(status_code=304)
        _add_cache_headers(response, TTL_SLIP_STATUS, cached)
        return cached

    c = db.cursor()
    srow = c.execute("SELECT slip_number, target_pairs, updated_at FROM slips WHERE slip_number=?", (slip_number,)).fetchone()
    target_pairs = int(srow["target_pairs"] or 0) if srow else 0
    updated_at = srow["updated_at"] if srow else now_utc_iso()

    def _pairs_at(stage: str, only_ok_completed: bool = False) -> Tuple[int, Dict[str, int]]:
        base = "SELECT UPPER(model) m, COUNT(*) cnt FROM boards WHERE slip_number=? AND stage=?"
        params = [slip_number, stage]
        if only_ok_completed:
            base += " AND (ng_flag IS NULL OR ng_flag=0)"
        base += " GROUP BY UPPER(model)"
        rows = c.execute(base, params).fetchall()
        by_m = {r["m"]: int(r["cnt"] or 0) for r in rows}
        return min(by_m.get("AM7", 0), by_m.get("AU8", 0)), by_m

    completed_boards = int(c.execute(
        "SELECT COUNT(*) cnt FROM boards WHERE slip_number=? AND stage='completed'", (slip_number,)
    ).fetchone()["cnt"] or 0)
    completed_pairs_ok, comp_ok_by_m = _pairs_at("completed", only_ok_completed=True)
    _completed_pairs_all, _comp_by_m_all = _pairs_at("completed", only_ok_completed=False)
    aging_pairs, aging_by_m = _pairs_at("aging")
    coating_pairs, coating_by_m = _pairs_at("coating")

    aging_total = sum(aging_by_m.values())
    coating_total = sum(coating_by_m.values())
    # completed by model：排除 NG，需與 slip target enforcement 規則一致
    completed_am7 = comp_ok_by_m.get("AM7", 0)
    completed_au8 = comp_ok_by_m.get("AU8", 0)
    remaining_pairs = max(0, target_pairs - completed_pairs_ok) if target_pairs else 0

    out = SlipStatus(
        slipNumber=slip_number,
        targetPairs=target_pairs,
        completedPairs=completed_pairs_ok,
        completed=completed_boards,
        remainingPairs=remaining_pairs,
        updatedAt=updated_at,
        agingPairs=aging_pairs,
        coatingPairs=coating_pairs,
        aging=aging_total,
        coating=coating_total,
        completedAM7=completed_am7,
        completedAU8=completed_au8,
    )
    CACHE.set(key, out, TTL_SLIP_STATUS)
    _add_cache_headers(response, TTL_SLIP_STATUS, out)
    return out
