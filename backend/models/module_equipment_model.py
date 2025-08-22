"""
Module_Equipment 數據模型
"""
from datetime import datetime, date
from typing import List, Dict, Any

from sqlalchemy import (
    Column, String, DateTime, Float, Integer, Date, Index
)
from sqlalchemy.ext.declarative import declarative_base
from pydantic import BaseModel, Field

Base = declarative_base()

# ─────────────────────────────────────────────
# SQLAlchemy ORM
# ─────────────────────────────────────────────
class Module_EquipmentRecord(Base):
    """設備記錄資料表"""
    __tablename__ = "module_equipment_records"

    id           = Column(Integer, primary_key=True, index=True)
    process_type = Column(String,   index=True)
    start_time   = Column(DateTime, index=True)
    end_time     = Column(DateTime)
    user_code    = Column(String,   index=True)
    process_time = Column(Float)            # 操作時間（秒）
    record_date  = Column(Date,  index=True)  # 方便日期查詢
    created_at   = Column(DateTime, default=datetime.utcnow)

    # 複合索引
    __table_args__ = (
        Index("idx_date_process", "record_date", "process_type"),
        Index("idx_date_user",    "record_date", "user_code"),
    )

# ─────────────────────────────────────────────
# Pydantic schemas  (API 請求/回應)
# ─────────────────────────────────────────────
class _ConfigOrm:
    """讓 Pydantic 可以直接從 ORM 模型轉換"""
    orm_mode = True


class Module_EquipmentData(BaseModel):
    """單筆設備資料"""
    processType: str = Field(..., description="Process type")
    StartTime:  str = Field(..., description="Start time (yyyy-mm-dd HH:MM:SS)")
    EndTime:    str = Field(..., description="End time   (yyyy-mm-dd HH:MM:SS)")
    userCode:   str = Field(..., description="User code")

    class Config(_ConfigOrm):
        pass


class Module_EquipmentDataRequest(BaseModel):
    """設備資料批次上傳"""
    list: List[Module_EquipmentData]

    class Config(_ConfigOrm):
        pass


class Module_ProcessTimeStats(BaseModel):
    """製程時間統計（每日）"""
    processType:      str
    date:             date
    avgProcessTime:   float  # 平均秒數
    minProcessTime:   float
    maxProcessTime:   float
    totalCount:       int
    totalTime:        float

    class Config(_ConfigOrm):
        pass


class Module_DashboardData(BaseModel):
    """Dashboard 回傳格式"""
    date:                 date
    processStats:         List[Dict[str, Any]]
    totalProcesses:       int
    avgDailyProcessTime:  float

    class Config(_ConfigOrm):
        pass
