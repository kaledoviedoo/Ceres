"""Contrato de API: observaciones de campo."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field

from app.domain.enums import ObservationType
from app.schemas.common import CeresORMSchema, CeresSchema


class ObservationCreate(CeresSchema):
    """Cuerpo de `POST /api/v1/observations`."""

    cell_id: uuid.UUID
    crop_cycle_id: uuid.UUID | None = None
    type: ObservationType
    severity: float = Field(ge=0, le=1, description="0 irrelevante .. 1 critico")
    description: str | None = Field(default=None, max_length=2000)
    observed_at: datetime | None = Field(
        default=None, description="Si se omite, se usa el momento del registro"
    )


class ObservationRead(CeresORMSchema):
    id: uuid.UUID
    cell_id: uuid.UUID
    crop_cycle_id: uuid.UUID | None = None
    type: ObservationType
    severity: float = Field(ge=0, le=1)
    description: str | None = None
    observed_at: datetime
    created_at: datetime
