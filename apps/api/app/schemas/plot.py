"""Contrato de API: lote y su malla."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field, computed_field

from app.core.provenance import ORIGIN_CORNER
from app.schemas.common import CeresORMSchema


class PlotRead(CeresORMSchema):
    id: uuid.UUID
    farm_id: uuid.UUID
    name: str
    code: str = Field(description="Prefijo del cell_code", examples=["A"])

    grid_width: int = Field(gt=0)
    grid_height: int = Field(gt=0)
    cell_size_m: float = Field(gt=0, description="Lado de la celda en metros")

    origin_latitude: float = Field(ge=-90, le=90, description="Origen del lote (x=0, y=0)")
    origin_longitude: float = Field(ge=-180, le=180)
    created_at: datetime

    @computed_field
    @property
    def origin_corner(self) -> str:
        """A que esquina se refieren `origin_latitude` y `origin_longitude`.

        Estaba escrito en la descripcion de un campo, que es prosa: un cliente
        tenia que leerla o suponer. Suponer el centro en vez de la esquina
        desplaza el lote medio lote, y no da ningun error.

        Es `computed_field` y no columna a proposito: no es un dato del lote, es
        una propiedad del sistema de coordenadas que usa el backend para
        derivar los centroides.
        """
        return ORIGIN_CORNER

    @computed_field
    @property
    def cell_count(self) -> int:
        return self.grid_width * self.grid_height

    @computed_field
    @property
    def area_m2(self) -> float:
        return self.cell_count * (self.cell_size_m**2)
