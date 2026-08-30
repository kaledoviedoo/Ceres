"""Contrato de API: cultivo y ciclo de cultivo."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import Field

from app.domain.enums import CropCycleStatus
from app.schemas.common import CeresORMSchema


class CropRead(CeresORMSchema):
    id: uuid.UUID
    organization_id: uuid.UUID
    name: str
    slug: str
    variety: str | None = None

    box_capacity_kg: float = Field(gt=0, description="kg por caja de cosecha")
    base_yield_kg_per_m2: float = Field(gt=0, description="Rendimiento de referencia (kg/m2)")
    optimal_plant_density_per_m2: float = Field(gt=0, description="Densidad optima (plantas/m2)")
    cycle_days: int | None = Field(default=None, gt=0)
    created_at: datetime


class CropCycleRead(CeresORMSchema):
    id: uuid.UUID
    plot_id: uuid.UUID
    crop_id: uuid.UUID
    name: str
    slug: str
    status: CropCycleStatus
    planted_at: date | None = None
    expected_harvest_at: date | None = None
    created_at: datetime


class CropCycleDetail(CropCycleRead):
    """Ciclo con el cultivo embebido: el frontend necesita box_capacity_kg."""

    crop: CropRead
