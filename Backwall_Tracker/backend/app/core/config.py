from functools import lru_cache
from pathlib import Path
from typing import ClassVar

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL, make_url

BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(PROJECT_DIR / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    APP_NAME: str = "后墙 Backwall Tracker"
    APP_ENV: str = "development"
    APP_DEBUG: bool = True
    APP_VERSION: str = "0.1.0"
    API_V1_PREFIX: ClassVar[str] = "/api/v1"
    LOG_LEVEL: str = "INFO"
    TIMEZONE: str = "Asia/Shanghai"

    SECRET_KEY: SecretStr = SecretStr("dev-only-change-me")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    DATABASE_URL: str | None = None
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "backwall"
    POSTGRES_USER: str = "backwall"
    POSTGRES_PASSWORD: SecretStr = SecretStr("backwall_dev_only")

    UPLOAD_DIR: Path = PROJECT_DIR / "data" / "uploads"
    MAX_UPLOAD_MB: int = 50

    OCR_PROVIDER: str = "disabled"
    LLM_PROVIDER: str = "disabled"
    LLM_BASE_URL: str | None = None
    LLM_API_KEY: SecretStr | None = None
    LLM_MODEL: str | None = None
    LLM_ALLOW_EXTERNAL: bool = False

    @model_validator(mode="after")
    def validate_production_secrets(self) -> "Settings":
        if self.APP_ENV.lower() == "production" and self.SECRET_KEY.get_secret_value() in {
            "dev-only-change-me",
            "change-me-before-deployment",
            "replace-with-a-long-random-string",
        }:
            raise ValueError("生产环境必须设置安全的 SECRET_KEY")
        return self

    @property
    def sqlalchemy_database_url(self) -> URL:
        if self.DATABASE_URL:
            return make_url(self.DATABASE_URL)
        return URL.create(
            drivername="postgresql+asyncpg",
            username=self.POSTGRES_USER,
            password=self.POSTGRES_PASSWORD.get_secret_value(),
            host=self.POSTGRES_HOST,
            port=self.POSTGRES_PORT,
            database=self.POSTGRES_DB,
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
