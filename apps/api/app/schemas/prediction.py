"""Contrato de API: prediccion.

Nota de honestidad (regla 46 del brief): estos valores provienen de un modelo
determinista sintetico. No son una prediccion agronomica validada.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

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
    frontend solo manda identificadores y, si quiere, una FECHA: nunca calcula
    agricultura.
    """

    cell_id: uuid.UUID
    crop_cycle_id: uuid.UUID
    #: De que momento se quiere la prediccion. Omitirlo significa "ahora".
    #:
    #: Es una fecha, no un estado: el cliente sigue sin poder mandar
    #: `soil_quality` ni `health_factor` —`extra="forbid"` lo rechaza con 422—.
    #: Lo unico que elige es el instante; el estado lo deriva el servidor de las
    #: observaciones que ya tenia.
    as_of: datetime | None = None


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
    #: COPIA DE LAS ENTRADAS con las que se ejecuto el motor.
    #:
    #: Estaba guardada desde el principio y no salia por la API, y sin ella una
    #: serie historica no se puede leer: dos predicciones distintas de la misma
    #: celda pueden diferir porque cambio el modelo o porque cambio el terreno,
    #: y `factors` sola no distingue los dos casos. Con `inputs` cada punto de la
    #: serie es reproducible.
    #:
    #: Es un diccionario abierto a proposito: describe la ENTRADA de una version
    #: concreta del motor, y esa forma cambia cuando cambia el modelo. Cerrarlo
    #: en un schema obligaria a migrar el historico cada vez.
    inputs: dict[str, Any] = Field(
        default_factory=dict,
        description="Entradas exactas usadas por el motor en esta ejecucion",
    )
    # NO hay `created_by`, y no se anade vacio a proposito.
    #
    # La tabla `predictions` no tiene columna de autor —`observations` y
    # `harvests` si la tienen—. Publicar aqui un `created_by: null` constante
    # seria anunciar una columna que no existe: un cliente que la viera
    # esperaria que algun dia trajera un usuario, y hoy nada podria rellenarla
    # porque tampoco hay autenticacion. Anadirla de verdad es una migracion.
    #: DE QUE MOMENTO habla. `created_at` dice cuando se ejecuto; esto, de que
    #: estado agronomico. Sin los dos, una serie ordenada por `created_at`
    #: mezclaria el orden de ejecucion con el orden de los hechos.
    as_of: datetime | None = None
    created_at: datetime

    @computed_field
    @property
    def projected_yield_tons(self) -> float:
        return self.projected_yield_kg / KG_PER_TON


class PredictionList(CeresORMSchema):
    """Historial de predicciones de una celda, mas reciente primero."""

    cell_id: uuid.UUID
    predictions: list[PredictionRead]
