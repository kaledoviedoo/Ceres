"""Contrato de API: observaciones de campo."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import Field

from app.domain.enums import ObservationType, Provenance
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
    #: De donde sale esta observacion. POR DEFECTO `unknown`, y es deliberado.
    #:
    #: Hasta ahora el endpoint no lo admitia y todo lo que entraba por HTTP
    #: quedaba como `synthetic` —el defecto de la columna—, que era falso: quien
    #: llama a la API no es el generador del dataset.
    #:
    #: `unknown` en vez de `measured` porque una llamada HTTP no demuestra que
    #: nadie haya salido al campo. Solo `measured` mueve el estado derivado de
    #: la celda, asi que reclamarlo tiene que ser un acto explicito.
    #:
    #: ATENCION: sin autenticacion, ese `measured` es una AFIRMACION DEL
    #: CLIENTE, no una verificacion del sistema. Queda registrada como tal.
    source_kind: Provenance = Field(
        default=Provenance.UNKNOWN,
        description="Procedencia declarada. Solo `measured` modifica el estado de la celda",
    )


class ObservationRead(CeresORMSchema):
    id: uuid.UUID
    cell_id: uuid.UUID
    crop_cycle_id: uuid.UUID | None = None
    type: ObservationType
    severity: float = Field(ge=0, le=1)
    description: str | None = None
    observed_at: datetime
    #: Quien la registro. Una observacion de campo la firma alguien, y sin el
    #: autor no se puede distinguir un dato levantado por un agronomo de uno
    #: cargado por un proceso. Se guardaba y no salia.
    created_by: uuid.UUID | None = None
    #: De donde sale la observacion. Solo `measured` mueve el estado derivado de
    #: la celda; las 24 del dataset actual son `synthetic` y no lo mueven.
    source_kind: Provenance = Provenance.UNKNOWN
    created_at: datetime
