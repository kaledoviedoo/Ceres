"""Contrato publico de la API (Pydantic).

Ningun endpoint debe devolver diccionarios arbitrarios: todo pasa por aqui.
"""

from app.schemas.cell import CellCollection, CellFeatures, CellRead, CellSummary
from app.schemas.common import CeresORMSchema, CeresSchema
from app.schemas.crop import CropCycleDetail, CropCycleRead, CropRead
from app.schemas.farm import FarmDetail, FarmRead
from app.schemas.harvest import HarvestCreate, HarvestRead
from app.schemas.observation import ObservationCreate, ObservationRead
from app.schemas.organization import OrganizationRead, UserRead
from app.schemas.performance import CellPerformance, PerformanceEntry
from app.schemas.plot import PlotRead
from app.schemas.prediction import (
    PredictionCreate,
    PredictionFactors,
    PredictionList,
    PredictionRead,
)

__all__ = [
    "CeresSchema",
    "CeresORMSchema",
    "OrganizationRead",
    "UserRead",
    "FarmRead",
    "FarmDetail",
    "PlotRead",
    "CropRead",
    "CropCycleRead",
    "CropCycleDetail",
    "CellFeatures",
    "CellSummary",
    "CellRead",
    "CellCollection",
    "PredictionCreate",
    "PredictionRead",
    "PredictionList",
    "PredictionFactors",
    "ObservationCreate",
    "ObservationRead",
    "HarvestCreate",
    "HarvestRead",
    "PerformanceEntry",
    "CellPerformance",
]
