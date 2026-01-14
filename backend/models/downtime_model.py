from pydantic import BaseModel

class DowntimeRecord(BaseModel):
    line: str               
    station: str            
    start_time: str   
    end_time: str 