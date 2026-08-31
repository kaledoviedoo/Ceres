"""Consultas de la jerarquia espacial: finca -> lote -> celda."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import CropCycle, Farm, GridCell, Plot
from app.services.errors import NotFoundError


def list_farms(session: Session) -> list[Farm]:
    return list(session.scalars(select(Farm).order_by(Farm.name)))


def get_farm(session: Session, farm_id: uuid.UUID) -> Farm:
    """Finca con sus lotes cargados, para el selector del dashboard."""
    farm = session.scalar(
        select(Farm).where(Farm.id == farm_id).options(selectinload(Farm.plots))
    )
    if farm is None:
        raise NotFoundError("Farm", farm_id)
    return farm


def get_plot(session: Session, plot_id: uuid.UUID) -> Plot:
    plot = session.get(Plot, plot_id)
    if plot is None:
        raise NotFoundError("Plot", plot_id)
    return plot


def list_cells_for_plot(session: Session, plot_id: uuid.UUID) -> tuple[Plot, list[GridCell]]:
    """Las celdas del lote completo, en una sola consulta.

    Devolver las 400 celdas de golpe es deliberado: una peticion por celda serian
    400 round-trips para pintar una pantalla, y ese patron es imposible de
    deshacer una vez que el frontend depende de el.

    El orden (y, x) hace que la lista llegue por filas de sur a norte, que es
    como el frontend recorre la malla.
    """
    plot = get_plot(session, plot_id)
    cells = list(
        session.scalars(
            select(GridCell)
            .where(GridCell.plot_id == plot_id)
            .order_by(GridCell.y, GridCell.x)
        )
    )
    return plot, cells


def get_cell(session: Session, cell_id: uuid.UUID) -> GridCell:
    cell = session.get(GridCell, cell_id)
    if cell is None:
        raise NotFoundError("Cell", cell_id)
    return cell


def list_crop_cycles_for_plot(session: Session, plot_id: uuid.UUID) -> list[CropCycle]:
    """Ciclos de cultivo del lote, con su cultivo cargado.

    El frontend lo necesita para poder pedir una prediccion: `POST /predictions`
    exige un `crop_cycle_id` y hasta ahora no habia forma de obtenerlo.
    """
    get_plot(session, plot_id)  # 404 si el lote no existe

    return list(
        session.scalars(
            select(CropCycle)
            .where(CropCycle.plot_id == plot_id)
            .options(joinedload(CropCycle.crop))
            .order_by(CropCycle.planted_at.desc().nullslast(), CropCycle.slug)
        )
    )
