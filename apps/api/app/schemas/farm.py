"""Contrato de API: finca."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field

from app.schemas.common import CeresORMSchema
from app.schemas.plot import PlotRead


class FarmRead(CeresORMSchema):
    id: uuid.UUID
    organization_id: uuid.UUID
    name: str
    country: str = Field(description="Codigo ISO 3166-1 alpha-2", examples=["CO"])
    region: str | None = None
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    created_at: datetime


class FarmDetail(FarmRead):
    """Finca con sus lotes, para el selector del dashboard."""

    plots: list[PlotRead] = Field(default_factory=list)
