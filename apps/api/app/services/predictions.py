"""Servicio de predicciones: el puente entre HTTP y el motor.

    POST /api/v1/predictions {cell_id, crop_cycle_id}
            |
            v
    carga la celda y el ciclo desde la base de datos   <- el servidor es la fuente de verdad
            |
            v
    predict(cell, crop)                                <- motor puro, sin FastAPI
            |
            v
    INSERT en predictions                              <- fila nueva, nunca UPDATE

El cliente manda **solo identificadores**. Nunca puede enviar `soil_quality`,
`health_factor`, `slope`, `projected_yield` ni `risk_score`: esos valores se leen
de la base de datos y se calculan aqui. El schema `PredictionCreate` declara
`extra="forbid"`, asi que intentarlo devuelve 422.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.prediction import PredictionResult, predict
from app.models import CropCycle, GridCell, Plot, Prediction
from app.services.errors import ConflictError, NotFoundError
from app.services.farms import get_cell


def _get_crop_cycle(session: Session, crop_cycle_id: uuid.UUID) -> CropCycle:
    """Ciclo con su cultivo cargado: el motor necesita los parametros del cultivo."""
    cycle = session.scalar(
        select(CropCycle)
        .where(CropCycle.id == crop_cycle_id)
        .options(joinedload(CropCycle.crop))
    )
    if cycle is None:
        raise NotFoundError("CropCycle", crop_cycle_id)
    return cycle


def run_engine(session: Session, cell: GridCell, cycle: CropCycle) -> PredictionResult:
    """Ejecuta el motor sobre una celda, sin persistir nada.

    Separado de `create_prediction` para poder previsualizar una prediccion sin
    escribir en la base de datos, y para que los tests puedan comprobar el
    calculo sin tocar la tabla.
    """
    plot = session.get(Plot, cell.plot_id)
    area_m2 = plot.cell_size_m**2 if plot else 1.0
    return predict(cell, cycle.crop, area_m2=area_m2)


def create_prediction(
    session: Session,
    cell_id: uuid.UUID,
    crop_cycle_id: uuid.UUID,
) -> Prediction:
    """Ejecuta el motor y persiste el resultado como una fila NUEVA.

    Nunca actualiza una prediccion existente: cada llamada es una fotografia
    historica mas. La base de datos lo refuerza con un trigger
    (`0002_prediction_immutability.sql`).
    """
    cell = get_cell(session, cell_id)
    cycle = _get_crop_cycle(session, crop_cycle_id)

    # Integridad espacial: no tiene sentido predecir una celda de Plot B bajo un
    # ciclo de cultivo que se siembra en Plot A.
    if cell.plot_id != cycle.plot_id:
        raise ConflictError(
            f"La celda {cell.cell_code} pertenece al lote {cell.plot_id}, "
            f"pero el ciclo {cycle.slug} se siembra en el lote {cycle.plot_id}"
        )

    result = run_engine(session, cell, cycle)

    prediction = Prediction(
        cell_id=cell.id,
        crop_cycle_id=cycle.id,
        model_version=result.model_version,
        projected_yield_kg=result.projected_yield_kg,
        projected_boxes=result.projected_boxes,
        estimated_loss_percentage=result.estimated_loss_percentage,
        risk_score=result.risk_score,
        risk_level=result.risk_level.value,
        factors=result.factors.as_dict(),
        inputs=result.inputs,
    )
    session.add(prediction)
    session.commit()
    session.refresh(prediction)
    return prediction


def list_predictions_for_cell(
    session: Session,
    cell_id: uuid.UUID,
    crop_cycle_id: uuid.UUID | None = None,
) -> list[Prediction]:
    """Historial de la celda, mas reciente primero."""
    get_cell(session, cell_id)  # 404 si la celda no existe

    statement = select(Prediction).where(Prediction.cell_id == cell_id)
    if crop_cycle_id is not None:
        statement = statement.where(Prediction.crop_cycle_id == crop_cycle_id)

    return list(
        session.scalars(statement.order_by(Prediction.created_at.desc(), Prediction.id))
    )
