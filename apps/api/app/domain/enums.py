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


class Provenance(str, Enum):
    """De donde sale un dato. Vocabulario CERRADO, y ese es el punto.

    Cinco palabras y ninguna mas. Un campo de texto libre habria dejado que cada
    endpoint inventara su matiz —"simulado", "aproximado", "modelado"— y quien
    lee la respuesta tendria que interpretarlos. Con cinco valores, un cliente
    puede decidir que hacer sin leer prosa.

    El orden importa al leerlas:

        MEASURED   alguien lo midio en el campo, con un instrumento.
        DERIVED    se calculo a partir de otro dato de esta misma respuesta.
        ESTIMATED  lo produjo un modelo a partir de entradas.
        SYNTHETIC  lo genero un generador. No describe ningun campo real.
        UNKNOWN    el sistema no puede respaldar ninguna de las anteriores.

    UNKNOWN ES EL VALOR POR DEFECTO, y nunca MEASURED. Callar sobre la
    procedencia tiene que ser explicito: un cliente que reciba `unknown` sabe
    que no sabe, mientras que uno que reciba un `measured` por omision creeria
    tener una medicion de campo.
    """

    MEASURED = "measured"
    DERIVED = "derived"
    ESTIMATED = "estimated"
    SYNTHETIC = "synthetic"
    UNKNOWN = "unknown"
