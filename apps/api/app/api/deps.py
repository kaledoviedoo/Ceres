"""Dependencias compartidas por los routers."""

from __future__ import annotations

from collections.abc import Iterator

from fastapi import Depends
from sqlalchemy.orm import Session
from typing_extensions import Annotated

from app.db import get_session


def db_session() -> Iterator[Session]:
    """Una sesion por request. Envoltorio fino para poder sustituirla en tests."""
    yield from get_session()


#: Alias para no repetir `Depends(...)` en cada firma.
SessionDep = Annotated[Session, Depends(db_session)]
