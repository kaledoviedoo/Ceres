"""Configuracion de la aplicacion, leida desde variables de entorno / .env.

Regla del proyecto: nada de secretos hardcodeados. Todo entra por aqui.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Entorno
    ceres_env: str = "development"

    # Base de datos (Postgres local o Supabase; misma URL, distinto host)
    database_url: str = "postgresql+psycopg://ceres:ceres@localhost:5432/ceres"

    # API
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_cors_origins: str = "http://localhost:3000"

    # Datos sinteticos: seed fija => dataset reproducible
    ceres_demo_seed: int = Field(default=42, ge=0)

    # Base de datos de pruebas. Si es None, los tests marcados `postgres` se
    # saltan: nunca fallan por falta de credenciales ni tocan una base real por
    # accidente.
    test_database_url: str | None = None

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.api_cors_origins.split(",") if origin.strip()]

    @property
    def is_production(self) -> bool:
        return self.ceres_env.lower() in {"production", "prod"}


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
