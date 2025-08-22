# （原檔頭說明保留）
from __future__ import annotations

import logging
import os
import re
import sqlite3
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from zoneinfo import ZoneInfo

from core.deps import get_current_user, User

# 將 Pydantic models 獨立到 models/pcba_models.py
from models.pcba_models import (
    BoardResponse, BoardCreate, BoardUpdate, BoardAdminUpdate,
    ModelBucket, StageStats, WeeklyStats, SlipUpsert, SlipStatus, NGPatch,
    SlipListItem, SlipTargetPatch,
)

logger = logging.getLogger("api.pcba")

# 最終路徑 /api/pcba/...
router = APIRouter(prefix="/pcba", tags=["PCBA Tracking"])

# ========== 型號規則 ==========
ALLOWED_HARD_MODELS = {"AM7", "AU8"}
MODEL_PREFIXES = {
    "AU8": [r"^10030035"],
    "AM7": [r"^10030034"],
}

# 三站別流程
FLOW = ("aging", "coating", "completed")
FLOW_ORDER = {s: i for i, s in enumerate(FLOW)}
LA = ZoneInfo("America/Los_Angeles")

# 自動修復開關（預設開啟；設 PCBA_AUTO_REPAIR=0 可關閉）
AUTO_REPAIR = os.getenv("PCBA_AUTO_REPAIR", "1") == "1"


def infer_model(serial: str) -> Optional[str]:
    s = (serial or "").upper().replace(" ", "").replace("-", "")
    for mdl, pats in MODEL_PREFIXES.items():
        if any(re.match(p, s) for p in pats):
            return mdl
    if "AM7" in s:
        return "AM7"
    if "AU8" in s:
        return "AU8"
    return None


def _normalize_serial_str(s: str) -> str:
    """與 assembly.db 對齊的序號正規化：去空白與 '-'，轉大寫。"""
    return (s or "").upper().replace(" ", "").replace("-", "")


def now_utc_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def parse_to_la_date_key(iso_ts: str) -> str:
    """將 ISO 時間字串（可能無 tz）轉為 LA 日期鍵（YYYY-MM-DD）。無 tz 視為 UTC。"""
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


# ========== DB 路徑 / 連線 ==========
def resolve_db_path() -> Path:
    env = os.getenv("PCBA_DB_PATH")
    if env:
        return Path(env)
    return Path("pcba.db")


def _open_conn_raw(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path), timeout=30.0, check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def _create_empty_schema(db_path: Path):
    """建立乾淨 schema（三表 + 索引）。"""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    c = conn.cursor()
    try:
        c.execute("PRAGMA foreign_keys = ON")
        c.execute("PRAGMA journal_mode = WAL")

        # boards（含 NG 欄位 & slip_number）
        c.execute(
            """
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
            )
            """
        )

        # board_history
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS board_history (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                board_id  TEXT NOT NULL,
                stage     TEXT NOT NULL CHECK(stage IN ('aging','coating','completed')),
                timestamp TEXT NOT NULL,
                operator  TEXT NOT NULL,
                notes     TEXT,
                FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
            )
            """
        )

        # slips
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS slips (
                slip_number  TEXT PRIMARY KEY,
                target_pairs INTEGER NOT NULL DEFAULT 0,
                created_at   TEXT NOT NULL,
                updated_at   TEXT NOT NULL
            )
            """
        )

        # 索引
        c.execute("CREATE INDEX IF NOT EXISTS idx_boards_serial      ON boards(serial_number)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_boards_stage       ON boards(stage)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_boards_batch       ON boards(batch_number)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_boards_model       ON boards(model)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_boards_slip        ON boards(slip_number)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_boards_last_update ON boards(last_update DESC)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_history_board      ON board_history(board_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_history_ts         ON board_history(timestamp DESC)")

        conn.commit()
        logger.info("✅ ensured pcba DB at %s", db_path.resolve())
    except Exception as e:
        conn.rollback()
        logger.error("init db error: %s", e)
        raise
    finally:
        conn.close()


def _backup_and_recreate(db_path: Path, tag: str = "") -> sqlite3.Connection:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    for ext in ("", "-wal", "-shm"):
        p = Path(str(db_path) + ext)
        if p.exists():
            backup = Path(str(db_path) + f".corrupt-{ts}{('-' + tag) if tag else ''}{ext}")
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
        try:
            row = conn.execute("PRAGMA integrity_check").fetchone()
            ok = (row and str(row[0]).lower() == "ok")
            if not ok:
                conn.close()
                if not AUTO_REPAIR:
                    raise sqlite3.DatabaseError(f"integrity_check failed: {row[0] if row else 'unknown'}")
                logger.error("PCBA DB corrupted (integrity_check). Auto-repairing...")
                return _backup_and_recreate(db_path, "integrity_check")
            return conn
        except sqlite3.DatabaseError as e:
            conn.close()
            if not AUTO_REPAIR:
                raise
            logger.error("PCBA DB corrupted (execute). Auto-repairing... %s", e)
            return _backup_and_recreate(db_path, "execute")
    except sqlite3.DatabaseError as e:
        if not AUTO_REPAIR:
            raise
        logger.error("PCBA DB open failed. Auto-repairing... %s", e)
        return _backup_and_recreate(db_path, "open")


# ========== 初始化 ==========
def init_pcba_database():
    """新建三表：boards、board_history、slips（不作舊版相容/遷移）。若檔案損壞且允許自修，會自動備份重建。"""
    db_path = resolve_db_path()
    try:
        _create_empty_schema(db_path)
    except sqlite3.DatabaseError as e:
        if not AUTO_REPAIR:
            raise
        logger.error("init db failed (likely corrupted). Auto-repairing... %s", e)
        _backup_and_recreate(db_path, "init")


# 啟動時建立
init_pcba_database()

# ========== 依賴 ==========
def get_pcba_db():
    conn = open_conn()
    try:
        yield conn
    finally:
        conn.close()

# ========== 內部 Helper ==========
def _row_to_board(cursor: sqlite3.Cursor, row: sqlite3.Row) -> Dict[str, Any]:
    cursor.execute(
        "SELECT stage, timestamp, operator, notes FROM board_history WHERE board_id=? ORDER BY timestamp ASC",
        (row["id"],),
    )
    history = [{"stage": h["stage"], "timestamp": h["timestamp"], "operator": h["operator"], "notes": h["notes"]}
               for h in cursor.fetchall()]
    return {
        "id": row["id"],
        "serialNumber": row["serial_number"],
        "batchNumber": row["batch_number"],
        "model": row["model"],
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


def _get_board_by_serial(conn: sqlite3.Connection, serial_number: str) -> Optional[Dict]:
    c = conn.cursor()
    c.execute(
        "SELECT id, serial_number, batch_number, model, stage, start_time, last_update, operator, slip_number, ng_flag, ng_reason, ng_time "
        "FROM boards WHERE serial_number=?",
        (serial_number,),
    )
    row = c.fetchone()
    if not row:
        return None
    return _row_to_board(c, row)


def _get_all_boards(
    conn: sqlite3.Connection,
    stage: Optional[str] = None,
    search: Optional[str] = None,
    model: Optional[str] = None,
    slip: Optional[str] = None,
) -> List[Dict]:
    c = conn.cursor()
    q = ("SELECT id, serial_number, batch_number, model, stage, start_time, last_update, operator, slip_number, ng_flag, ng_reason, ng_time "
         "FROM boards WHERE 1=1")
    params: List[Any] = []
    if stage and stage != "all":
        q += " AND stage=?"; params.append(stage)
    if model and model.upper() in ALLOWED_HARD_MODELS:
        q += " AND UPPER(model)=?"; params.append(model.upper())
    if slip:
        q += " AND slip_number=?"; params.append(slip)
    if search:
        like = f"%{search}%"
        q += " AND (serial_number LIKE ? OR batch_number LIKE ?)"
        params.extend([like, like])
    q += " ORDER BY last_update DESC"
    c.execute(q, params)
    return [_row_to_board(c, r) for r in c.fetchall()]


def _ensure_slip(conn: sqlite3.Connection, slip_number: str, target_pairs: Optional[int] = None):
    if not slip_number:
        return
    c = conn.cursor()
    now = now_utc_iso()
    c.execute("SELECT slip_number, target_pairs FROM slips WHERE slip_number=?", (slip_number,))
    row = c.fetchone()
    if row:
        if target_pairs is not None and target_pairs != row["target_pairs"]:
            c.execute("UPDATE slips SET target_pairs=?, updated_at=? WHERE slip_number=?",
                      (int(target_pairs), now, slip_number))
            conn.commit()
    else:
        c.execute("INSERT INTO slips (slip_number, target_pairs, created_at, updated_at) VALUES (?, ?, ?, ?)",
                  (slip_number, int(target_pairs or 0), now, now))
        conn.commit()


def _validate_create_stage(stage: str):
    if stage != "aging":
        raise HTTPException(status_code=400, detail="Must start with Aging")


def _validate_update_sequential(conn: sqlite3.Connection, serial: str, new_stage: str):
    c = conn.cursor()
    c.execute("SELECT stage FROM boards WHERE serial_number=?", (serial,))
    row = c.fetchone()
    if not row:
        return
    curr = row["stage"]
    if curr == "completed":
        raise HTTPException(status_code=400, detail="Board already Completed")
    expected = next_stage_of(curr)
    if new_stage != expected:
        raise HTTPException(status_code=400, detail=f"Invalid order. Current: {curr} → Next should be {expected}")


def _validate_no_duplicate_today(conn: sqlite3.Connection, board_id: str, stage: str):
    """同一天(LA)同站別不可重複掃。"""
    c = conn.cursor()
    la_today = today_la_key()
    c.execute(
        "SELECT timestamp FROM board_history WHERE board_id=? AND stage=? ORDER BY timestamp DESC LIMIT 5",
        (board_id, stage),
    )
    for r in c.fetchall():
        if parse_to_la_date_key(r["timestamp"]) == la_today:
            raise HTTPException(status_code=409, detail=f"Already scanned {stage} today")


def _effective_target_pairs_from_create(data: BoardCreate) -> Optional[int]:
    return data.targetPairs if data.targetPairs is not None else data.slipPairs


def _effective_target_pairs_from_admin(patch: BoardAdminUpdate) -> Optional[int]:
    return patch.targetPairs if patch.targetPairs is not None else patch.slipPairs


def _create_board_internal(conn: sqlite3.Connection, data: BoardCreate, username: str) -> Dict:
    c = conn.cursor()
    c.execute("SELECT id FROM boards WHERE serial_number=?", (data.serialNumber,))
    if c.fetchone():
        raise HTTPException(status_code=400, detail=f"Board {data.serialNumber} already exists")

    _validate_create_stage(data.stage)

    req_model = (data.model or "AUTO-DETECT").upper()
    if req_model == "AUTO-DETECT":
        model = infer_model(data.serialNumber)
        if model is None or model not in ALLOWED_HARD_MODELS:
            raise HTTPException(status_code=400, detail="Unrecognized model from serial (only AM7/AU8 accepted)")
    else:
        model = req_model
        if model not in ALLOWED_HARD_MODELS:
            raise HTTPException(status_code=400, detail="Invalid model. Only AM7/AU8 allowed")

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
    c.execute(
        "INSERT INTO board_history (board_id, stage, timestamp, operator, notes) VALUES (?, ?, ?, ?, ?)",
        (board_id, data.stage, now, username, f"create (model={model})"),
    )
    conn.commit()
    return _get_board_by_serial(conn, data.serialNumber)


def _update_board_stage_internal(conn: sqlite3.Connection, serial_number: str, stage: str, username: str) -> Dict:
    c = conn.cursor()
    c.execute("SELECT id, stage FROM boards WHERE serial_number=?", (serial_number,))
    row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Board {serial_number} not found")
    board_id, old_stage = row["id"], row["stage"]

    _validate_update_sequential(conn, serial_number, stage)
    _validate_no_duplicate_today(conn, board_id, stage)

    if old_stage == stage:
        return _get_board_by_serial(conn, serial_number)

    now = now_utc_iso()
    c.execute("UPDATE boards SET stage=?, last_update=?, operator=? WHERE serial_number=?",
              (stage, now, username, serial_number))
    c.execute(
        "INSERT INTO board_history (board_id, stage, timestamp, operator, notes) VALUES (?, ?, ?, ?, ?)",
        (board_id, stage, now, username, f"stage {old_stage} -> {stage}"),
    )
    conn.commit()
    return _get_board_by_serial(conn, serial_number)


# ===== 使用量（只計 PCBA 完成清單 & DISTINCT 去重） =====
def _fetch_completed_serials_by_model(conn: sqlite3.Connection) -> Dict[str, List[str]]:
    """抓出 pcba 里『已完成且非 NG』的序號，依機型分組。"""
    c = conn.cursor()
    result = {"AM7": [], "AU8": []}
    for mdl in ("AM7", "AU8"):
        c.execute(
            """
            SELECT serial_number
            FROM boards
            WHERE stage='completed'
              AND (ng_flag IS NULL OR ng_flag=0)
              AND UPPER(model)=?
            """,
            (mdl,),
        )
        result[mdl] = [_normalize_serial_str(r["serial_number"]) for r in c.fetchall()]
    return result


def _assembly_usage_counts_limited_to_pcba(conn_pcba: sqlite3.Connection) -> Dict[str, int]:
    """
    只計算『存在於 PCBA 且已完成(非 NG)』的序號在 assembly.db 被使用過的數量。
    使用 COUNT(DISTINCT ...) 去重，避免重掃導致超扣。
    若沒有 assembly.db，回傳 0。
    """
    serials = _fetch_completed_serials_by_model(conn_pcba)

    def _count_used(column: str, values: List[str]) -> int:
        if not values:
            return 0
        try:
            adb = sqlite3.connect("assembly.db")
            adb.row_factory = sqlite3.Row
            ac = adb.cursor()
            # TEMP TABLE 裝正規化序號，JOIN 時以正規化比對
            ac.execute("DROP TABLE IF EXISTS _tmp_pcba_serials")
            ac.execute("CREATE TEMP TABLE _tmp_pcba_serials (serial TEXT PRIMARY KEY)")
            ac.executemany("INSERT OR IGNORE INTO _tmp_pcba_serials(serial) VALUES (?)", [(v,) for v in values])

            norm = f"REPLACE(REPLACE(UPPER(s.{column}), '-', ''), ' ', '')"
            ac.execute(
                f"""
                SELECT COUNT(DISTINCT {norm}) AS c
                FROM scans s
                JOIN _tmp_pcba_serials t ON t.serial = {norm}
                WHERE s.{column} IS NOT NULL
                  AND TRIM(UPPER(s.{column})) <> 'N/A'
                """
            )
            used = int(ac.fetchone()["c"] or 0)
            ac.execute("DROP TABLE IF EXISTS _tmp_pcba_serials")
            adb.close()
            return used
        except Exception as e:
            logger.warning("read assembly.db usage failed: %s (treat as 0)", e)
            return 0

    return {
        "AM7": _count_used("am7", serials["AM7"]),
        "AU8": _count_used("au8", serials["AU8"]),
    }


def _get_statistics(conn: sqlite3.Connection) -> StageStats:
    c = conn.cursor()

    # 全體分站別（不排除 NG，用於總體效率/分布）
    c.execute(
        """
        SELECT
            COUNT(*) total,
            SUM(CASE WHEN stage='aging'     THEN 1 ELSE 0 END) aging,
            SUM(CASE WHEN stage='coating'   THEN 1 ELSE 0 END) coating,
            SUM(CASE WHEN stage='completed' THEN 1 ELSE 0 END) completed
        FROM boards
        """
    )
    r = c.fetchone()
    total, aging, coating, completed = (int(r["total"] or 0), int(r["aging"] or 0), int(r["coating"] or 0), int(r["completed"] or 0))
    eff = round(completed / total * 100, 1) if total else 0.0

    # byModel（不排 NG）
    c.execute(
        """
        SELECT UPPER(model) m,
               COUNT(*) total,
               SUM(CASE WHEN stage='aging'     THEN 1 ELSE 0 END) aging,
               SUM(CASE WHEN stage='coating'   THEN 1 ELSE 0 END) coating,
               SUM(CASE WHEN stage='completed' THEN 1 ELSE 0 END) completed
        FROM boards
        GROUP BY UPPER(model)
        """
    )
    by_model: Dict[str, ModelBucket] = {}
    for x in c.fetchall():
        by_model[x["m"]] = ModelBucket(
            total=int(x["total"] or 0),
            aging=int(x["aging"] or 0),
            coating=int(x["coating"] or 0),
            completed=int(x["completed"] or 0),
        )

    # 完成(排 NG) 的機型分布（用於 Available / Pairs）
    c.execute(
        """
        SELECT UPPER(model) m, COUNT(*) cnt
        FROM boards
        WHERE stage='completed' AND (ng_flag IS NULL OR ng_flag=0)
        GROUP BY UPPER(model)
        """
    )
    completed_by_model = {"AM7": 0, "AU8": 0}
    for x in c.fetchall():
        completed_by_model[x["m"]] = int(x["cnt"] or 0)

    # Assembly 使用量（僅限 pcba 完成清單內的序號；且 DISTINCT 去重複）
    used = _assembly_usage_counts_limited_to_pcba(conn)
    am7_used, au8_used = used["AM7"], used["AU8"]

    # 可用 = 完成(排NG) − 使用量（不為負）
    avail_am7 = max(completed_by_model["AM7"] - am7_used, 0)
    avail_au8 = max(completed_by_model["AU8"] - au8_used, 0)
    avail_total = avail_am7 + avail_au8

    # Pairs Done 以 available 為準
    pairs_done = min(avail_am7, avail_au8)

    return StageStats(
        total=total, aging=aging, coating=coating, completed=completed, efficiency=eff, byModel=by_model,
        completedByModel=completed_by_model,
        consumedAM7=am7_used, consumedAU8=au8_used, consumedTotal=am7_used + au8_used,
        availableAM7=avail_am7, availableAU8=avail_au8, availableTotal=avail_total,
        pairsDone=pairs_done,
    )


def _current_week_range_la() -> Tuple[datetime, datetime, str]:
    now_la = datetime.now(timezone.utc).astimezone(LA)
    delta_days = now_la.weekday()  # Monday=0
    monday_la = (now_la - timedelta(days=delta_days)).replace(hour=0, minute=0, second=0, microsecond=0)
    sunday_la = monday_la + timedelta(days=6, hours=23, minutes=59, seconds=59, microseconds=999000)
    fmt = lambda d: d.strftime("%m/%d")
    label = f"{fmt(monday_la)} – {fmt(sunday_la)}"
    return monday_la.astimezone(timezone.utc), sunday_la.astimezone(timezone.utc), label


def _weekly_stats(conn: sqlite3.Connection) -> WeeklyStats:
    week_start_utc, week_end_utc, label = _current_week_range_la()
    c = conn.cursor()
    c.execute(
        """
        SELECT h.board_id, h.stage, h.timestamp, b.serial_number, b.model
        FROM board_history h
        JOIN boards b ON b.id = h.board_id
        WHERE h.timestamp BETWEEN ? AND ?
          AND h.stage IN ('aging','coating','completed')
        """,
        (week_start_utc.isoformat(), week_end_utc.isoformat()),
    )

    latest_by_sn: Dict[str, Tuple[str, str]] = {}
    completed_am7: set[str] = set()
    completed_au8: set[str] = set()

    for r in c.fetchall():
        st = r["stage"]; sn = r["serial_number"]; ts = r["timestamp"]; mdl = (r["model"] or "").upper()

        # 最新一次事件（同時間時 completed > coating > aging）
        if sn not in latest_by_sn:
            latest_by_sn[sn] = (st, ts)
        else:
            prev_st, prev_ts = latest_by_sn[sn]
            if ts > prev_ts or (ts == prev_ts and FLOW_ORDER[st] > FLOW_ORDER[prev_st]):
                latest_by_sn[sn] = (st, ts)

        if st == "completed":
            if mdl == "AM7": completed_am7.add(sn)
            elif mdl == "AU8": completed_au8.add(sn)

    aging_cnt = sum(1 for st, _ in latest_by_sn.values() if st == "aging")
    coating_cnt = sum(1 for st, _ in latest_by_sn.values() if st == "coating")
    completed_cnt = sum(1 for st, _ in latest_by_sn.values() if st == "completed")
    pairs = min(len(completed_am7), len(completed_au8))

    return WeeklyStats(
        range=label, aging=aging_cnt, coating=coating_cnt, completed=completed_cnt,
        pairs=pairs, completedByModel={"AM7": len(completed_am7), "AU8": len(completed_au8)}
    )


def _slip_status(conn: sqlite3.Connection, slip_number: str) -> SlipStatus:
    """
    回傳單一 slip 的完成/在製進度：
    - completedPairs / remainingPairs：以 **排除 NG** 的 completed 對數為基礎
    - agingPairs / coatingPairs / wipPairs：以 **排除 NG** 的在製對數
    """
    c = conn.cursor()

    # 目標
    c.execute("SELECT target_pairs FROM slips WHERE slip_number=?", (slip_number,))
    row = c.fetchone()
    target_pairs = int(row["target_pairs"]) if row else 0

    # 各站板件數（原樣，不扣 NG，提供給前端「Completed Boards」用）
    c.execute("SELECT stage, COUNT(*) cnt FROM boards WHERE slip_number=? GROUP BY stage", (slip_number,))
    cnt_by_stage = {r["stage"]: int(r["cnt"]) for r in c.fetchall()}

    # pairs 計算（排除 NG）
    def _pairs_for_stage(stage: str) -> int:
        c.execute(
            """
            SELECT UPPER(model) AS m, COUNT(*) AS cnt
            FROM boards
            WHERE slip_number=? AND stage=? AND (ng_flag IS NULL OR ng_flag=0)
            GROUP BY UPPER(model)
            """,
            (slip_number, stage),
        )
        by_model = {r["m"]: int(r["cnt"]) for r in c.fetchall()}
        am7 = by_model.get("AM7", 0)
        au8 = by_model.get("AU8", 0)
        return min(am7, au8)

    aging_pairs = _pairs_for_stage("aging")
    coating_pairs = _pairs_for_stage("coating")
    completed_pairs = _pairs_for_stage("completed")  # 排除 NG

    wip_pairs = aging_pairs + coating_pairs

    status = SlipStatus(
        slipNumber=slip_number,
        targetPairs=target_pairs,
        aging=cnt_by_stage.get("aging", 0),
        coating=cnt_by_stage.get("coating", 0),
        completed=cnt_by_stage.get("completed", 0),
        # completed by model（維持提供，來源一樣從 completed stage 計）
        completedAM7=0,
        completedAU8=0,
        completedPairs=completed_pairs,
        remainingPairs=max(target_pairs - completed_pairs, 0),
        # 新增欄位
        agingPairs=aging_pairs,
        coatingPairs=coating_pairs,
        wipPairs=wip_pairs,
        remainingPairsAfterWIP=max(target_pairs - min(target_pairs, completed_pairs + wip_pairs), 0),
    )

    # 填 completedAM7/AU8（方便除錯）
    c.execute(
        """
        SELECT UPPER(model) AS m, COUNT(*) AS cnt
        FROM boards
        WHERE slip_number=? AND stage='completed' AND (ng_flag IS NULL OR ng_flag=0)
        GROUP BY UPPER(model)
        """,
        (slip_number,),
    )
    by_m = {r["m"]: int(r["cnt"]) for r in c.fetchall()}
    status.completedAM7 = by_m.get("AM7", 0)
    status.completedAU8 = by_m.get("AU8", 0)

    return status


# ========== 廣播 ==========
async def _broadcast_stats_async():
    from core.ws_manager import ws_manager
    conn = None
    try:
        conn = open_conn()
        stats = _get_statistics(conn)
        payload = stats.model_dump() if hasattr(stats, "model_dump") else (stats.dict() if hasattr(stats, "dict") else stats.__dict__)
        await ws_manager.broadcast({"type": "statistics_update", "statistics": payload})
    finally:
        if conn:
            conn.close()


# ========== REST ==========
@router.get("/boards", response_model=List[BoardResponse])
async def get_boards(
    stage: Optional[str] = Query(None, pattern="^(all|aging|coating|completed)$"),
    search: Optional[str] = Query(None, max_length=100),
    model: Optional[str] = Query(None, pattern="^(AM7|AU8)$"),
    slip: Optional[str] = Query(None, max_length=100),
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    mdl = model.upper() if model else None
    return _get_all_boards(db, stage, search, mdl, slip)


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
    b = _create_board_internal(db, board_data, current_user.username)
    from core.ws_manager import ws_manager
    await ws_manager.broadcast({"type": "board_update", "action": "create", "board": b})
    await _broadcast_stats_async()
    return b


@router.put("/boards/{serial_number}", response_model=BoardResponse)
async def update_board(
    serial_number: str,
    update_data: BoardUpdate,
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    b = _update_board_stage_internal(db, serial_number, update_data.stage, current_user.username)
    from core.ws_manager import ws_manager
    await ws_manager.broadcast({"type": "board_update", "action": "update", "board": b})
    await _broadcast_stats_async()
    return b


@router.patch("/boards/{serial_number}/admin", response_model=BoardResponse)
async def admin_edit_board(
    serial_number: str,
    patch: BoardAdminUpdate,
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can edit boards")

    c = db.cursor()
    c.execute("SELECT id, serial_number, stage FROM boards WHERE serial_number=?", (serial_number,))
    row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Board {serial_number} not found")

    board_id, old_sn, old_stage = row["id"], row["serial_number"], row["stage"]
    sets: List[str] = []
    params: List[Any] = []

    if patch.batchNumber is not None: sets.append("batch_number=?"); params.append(patch.batchNumber)

    if patch.model is not None:
        mdl = (patch.model or "").upper()
        if mdl == "AUTO-DETECT": mdl = infer_model(old_sn) or mdl
        if mdl not in ALLOWED_HARD_MODELS: raise HTTPException(status_code=400, detail="Invalid model (AM7/AU8 only)")
        sets.append("model=?"); params.append(mdl)

    new_stage_for_history: Optional[str] = None
    if patch.stage is not None:
        sets.append("stage=?"); params.append(patch.stage)
        if patch.stage != old_stage: new_stage_for_history = patch.stage

    if patch.slipNumber is not None: sets.append("slip_number=?"); params.append(patch.slipNumber)
    if patch.startTime is not None:  sets.append("start_time=?");  params.append(patch.startTime)

    now = now_utc_iso()
    sets.append("last_update=?"); params.append(patch.lastUpdate or now)
    sets.append("operator=?");    params.append(patch.operator or current_user.username)

    params.append(old_sn)
    c.execute(f"UPDATE boards SET {', '.join(sets)} WHERE serial_number=?", params)

    if new_stage_for_history:
        c.execute(
            "INSERT INTO board_history (board_id, stage, timestamp, operator, notes) VALUES (?, ?, ?, ?, ?)",
            (board_id, new_stage_for_history, now, current_user.username, patch.note or "admin edit"),
        )

    if patch.newSerialNumber and patch.newSerialNumber != old_sn:
        c.execute("SELECT 1 FROM boards WHERE serial_number=?", (patch.newSerialNumber,))
        if c.fetchone():
            raise HTTPException(status_code=400, detail=f"Serial {patch.newSerialNumber} already exists")
        c.execute("UPDATE boards SET serial_number=? WHERE id=?", (patch.newSerialNumber, board_id))

    eff_pairs = _effective_target_pairs_from_admin(patch)
    if patch.slipNumber:
        _ensure_slip(db, patch.slipNumber, eff_pairs)

    db.commit()
    new_sn = patch.newSerialNumber or old_sn
    b = _get_board_by_serial(db, new_sn)

    from core.ws_manager import ws_manager
    await ws_manager.broadcast({"type": "board_update", "action": "admin_edit", "board": b})
    await _broadcast_stats_async()
    return b


@router.delete("/boards/{serial_number}")
async def delete_board(
    serial_number: str,
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can delete boards")

    c = db.cursor()
    c.execute("SELECT id FROM boards WHERE serial_number=?", (serial_number,))
    row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Board {serial_number} not found")

    bid = row["id"]
    c.execute("DELETE FROM board_history WHERE board_id=?", (bid,))
    c.execute("DELETE FROM boards WHERE id=?", (bid,))
    db.commit()

    from core.ws_manager import ws_manager
    await ws_manager.broadcast({"type": "board_deleted", "serialNumber": serial_number})
    await _broadcast_stats_async()
    return {"message": f"Board {serial_number} deleted successfully"}



@router.post("/scan", response_model=BoardResponse, summary="Scan upsert（存在就更新，不存在就建立；強制流程順序＋同日防重複）")
async def scan_upsert(
    payload: BoardCreate,
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    serial = payload.serialNumber
    if not serial:
        raise HTTPException(status_code=400, detail="serialNumber required")

    if payload.slipNumber:
        _ensure_slip(db, payload.slipNumber, _effective_target_pairs_from_create(payload))

    existing = _get_board_by_serial(db, serial)
    if existing:
        # 若本次帶了不同 slipNumber，先掛上 slip 並記歷史
        if payload.slipNumber and existing.get("slipNumber") != payload.slipNumber:
            c = db.cursor()
            now = now_utc_iso()
            c.execute(
                "UPDATE boards SET slip_number=?, last_update=?, operator=? WHERE serial_number=?",
                (payload.slipNumber, now, current_user.username, serial),
            )
            c.execute(
                "INSERT INTO board_history (board_id, stage, timestamp, operator, notes) VALUES (?, ?, ?, ?, ?)",
                (existing["id"], existing["stage"], now, current_user.username, f"attach slip {payload.slipNumber}"),
            )
            db.commit()
        b = _update_board_stage_internal(db, serial, payload.stage, current_user.username)
    else:
        b = _create_board_internal(db, payload, current_user.username)

    from core.ws_manager import ws_manager
    await ws_manager.broadcast({"type": "board_update", "board": b})
    await _broadcast_stats_async()
    return b


# ======= NG 標記/清除 =======
@router.patch("/boards/{serial_number}/ng", response_model=BoardResponse, summary="標記/取消 NG（只影響 Completed 計數與 Available）")
async def mark_ng(
    serial_number: str,
    payload: NGPatch,
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    c = db.cursor()
    c.execute("SELECT id, stage FROM boards WHERE serial_number=?", (serial_number,))
    row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Board {serial_number} not found")

    now = now_utc_iso()
    if payload.ng:
        c.execute(
            "UPDATE boards SET ng_flag=1, ng_reason=?, ng_time=?, last_update=?, operator=? WHERE serial_number=?",
            (payload.reason or "", now, now, current_user.username, serial_number),
        )
    else:
        c.execute(
            "UPDATE boards SET ng_flag=0, ng_reason=NULL, ng_time=NULL, last_update=?, operator=? WHERE serial_number=?",
            (now, current_user.username, serial_number),
        )
    db.commit()

    b = _get_board_by_serial(db, serial_number)
    from core.ws_manager import ws_manager
    await ws_manager.broadcast({"type": "board_update", "action": "ng", "board": b})
    await _broadcast_stats_async()
    return b


@router.get("/statistics", response_model=StageStats)
async def get_statistics(
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    return _get_statistics(db)


# （可選）供前端初始化使用的 inventory 總覽
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


@router.get("/inventory", response_model=InventorySummary, summary="PCBA Inventory Summary（available/used/completed）")
async def get_inventory_summary(
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    stats = _get_statistics(db)
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


@router.get("/metrics/weekly", response_model=WeeklyStats, summary="每週統計（Mon–Sun, LA）")
async def get_weekly_metrics_alias(
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    return _weekly_stats(db)


@router.get("/statistics/weekly", response_model=WeeklyStats, summary="每週統計（Mon–Sun, LA）")
async def get_weekly_stats(
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    return _weekly_stats(db)


# ======== Slip APIs ========
@router.post("/slips", summary="建立/更新 Packing Slip 目標對數")
async def upsert_slip(
    slip: SlipUpsert,
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_slip(db, slip.slipNumber, slip.targetPairs)
    return {"message": "OK"}


@router.get("/slips", response_model=List[SlipListItem], summary="列出所有 Packing Slips（含分站別統計）")
async def list_slips(
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    c = db.cursor()
    # Completed Pairs 改為「排除 NG」計算；aging/coating/completed 欄保留板件數
    c.execute(
        """
        SELECT
          s.slip_number AS slip,
          s.target_pairs AS target_pairs,
          s.updated_at  AS updated_at,
          COALESCE(SUM(CASE WHEN b.stage='aging'     THEN 1 ELSE 0 END), 0) AS aging,
          COALESCE(SUM(CASE WHEN b.stage='coating'   THEN 1 ELSE 0 END), 0) AS coating,
          COALESCE(SUM(CASE WHEN b.stage='completed' THEN 1 ELSE 0 END), 0) AS completed,
          -- pairs by model with NG excluded
          COALESCE(SUM(CASE WHEN b.stage='completed' AND (b.ng_flag IS NULL OR b.ng_flag=0) AND UPPER(b.model)='AM7' THEN 1 ELSE 0 END), 0) AS completed_am7_ok,
          COALESCE(SUM(CASE WHEN b.stage='completed' AND (b.ng_flag IS NULL OR b.ng_flag=0) AND UPPER(b.model)='AU8' THEN 1 ELSE 0 END), 0) AS completed_au8_ok
        FROM slips s
        LEFT JOIN boards b ON b.slip_number = s.slip_number
        GROUP BY s.slip_number
        ORDER BY s.updated_at DESC
        """
    )
    rows = c.fetchall()
    result: List[SlipListItem] = []
    for r in rows:
        result.append(
            SlipListItem(
                slipNumber=r["slip"],
                targetPairs=int(r["target_pairs"] or 0),
                aging=int(r["aging"] or 0),
                coating=int(r["coating"] or 0),
                completed=int(r["completed"] or 0),
                completedPairs=min(int(r["completed_am7_ok"] or 0), int(r["completed_au8_ok"] or 0)),
                updatedAt=r["updated_at"],
            )
        )
    return result


@router.patch("/slips/{slip_number}", summary="更新單一 slip 的 targetPairs")
async def update_slip_target(
    slip_number: str,
    patch: SlipTargetPatch,
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    c = db.cursor()
    now = now_utc_iso()
    c.execute("SELECT 1 FROM slips WHERE slip_number=?", (slip_number,))
    if not c.fetchone():
        # 若不存在就建立（與 POST 行為一致）
        c.execute(
            "INSERT INTO slips (slip_number, target_pairs, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (slip_number, int(patch.targetPairs), now, now),
        )
    else:
        c.execute(
            "UPDATE slips SET target_pairs=?, updated_at=? WHERE slip_number=?",
            (int(patch.targetPairs), now, slip_number),
        )
    db.commit()
    return {"message": "OK"}


@router.delete("/slips/{slip_number}", summary="刪除 slip（無關聯板件時才允許）")
async def delete_slip(
    slip_number: str,
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    c = db.cursor()
    c.execute("SELECT COUNT(*) AS cnt FROM boards WHERE slip_number=?", (slip_number,))
    cnt = int(c.fetchone()["cnt"] or 0)
    if cnt > 0:
        raise HTTPException(status_code=409, detail="Cannot delete: related boards exist")
    c.execute("DELETE FROM slips WHERE slip_number=?", (slip_number,))
    db.commit()
    return {"message": f"Slip {slip_number} deleted"}


@router.get("/slips/{slip_number}/status", response_model=SlipStatus, summary="查詢單一 Packing Slip 進度")
async def slip_status(
    slip_number: str,
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    return _slip_status(db, slip_number)


@router.get("/slips/{slip_number}", response_model=SlipStatus, summary="查詢單一 Packing Slip 進度（別名）")
async def slip_status_alias(
    slip_number: str,
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    return _slip_status(db, slip_number)


# ======== 維護 / 健檢 ========
@router.get("/maintenance/health")
async def pcba_db_health(
    db: sqlite3.Connection = Depends(get_pcba_db),
    current_user: User = Depends(get_current_user),
):
    try:
        row = db.execute("PRAGMA integrity_check").fetchone()
        status = str(row[0]) if row else "unknown"
        return {"ok": status.lower() == "ok", "detail": status, "dbPath": str(resolve_db_path())}
    except Exception as e:
        return {"ok": False, "detail": str(e), "dbPath": str(resolve_db_path())}


@router.post("/maintenance/repair")
async def pcba_db_repair(
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can repair the database")
    db_path = resolve_db_path()
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backups = []
    for ext in ("", "-wal", "-shm"):
        p = Path(str(db_path) + ext)
        if p.exists():
            backup = Path(str(db_path) + f".manual-{ts}{ext}")
            try:
                p.replace(backup)
                backups.append(str(backup))
            except Exception as e:
                logger.warning("manual backup failed for %s: %s", p, e)
    _create_empty_schema(db_path)
    return {"message": "PCBA DB recreated", "backups": backups, "dbPath": str(db_path)}


@router.get("/debug/info")
async def debug_info(current_user: User = Depends(get_current_user)):
    p = resolve_db_path()
    total = 0
    integrity = "unknown"
    conn = None
    try:
        conn = open_conn()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM boards")
        total = int(cur.fetchone()[0])
        try:
            r = cur.execute("PRAGMA integrity_check").fetchone()
            integrity = str(r[0]) if r else "unknown"
        except Exception:
            integrity = "check_failed"
    finally:
        if conn:
            conn.close()
    return {"dbPath": str(p.resolve()), "cwd": str(Path.cwd()), "totalRows": total, "integrity": integrity}


@router.get("/models/infer")
async def infer_model_api(serial: str, current_user: User = Depends(get_current_user)):
    mdl = infer_model(serial)
    return {"serial": serial, "model": mdl or "UNKNOWN"}


@router.post("/broadcast")
async def broadcast_message(message: Dict[str, Any], current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only administrators can broadcast messages")
    from core.ws_manager import ws_manager
    await ws_manager.broadcast(message)
    return {"message": "Broadcast sent successfully"}
