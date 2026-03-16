from pydantic import BaseModel
from typing import Optional

class DowntimeRecord(BaseModel):
    line: str
    station: str
    start_time: str
    end_time: str
    downtime_type: Optional[str] = "Other"