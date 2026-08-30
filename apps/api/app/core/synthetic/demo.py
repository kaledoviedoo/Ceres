"""Construccion del dataset de demo completo.

DEMO / SYNTHETIC DATA — finca ficticia, valores ficticios.

Produce filas listas para insertar, sin tocar la base de datos: quien escribe el
SQL (scripts/generate_demo_data.py) y quien genera los datos estan separados,
asi que el mismo dataset puede volcarse a SQL, a JSON o a memoria en un test.

Identificadores: se usan UUID v5 derivados de un namespace fijo. Regenerar el
dataset produce exactamente los mismos ids, asi que el seed es idempotente y se
puede reaplicar sin duplicar filas.
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any

import numpy as np

from app.core.synthetic.field import (
    METERS_PER_DEGREE_LATITUDE,
    TerrainProfile,
    build_cell_code,
    cell_centroid,
    generate_cell_features,
)
from app.domain.enums import CropCycleStatus, ObservationType, UserRole

#: Seed por defecto. El brief la fija en 42 para que el dataset sea reproducible.
DEFAULT_SEED = 42

#: Namespace para los UUID v5 del dataset de demo.
CERES_DEMO_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_DNS, "demo.ceres.local")

#: Zonas agricolas reales de Colombia entre las que se ubica la finca ficticia.
#: Se elige una con el generador sembrado: "aleatoria" pero reproducible.
COLOMBIAN_REGIONS: tuple[tuple[str, str, float, float], ...] = (
    ("Boyaca", "Villa de Leyva", 5.6339, -73.5240),
    ("Antioquia", "El Retiro", 6.0592, -75.5028),
    ("Valle del Cauca", "Ginebra", 3.7247, -76.2680),
    ("Cundinamarca", "Fusagasuga", 4.3373, -74.3639),
    ("Santander", "Piedecuesta", 6.9922, -73.0499),
)

#: Tamano de la malla de cada lote en el MVP (20 x 20 = 400 celdas ~ 400 m2).
GRID_WIDTH = 20
GRID_HEIGHT = 20
CELL_SIZE_M = 1.0

#: Separacion entre lotes, en metros hacia el este.
PLOT_SEPARATION_M = 30.0

#: Cuantas observaciones sinteticas se generan y sobre que muestra de celdas.
OBSERVATION_COUNT = 24
OBSERVATION_CANDIDATE_POOL = 60

_OBSERVATION_DESCRIPTIONS: dict[ObservationType, str] = {
    ObservationType.PEST: "Presencia de insectos en el enves de las hojas.",
    ObservationType.DISEASE: "Manchas foliares compatibles con infeccion fungica.",
    ObservationType.WATER_STRESS: "Marchitez en horas centrales del dia.",
    ObservationType.PHYSICAL_DAMAGE: "Tallos partidos y erosion superficial del suelo.",
    ObservationType.OTHER: "Anomalia registrada en campo, pendiente de clasificar.",
}


def demo_uuid(*parts: str) -> uuid.UUID:
    """UUID v5 estable a partir de una clave legible."""
    return uuid.uuid5(CERES_DEMO_NAMESPACE, ":".join(parts))


@dataclass(frozen=True, slots=True)
class TableRows:
    """Filas de una tabla, en orden de insercion."""

    name: str
    rows: list[dict[str, Any]]

    @property
    def columns(self) -> tuple[str, ...]:
        return tuple(self.rows[0].keys()) if self.rows else ()


@dataclass(frozen=True, slots=True)
class DemoDataset:
    """Dataset completo, con las tablas en orden de dependencia."""

    seed: int
    tables: list[TableRows] = field(default_factory=list)

    def table(self, name: str) -> TableRows:
        for table in self.tables:
            if table.name == name:
                return table
        raise KeyError(f"El dataset no contiene la tabla {name!r}")

    def summary(self) -> dict[str, int]:
        return {table.name: len(table.rows) for table in self.tables}


def _offset_longitude(latitude: float, longitude: float, meters_east: float) -> float:
    """Desplaza una longitud N metros hacia el este a una latitud dada."""
    meters_per_degree_lon = METERS_PER_DEGREE_LATITUDE * math.cos(math.radians(latitude))
    return longitude + meters_east / meters_per_degree_lon


def _classify_observation(
    slope_deg: float,
    health: float,
    soil_quality: float,
    force_other: bool,
) -> ObservationType:
    """Regla explicita que liga el tipo de observacion al estado de la celda.

    No es agronomia real: es una heuristica para que los datos de demo tengan
    coherencia interna en lugar de etiquetas al azar.
    """
    if force_other:
        return ObservationType.OTHER
    if slope_deg >= 8.0:
        return ObservationType.PHYSICAL_DAMAGE
    if health < 0.35:
        return ObservationType.DISEASE
    if soil_quality < 0.50:
        return ObservationType.WATER_STRESS
    return ObservationType.PEST


def build_demo_dataset(
    seed: int = DEFAULT_SEED,
    grid_width: int = GRID_WIDTH,
    grid_height: int = GRID_HEIGHT,
    profile: TerrainProfile | None = None,
) -> DemoDataset:
    """Construye el dataset de demo completo de forma determinista.

    Contenido (seccion 37 del brief):
    1 organizacion, 2 usuarios, 1 finca, 2 lotes, 1 cultivo, 1 ciclo de cultivo,
    `grid_width * grid_height` celdas por lote y observaciones sinteticas.
    """
    rng = np.random.default_rng(seed)
    profile = profile or TerrainProfile()

    # --- Organizacion y usuarios ---------------------------------------------
    organization_id = demo_uuid("organization", "ceres-demo")
    organizations = [
        {
            "id": organization_id,
            "name": "CERES Demo",
            "slug": "ceres-demo",
        }
    ]

    users = [
        {
            "id": demo_uuid("user", "owner@ceres.demo"),
            "organization_id": organization_id,
            "email": "owner@ceres.demo",
            "full_name": "Demo Owner",
            "role": UserRole.OWNER.value,
        },
        {
            "id": demo_uuid("user", "agronomo@ceres.demo"),
            "organization_id": organization_id,
            "email": "agronomo@ceres.demo",
            "full_name": "Demo Agronomo",
            "role": UserRole.AGRONOMIST.value,
        },
    ]
    agronomist_id = users[1]["id"]

    # --- Finca: ubicacion "aleatoria" pero reproducible -----------------------
    region_name, locality, region_lat, region_lon = COLOMBIAN_REGIONS[
        int(rng.integers(len(COLOMBIAN_REGIONS)))
    ]
    farm_latitude = round(float(region_lat + rng.uniform(-0.05, 0.05)), 7)
    farm_longitude = round(float(region_lon + rng.uniform(-0.05, 0.05)), 7)

    farm_id = demo_uuid("farm", "ceres-demo-farm")
    farms = [
        {
            "id": farm_id,
            "organization_id": organization_id,
            "name": "CERES Demo Farm",
            "country": "CO",
            "region": f"{region_name} ({locality})",
            "latitude": farm_latitude,
            "longitude": farm_longitude,
        }
    ]

    # --- Cultivo --------------------------------------------------------------
    crop_id = demo_uuid("crop", "tomato")
    crops = [
        {
            "id": crop_id,
            "organization_id": organization_id,
            "name": "Tomate",
            "slug": "tomato",
            "variety": "Chonto",
            "box_capacity_kg": 6.0,
            "base_yield_kg_per_m2": 12.0,
            "optimal_plant_density_per_m2": profile.target_plant_density,
            "cycle_days": 120,
        }
    ]

    # --- Lotes y celdas -------------------------------------------------------
    plots: list[dict[str, Any]] = []
    grid_cells: list[dict[str, Any]] = []
    feature_grids = {}

    plot_definitions = (
        ("A", "Plot A", 0.0),
        ("B", "Plot B", PLOT_SEPARATION_M + grid_width * CELL_SIZE_M),
    )

    for plot_index, (plot_code, plot_name, east_offset_m) in enumerate(plot_definitions):
        plot_id = demo_uuid("plot", plot_code)
        origin_latitude = farm_latitude
        origin_longitude = round(
            _offset_longitude(farm_latitude, farm_longitude, east_offset_m), 7
        )

        plots.append(
            {
                "id": plot_id,
                "farm_id": farm_id,
                "name": plot_name,
                "code": plot_code,
                "grid_width": grid_width,
                "grid_height": grid_height,
                "cell_size_m": CELL_SIZE_M,
                "origin_latitude": origin_latitude,
                "origin_longitude": origin_longitude,
            }
        )

        # Cada lote usa una seed derivada: terrenos distintos, ambos deterministas.
        features = generate_cell_features(
            width=grid_width,
            height=grid_height,
            seed=seed + plot_index * 1_000,
            cell_size_m=CELL_SIZE_M,
            profile=profile,
        )
        feature_grids[plot_code] = features

        for y in range(grid_height):
            for x in range(grid_width):
                cell_code = build_cell_code(plot_code, x, y, grid_width)
                centroid_lat, centroid_lon = cell_centroid(
                    origin_latitude, origin_longitude, x, y, CELL_SIZE_M
                )
                grid_cells.append(
                    {
                        "id": demo_uuid("grid_cell", plot_code, str(x), str(y)),
                        "plot_id": plot_id,
                        "cell_code": cell_code,
                        "x": x,
                        "y": y,
                        "elevation_m": round(float(features.elevation_m[y, x]), 3),
                        "slope_deg": round(float(features.slope_deg[y, x]), 3),
                        "soil_quality": round(float(features.soil_quality[y, x]), 4),
                        "plant_density": round(float(features.plant_density[y, x]), 4),
                        "health_factor": round(float(features.health_factor[y, x]), 4),
                        "base_yield_factor": round(float(features.base_yield_factor[y, x]), 4),
                        "centroid_latitude": round(centroid_lat, 7),
                        "centroid_longitude": round(centroid_lon, 7),
                    }
                )

    # --- Ciclo de cultivo -----------------------------------------------------
    # Un unico ciclo, sobre Plot A. Plot B queda sembrable en una temporada
    # futura: es justamente lo que justifica separar CropCycle de Plot.
    plot_a_id = plots[0]["id"]
    planted_at = date(2026, 2, 15)
    crop_cycle_id = demo_uuid("crop_cycle", "A", "tomate-2026a")
    crop_cycles = [
        {
            "id": crop_cycle_id,
            "plot_id": plot_a_id,
            "crop_id": crop_id,
            "name": "Tomate 2026-A",
            "slug": "tomate-2026a",
            "status": CropCycleStatus.ACTIVE.value,
            "planted_at": planted_at,
            "expected_harvest_at": planted_at + timedelta(days=crops[0]["cycle_days"]),
        }
    ]

    # --- Observaciones --------------------------------------------------------
    # Se concentran en las celdas mas debiles de Plot A: es donde un agronomo
    # realmente miraria, y hace que el mapa de observaciones tenga estructura.
    plot_a_cells = [cell for cell in grid_cells if cell["plot_id"] == plot_a_id]
    weakest = sorted(plot_a_cells, key=lambda cell: cell["health_factor"])[
        :OBSERVATION_CANDIDATE_POOL
    ]
    chosen_indices = rng.choice(len(weakest), size=OBSERVATION_COUNT, replace=False)

    observations: list[dict[str, Any]] = []
    for order, index in enumerate(sorted(int(i) for i in chosen_indices)):
        cell = weakest[index]
        observation_type = _classify_observation(
            slope_deg=cell["slope_deg"],
            health=cell["health_factor"],
            soil_quality=cell["soil_quality"],
            force_other=bool(rng.random() < 0.08),
        )
        severity = float(
            np.clip(0.25 + (1.0 - cell["health_factor"]) * 0.70 + rng.normal(0, 0.05), 0.05, 1.0)
        )
        days_into_cycle = int(rng.integers(20, 100))
        observed_at = datetime.combine(
            planted_at + timedelta(days=days_into_cycle),
            datetime.min.time(),
            tzinfo=timezone.utc,
        ) + timedelta(hours=14)

        observations.append(
            {
                "id": demo_uuid("observation", cell["cell_code"], str(order)),
                "cell_id": cell["id"],
                "crop_cycle_id": crop_cycle_id,
                "type": observation_type.value,
                "severity": round(severity, 3),
                "description": _OBSERVATION_DESCRIPTIONS[observation_type],
                "observed_at": observed_at,
                "created_by": agronomist_id,
            }
        )

    return DemoDataset(
        seed=seed,
        tables=[
            TableRows("organizations", organizations),
            TableRows("users", users),
            TableRows("farms", farms),
            TableRows("plots", plots),
            TableRows("crops", crops),
            TableRows("crop_cycles", crop_cycles),
            TableRows("grid_cells", grid_cells),
            TableRows("observations", observations),
        ],
    )
