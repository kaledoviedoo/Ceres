"""Servicio de cosechas: el ground truth del ciclo de validacion."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CropCycle, Harvest
from app.schemas.harvest import HarvestCreate
from app.services.errors import ConflictError, NotFoundError
from app.services.farms import get_cell


def create_harvest(session: Session, payload: HarvestCreate) -> Harvest:
    cell = get_cell(session, payload.cell_id)

    cycle = session.get(CropCycle, payload.crop_cycle_id)
    if cycle is None:
        raise NotFoundError("CropCycle", payload.crop_cycle_id)
    if cycle.plot_id != cell.plot_id:
        raise ConflictError(
            f"La celda {cell.cell_code} no pertenece al lote del ciclo {cycle.slug}"
        )

    harvest = Harvest(
        cell_id=cell.id,
        crop_cycle_id=cycle.id,
        actual_yield_kg=payload.actual_yield_kg,
        actual_boxes=payload.actual_boxes,
        harvested_at=payload.harvested_at,
        notes=payload.notes,
    )
    session.add(harvest)
    session.commit()
    session.refresh(harvest)
    return harvest


def list_harvests_for_cell(session: Session, cell_id: uuid.UUID) -> list[Harvest]:
    """Cosechas de la celda, mas reciente primero."""
    get_cell(session, cell_id)

    return list(
        session.scalars(
            select(Harvest)
            .where(Harvest.cell_id == cell_id)
            .order_by(Harvest.harvested_at.desc(), Harvest.id)
        )
    )
