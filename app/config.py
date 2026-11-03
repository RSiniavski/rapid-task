import os
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    SECRET_KEY: str = os.getenv("SECRET_KEY", "super-secret-key-change-it-in-production")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 днів

    # Platform (admin tool). The root admin is created / updated from these two values at every start.
    PLATFORM_ROOT_USERNAME: str = ""
    PLATFORM_ROOT_PASSWORD: str = ""
    PLATFORM_SECRET_KEY: str = ""            # empty = the app key + ":platform"
    PLATFORM_TOKEN_MINUTES: int = 60 * 8     # one work day
    PLATFORM_MAX_FAILED_LOGINS: int = 5
    PLATFORM_LOCK_MINUTES: int = 15

    model_config = SettingsConfigDict(env_file=".env")

settings = Settings()
