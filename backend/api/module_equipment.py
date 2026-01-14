# api/module_equipment.py
from __future__ import annotations

from datetime import datetime, date, timedelta
import os
import re
import json
import logging
from typing import List, Optional, Dict, Any, Set

from fastapi import APIRouter, Depends, HTTPException, Query, Body, Request
from sqlalchemy import (
    create_engine, func, Column, Integer, String, DateTime,
    Date, Float, text as sqltext
)
from sqlalchemy.orm import Session, sessionmaker, declarative_base
from pydantic import BaseModel, ValidationError

# ───────────────────────── Logger ─────────────────────────
log = logging.getLogger("module_equipment")
if not log.handlers:
    log.addHandler(logging.StreamHandler())
log.setLevel(logging.INFO)

def _is_blank(s: Optional[str]) -> bool:
    return s is None or (isinstance(s, str) and s.strip() == "")

# ───────────────────────── Config（DB 在根目錄） ─────────────────────────
DB_PATH = os.getenv("MODULE_EQUIPMENT_DB_PATH", "./module_equipment.db")
SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

router = APIRouter(
    prefix="/module_equipment",     # 由 main.py 掛在 /api 之下 → /api/module_equipment/...
    tags=["module_equipment"],
    responses={404: {"description": "Not found"}},
)

# ───────────────────────── ORM ─────────────────────────
class Module_EquipmentRecord(Base):
    __tablename__ = "module_equipment_record"

    id             = Column(Integer, primary_key=True, index=True)
    process_type   = Column(String, nullable=False, index=True)  # 製程名（=工位名）
    start_time     = Column(DateTime, nullable=False, index=True)
    end_time       = Column(DateTime, nullable=False)
    user_code      = Column(String, nullable=False, index=True)
    # 工位名：= 製程名（寫入時自動等於 process_type）
    station        = Column(String, nullable=True, index=True)
    process_time   = Column(Float, nullable=False)                # 秒
    record_date    = Column(Date,  nullable=False, index=True)    # 依 start_time 取 date
    created_at     = Column(DateTime, nullable=False, server_default=func.current_timestamp())
    # ← 新增：追蹤本筆來源批次
    ingest_batch_id = Column(Integer, nullable=True, index=True)

# ─────────── 聚合表 DDL（單句、避免 SQLite 一次一語句錯誤） ───────────
AGG_PROC_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS module_equipment_daily_proc(
  stat_date    DATE    NOT NULL,
  process_type TEXT    NOT NULL,
  station      TEXT,
  avg_time     REAL    NOT NULL,
  min_time     REAL    NOT NULL,
  max_time     REAL    NOT NULL,
  total_count  INTEGER NOT NULL,
  total_time   REAL    NOT NULL,
  PRIMARY KEY(stat_date, process_type, station)
);
"""
AGG_PROC_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS idx_me_agg_proc_date
ON module_equipment_daily_proc(stat_date);
"""

AGG_USER_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS module_equipment_daily_user(
  stat_date    DATE    NOT NULL,
  user_code    TEXT    NOT NULL,
  process_type TEXT    NOT NULL,
  station      TEXT,
  avg_time     REAL    NOT NULL,
  total_count  INTEGER NOT NULL,
  total_time   REAL    NOT NULL,
  PRIMARY KEY(stat_date, user_code, process_type, station)
);
"""
AGG_USER_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS idx_me_agg_user_date
ON module_equipment_daily_user(stat_date);
"""

# ─────────── 新增：原始批次與壞筆日誌 DDL ───────────
INGEST_BATCH_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS module_equipment_ingest_batch(
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  client_ip       TEXT,
  items_count     INTEGER NOT NULL,
  saved_count     INTEGER NOT NULL,
  error_count     INTEGER NOT NULL,
  payload_preview TEXT,
  payload_full    TEXT
);
"""
INGEST_BATCH_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS idx_me_ingest_batch_created
ON module_equipment_ingest_batch(created_at);
"""

BAD_ITEM_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS module_equipment_bad_item(
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id       INTEGER NOT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  client_ip      TEXT,
  process_type   TEXT,
  user_code      TEXT,
  start_time_raw TEXT,
  end_time_raw   TEXT,
  code           TEXT,
  msg            TEXT,
  raw_item       TEXT,
  FOREIGN KEY(batch_id) REFERENCES module_equipment_ingest_batch(id)
);
"""
BAD_ITEM_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS idx_me_bad_item_batch
ON module_equipment_bad_item(batch_id, created_at);
"""

# 若舊 DB 尚未有 ingest_batch_id 欄位，動態補上
ADD_BATCH_COL_SQL = "ALTER TABLE module_equipment_record ADD COLUMN ingest_batch_id INTEGER;"
ADD_BATCH_COL_IDX_SQL = """
CREATE INDEX IF NOT EXISTS idx_me_record_batch
ON module_equipment_record(ingest_batch_id);
"""

# ───────────────────────── Pydantic ─────────────────────────
class Module_EquipmentItem(BaseModel):
    processType: str
    StartTime: str
    EndTime:   str
    userCode:  str
    # station 不需要；後端會自動等於 processType
    station: Optional[str] = None

class Module_EquipmentDataRequest(BaseModel):
    list: List[Module_EquipmentItem]

class Module_ProcessTimeStats(BaseModel):
    processType: str
    station: Optional[str] = None
    date: date
    avgProcessTime: float
    minProcessTime: float
    maxProcessTime: float
    totalCount: int
    totalTime: float

class Module_DashboardData(BaseModel):
    date: date
    processStats: List[Dict[str, Any]]
    totalProcesses: int
    avgDailyProcessTime: float

# ───────────────────────── DB init ─────────────────────────
def _init_db() -> None:
    """啟動時自動建表與索引；可直接刪 DB 檔，會自動重建。"""
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        for stmt in (
            AGG_PROC_TABLE_SQL,
            AGG_PROC_INDEX_SQL,
            AGG_USER_TABLE_SQL,
            AGG_USER_INDEX_SQL,
            INGEST_BATCH_TABLE_SQL,
            INGEST_BATCH_INDEX_SQL,
            BAD_ITEM_TABLE_SQL,
            BAD_ITEM_INDEX_SQL,
        ):
            conn.exec_driver_sql(stmt)
        # 嘗試補欄位（若已存在會丟錯，忽略即可）
        try:
            conn.exec_driver_sql(ADD_BATCH_COL_SQL)
        except Exception:
            pass
        conn.exec_driver_sql(ADD_BATCH_COL_IDX_SQL)

_init_db()

# ───────────────────────── DI ─────────────────────────
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ───────────────────────── Helpers：時間解析 ─────────────────────────
_TIME_FMTS: List[str] = [
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y/%m/%d %H:%M:%S",
    "%Y/%m/%d %H:%M",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%dT%H:%M",
]

def _normalize_time_string(s: str) -> str:
    """把常見變體正規化：全形冒號、Z 結尾、小數秒等"""
    s = s.strip()
    # 全形 → 半形
    s = s.replace("：", ":").replace("／", "/")
    # 去掉毫秒與 Z
    s = re.sub(r"\.\d+(Z)?$", "", s, flags=re.IGNORECASE)
    s = re.sub(r"Z$", "", s, flags=re.IGNORECASE)
    return s

def parse_ts(raw: str) -> datetime:
    if not isinstance(raw, str):
        detail = f"time must be string, got {type(raw)}"
        log.warning("[module_equipment] 400 parse_ts: %s", detail)
        raise HTTPException(400, detail)
    s = _normalize_time_string(raw)
    for fmt in _TIME_FMTS:
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    # 嘗試：若只有到分鐘，補 :00 再試
    if re.match(r"^\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}$", s):
        s2 = s + ":00"
        for fmt in _TIME_FMTS:
            try:
                return datetime.strptime(s2, fmt)
            except ValueError:
                continue
    detail = ("invalid time format: '%s'. accepted examples: "
              "2025-07-14 11:20:37 / 2025/07/14 11:20 / 2025-07-14T11:20:37") % raw
    log.warning("[module_equipment] 400 parse_ts: %s", detail)
    raise HTTPException(400, detail)

# ───────────────────────── Helpers：彙總重建 ─────────────────────────
def _upsert_daily_proc(db: Session, the_date: date) -> None:
    """重算『每日 × 製程(=工位)』聚合，直接覆蓋該日。"""
    db.execute(sqltext("DELETE FROM module_equipment_daily_proc WHERE stat_date=:d"),
               {"d": the_date.isoformat()})
    rows = db.execute(sqltext("""
        SELECT
          :d AS stat_date,
          process_type,
          COALESCE(station, process_type) AS station,
          AVG(process_time) AS avg_time,
          MIN(process_time) AS min_time,
          MAX(process_time) AS max_time,
          COUNT(*) AS total_count,
          SUM(process_time) AS total_time
        FROM module_equipment_record
        WHERE record_date = :d
        GROUP BY process_type, COALESCE(station, process_type)
    """), {"d": the_date.isoformat()}).mappings().all()
    if rows:
        db.execute(sqltext("""
            INSERT INTO module_equipment_daily_proc
            (stat_date, process_type, station, avg_time, min_time, max_time, total_count, total_time)
            VALUES (:stat_date, :process_type, :station, :avg_time, :min_time, :max_time, :total_count, :total_time)
        """), rows)

def _upsert_daily_user(db: Session, the_date: date) -> None:
    """重算『每日 × 使用者 × 製程(=工位)』聚合，直接覆蓋該日。"""
    db.execute(sqltext("DELETE FROM module_equipment_daily_user WHERE stat_date=:d"),
               {"d": the_date.isoformat()})
    rows = db.execute(sqltext("""
        SELECT
          :d AS stat_date,
          user_code,
          process_type,
          COALESCE(station, process_type) AS station,
          AVG(process_time) AS avg_time,
          COUNT(*) AS total_count,
          SUM(process_time) AS total_time
        FROM module_equipment_record
        WHERE record_date = :d
        GROUP BY user_code, process_type, COALESCE(station, process_type)
    """), {"d": the_date.isoformat()}).mappings().all()
    if rows:
        db.execute(sqltext("""
            INSERT INTO module_equipment_daily_user
            (stat_date, user_code, process_type, station, avg_time, total_count, total_time)
            VALUES (:stat_date, :user_code, :process_type, :station, :avg_time, :total_count, :total_time)
        """), rows)

def _rebuild_one_day(db: Session, the_date: date) -> None:
    _upsert_daily_proc(db, the_date)
    _upsert_daily_user(db, the_date)

# ───────────────────────── Helpers：輸入標準化 ─────────────────────────
def _normalize_payload_to_items(payload: Any) -> List[Dict[str, Any]]:
    """
    支援三種型態：
      1) {"list":[{...}, ...]}
      2) [{...}, ...]
      3) {...}  (單筆)
    仍建議用 #1
    """
    if payload is None:
        return []
    if isinstance(payload, dict):
        if "list" in payload and isinstance(payload["list"], list):
            return payload["list"]
        else:
            return [payload]
    if isinstance(payload, list):
        return payload
    raise HTTPException(400, "invalid payload; expected {'list': [...]}, [...] or single object")

def _validate_items(items: List[Dict[str, Any]]) -> List[Module_EquipmentItem]:
    out: List[Module_EquipmentItem] = []
    for idx, raw in enumerate(items, 1):
        try:
            out.append(Module_EquipmentItem(**raw))
        except ValidationError as ve:
            raise HTTPException(400, f"[item #{idx}] {ve.errors()}") from ve
    return out

# ───────────────────────── API：設備上報入口（部分成功版 + 日誌） ─────────────────────────
@router.post("/data", response_model=Dict[str, Any])
async def receive_equipment_data(
    request: Request,
    payload: Any = Body(..., description="設備上報：{'list':[...]} 或直接陣列/單筆"),
    echo: int = Query(0, ge=0, le=50, description="回傳前 N 筆原始項目以便除錯"),
    db: Session = Depends(get_db),
):
    """
    設備上報唯一入口：/api/module_equipment/data

    - 支援三種 payload 型態：{"list":[...]}, [...], {...}
    - 逐筆驗證與寫入：壞筆跳過、好筆照常入庫
    - 會建立 ingest 批次日誌，記錄原始 payload（預覽 + 可選 full）
    - 回傳 partial_success 時會附上錯誤清單（最多 50 筆）與 batchId
    - 每次寫入後自動重算 touched_days 的當日聚合
    """
    # 1) 正規化 payload
    log.debug("[module_equipment] /data raw payload=%s", payload)
    items_raw = _normalize_payload_to_items(payload)
    log.info("[module_equipment] /data called items=%d", len(items_raw))
    if not items_raw:
        raise HTTPException(400, "list is empty")

    # 1.1 建立批次日誌（獨立交易，避免主交易 rollback 影響）
    client_ip = request.client.host if request and request.client else None
    preview_len = int(os.getenv("ME_PAYLOAD_PREVIEW_CHARS", "4000"))
    save_full   = os.getenv("ME_SAVE_FULL_PAYLOAD", "0") == "1"
    try:
        raw_str = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    except Exception:
        raw_str = str(payload)
    payload_preview = raw_str[:preview_len]
    payload_full    = raw_str if save_full else None

    with engine.begin() as conn:
        conn.execute(sqltext("""
            INSERT INTO module_equipment_ingest_batch
              (client_ip, items_count, saved_count, error_count, payload_preview, payload_full)
            VALUES (:ip, :ic, 0, 0, :prev, :full)
        """), {"ip": client_ip, "ic": len(items_raw), "prev": payload_preview, "full": payload_full})
        batch_id = conn.execute(sqltext("SELECT last_insert_rowid()")).scalar()

    # 2) Pydantic 驗證必填欄位存在（型別檢查）
    items = _validate_items(items_raw)

    touched_days: Set[date] = set()
    saved = 0
    errors: List[Dict[str, Any]] = []
    bad_rows_sql_params: List[Dict[str, Any]] = []

    try:
        # 3) 逐筆處理，壞筆跳過，不讓整批失敗
        for idx, item in enumerate(items, 1):
            # 3.1 先過空值（避免 parse_ts('') 直接 400）
            if _is_blank(item.StartTime) or _is_blank(item.EndTime):
                err = {
                    "index": idx,
                    "code": "EMPTY_TIME",
                    "msg": "StartTime/EndTime is blank",
                    "item": item.dict(),
                }
                errors.append(err)
                bad_rows_sql_params.append({
                    "batch_id": batch_id,
                    "ip": client_ip,
                    "pt": item.processType,
                    "uc": item.userCode,
                    "st": item.StartTime,
                    "et": item.EndTime,
                    "code": "EMPTY_TIME",
                    "msg": "StartTime/EndTime is blank",
                    "raw": json.dumps(item.dict(), ensure_ascii=False),
                })
                log.warning("[module_equipment] skip item#%s: EMPTY_TIME %s", idx, item.dict())
                continue

            # 3.2 時間格式解析
            try:
                start_dt = parse_ts(item.StartTime)
                end_dt   = parse_ts(item.EndTime)
            except HTTPException as he:
                err = {
                    "index": idx,
                    "code": "BAD_TIME_FORMAT",
                    "msg": he.detail,
                    "item": item.dict(),
                }
                errors.append(err)
                bad_rows_sql_params.append({
                    "batch_id": batch_id,
                    "ip": client_ip,
                    "pt": item.processType,
                    "uc": item.userCode,
                    "st": item.StartTime,
                    "et": item.EndTime,
                    "code": "BAD_TIME_FORMAT",
                    "msg": str(he.detail),
                    "raw": json.dumps(item.dict(), ensure_ascii=False),
                })
                log.warning("[module_equipment] skip item#%s: BAD_TIME_FORMAT %s item=%s",
                            idx, he.detail, item.dict())
                continue
            except Exception as exc:
                err = {
                    "index": idx,
                    "code": "PARSE_ERROR",
                    "msg": str(exc),
                    "item": item.dict(),
                }
                errors.append(err)
                bad_rows_sql_params.append({
                    "batch_id": batch_id,
                    "ip": client_ip,
                    "pt": item.processType,
                    "uc": item.userCode,
                    "st": item.StartTime,
                    "et": item.EndTime,
                    "code": "PARSE_ERROR",
                    "msg": str(exc),
                    "raw": json.dumps(item.dict(), ensure_ascii=False),
                })
                log.warning("[module_equipment] skip item#%s: PARSE_ERROR %s item=%s",
                            idx, exc, item.dict())
                continue

            # 3.3 時序檢查
            if end_dt < start_dt:
                err = {
                    "index": idx,
                    "code": "TIME_ORDER",
                    "msg": f"EndTime earlier than StartTime: {item.EndTime} < {item.StartTime}",
                    "item": item.dict(),
                }
                errors.append(err)
                bad_rows_sql_params.append({
                    "batch_id": batch_id,
                    "ip": client_ip,
                    "pt": item.processType,
                    "uc": item.userCode,
                    "st": item.StartTime,
                    "et": item.EndTime,
                    "code": "TIME_ORDER",
                    "msg": f"EndTime earlier than StartTime: {item.EndTime} < {item.StartTime}",
                    "raw": json.dumps(item.dict(), ensure_ascii=False),
                })
                log.warning("[module_equipment] skip item#%s: TIME_ORDER %s", idx, item.dict())
                continue

            # 3.4 計算秒數
            sec = max(0.0, (end_dt - start_dt).total_seconds())

            # 製程名 = 工位名（如需之後擴充 station，這裡可改成 item.station or item.processType）
            station_final = item.processType

            rec = Module_EquipmentRecord(
                process_type=item.processType.strip(),
                start_time=start_dt,
                end_time=end_dt,
                user_code=item.userCode.strip(),
                station=station_final.strip(),
                process_time=sec,
                record_date=start_dt.date(),
                ingest_batch_id=batch_id,  # ← 關聯批次
            )
            db.add(rec)
            saved += 1
            touched_days.add(rec.record_date)

        # 3.5 先把錯誤明細與批次統計落庫（即使等等主交易回滾也不影響）
        with engine.begin() as conn:
            if bad_rows_sql_params:
                conn.execute(sqltext("""
                    INSERT INTO module_equipment_bad_item
                      (batch_id, client_ip, process_type, user_code,
                       start_time_raw, end_time_raw, code, msg, raw_item)
                    VALUES (:batch_id, :ip, :pt, :uc, :st, :et, :code, :msg, :raw)
                """), bad_rows_sql_params)
            conn.execute(sqltext("""
                UPDATE module_equipment_ingest_batch
                   SET saved_count=:s, error_count=:e
                 WHERE id=:bid
            """), {"s": saved, "e": len(errors), "bid": batch_id})

        # 4) 如果完全沒成功，回 400 並附錯誤清單（批次資訊已寫入）
        if saved == 0:
            db.rollback()
            log.warning("[module_equipment] /data no valid records; errors=%d batch_id=%s",
                        len(errors), batch_id)
            raise HTTPException(
                status_code=400,
                detail={"message": "no valid records", "batchId": batch_id, "errors": errors}
            )

        # 5) 有成功的先提交，再重建聚合（僅 touched_days）
        db.commit()
        for d in touched_days:
            _rebuild_one_day(db, d)
        db.commit()

        # 6) 回傳部分成功 / 全部成功
        status = "success" if len(errors) == 0 else "partial_success"
        log.info("[module_equipment] /data %s saved=%d errors=%d batch_id=%s",
                 status, saved, len(errors), batch_id)
        return {
            "status": status,
            "batchId": batch_id,
            "clientIp": client_ip,
            "savedCount": saved,
            "errorCount": len(errors),
            "touchedDays": [d.isoformat() for d in sorted(touched_days)],
            "errors": errors[:50],           # 避免回應太大
            "echoItems": (items_raw[:echo] if echo else []),
        }

    except HTTPException:
        # 已知錯誤直接拋
        raise
    except Exception as exc:
        db.rollback()
        log.exception("[module_equipment] /data unexpected error: %s", exc)
        # 仍更新批次（saved 為目前值）
        with engine.begin() as conn:
            conn.execute(sqltext("""
                UPDATE module_equipment_ingest_batch
                   SET saved_count=:s, error_count=:e
                 WHERE id=:bid
            """), {"s": saved, "e": len(errors), "bid": batch_id})
        raise HTTPException(status_code=400, detail=str(exc))

# ───────────────────────── API：每日統計 ─────────────────────────
@router.get("/stats/daily", response_model=List[Module_ProcessTimeStats])
async def get_daily_stats(
    target_date: Optional[date] = Query(None, description="日期，預設今日"),
    db: Session = Depends(get_db),
):
    if not target_date:
        target_date = date.today()

    rows = db.execute(sqltext("""
        SELECT process_type, station, avg_time, min_time, max_time, total_count, total_time
        FROM module_equipment_daily_proc
        WHERE stat_date=:d
        ORDER BY process_type, COALESCE(station, process_type)
    """), {"d": target_date.isoformat()}).mappings().all()

    if not rows:
        _rebuild_one_day(db, target_date)
        db.commit()
        rows = db.execute(sqltext("""
            SELECT process_type, station, avg_time, min_time, max_time, total_count, total_time
            FROM module_equipment_daily_proc
            WHERE stat_date=:d
            ORDER BY process_type, COALESCE(station, process_type)
        """), {"d": target_date.isoformat()}).mappings().all()

    return [
        Module_ProcessTimeStats(
            processType=r["process_type"],
            station=r["station"],
            date=target_date,
            avgProcessTime=float(r["avg_time"] or 0),
            minProcessTime=float(r["min_time"] or 0),
            maxProcessTime=float(r["max_time"] or 0),
            totalCount=int(r["total_count"] or 0),
            totalTime=float(r["total_time"] or 0),
        )
        for r in rows
    ]

# ───────────────────────── API：區間統計（天粒度） ─────────────────────────
@router.get("/stats/range", response_model=List[Dict[str, Any]])
async def get_range_stats(
    start_date: Optional[date] = Query(None, description="開始日期"),
    end_date:   Optional[date] = Query(None, description="結束日期"),
    week: Optional[str] = Query(None, description="latest=本週自動 (含週六)"),
    process_type: Optional[str] = Query(None, description="製程/工位（同義）"),
    station: Optional[str] = Query(None, description="工位（同義，可不填）"),
    db: Session = Depends(get_db),
):
    # 1) 區間決定
    if start_date and end_date:
        s_day, e_day = start_date, end_date
    elif week == "latest":
        today_ = date.today()
        monday = today_ - timedelta(days=today_.weekday())  # 週一
        saturday = monday + timedelta(days=5)
        include_sat = today_.weekday() >= 5
        if not include_sat:
            # 看該週六是否有資料
            cnt_sat = db.execute(sqltext("""
                SELECT COUNT(*) AS c FROM module_equipment_record WHERE record_date=:d
            """), {"d": saturday.isoformat()}).scalar() or 0
            include_sat = cnt_sat > 0
        s_day, e_day = monday, (saturday if include_sat else monday + timedelta(days=4))
    else:
        raise HTTPException(400, "請給 start_date / end_date，或 week=latest")

    # 2) station 與 process_type 同義 → 若只帶 station 就當成 process_type
    if station and not process_type:
        process_type = station

    # 3) 優先用日聚合表
    conds = ["stat_date BETWEEN :s AND :e"]
    params = {"s": s_day.isoformat(), "e": e_day.isoformat()}
    if process_type:
        conds.append("process_type=:pt")
        params["pt"] = process_type

    rows = db.execute(sqltext(f"""
        SELECT stat_date AS date, process_type, station, avg_time, total_count
        FROM module_equipment_daily_proc
        WHERE {" AND ".join(conds)}
        ORDER BY stat_date, process_type
    """), params).mappings().all()

    # 沒聚合就動態重建後再查
    if not rows:
        d = s_day
        while d <= e_day:
            _rebuild_one_day(db, d)
            d += timedelta(days=1)
        db.commit()
        rows = db.execute(sqltext(f"""
            SELECT stat_date AS date, process_type, station, avg_time, total_count
            FROM module_equipment_daily_proc
            WHERE {" AND ".join(conds)}
            ORDER BY stat_date, process_type
        """), params).mappings().all()

    return [
        {
            "date": r["date"],
            "processType": r["process_type"],
            "station": r["station"],
            "avgProcessTime": float(r["avg_time"] or 0),
            "count": int(r["total_count"] or 0),
        }
        for r in rows
    ]

# ───────────────────────── API：Dashboard ─────────────────────────
@router.get("/dashboard", response_model=Module_DashboardData)
async def get_dashboard_data(
    target_date: Optional[date] = Query(None, description="日期，預設今日"),
    db: Session = Depends(get_db),
):
    if not target_date:
        target_date = date.today()

    stats = await get_daily_stats(target_date=target_date, db=db)
    total_proc  = sum(s.totalCount for s in stats)
    total_time  = sum(s.totalTime  for s in stats)
    avg_daily   = (total_time / total_proc) if total_proc else 0.0

    process_stats: List[Dict[str, Any]] = []
    for s in stats:
        process_stats.append({
            "processType": s.processType,
            "station": s.station,
            "avgTime": round(s.avgProcessTime, 2),
            "minTime": round(s.minProcessTime, 2),
            "maxTime": round(s.maxProcessTime, 2),
            "count": s.totalCount,
            "percentage": round((s.totalCount / total_proc * 100), 2) if total_proc else 0.0,
        })

    return Module_DashboardData(
        date=target_date,
        processStats=process_stats,
        totalProcesses=total_proc,
        avgDailyProcessTime=round(avg_daily, 2),
    )

# ───────────────────────── API：Process Types ─────────────────────────
@router.get("/process_types", response_model=List[str])
async def get_process_types(db: Session = Depends(get_db)):
    rows = db.execute(sqltext("""
        SELECT DISTINCT process_type FROM module_equipment_record ORDER BY process_type
    """)).fetchall()
    return [r[0] for r in rows if r and r[0]]

# ───────────────────────── API：User Stats（當日） ─────────────────────────
@router.get("/user-stats", response_model=List[Dict[str, Any]])
async def get_user_stats(
    target_date: Optional[date] = Query(None, description="日期，預設今日"),
    db: Session = Depends(get_db),
):
    if not target_date:
        target_date = date.today()

    rows = db.execute(sqltext("""
        SELECT user_code, process_type, station, total_count, avg_time
        FROM module_equipment_daily_user
        WHERE stat_date=:d
        ORDER BY user_code, process_type
    """), {"d": target_date.isoformat()}).mappings().all()

    if not rows:
        _rebuild_one_day(db, target_date)
        db.commit()
        rows = db.execute(sqltext("""
            SELECT user_code, process_type, station, total_count, avg_time
            FROM module_equipment_daily_user
            WHERE stat_date=:d
            ORDER BY user_code, process_type
        """), {"d": target_date.isoformat()}).mappings().all()

    return [
        {
            "userCode": r["user_code"],
            "operationCount": int(r["total_count"] or 0),
            "avgProcessTime": round(float(r["avg_time"] or 0), 2),
            "processType": r["process_type"],
            "station": r["station"],
        }
        for r in rows
    ]

# ───────────────────────── API：近期明細 ─────────────────────────
@router.get("/recent-records", response_model=List[Dict[str, Any]])
async def get_recent_records(
    limit: int = Query(10, ge=1, le=200, description="要取回的筆數"),
    db: Session = Depends(get_db),
):
    rows = db.execute(sqltext("""
        SELECT id, process_type, start_time, end_time, process_time, user_code, record_date, created_at, COALESCE(station, process_type) AS station
        FROM module_equipment_record
        ORDER BY created_at DESC
        LIMIT :n
    """), {"n": limit}).mappings().all()

    return [
        {
            "id": r["id"],
            "processType": r["process_type"],
            "startTime":   r["start_time"],
            "endTime":     r["end_time"],
            "processTime": round(float(r["process_time"] or 0), 2),
            "userCode":    r["user_code"],
            "recordDate":  r["record_date"],
            "createdAt":   r["created_at"],
            "station":     r["station"],
        }
        for r in rows
    ]

# ───────────────────────── API：24h 使用（熱力圖） ─────────────────────────
@router.get("/stats/hourly-usage", response_model=List[Dict[str, Any]])
async def get_hourly_usage(
    target_date: Optional[date] = Query(None, description="日期，預設今日"),
    process_type: Optional[str] = Query(None, description="製程/工位（同義，可選）"),
    station: Optional[str] = Query(None, description="工位（同義，可選）"),
    db: Session = Depends(get_db),
):
    if not target_date:
        target_date = date.today()
    if station and not process_type:
        process_type = station

    q = sqltext("""
        SELECT CAST(STRFTIME('%H', start_time) AS INTEGER) AS hh, COUNT(*) AS cnt
        FROM module_equipment_record
        WHERE record_date=:d
        {proc_filter}
        GROUP BY CAST(STRFTIME('%H', start_time) AS INTEGER)
        ORDER BY hh
    """.format(proc_filter="AND process_type=:pt" if process_type else ""))

    params = {"d": target_date.isoformat()}
    if process_type:
        params["pt"] = process_type

    rows = db.execute(q, params).fetchall()
    by_hour = {int(h): int(c or 0) for h, c in rows}
    max_cnt = max(by_hour.values()) if by_hour else 0

    out: List[Dict[str, Any]] = []
    for h in range(24):
        cnt = by_hour.get(h, 0)
        usage = round((cnt / max_cnt * 100), 0) if max_cnt > 0 else 0
        out.append({"hour": h, "usage": usage, "processes": cnt})
    return out

# ───────────────────────── Admin：重建聚合（回填/修復） ─────────────────────────
@router.post("/admin/rebuild-agg", response_model=Dict[str, Any])
def rebuild_agg(
    from_date: Optional[date] = Query(None, description="起始日 (YYYY-MM-DD)"),
    to_date:   Optional[date] = Query(None, description="結束日 (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
):
    """
    針對區間逐日重建聚合表（module_equipment_daily_proc / module_equipment_daily_user）
    不輸入就重建『今天』。
    """
    if not from_date and not to_date:
        from_date = to_date = date.today()
    elif from_date and not to_date:
        to_date = from_date
    elif to_date and not from_date:
        from_date = to_date

    if to_date < from_date:
        raise HTTPException(400, "to_date must be >= from_date")

    d = from_date
    n = 0
    while d <= to_date:
        _rebuild_one_day(db, d)
        n += 1
        d += timedelta(days=1)
    db.commit()
    return {"status": "ok", "daysRebuilt": n, "from": from_date, "to": to_date}

# ───────────────────────── KPI Summary（原樣保留） ─────────────────────────
@router.get("/stats/summary")
async def get_stats_summary(
    target_date: Optional[date] = Query(None, description="日期，預設今日"),
    db: Session = Depends(get_db),
):
    """提供前端 KPI 卡片所需匯總。"""
    if not target_date:
        target_date = date.today()

    # 先用日聚合表
    rows = db.execute(sqltext("""
        SELECT station, total_count, total_time
        FROM module_equipment_daily_proc
        WHERE stat_date=:d
    """), {"d": target_date.isoformat()}).mappings().all()

    if not rows:
        # 該日聚合不存在就重建一次
        _rebuild_one_day(db, target_date)
        db.commit()
        rows = db.execute(sqltext("""
            SELECT station, total_count, total_time
            FROM module_equipment_daily_proc
            WHERE stat_date=:d
        """), {"d": target_date.isoformat()}).mappings().all()

    total_ops = sum(int(r["total_count"] or 0) for r in rows)
    total_runtime = float(sum(r["total_time"] or 0.0 for r in rows))
    avg_time = (total_runtime / total_ops) if total_ops else 0.0
    active_stations = sum(1 for r in rows if int(r["total_count"] or 0) > 0)

    # 當日 active users（有作業數）
    urows = db.execute(sqltext("""
        SELECT COUNT(DISTINCT user_code) AS c
        FROM module_equipment_daily_user
        WHERE stat_date=:d AND total_count > 0
    """), {"d": target_date.isoformat()}).mappings().first()
    active_users = int((urows or {}).get("c") or 0)

    # 尖峰時段
    hrows = db.execute(sqltext("""
        SELECT CAST(STRFTIME('%H', start_time) AS INTEGER) AS hh, COUNT(*) AS cnt
        FROM module_equipment_record
        WHERE record_date=:d
        GROUP BY CAST(STRFTIME('%H', start_time) AS INTEGER)
        ORDER BY cnt DESC, hh ASC
        LIMIT 1
    """), {"d": target_date.isoformat()}).mappings().first()
    peak_hour = int((hrows or {}).get("hh") or 0)
    peak_ops  = int((hrows or {}).get("cnt") or 0)

    # 粗略設備使用率：總執行時間 / (啟用工位 × 24h)
    util = 0.0
    if active_stations > 0:
        util = total_runtime / (active_stations * 24 * 3600)
        if util < 0: util = 0.0
        if util > 1: util = 1.0

    return {
        "date": target_date,
        "totalOperations": total_ops,
        "averageTime": avg_time,
        "activeStations": active_stations,
        "activeUsers": active_users,
        "peakHour": peak_hour,
        "peakHourOperations": peak_ops,
        "totalRuntimeSeconds": total_runtime,
        "utilizationRate": util,
    }

# ───────────────────────── API：區間「每天 × 工位」明細 ─────────────────────────
@router.get("/stats/per-station-daily", response_model=List[Dict[str, Any]])
async def get_per_station_daily(
    start_date: Optional[date] = Query(None, description="開始日"),
    end_date:   Optional[date] = Query(None, description="結束日"),
    process_type: Optional[str] = Query(None, description="過濾特定工位/製程（選填）"),
    db: Session = Depends(get_db),
):
    """回傳區間內『每天 × 工位』的 avg/count/total，供多線趨勢圖。"""
    if not start_date and not end_date:
        end_date = date.today()
        start_date = end_date - timedelta(days=13)
    elif start_date and not end_date:
        end_date = start_date
    elif end_date and not start_date:
        start_date = end_date

    if end_date < start_date:
        raise HTTPException(400, "end_date must be >= start_date")

    conds = ["stat_date BETWEEN :s AND :e"]
    params = {"s": start_date.isoformat(), "e": end_date.isoformat()}
    if process_type:
        conds.append("process_type=:pt")
        params["pt"] = process_type

    # 直接用日聚合表
    rows = db.execute(sqltext(f"""
        SELECT stat_date AS date, process_type, COALESCE(station, process_type) AS station,
               avg_time, total_count, total_time
        FROM module_equipment_daily_proc
        WHERE {" AND ".join(conds)}
        ORDER BY stat_date, process_type
    """), params).mappings().all()

    # 若整段都沒有聚合，就重建後再查
    if not rows:
        d = start_date
        while d <= end_date:
            _rebuild_one_day(db, d)
            d += timedelta(days=1)
        db.commit()
        rows = db.execute(sqltext(f"""
            SELECT stat_date AS date, process_type, COALESCE(station, process_type) AS station,
                   avg_time, total_count, total_time
            FROM module_equipment_daily_proc
            WHERE {" AND ".join(conds)}
            ORDER BY stat_date, process_type
        """), params).mappings().all()

    return [
        {
            "date": r["date"],
            "processType": r["process_type"],
            "station": r["station"],
            "avgProcessTime": float(r["avg_time"] or 0),
            "count": int(r["total_count"] or 0),
            "totalTime": float(r["total_time"] or 0),
        }
        for r in rows
    ]

# ───────────────────────── Ingest 查詢 API（直接看打入原始資料） ─────────────────────────
@router.get("/ingest/batches", response_model=List[Dict[str, Any]])
async def list_ingest_batches(
    limit: int = Query(20, ge=1, le=200),
    include_full: bool = Query(False, description="需要同時設定環境變數 ME_SAVE_FULL_PAYLOAD=1 才可能有值"),
    db: Session = Depends(get_db),
):
    cols = "id, created_at, client_ip, items_count, saved_count, error_count, payload_preview"
    if include_full:
        cols += ", payload_full"
    rows = db.execute(sqltext(f"""
        SELECT {cols}
        FROM module_equipment_ingest_batch
        ORDER BY id DESC
        LIMIT :n
    """), {"n": limit}).mappings().all()
    return [dict(r) for r in rows]

@router.get("/ingest/batch/{batch_id}", response_model=Dict[str, Any])
async def get_ingest_batch(batch_id: int, db: Session = Depends(get_db)):
    r = db.execute(sqltext("""
        SELECT id, created_at, client_ip, items_count, saved_count, error_count,
               payload_preview, payload_full
        FROM module_equipment_ingest_batch
        WHERE id=:id
    """), {"id": batch_id}).mappings().first()
    if not r:
        raise HTTPException(404, "batch not found")
    return dict(r)

@router.get("/ingest/batch/{batch_id}/errors", response_model=List[Dict[str, Any]])
async def get_ingest_bad_items(batch_id: int, db: Session = Depends(get_db)):
    rows = db.execute(sqltext("""
        SELECT id, created_at, client_ip, process_type, user_code,
               start_time_raw, end_time_raw, code, msg, raw_item
        FROM module_equipment_bad_item
        WHERE batch_id=:id
        ORDER BY id
    """), {"id": batch_id}).mappings().all()
    return [dict(r) for r in rows]

@router.get("/ingest/errors", response_model=List[Dict[str, Any]])
async def list_recent_bad_items(
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    rows = db.execute(sqltext("""
        SELECT id, batch_id, created_at, client_ip, process_type, user_code,
               start_time_raw, end_time_raw, code, msg, raw_item
        FROM module_equipment_bad_item
        ORDER BY id DESC
        LIMIT :n
    """), {"n": limit}).mappings().all()
    return [dict(r) for r in rows]

@router.get("/ingest/batch/{batch_id}/saved", response_model=List[Dict[str, Any]])
async def get_ingest_saved_items(
    batch_id: int,
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    rows = db.execute(sqltext("""
        SELECT id, process_type, start_time, end_time, process_time,
               user_code, record_date, created_at, COALESCE(station, process_type) AS station
        FROM module_equipment_record
        WHERE ingest_batch_id=:bid
        ORDER BY id
        LIMIT :n
    """), {"bid": batch_id, "n": limit}).mappings().all()
    return [
        {
            "id": r["id"],
            "processType": r["process_type"],
            "startTime":   r["start_time"],
            "endTime":     r["end_time"],
            "processTime": round(float(r["process_time"] or 0), 2),
            "userCode":    r["user_code"],
            "recordDate":  r["record_date"],
            "createdAt":   r["created_at"],
            "station":     r["station"],
        } for r in rows
    ]

# ───────────────────────── optional helper ─────────────────────────
def init_module():
    """手動初始化（通常不需要呼叫，模組載入已做）。"""
    _init_db()
    print(f"module_equipment ready → {DB_PATH}")
