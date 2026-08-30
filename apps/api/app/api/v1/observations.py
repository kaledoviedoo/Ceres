"""Endpoint de observaciones de campo."""

from __future__ import annotations

from fastapi import APIRouter, status

from app.api.deps import SessionDep
from app.schemas.observation import ObservationCreate, ObservationRead
from app.services import observations as observations_service

router = APIRouter(tags=["observations"])


@router.post(
    "/observations",
    response_model=ObservationRead,
    status_code=status.HTTP_201_CREATED,
)
def create_observation(payload: ObservationCreate, session: SessionDep) -> ObservationRead:
    return ObservationRead.model_validate(
        observations_service.create_observation(session, payload)
    )
