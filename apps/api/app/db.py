"""Conexion a la base de datos.

Una sola fabrica de sesiones para todo el backend. Las consultas viven en
`services/` (fase 4), nunca dispersas por los routers.
"""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings

_settings = get_settings()

engine = create_engine(
    _settings.database_url,
    pool_pre_ping=True,
    echo=False,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    """Dependencia de FastAPI: una sesion por request."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
