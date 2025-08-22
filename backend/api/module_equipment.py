# module_equipment.py  ── 修正版
from datetime import datetime, date, timedelta
import os
import statistics
from typing import List, Optional, Dict, Any   # ← 加入 Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, create_engine
from sqlalchemy.orm import Session, sessionmaker

# 從 models 目錄導入 Pydantic / ORM
from models.module_equipment_model import (
    Base,
    Module_EquipmentRecord,
    Module_EquipmentDataRequest,
    Module_ProcessTimeStats,
    Module_DashboardData,
)

# ───────────────────── 資料庫設定 ─────────────────────
MODULE_EQUIPMENT_DB_PATH = "./Module_Equipment.db"
SQLALCHEMY_DATABASE_URL  = f"sqlite:///{MODULE_EQUIPMENT_DB_PATH}"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base.metadata.create_all(bind=engine)

# ───────────────────── 依賴注入 ─────────────────────
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ───────────────────── FastAPI Router ─────────────────────
router = APIRouter(
    prefix="/Module_Equipment",
    tags=["Module_Equipment"],
    responses={404: {"description": "Not found"}},
)

# ───────────────────── 輔助函式 ─────────────────────
FMT = "%Y-%m-%d %H:%M:%S"

def calculate_process_time(start_time: str, end_time: str) -> float:
    """計算兩時間差（秒）。"""
    start = datetime.strptime(start_time, FMT)
    end   = datetime.strptime(end_time,   FMT)
    return (end - start).total_seconds()

def get_date_from_datetime(dt_str: str) -> date:
    """僅取日期部分。"""
    return datetime.strptime(dt_str, FMT).date()

# ───────────────────── API 端點 ─────────────────────
@router.post("/data", response_model=Dict[str, Any])
async def receive_equipment_data(
    data: Module_EquipmentDataRequest,
    db: Session = Depends(get_db),
):
    """
    接收設備資料並寫入資料庫。
    """
    try:
        saved = 0
        for item in data.list:
            db_record = Module_EquipmentRecord(
                process_type=item.processType,
                start_time=datetime.strptime(item.StartTime, FMT),
                end_time=datetime.strptime(item.EndTime,   FMT),
                user_code=item.userCode,
                process_time=calculate_process_time(item.StartTime, item.EndTime),
                record_date=get_date_from_datetime(item.StartTime),
            )
            db.add(db_record)
            saved += 1
        db.commit()

        return {"status": "success", "savedCount": saved}
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))

# ───────────────────── 統計相關 ─────────────────────
@router.get("/stats/daily", response_model=List[Module_ProcessTimeStats])
async def get_daily_stats(
    target_date: Optional[date] = Query(None, description="日期，預設今日"),
    db: Session = Depends(get_db),
):
    if not target_date:
        target_date = date.today()

    records = db.query(Module_EquipmentRecord).filter(
        Module_EquipmentRecord.record_date == target_date
    ).all()
    if not records:
        return []

    grouped: Dict[str, List[float]] = {}
    for r in records:
        grouped.setdefault(r.process_type, []).append(r.process_time)

    return [
        Module_ProcessTimeStats(
            processType=pt,
            date=target_date,
            avgProcessTime=statistics.mean(ts),
            minProcessTime=min(ts),
            maxProcessTime=max(ts),
            totalCount=len(ts),
            totalTime=sum(ts),
        )
        for pt, ts in grouped.items()
    ]

@router.get("/stats/range", response_model=List[Dict[str, Any]])
async def get_range_stats(
    start_date: Optional[date] = Query(None, description="開始日期"),
    end_date:   Optional[date] = Query(None, description="結束日期"),
    week: Optional[str] = Query(None, description="latest=本週自動 (含週六)"),
    process_type: Optional[str] = Query(None, description="製程類型（可選）"),
    db: Session = Depends(get_db),
):
    # ✦ 1. 若 user 直接給 start / end，照舊 ─────────────────
    if start_date and end_date:
        s_day, e_day = start_date, end_date

    # ✦ 2. 若使用 week=latest，自動決定區間 ─────────────────
    elif week == "latest":
        today   = date.today()
        monday  = today - timedelta(days=today.weekday())
        saturday= monday + timedelta(days=5)

        # 只要今天>=週六，或 DB 有週六資料，就把週六算進區間
        include_sat = today.weekday() >= 5
        if not include_sat:
            sat_cnt = db.query(func.count(Module_EquipmentRecord.id))\
                        .filter(Module_EquipmentRecord.record_date == saturday)\
                        .scalar()
            include_sat = sat_cnt > 0

        s_day, e_day = monday, (saturday if include_sat else monday + timedelta(days=4))
    else:
        raise HTTPException(400, "請給 start_date / end_date，或 week=latest")

    # －－－－－－ 原本的 SQL 統計邏輯保持不變 －－－－－－
    q = db.query(
        Module_EquipmentRecord.record_date,
        Module_EquipmentRecord.process_type,
        func.avg(Module_EquipmentRecord.process_time).label("avg_time"),
        func.count(Module_EquipmentRecord.id).label("cnt"),
    ).filter(
        Module_EquipmentRecord.record_date.between(s_day, e_day)
    )
    if process_type:
        q = q.filter(Module_EquipmentRecord.process_type == process_type)

    return [
        {
            "date": r.record_date.isoformat(),
            "processType": r.process_type,
            "avgProcessTime": round(r.avg_time, 2),
            "count": r.cnt,
        }
        for r in q.group_by(
            Module_EquipmentRecord.record_date,
            Module_EquipmentRecord.process_type
        ).all()
    ]


@router.get("/dashboard", response_model=Module_DashboardData)
async def get_dashboard_data(
    target_date: Optional[date] = Query(None, description="日期，預設今日"),
    db: Session = Depends(get_db),
):
    if not target_date:
        target_date = date.today()

    daily_stats = await get_daily_stats(target_date=target_date, db=db)
    total_proc  = sum(s.totalCount for s in daily_stats)
    total_time  = sum(s.totalTime  for s in daily_stats)
    avg_daily   = total_time / total_proc if total_proc else 0

    process_stats = [
        {
            "processType": s.processType,
            "avgTime": round(s.avgProcessTime, 2),
            "minTime": round(s.minProcessTime, 2),
            "maxTime": round(s.maxProcessTime, 2),
            "count": s.totalCount,
            "percentage": round(s.totalCount / total_proc * 100, 2) if total_proc else 0,
        }
        for s in daily_stats
    ]

    return Module_DashboardData(
        date=target_date,
        processStats=process_stats,
        totalProcesses=total_proc,
        avgDailyProcessTime=round(avg_daily, 2),
    )

@router.get("/process-types", response_model=List[str])
async def get_process_types(db: Session = Depends(get_db)):
    return [pt for (pt,) in db.query(Module_EquipmentRecord.process_type).distinct()]

@router.get("/user-stats", response_model=List[Dict[str, Any]])
async def get_user_stats(
    target_date: Optional[date] = Query(None, description="日期，預設今日"),
    db: Session = Depends(get_db),
):
    if not target_date:
        target_date = date.today()

    q = db.query(
        Module_EquipmentRecord.user_code,
        func.count(Module_EquipmentRecord.id).label("cnt"),
        func.avg(Module_EquipmentRecord.process_time).label("avg_time"),
    ).filter(
        Module_EquipmentRecord.record_date == target_date
    ).group_by(Module_EquipmentRecord.user_code)

    return [
        {"userCode": u, "operationCount": c, "avgProcessTime": round(a, 2)}
        for u, c, a in q
    ]

@router.get("/recent-records", response_model=List[Dict[str, Any]])
async def get_recent_records(
    limit: int = Query(10, description="要取回的筆數"),
    db: Session = Depends(get_db),
):
    rs = db.query(Module_EquipmentRecord).order_by(
        Module_EquipmentRecord.created_at.desc()
    ).limit(limit).all()

    return [
        {
            "id": r.id,
            "processType": r.process_type,
            "startTime":   r.start_time.isoformat(),
            "endTime":     r.end_time.isoformat(),
            "processTime": round(r.process_time, 2),
            "userCode":    r.user_code,
            "recordDate":  r.record_date.isoformat(),
            "createdAt":   r.created_at.isoformat(),
        }
        for r in rs
    ]
@router.get("/stats/hourly-usage", response_model=List[Dict[str, Any]])
async def get_hourly_usage(
    target_date: Optional[date] = Query(None, description="日期，預設今日"),
    db: Session = Depends(get_db),
):
    """
    根據 StartTime 統計每小時操作筆數與平均處理時間。
    """
    if not target_date:
        target_date = date.today()

    records = db.query(Module_EquipmentRecord).filter(
        Module_EquipmentRecord.record_date == target_date
    ).all()
    if not records:
        return []

    # 分組統計：hour -> user_code -> [process_time...]
    hourly_user_times: Dict[int, Dict[str, List[float]]] = {}

    for r in records:
        hour = r.start_time.hour
        user = r.user_code
        hourly_user_times.setdefault(hour, {}).setdefault(user, []).append(r.process_time)

    result = []
    for hour in range(24):
        hour_data = hourly_user_times.get(hour, {})
        total_count = sum(len(v) for v in hour_data.values())
        avg_time    = round(
            statistics.mean([t for v in hour_data.values() for t in v]), 2
        ) if total_count else 0

        user_summary = [
            {
                "userCode": u,
                "count": len(times),
                "avgProcessTime": round(statistics.mean(times), 2) if times else 0
            }
            for u, times in hour_data.items()
        ]

        result.append({
            "hour": hour,
            "totalCount": total_count,
            "avgProcessTime": avg_time,
            "users": user_summary
        })

    return result


# ───────────────────── 初始化提示 ─────────────────────
def init_module():
    if not os.path.exists(MODULE_EQUIPMENT_DB_PATH):
        Base.metadata.create_all(bind=engine)
        print("Module_Equipment.db created.")
    print(f"Module_Equipment ready → {MODULE_EQUIPMENT_DB_PATH}")
