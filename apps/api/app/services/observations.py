"""Servicio de observaciones de campo."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CropCycle, Observation
from app.schemas.observation import ObservationCreate
from app.services.errors import ConflictError, NotFoundError
from app.services.farms import get_cell


def create_observation(session: Session, payload: ObservationCreate) -> Observation:
    cell = get_cell(session, payload.cell_id)

    if payload.crop_cycle_id is not None:
        cycle = session.get(CropCycle, payload.crop_cycle_id)
        if cycle is None:
            raise NotFoundError("CropCycle", payload.crop_cycle_id)
        if cycle.plot_id != cell.plot_id:
            raise ConflictError(
                f"La celda {cell.cell_code} no pertenece al lote del ciclo {cycle.slug}"
            )

    observation = Observation(
        cell_id=cell.id,
        crop_cycle_id=payload.crop_cycle_id,
        type=payload.type.value,
        severity=payload.severity,
        description=payload.description,
        observed_at=payload.observed_at or datetime.now(timezone.utc),
    )
    session.add(observation)
    session.commit()
    session.refresh(observation)
    return observation


def list_observations_for_cell(session: Session, cell_id: uuid.UUID) -> list[Observation]:
    """Observaciones de la celda, mas reciente primero."""
    get_cell(session, cell_id)

    return list(
        session.scalars(
            select(Observation)
            .where(Observation.cell_id == cell_id)
            .order_by(Observation.observed_at.desc(), Observation.id)
        )
    )
