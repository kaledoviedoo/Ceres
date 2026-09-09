"""Contrato de API: prediccion vs realidad.

Este es el corazon conceptual del Digital Twin. Responde a
`GET /api/v1/cells/{cell_id}/performance`.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import Field

from app.domain.enums import RiskLevel
from app.schemas.common import CeresORMSchema


class PerformanceEntry(CeresORMSchema):
    """Una prediccion emparejada con su cosecha real, si existe."""

    prediction_id: uuid.UUID
    #: Cuando se EJECUTO el calculo.
    predicted_at: datetime
    #: De que momento HABLA la prediccion. Es lo que decide si precede a la
    #: cosecha, y por tanto si su error es un error de prediccion.
    #: `None` en predicciones sin fechar, que no se emparejan con nada.
    as_of: datetime | None = None
    model_version: str

    projected_yield_kg: float = Field(ge=0)
    projected_boxes: int = Field(ge=0)
    estimated_loss_percentage: float = Field(ge=0, le=100)
    risk_level: RiskLevel

    harvest_id: uuid.UUID | None = None
    harvested_at: date | None = None
    actual_yield_kg: float | None = Field(default=None, ge=0)
    actual_boxes: int | None = Field(default=None, ge=0)

    #: |predicho - real|, en kg. None mientras no exista cosecha.
    absolute_error_kg: float | None = Field(default=None, ge=0)
    #: absolute_error_kg / real * 100. None si no hay cosecha o si el real es 0
    #: (no se puede dividir; se deja explicito en vez de inventar un numero).
    percentage_error: float | None = Field(default=None, ge=0)

    #: Los campos de cosecha van vacios en DOS casos que conviene no confundir:
    #: que no haya cosecha registrada, y que la prediccion sea POSTERIOR a ella.
    #: Los dos significan "no hay error medible aqui", que es la respuesta
    #: honesta; distinguirlos requeriria un estado que hoy nadie necesita.


class CellPerformance(CeresORMSchema):
    cell_id: uuid.UUID
    cell_code: str
    crop_cycle_id: uuid.UUID
    entries: list[PerformanceEntry] = Field(
        default_factory=list, description="Mas reciente primero"
    )
