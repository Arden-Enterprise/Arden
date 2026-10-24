from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ARDEN_AI_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"
    openai_api_key: SecretStr | None = None
    openai_embedding_model: str = "text-embedding-3-small"
    openai_embedding_dimensions: int = Field(default=1_536, gt=0)
    openai_chat_model: str = "gpt-4.1-mini"
    chroma_url: str = "http://chroma:8000"
    chroma_collection: str = Field(default="arden_knowledge_v1", pattern=r"^[a-z0-9_-]{3,63}$")
    service_token: SecretStr | None = None
    langfuse_host: str = "http://langfuse:3000"
    langfuse_public_key: SecretStr | None = None
    langfuse_secret_key: SecretStr | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
