"""Modelos de persistencia (SQLAlchemy).

Importar todos los modelos aqui es necesario para que SQLAlchemy resuelva las
relaciones declaradas por nombre antes de configurar los mappers.
"""

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.crop import Crop, CropCycle
from app.models.farm import Farm, Plot
from app.models.grid_cell import GridCell
from app.models.harvest import Harvest
from app.models.observation import Observation
from app.models.organization import Organization, User
from app.models.prediction import Prediction

__all__ = [
    "Base",
    "TimestampMixin",
    "UUIDPrimaryKeyMixin",
    "Organization",
    "User",
    "Farm",
    "Plot",
    "Crop",
    "CropCycle",
    "GridCell",
    "Prediction",
    "Observation",
    "Harvest",
]
