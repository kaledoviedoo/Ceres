"""Endpoints de fincas y lotes."""

from __future__ import annotations

import uuid

from fastapi import APIRouter

from app.api.deps import SessionDep
from app.schemas.cell import CellCollection, CellSummary
from app.schemas.farm import FarmDetail, FarmRead
from app.schemas.plot import PlotRead
from app.services import farms as farms_service

router = APIRouter(tags=["farms"])


@router.get("/farms", response_model=list[FarmRead])
def list_farms(session: SessionDep) -> list[FarmRead]:
    return [FarmRead.model_validate(farm) for farm in farms_service.list_farms(session)]


@router.get("/farms/{farm_id}", response_model=FarmDetail)
def get_farm(farm_id: uuid.UUID, session: SessionDep) -> FarmDetail:
    """Finca con sus lotes, para poblar el selector finca -> lote."""
    return FarmDetail.model_validate(farms_service.get_farm(session, farm_id))


@router.get("/plots/{plot_id}", response_model=PlotRead)
def get_plot(plot_id: uuid.UUID, session: SessionDep) -> PlotRead:
    return PlotRead.model_validate(farms_service.get_plot(session, plot_id))


@router.get("/plots/{plot_id}/cells", response_model=CellCollection)
def list_plot_cells(plot_id: uuid.UUID, session: SessionDep) -> CellCollection:
    """Las 400 celdas del lote en una sola respuesta.

    Deliberado: una peticion por celda serian 400 round-trips para pintar una
    pantalla. El detalle de una celda concreta se pide al hacer click.
    """
    plot, cells = farms_service.list_cells_for_plot(session, plot_id)
    return CellCollection(
        plot_id=plot.id,
        grid_width=plot.grid_width,
        grid_height=plot.grid_height,
        cell_size_m=plot.cell_size_m,
        cells=[CellSummary.model_validate(cell) for cell in cells],
    )
