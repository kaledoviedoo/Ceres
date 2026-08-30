"""Constructores de datos para los tests.

`FakeCell` y `FakeCrop` satisfacen los protocolos `CellState` y `CropSpec` del
motor sin heredar de nada, que es justamente lo que esos protocolos permiten
comprobar: el motor no necesita SQLAlchemy.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

#: Parametros del tomate del dataset de demo.
TOMATO_BASE_YIELD_KG_PER_M2 = 12.0
TOMATO_BOX_CAPACITY_KG = 6.0
TOMATO_OPTIMAL_DENSITY = 2.5


@dataclass(frozen=True)
class FakeCrop:
    slug: str = "tomato"
    base_yield_kg_per_m2: float = TOMATO_BASE_YIELD_KG_PER_M2
    box_capacity_kg: float = TOMATO_BOX_CAPACITY_KG
    optimal_plant_density_per_m2: float = TOMATO_OPTIMAL_DENSITY


@dataclass(frozen=True)
class FakeCell:
    cell_code: str = "A-00001"
    elevation_m: float = 1180.0
    slope_deg: float = 0.0
    soil_quality: float = 0.5
    plant_density: float = TOMATO_OPTIMAL_DENSITY
    health_factor: float = 1.0
    base_yield_factor: float = 1.0
    id: uuid.UUID | None = None


def make_cell(**overrides) -> FakeCell:
    """Celda neutra, con los campos indicados sustituidos."""
    return FakeCell(**overrides)


#: Celda perfecta: sin pendiente, suelo optimo, sanidad plena, densidad optima.
OPTIMAL_CELL = FakeCell(
    cell_code="A-OPTIMAL",
    slope_deg=0.0,
    soil_quality=1.0,
    plant_density=TOMATO_OPTIMAL_DENSITY,
    health_factor=1.0,
    base_yield_factor=1.0,
)

#: Celda pesima: pendiente por encima de la referencia, suelo y sanidad minimos.
POOR_CELL = FakeCell(
    cell_code="A-POOR",
    slope_deg=25.0,
    soil_quality=0.0,
    plant_density=0.2,
    health_factor=0.05,
    base_yield_factor=0.8,
)

#: Celda intermedia, cercana a la media del dataset sintetico.
AVERAGE_CELL = FakeCell(
    cell_code="A-AVERAGE",
    slope_deg=3.0,
    soil_quality=0.6,
    plant_density=2.4,
    health_factor=0.75,
    base_yield_factor=1.0,
)
