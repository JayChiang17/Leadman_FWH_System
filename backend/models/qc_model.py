# ========================= models/qc_model.py =========================
from pydantic import BaseModel
from typing import Optional
from typing import List, Dict

# ── inbound payload ────────────────────────────────────────────────
class QCActionIn(BaseModel):
    sn: str
    action: str  # "fqc_ready" or "ship"
    timestamp: Optional[str] = None

# ── single record returned to the client ────────────────────────────
class QCRecordOut(BaseModel):
    sn: str
    fqc_ready: bool
    fqc_ready_at: Optional[str]
    shipped: bool
    shipped_at: Optional[str]

# ── dashboard aggregate numbers ────────────────────────────────────
class DashboardStats(BaseModel):
    today_fqc: int
    today_shipped: int
    week_fqc: int
    week_shipped: int
    month_fqc: int
    month_shipped: int
    pending_shipment: int
    shipping_rate_today: float
    shipping_rate_week: float

# 批量檢查請求
class BatchCheckIn(BaseModel):
    sns: List[str]

# 批量出貨請求
class BatchShipIn(BaseModel):
    sns: List[str]