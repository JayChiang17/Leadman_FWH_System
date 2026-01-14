from pydantic import BaseModel

class InventoryScan(BaseModel):
    sn: str
