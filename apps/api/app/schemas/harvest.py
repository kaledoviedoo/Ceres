"""Contrato de API: cosecha real."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import Field, computed_field

from app.domain.units import KG_PER_TON
from app.schemas.common import CeresORMSchema, CeresSchema


class HarvestCreate(CeresSchema):
    """Cuerpo de `POST /api/v1/harvests`."""

    cell_id: uuid.UUID
    crop_cycle_id: uuid.UUID
    actual_yield_kg: float = Field(ge=0)
    actual_boxes: int = Field(ge=0)
    harvested_at: date
    notes: str | None = Field(default=None, max_length=2000)


class HarvestRead(CeresORMSchema):
    id: uuid.UUID
    cell_id: uuid.UUID
    crop_cycle_id: uuid.UUID
    actual_yield_kg: float = Field(ge=0)
    actual_boxes: int = Field(ge=0)
    harvested_at: date
    notes: str | None = None
    #: Quien registro la cosecha. Mismo motivo que en las observaciones.
    created_by: uuid.UUID | None = None
    created_at: datetime

    @computed_field
    @property
    def actual_yield_tons(self) -> float:
        return self.actual_yield_kg / KG_PER_TON
