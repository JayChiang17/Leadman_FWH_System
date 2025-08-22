from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # 讀取環境變數 SECRET_KEY、DB_PATH
    SECRET_KEY: str = Field(..., validation_alias="SECRET_KEY")
    DB_PATH:   str = Field("./login.db", validation_alias="DB_PATH")
    
    # Token 設定
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15  # 15 分鐘 (短期 token)
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7     # 7 天 (長期 token)

    # 等同於舊版 class Config
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

settings = Settings()