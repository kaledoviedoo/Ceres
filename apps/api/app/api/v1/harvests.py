"""Endpoint de cosechas reales."""

from __future__ import annotations

from fastapi import APIRouter, status

from app.api.deps import SessionDep
from app.schemas.harvest import HarvestCreate, HarvestRead
from app.services import harvests as harvests_service

router = APIRouter(tags=["harvests"])


@router.post(
    "/harvests",
    response_model=HarvestRead,
    status_code=status.HTTP_201_CREATED,
)
def create_harvest(payload: HarvestCreate, session: SessionDep) -> HarvestRead:
    """Registra la cosecha real de una celda: el ground truth de la validacion."""
    return HarvestRead.model_validate(harvests_service.create_harvest(session, payload))
