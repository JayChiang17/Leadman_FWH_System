from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    SECRET_KEY: str = Field(..., validation_alias="SECRET_KEY")

    DATABASE_URL: str = Field(
        "postgresql://leadman:leadman_dev_pw@localhost:5432/leadman",
        validation_alias="DATABASE_URL",
    )

    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
