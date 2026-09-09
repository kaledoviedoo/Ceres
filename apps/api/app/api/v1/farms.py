"""Endpoints de fincas y lotes."""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter

import uuid as _uuid

from fastapi import Query

from app.api.deps import SessionDep
from app.schemas.cell import CellCollection, CellSummary
from app.schemas.crop import CropCycleDetail
from app.schemas.farm import FarmDetail, FarmRead
from app.schemas.overview import CellOverview, PlotOverview, PlotTimeline, TimelineMoment
from app.schemas.plot import PlotRead
from app.services import farms as farms_service
from app.services import provenance as provenance_service
from app.core.prediction import MODEL_VERSION
from app.core.state import IMPACT_VERSION
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
    """Todas las celdas del lote en una sola respuesta.

    Deliberado: una peticion por celda seria un round-trip por celda para pintar
    una pantalla. El detalle de una celda concreta se pide al hacer click.

    SIN PAGINAR, y el coste depende del lote. Los de La Cuadricula son de
    100 x 100, o sea 10.000 celdas y ~2 MB por peticion; el de la finca demo es
    de 20 x 20. Queda como deuda conocida: la respuesta se sirve entera porque
    el frontend necesita la malla completa para construir la geometria, y
    paginarla exigiria que la reensamblara.
    """
    plot, cells = farms_service.list_cells_for_plot(session, plot_id)
    return CellCollection(
        plot_id=plot.id,
        grid_width=plot.grid_width,
        grid_height=plot.grid_height,
        cell_size_m=plot.cell_size_m,
        provenance=provenance_service.build_cell_provenance(plot),
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


@router.get("/plots/{plot_id}/timeline", response_model=PlotTimeline)
def get_plot_timeline(
    plot_id: uuid.UUID,
    session: SessionDep,
    crop_cycle_id: _uuid.UUID = Query(
        ..., description="Ciclo de cultivo cuyos momentos se piden"
    ),
) -> PlotTimeline:
    """De que momentos puede el mapa ensenar el estado de este lote.

    Devuelve los `as_of` DISTINTOS que existen en `predictions`. No es una lista
    escrita a mano: es lo que quedo escrito al lanzar predicciones.

    Existe porque la interfaz no tenia de donde sacar esos instantes. Los del
    escenario sintetico viven en `PREDICTION_MOMENTS`, dentro del generador, que
    la API no importa. Y no se pueden deducir del ciclo: para el lote de papa,
    t0 es 2026-04-14 --siembra + 30 dias-- y t2 es 2026-08-13 --cosecha - 7--,
    asi que ni `planted_at` ni `expected_harvest_at` sirven como momento.

    Un lote sin predicciones devuelve la lista vacia. Es una respuesta, no un
    hueco: significa que no hay ningun momento del que ensenar el estado.
    """
    plot, cycle, momentos = predictions_service.build_plot_timeline(
        session, plot_id, crop_cycle_id
    )

    return PlotTimeline(
        plot_id=plot.id,
        crop_cycle_id=cycle.id,
        planted_at=cycle.planted_at,
        expected_harvest_at=cycle.expected_harvest_at,
        moments=[
            TimelineMoment(as_of=momento, prediction_count=total)
            for momento, total in momentos
        ],
    )


@router.get("/plots/{plot_id}/overview", response_model=PlotOverview)
def get_plot_overview(
    plot_id: uuid.UUID,
    session: SessionDep,
    crop_cycle_id: _uuid.UUID = Query(
        ..., description="Ciclo de cultivo sobre el que se evalua la malla"
    ),
    as_of: datetime | None = Query(
        None,
        description=(
            "De que momento se pinta el mapa. Sin fecha se usa el estado base, "
            "sin observaciones. Con fecha se derivan con `state_at`, que es lo "
            "que hace visibles las zonas de evento."
        ),
    ),
) -> PlotOverview:
    """Riesgo y rendimiento de todas las celdas del lote, para colorear la malla.

    **No persiste nada.** Son metricas calculadas al vuelo; `persisted` viaja en
    la respuesta como false para que nadie las confunda con predicciones
    guardadas. Guardar sigue siendo exclusivo de `POST /predictions`, al hacer
    click en una celda concreta.

    `as_of` es opcional y sin el el comportamiento es el de siempre. Se anadio
    porque sin fecha el mapa NO PUEDE mostrar lo que ha pasado: una finca con
    9.900 observaciones fechadas se pintaba entera del mismo color, y las zonas
    de gota, granizada o inundacion solo existian en las predicciones guardadas,
    que el mapa no lee.
    """
    plot, cycle, results = predictions_service.build_plot_overview(
        session, plot_id, crop_cycle_id, as_of
    )

    # La version tiene que decir QUE modelos produjeron estos numeros, y con
    # `as_of` son dos: el motor de rendimiento y el de impacto, que es el que
    # deriva el estado de cada celda a partir de sus observaciones. Se declaraba
    # solo el primero, igual que antes de existir el eje temporal, y desde que
    # el mapa acepta fecha eso es afirmar de menos: una prediccion guardada del
    # mismo instante se identifica como `rule-based-v0.1+impact-v0` y el mapa
    # decia `rule-based-v0.1` para los mismos kilos.
    motor = results[0][1].model_version if results else MODEL_VERSION
    version = f"{motor}+{IMPACT_VERSION}" if as_of is not None else motor

    return PlotOverview(
        plot_id=plot.id,
        crop_cycle_id=cycle.id,
        grid_width=plot.grid_width,
        grid_height=plot.grid_height,
        cell_size_m=plot.cell_size_m,
        model_version=version,
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
