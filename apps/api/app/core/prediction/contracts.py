"""Contratos del motor de prediccion.

Estructuras planas e inmutables. El motor no recibe modelos de SQLAlchemy: solo
valores. Eso lo hace testeable sin base de datos y reutilizable desde un script,
un notebook o un endpoint.

MODELO EXPERIMENTAL / DEMOSTRATIVO: las formulas operan sobre datos geograficos
y agricolas sinteticos. No son una prediccion agronomica cientificamente
validada.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from app.domain.enums import RiskLevel
from app.domain.units import KG_PER_TON, risk_level_from_score

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
    """Estado de una celda mas el cultivo que se esta sembrando en ella.

    Valida sus rangos al construirse: una entrada imposible falla aqui y no
    silenciosamente tres formulas mas adelante.
    """

    cell_code: str
    area_m2: float
    elevation_m: float
    slope_deg: float
    soil_quality: float
    plant_density: float
    health_factor: float
    base_yield_factor: float
    crop: CropParameters
    #: Identidad canonica de la celda. `None` cuando la entrada no viene de la
    #: base de datos (tests, notebooks, exploracion).
    cell_id: uuid.UUID | None = None

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

    def as_dict(self) -> dict[str, float | str]:
        """Fotografia de las entradas, para persistir en `predictions.inputs`.

        Permite reproducir la prediccion aunque la celda cambie despues.
        """
        return {
            "cell_code": self.cell_code,
            "area_m2": self.area_m2,
            "elevation_m": self.elevation_m,
            "slope_deg": self.slope_deg,
            "soil_quality": self.soil_quality,
            "plant_density": self.plant_density,
            "health_factor": self.health_factor,
            "base_yield_factor": self.base_yield_factor,
            "crop_slug": self.crop.slug,
            "crop_base_yield_kg_per_m2": self.crop.base_yield_kg_per_m2,
            "crop_box_capacity_kg": self.crop.box_capacity_kg,
            "crop_optimal_plant_density_per_m2": self.crop.optimal_plant_density_per_m2,
        }


@dataclass(frozen=True, slots=True)
class YieldFactors:
    """Multiplicadores que explican el resultado. 1.0 = neutro.

    Es lo que convierte la prediccion en algo auditable: se puede senalar que
    factor bajo el rendimiento y cuanto.
    """

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

    def combined(self) -> float:
        """Producto de todos los factores: el multiplicador total sobre el potencial."""
        return (
            self.density_factor
            * self.soil_factor
            * self.health_factor
            * self.terrain_factor
            * self.base_yield_factor
        )


@dataclass(frozen=True, slots=True)
class PredictionResult:
    """Salida del motor. Se persiste tal cual en la tabla `predictions`.

    Los invariantes de rango se comprueban al construir: es imposible que exista
    un `PredictionResult` con perdida del 130% o rendimiento negativo.
    """

    cell_code: str
    projected_yield_kg: float
    projected_boxes: int
    estimated_loss_percentage: float
    risk_score: float
    risk_level: RiskLevel
    factors: YieldFactors
    model_version: str = MODEL_VERSION
    cell_id: uuid.UUID | None = None
    inputs: dict[str, float | str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.projected_yield_kg < 0:
            raise ValueError("projected_yield_kg no puede ser negativo")
        if self.projected_boxes < 0:
            raise ValueError("projected_boxes no puede ser negativo")
        if not 0.0 <= self.estimated_loss_percentage <= 100.0:
            raise ValueError("estimated_loss_percentage debe estar en [0, 100]")
        if not 0.0 <= self.risk_score <= 1.0:
            raise ValueError("risk_score debe estar en [0, 1]")
        if self.risk_level is not risk_level_from_score(self.risk_score):
            raise ValueError(
                f"risk_level {self.risk_level} no corresponde a risk_score {self.risk_score}"
            )
        if not self.model_version:
            raise ValueError("model_version es obligatorio")

    @property
    def projected_yield_tons(self) -> float:
        """Derivado, nunca almacenado por separado: no pueden divergir."""
        return self.projected_yield_kg / KG_PER_TON

    def to_payload(self) -> dict[str, object]:
        """Forma JSON del resultado, tal como la consume el frontend."""
        return {
            "cell_id": str(self.cell_id) if self.cell_id else None,
            "cell_code": self.cell_code,
            "projected_yield_kg": self.projected_yield_kg,
            "projected_yield_tons": self.projected_yield_tons,
            "projected_boxes": self.projected_boxes,
            "estimated_loss_percentage": self.estimated_loss_percentage,
            "risk_score": self.risk_score,
            "risk_level": self.risk_level.value,
            "model_version": self.model_version,
            "factors": self.factors.as_dict(),
        }
