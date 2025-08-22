# backend/models/assembly_inventory_model.py
from typing import Optional
from pydantic import BaseModel

# -------- 新增掃描時用 --------
class AssemblyRecordIn(BaseModel):
    china_sn:  str
    us_sn:     str
    module_a:  str
    module_b:  str
    pcba_au8:  str
    pcba_am7:  str
    timestamp: Optional[str] = None    # 測試或批次匯入可自行帶時間

# -------- 從資料庫撈資料 / 單筆查詢時用 --------
class AssemblyRecordOut(AssemblyRecordIn):
    status:     str                     # '' / 'NG'
    ng_reason:  str                     # NG 原因（可能為空字串）
    id:         int                     # 若需要也可包含 DB 主鍵
