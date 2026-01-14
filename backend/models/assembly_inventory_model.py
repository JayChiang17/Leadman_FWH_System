# backend/models/assembly_inventory_model.py
from typing import Optional
from pydantic import BaseModel

# -------- Input --------
class AssemblyRecordIn(BaseModel):
    china_sn:  str
    us_sn:     str
    module_a:  str
    module_b:  str
    pcba_au8:  str
    pcba_am7:  str
    product_line: Optional[str] = None   # optional product tag (e.g., apower / apower2)
    timestamp: Optional[str] = None      # optional ISO timestamp

# -------- Output --------
class AssemblyRecordOut(AssemblyRecordIn):
    status:     str                     # '' / 'NG'
    ng_reason:  str                     # NG reason text
    id:         int                     # DB row id
