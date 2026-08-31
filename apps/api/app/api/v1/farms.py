"""Endpoints de fincas y lotes."""

from __future__ import annotations

import uuid

from fastapi import APIRouter

import uuid as _uuid

from fastapi import Query

from app.api.deps import SessionDep
from app.schemas.cell import CellCollection, CellSummary
from app.schemas.crop import CropCycleDetail
from app.schemas.farm import FarmDetail, FarmRead
from app.schemas.overview import CellOverview, PlotOverview
from app.schemas.plot import PlotRead
from app.services import farms as farms_service
from app.core.prediction import MODEL_VERSION
from app.services import predictions as predictions_service

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


@router.get("/plots/{plot_id}/crop-cycles", response_model=list[CropCycleDetail])
def list_plot_crop_cycles(plot_id: uuid.UUID, session: SessionDep) -> list[CropCycleDetail]:
    """Ciclos de cultivo del lote, con su cultivo embebido.

    El frontend lo necesita para poder pedir una prediccion: `POST /predictions`
    exige un `crop_cycle_id`.
    """
    return [
        CropCycleDetail.model_validate(cycle)
        for cycle in farms_service.list_crop_cycles_for_plot(session, plot_id)
    ]


@router.get("/plots/{plot_id}/overview", response_model=PlotOverview)
def get_plot_overview(
    plot_id: uuid.UUID,
    session: SessionDep,
    crop_cycle_id: _uuid.UUID = Query(
        ..., description="Ciclo de cultivo sobre el que se evalua la malla"
    ),
) -> PlotOverview:
    """Riesgo y rendimiento de las 400 celdas, para colorear la malla.

    **No persiste nada.** Son metricas calculadas al vuelo sobre el estado
    actual del terreno; `persisted` viaja en la respuesta como false para que
    nadie las confunda con predicciones guardadas.

    Guardar una prediccion sigue siendo exclusivo de `POST /predictions`, al
    hacer click en una celda concreta.
    """
    plot, cycle, results = predictions_service.build_plot_overview(
        session, plot_id, crop_cycle_id
    )

    return PlotOverview(
        plot_id=plot.id,
        crop_cycle_id=cycle.id,
        grid_width=plot.grid_width,
        grid_height=plot.grid_height,
        cell_size_m=plot.cell_size_m,
        model_version=results[0][1].model_version if results else MODEL_VERSION,
        cells=[
            CellOverview(
                cell_id=cell.id,
                cell_code=cell.cell_code,
                x=cell.x,
                y=cell.y,
                projected_yield_kg=result.projected_yield_kg,
                projected_boxes=result.projected_boxes,
                estimated_loss_percentage=result.estimated_loss_percentage,
                risk_score=result.risk_score,
                risk_level=result.risk_level,
            )
            for cell, result in results
        ],
    )
