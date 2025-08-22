# models/pcba_models.py
from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


# ========== Pydantic Models ==========
class BoardHistoryModel(BaseModel):
    stage: str
    timestamp: str
    operator: str
    notes: Optional[str] = None


class BoardResponse(BaseModel):
    id: str
    serialNumber: str
    batchNumber: str
    model: str
    stage: str
    startTime: str
    lastUpdate: str
    operator: str
    slipNumber: Optional[str] = None
    ngFlag: int = 0
    ngReason: Optional[str] = None
    ngTime: Optional[str] = None
    history: List[Dict[str, Any]]


class BoardCreate(BaseModel):
    serialNumber: str = Field(..., min_length=1, max_length=100)
    stage: str = Field(..., pattern="^(aging|coating|completed)$")
    batchNumber: Optional[str] = None
    model: Optional[str] = Field("AUTO-DETECT", pattern="^(AM7|AU8|AUTO-DETECT)$")
    operator: Optional[str] = "User"
    slipNumber: Optional[str] = Field(None, max_length=100)
    targetPairs: Optional[int] = Field(None, ge=0)
    slipPairs: Optional[int] = Field(None, ge=0)  # 舊名相容（可不送）


class BoardUpdate(BaseModel):
    stage: str = Field(..., pattern="^(aging|coating|completed)$")
    operator: Optional[str] = "User"


class BoardAdminUpdate(BaseModel):
    newSerialNumber: Optional[str] = Field(None, min_length=1, max_length=100)
    batchNumber: Optional[str] = None
    model: Optional[str] = Field(None, pattern="^(AM7|AU8|AUTO-DETECT)$")
    stage: Optional[str] = Field(None, pattern="^(aging|coating|completed)$")
    startTime: Optional[str] = None
    lastUpdate: Optional[str] = None
    operator: Optional[str] = None
    note: Optional[str] = None
    slipNumber: Optional[str] = None
    targetPairs: Optional[int] = Field(None, ge=0)
    slipPairs: Optional[int] = Field(None, ge=0)


class ModelBucket(BaseModel):
    total: int = 0
    aging: int = 0
    coating: int = 0
    completed: int = 0


class StageStats(BaseModel):
    total: int = 0
    aging: int = 0
    coating: int = 0
    completed: int = 0
    efficiency: float = 0.0
    byModel: Dict[str, ModelBucket] = Field(default_factory=dict)

    # 完成數(排NG)＆消耗＆可用（給儀表板即時用）
    completedByModel: Dict[str, int] = Field(default_factory=lambda: {"AM7": 0, "AU8": 0})
    consumedAM7: int = 0
    consumedAU8: int = 0
    consumedTotal: int = 0
    availableAM7: int = 0
    availableAU8: int = 0
    availableTotal: int = 0
    # 「Pairs Done」= min(available AM7, available AU8)
    pairsDone: int = 0


class WeeklyStats(BaseModel):
    range: str
    aging: int
    coating: int
    completed: int
    pairs: int
    completedByModel: Dict[str, int] = Field(default_factory=lambda: {"AM7": 0, "AU8": 0})


class SlipUpsert(BaseModel):
    slipNumber: str = Field(..., min_length=1, max_length=100)
    targetPairs: int = Field(..., ge=0)


class SlipStatus(BaseModel):
    slipNumber: str
    targetPairs: int

    # boards count by stage（數量為「板件」）
    aging: int
    coating: int
    completed: int

    # completed by model（排除 NG）
    completedAM7: int
    completedAU8: int

    # pairs（完成對數 = min(AM7, AU8)；排除 NG）
    completedPairs: int
    remainingPairs: int

    # ★ 新增：在製對數（排除 NG）
    agingPairs: int = 0
    coatingPairs: int = 0
    wipPairs: int = 0

    # ★ 新增：扣掉在製後的尚待對數
    remainingPairsAfterWIP: int = 0


class NGPatch(BaseModel):
    ng: bool
    reason: Optional[str] = None


# Slip Library 專用
class SlipListItem(BaseModel):
    slipNumber: str
    targetPairs: int
    aging: int
    coating: int
    completed: int
    completedPairs: int
    updatedAt: str


class SlipTargetPatch(BaseModel):
    targetPairs: int = Field(..., ge=0)


__all__ = [
    "BoardHistoryModel", "BoardResponse", "BoardCreate", "BoardUpdate", "BoardAdminUpdate",
    "ModelBucket", "StageStats", "WeeklyStats", "SlipUpsert", "SlipStatus", "NGPatch",
    "SlipListItem", "SlipTargetPatch",
]
