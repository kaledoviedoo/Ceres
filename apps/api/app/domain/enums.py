"""Enumeraciones del dominio.

Se declaran como `str, Enum` para que serialicen directo a JSON y coincidan
uno a uno con los CHECK constraints de las migraciones SQL.
"""

from __future__ import annotations

from enum import Enum


class RiskLevel(str, Enum):
    """Bucket cualitativo derivado del `risk_score` continuo (0..1)."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ObservationType(str, Enum):
    """Tipos de observacion de campo que un agronomo puede registrar."""

    PEST = "pest"
    DISEASE = "disease"
    WATER_STRESS = "water_stress"
    PHYSICAL_DAMAGE = "physical_damage"
    OTHER = "other"


class CropCycleStatus(str, Enum):
    """Estado de un ciclo de cultivo sobre un lote."""

    PLANNED = "planned"
    ACTIVE = "active"
    HARVESTED = "harvested"
    CLOSED = "closed"


class UserRole(str, Enum):
    """Rol dentro de una organizacion. Permisos complejos quedan fuera del MVP."""

    OWNER = "owner"
    AGRONOMIST = "agronomist"
    VIEWER = "viewer"
