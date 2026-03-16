# backend/models/assembly_inventory_model.py
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, field_validator

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
    # DB TIMESTAMPTZ returns datetime; coerce to string before type validation.
    timestamp: Optional[str] = None
    status:     str                     # '' / 'NG'
    ng_reason:  str                     # NG reason text
    id:         int                     # DB row id

    @field_validator("timestamp", mode="before")
    @classmethod
    def coerce_timestamp(cls, v: object) -> Optional[str]:
        if v is None:
            return None
        if hasattr(v, "strftime"):
            return v.strftime("%Y-%m-%d %H:%M:%S")
        return str(v) if not isinstance(v, str) else v
