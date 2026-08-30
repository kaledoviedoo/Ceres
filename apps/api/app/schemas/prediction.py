"""Contrato de API: prediccion.

Nota de honestidad (regla 46 del brief): estos valores provienen de un modelo
determinista sintetico. No son una prediccion agronomica validada.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field, computed_field

from app.domain.enums import RiskLevel
from app.domain.units import KG_PER_TON
from app.schemas.common import CeresORMSchema, CeresSchema


class PredictionFactors(CeresORMSchema):
    """Desglose explicable del resultado.

    Cada valor es un multiplicador aplicado sobre el rendimiento base:
    1.0 = neutro, >1 lo sube, <1 lo baja.
    """

    # density y health pueden ser 0: una celda sin sembrar o con el cultivo
    # muerto produce 0 kg, y ese resultado tiene que poder serializarse.
    density_factor: float = Field(ge=0)
    health_factor: float = Field(ge=0)
    # Los otros tres son estructuralmente positivos: soil_factor parte de 0.70,
    # terrain_factor de 0.75 y base_yield_factor de la celda, que es > 0.
    soil_factor: float = Field(gt=0)
    terrain_factor: float = Field(gt=0)
    base_yield_factor: float = Field(gt=0)


class PredictionCreate(CeresSchema):
    """Cuerpo de `POST /api/v1/predictions`.

    Se pide una prediccion para una celda dentro de un ciclo de cultivo. El
    frontend solo manda identificadores: nunca calcula agricultura.
    """

    cell_id: uuid.UUID
    crop_cycle_id: uuid.UUID


class PredictionRead(CeresORMSchema):
    id: uuid.UUID
    cell_id: uuid.UUID
    crop_cycle_id: uuid.UUID

    model_version: str = Field(examples=["rule-based-v0.1"])

    projected_yield_kg: float = Field(ge=0)
    projected_boxes: int = Field(ge=0)
    estimated_loss_percentage: float = Field(ge=0, le=100)
    risk_score: float = Field(ge=0, le=1)
    risk_level: RiskLevel

    factors: PredictionFactors
    created_at: datetime

    @computed_field
    @property
    def projected_yield_tons(self) -> float:
        return self.projected_yield_kg / KG_PER_TON


class PredictionList(CeresORMSchema):
    """Historial de predicciones de una celda, mas reciente primero."""

    cell_id: uuid.UUID
    predictions: list[PredictionRead]
