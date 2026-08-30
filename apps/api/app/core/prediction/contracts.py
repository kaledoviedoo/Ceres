"""Contratos del motor de prediccion.

Estructuras planas e inmutables. El motor no recibe modelos de SQLAlchemy: solo
valores. Eso lo hace testeable sin base de datos y reutilizable desde un script,
un notebook o un endpoint.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.domain.enums import RiskLevel

#: Version del modelo actual. Se persiste en cada prediccion para que un cambio
#: de formula no reescriba la historia.
MODEL_VERSION = "rule-based-v0.1"


@dataclass(frozen=True, slots=True)
class CropParameters:
    """Parametros agronomicos del cultivo, extraidos de la tabla `crops`."""

    slug: str
    base_yield_kg_per_m2: float
    box_capacity_kg: float
    optimal_plant_density_per_m2: float

    def __post_init__(self) -> None:
        if self.base_yield_kg_per_m2 <= 0:
            raise ValueError("base_yield_kg_per_m2 debe ser > 0")
        if self.box_capacity_kg <= 0:
            raise ValueError("box_capacity_kg debe ser > 0")
        if self.optimal_plant_density_per_m2 <= 0:
            raise ValueError("optimal_plant_density_per_m2 debe ser > 0")


@dataclass(frozen=True, slots=True)
class PredictionInput:
    """Estado de una celda mas el cultivo que se esta sembrando en ella."""

    cell_code: str
    area_m2: float
    elevation_m: float
    slope_deg: float
    soil_quality: float
    plant_density: float
    health_factor: float
    base_yield_factor: float
    crop: CropParameters

    def __post_init__(self) -> None:
        if self.area_m2 <= 0:
            raise ValueError("area_m2 debe ser > 0")
        if not 0.0 <= self.soil_quality <= 1.0:
            raise ValueError("soil_quality debe estar en [0, 1]")
        if not 0.0 <= self.health_factor <= 1.0:
            raise ValueError("health_factor debe estar en [0, 1]")
        if not 0.0 <= self.slope_deg <= 90.0:
            raise ValueError("slope_deg debe estar en [0, 90]")
        if self.plant_density < 0:
            raise ValueError("plant_density no puede ser negativa")
        if self.base_yield_factor <= 0:
            raise ValueError("base_yield_factor debe ser > 0")


@dataclass(frozen=True, slots=True)
class YieldFactors:
    """Multiplicadores que explican el resultado. 1.0 = neutro."""

    density_factor: float
    soil_factor: float
    health_factor: float
    terrain_factor: float
    base_yield_factor: float

    def as_dict(self) -> dict[str, float]:
        return {
            "density_factor": self.density_factor,
            "soil_factor": self.soil_factor,
            "health_factor": self.health_factor,
            "terrain_factor": self.terrain_factor,
            "base_yield_factor": self.base_yield_factor,
        }


@dataclass(frozen=True, slots=True)
class PredictionResult:
    """Salida del motor. Se persiste tal cual en la tabla `predictions`."""

    cell_code: str
    projected_yield_kg: float
    projected_yield_tons: float
    projected_boxes: int
    estimated_loss_percentage: float
    risk_score: float
    risk_level: RiskLevel
    model_version: str = MODEL_VERSION
    factors: YieldFactors | None = None
    inputs: dict[str, float] = field(default_factory=dict)
