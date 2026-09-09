"""Contrato de API: celda de la malla.

`CellSummary` es deliberadamente compacto: `GET /plots/{id}/cells` devuelve la
malla entera de una vez y ese payload alimenta el render del terreno (2D y 3D).

Cuanto pesa depende del lote, y por eso el campo importa: los de La Cuadricula
son de 100 x 100, o sea 10.000 celdas. Medido, ~219 bytes por celda: unos 2 MB
por peticion. Cada campo que se anada aqui se multiplica por diez mil.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field

from app.schemas.common import CeresORMSchema
from app.schemas.provenance import CellProvenance


class CellFeatures(CeresORMSchema):
    """Las variables fisicas de una celda. Entrada del motor de prediccion."""

    elevation_m: float = Field(description="Altitud sobre el nivel del mar (m)")
    slope_deg: float = Field(ge=0, le=90, description="Pendiente en grados")
    soil_quality: float = Field(ge=0, le=1, description="0 pobre .. 1 optimo")
    plant_density: float = Field(ge=0, description="Plantas por m2")
    health_factor: float = Field(ge=0, le=1, description="0 muerto .. 1 sano")
    base_yield_factor: float = Field(gt=0, description="Multiplicador residual local")


class CellSummary(CeresORMSchema):
    """Carga ligera para pintar la malla completa."""

    id: uuid.UUID
    cell_code: str = Field(examples=["A-00123"])
    x: int = Field(ge=0, description="0 = oeste")
    y: int = Field(ge=0, description="0 = sur")
    elevation_m: float
    slope_deg: float
    soil_quality: float
    plant_density: float
    health_factor: float
    base_yield_factor: float


class CellRead(CellSummary):
    """Detalle completo de una celda."""

    plot_id: uuid.UUID
    centroid_latitude: float = Field(ge=-90, le=90)
    centroid_longitude: float = Field(ge=-180, le=180)
    created_at: datetime


class CellCollection(CeresORMSchema):
    """Respuesta de `GET /plots/{plot_id}/cells`.

    Incluye las dimensiones de la malla para que el frontend no tenga que
    deducirlas recorriendo las celdas, y la procedencia de los campos para que
    no tenga que suponerla.
    """

    plot_id: uuid.UUID
    grid_width: int = Field(gt=0)
    grid_height: int = Field(gt=0)
    cell_size_m: float = Field(gt=0)
    #: De donde sale cada grupo de campos. Obligatorio: un cliente que reciba
    #: celdas sin procedencia tendria que inventarsela, y hasta ahora lo hacia.
    provenance: CellProvenance
    cells: list[CellSummary]
