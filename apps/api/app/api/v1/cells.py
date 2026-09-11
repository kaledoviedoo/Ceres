"""Endpoints de celda: detalle, historiales y rendimiento real."""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Query

from app.api.deps import SessionDep
from app.schemas.cell import CellRead
from app.schemas.harvest import HarvestRead
from app.schemas.observation import ObservationRead
from app.schemas.performance import CellPerformance
from app.schemas.prediction import PredictionList, PredictionRead
from app.services import farms as farms_service
from app.services import harvests as harvests_service
from app.services import observations as observations_service
from app.services import performance as performance_service
from app.services import predictions as predictions_service

router = APIRouter(prefix="/cells", tags=["cells"])


@router.get("/{cell_id}", response_model=CellRead)
def get_cell(cell_id: uuid.UUID, session: SessionDep) -> CellRead:
    return CellRead.model_validate(farms_service.get_cell(session, cell_id))


@router.get("/{cell_id}/predictions", response_model=PredictionList)
def list_cell_predictions(
    cell_id: uuid.UUID,
    session: SessionDep,
    crop_cycle_id: uuid.UUID | None = None,
) -> PredictionList:
    """Historial completo, mas reciente primero.

    Devuelve todas las predicciones, no solo la ultima: el valor del Digital
    Twin esta en poder responder "que predijo CERES en ese momento".
    """
    predictions = predictions_service.list_predictions_for_cell(
        session, cell_id, crop_cycle_id
    )
    return PredictionList(
        cell_id=cell_id,
        predictions=[PredictionRead.model_validate(p) for p in predictions],
    )


@router.get("/{cell_id}/observations", response_model=list[ObservationRead])
def list_cell_observations(cell_id: uuid.UUID, session: SessionDep) -> list[ObservationRead]:
    return [
        ObservationRead.model_validate(observation)
        for observation in observations_service.list_observations_for_cell(session, cell_id)
    ]


@router.get("/{cell_id}/harvests", response_model=list[HarvestRead])
def list_cell_harvests(cell_id: uuid.UUID, session: SessionDep) -> list[HarvestRead]:
    return [
        HarvestRead.model_validate(harvest)
        for harvest in harvests_service.list_harvests_for_cell(session, cell_id)
    ]


@router.get("/{cell_id}/performance", response_model=CellPerformance)
def get_cell_performance(
    cell_id: uuid.UUID,
    session: SessionDep,
    crop_cycle_id: uuid.UUID | None = None,
    as_of: datetime | None = Query(
        None,
        description=(
            "Deja solo la prediccion que habla de ESE instante. Sin fecha se "
            "devuelve el historial completo, que es el comportamiento de siempre."
        ),
    ),
) -> CellPerformance:
    """Prediccion vs realidad. El cierre del ciclo del Digital Twin.

    `as_of` FILTRA, no recalcula, y la diferencia importa. Este endpoint
    responde "que predijo CERES de aquel momento", y eso es un hecho historico
    que vive en `predictions`: rederivarlo permitiria que la respuesta cambiara
    al cambiar el modelo, y entonces dejaria de ser un historial.

    Es la diferencia con `GET /plots/{id}/overview`, que con `as_of` SI
    recalcula: aquel pinta un estado, este cuenta lo que se dijo.

    Se anadio para que el inspector pueda seguir al mismo instante que el mapa.
    Sin el parametro, la interfaz tendria que elegir la entrada por su cuenta y
    el momento no viajaria en la peticion: nadie podria comprobar desde fuera
    que la ficha esta ensenando el momento que dice.

    La COSECHA NO DEPENDE DE `as_of`. Es la misma celda y el mismo ciclo, asi
    que el rendimiento real es el mismo se mire desde el momento que se mire; lo
    que cambia es la prediccion contra la que se compara, y por tanto el error.
    """
    return performance_service.get_cell_performance(
        session, cell_id, crop_cycle_id, as_of
    )
