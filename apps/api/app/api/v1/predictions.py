"""Endpoint de predicciones.

El cliente manda **solo identificadores**. El servidor carga la celda y el ciclo,
ejecuta el motor y persiste el resultado. `PredictionCreate` declara
`extra="forbid"`, asi que un intento de enviar `soil_quality`, `health_factor`,
`projected_yield` o `risk_score` se rechaza con 422 antes de llegar al servicio.
"""

from __future__ import annotations

from fastapi import APIRouter, status

from app.api.deps import SessionDep
from app.schemas.prediction import PredictionCreate, PredictionRead
from app.services import predictions as predictions_service

router = APIRouter(tags=["predictions"])


@router.post(
    "/predictions",
    response_model=PredictionRead,
    status_code=status.HTTP_201_CREATED,
)
def create_prediction(payload: PredictionCreate, session: SessionDep) -> PredictionRead:
    """Ejecuta el motor y guarda una prediccion NUEVA.

    Nunca modifica una prediccion anterior: cada llamada anade una fotografia
    historica mas. Por eso responde 201 y no hay ni PUT ni DELETE.
    """
    prediction = predictions_service.create_prediction(
        session, payload.cell_id, payload.crop_cycle_id, payload.as_of
    )
    return PredictionRead.model_validate(prediction)
