"""Extraccion y normalizacion de features.

Primera etapa del motor. Convierte el estado crudo de una celda en las
magnitudes adimensionales que consumen las formulas de rendimiento, perdida y
riesgo, y aisla al resto del motor de la forma concreta que tengan los objetos
de entrada.

Los protocolos son estructurales: un `GridCell` de SQLAlchemy los satisface sin
heredar de nada, y el motor sigue sin importar SQLAlchemy.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from app.core.prediction.contracts import CropParameters, PredictionInput

#: Pendiente (grados) a partir de la cual se aplica la penalizacion maxima.
#: SUPUESTO SINTETICO: decision de producto para el MVP, no un umbral
#: agronomico medido.
SLOPE_REFERENCE_DEG = 15.0


@runtime_checkable
class CellState(Protocol):
    """Lo que el motor necesita saber de una celda."""

    cell_code: str
    elevation_m: float
    slope_deg: float
    soil_quality: float
    plant_density: float
    health_factor: float
    base_yield_factor: float


@runtime_checkable
class CropSpec(Protocol):
    """Lo que el motor necesita saber del cultivo."""

    slug: str
    base_yield_kg_per_m2: float
    box_capacity_kg: float
    optimal_plant_density_per_m2: float


@dataclass(frozen=True, slots=True)
class NormalizedFeatures:
    """Magnitudes adimensionales derivadas del estado de la celda."""

    #: Pendiente normalizada: 0 (plano) .. 1 (>= SLOPE_REFERENCE_DEG).
    slope_norm: float
    #: Calidad de suelo, 0 .. 1. Se propaga tal cual.
    soil_quality: float
    #: Sanidad, 0 .. 1. Se propaga tal cual.
    health: float
    #: Densidad real dividida por la optima del cultivo. Sin techo: el techo es
    #: una decision del modelo de rendimiento, no de la normalizacion.
    density_ratio: float


def clamp(value: float, minimum: float, maximum: float) -> float:
    """Recorta un valor a un rango cerrado."""
    return max(minimum, min(maximum, value))


def normalize_slope(slope_deg: float) -> float:
    """Pendiente en grados -> 0..1."""
    return clamp(slope_deg / SLOPE_REFERENCE_DEG, 0.0, 1.0)


def extract_features(prediction_input: PredictionInput) -> NormalizedFeatures:
    """Normaliza una entrada ya validada."""
    return NormalizedFeatures(
        slope_norm=normalize_slope(prediction_input.slope_deg),
        soil_quality=prediction_input.soil_quality,
        health=prediction_input.health_factor,
        density_ratio=(
            prediction_input.plant_density
            / prediction_input.crop.optimal_plant_density_per_m2
        ),
    )


def build_prediction_input(
    cell: CellState,
    crop: CropSpec,
    area_m2: float = 1.0,
) -> PredictionInput:
    """Empaqueta celda y cultivo en la entrada validada del motor.

    `area_m2` sale de `plot.cell_size_m ** 2`. Por defecto 1 m2, que es el
    tamano de celda del MVP.
    """
    cell_id = getattr(cell, "id", None)
    return PredictionInput(
        cell_code=cell.cell_code,
        area_m2=area_m2,
        elevation_m=cell.elevation_m,
        slope_deg=cell.slope_deg,
        soil_quality=cell.soil_quality,
        plant_density=cell.plant_density,
        health_factor=cell.health_factor,
        base_yield_factor=cell.base_yield_factor,
        crop=CropParameters(
            slug=crop.slug,
            base_yield_kg_per_m2=crop.base_yield_kg_per_m2,
            box_capacity_kg=crop.box_capacity_kg,
            optimal_plant_density_per_m2=crop.optimal_plant_density_per_m2,
        ),
        cell_id=cell_id if isinstance(cell_id, uuid.UUID) else None,
    )
