"""Prediccion vs realidad: el cierre del ciclo del Digital Twin.

Empareja cada prediccion de una celda con la cosecha real de esa celda en el
mismo ciclo de cultivo. Si hay varias cosechas para el mismo par, se toma la mas
reciente; el MVP asume una cosecha por celda y ciclo.

La aritmetica del error vive en `app/domain/performance.py`, no aqui.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.performance import absolute_error_kg, percentage_error
from app.models import Harvest, Prediction
from app.schemas.performance import CellPerformance, PerformanceEntry
from app.services.errors import NotFoundError
from app.services.farms import get_cell


def get_cell_performance(
    session: Session,
    cell_id: uuid.UUID,
    crop_cycle_id: uuid.UUID | None = None,
) -> CellPerformance:
    """Historial de la celda con el error de cada prediccion, mas reciente primero."""
    cell = get_cell(session, cell_id)

    prediction_query = select(Prediction).where(Prediction.cell_id == cell_id)
    harvest_query = select(Harvest).where(Harvest.cell_id == cell_id)
    if crop_cycle_id is not None:
        prediction_query = prediction_query.where(Prediction.crop_cycle_id == crop_cycle_id)
        harvest_query = harvest_query.where(Harvest.crop_cycle_id == crop_cycle_id)

    predictions = list(
        session.scalars(prediction_query.order_by(Prediction.created_at.desc(), Prediction.id))
    )
    harvests = list(
        session.scalars(harvest_query.order_by(Harvest.harvested_at.desc(), Harvest.id))
    )

    # Cosecha mas reciente por ciclo. Igual criterio que el LATERAL de la vista.
    latest_harvest: dict[uuid.UUID, Harvest] = {}
    for harvest in harvests:
        latest_harvest.setdefault(harvest.crop_cycle_id, harvest)

    entries = [_build_entry(p, latest_harvest.get(p.crop_cycle_id)) for p in predictions]

    resolved_cycle_id = crop_cycle_id
    if resolved_cycle_id is None and predictions:
        resolved_cycle_id = predictions[0].crop_cycle_id
    if resolved_cycle_id is None:
        raise NotFoundError("CropCycle para la celda", cell_id)

    return CellPerformance(
        cell_id=cell.id,
        cell_code=cell.cell_code,
        crop_cycle_id=resolved_cycle_id,
        entries=entries,
    )


def _build_entry(prediction: Prediction, harvest: Harvest | None) -> PerformanceEntry:
    if harvest is None:
        return PerformanceEntry(
            prediction_id=prediction.id,
            predicted_at=prediction.created_at,
            model_version=prediction.model_version,
            projected_yield_kg=prediction.projected_yield_kg,
            projected_boxes=prediction.projected_boxes,
            estimated_loss_percentage=prediction.estimated_loss_percentage,
            risk_level=prediction.risk_level,
        )

    return PerformanceEntry(
        prediction_id=prediction.id,
        predicted_at=prediction.created_at,
        model_version=prediction.model_version,
        projected_yield_kg=prediction.projected_yield_kg,
        projected_boxes=prediction.projected_boxes,
        estimated_loss_percentage=prediction.estimated_loss_percentage,
        risk_level=prediction.risk_level,
        harvest_id=harvest.id,
        harvested_at=harvest.harvested_at,
        actual_yield_kg=harvest.actual_yield_kg,
        actual_boxes=harvest.actual_boxes,
        absolute_error_kg=absolute_error_kg(
            prediction.projected_yield_kg, harvest.actual_yield_kg
        ),
        percentage_error=percentage_error(
            prediction.projected_yield_kg, harvest.actual_yield_kg
        ),
    )
