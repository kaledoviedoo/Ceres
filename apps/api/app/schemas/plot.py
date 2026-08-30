"""Contrato de API: lote y su malla."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field, computed_field

from app.schemas.common import CeresORMSchema


class PlotRead(CeresORMSchema):
    id: uuid.UUID
    farm_id: uuid.UUID
    name: str
    code: str = Field(description="Prefijo del cell_code", examples=["A"])

    grid_width: int = Field(gt=0)
    grid_height: int = Field(gt=0)
    cell_size_m: float = Field(gt=0, description="Lado de la celda en metros")

    origin_latitude: float = Field(ge=-90, le=90, description="Esquina suroeste (x=0, y=0)")
    origin_longitude: float = Field(ge=-180, le=180)
    created_at: datetime

    @computed_field
    @property
    def cell_count(self) -> int:
        return self.grid_width * self.grid_height

    @computed_field
    @property
    def area_m2(self) -> float:
        return self.cell_count * (self.cell_size_m**2)
