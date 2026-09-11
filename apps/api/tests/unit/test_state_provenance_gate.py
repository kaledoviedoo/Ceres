"""QUE OBSERVACION PUEDE MOVER EL ESTADO DE UNA CELDA.

La regla no es una lista blanca: es una COMPARACION entre la procedencia de la
observacion y la que el despliegue puede respaldar para sus celdas.

    despliegue `measured`   -> solo `measured`
    despliegue `synthetic`  -> `synthetic` tambien

La primera linea es la que protege y no se toca. La segunda existe porque en un
despliegue sintetico el estado base ya sale de un generador: rechazar ahi una
observacion sintetica no protegia de nada, solo impedia que el eje temporal
existiera.

Estos tests fijan las tres combinaciones que importan. Si alguien "simplifica"
la puerta borrando el filtro, el primero de los tres se cae.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.core.state import (
    DerivedCellState,
    ObservedEvent,
    admissible_provenances,
    applies,
    state_at,
)
from app.domain.enums import ObservationType, Provenance

T = datetime(2026, 5, 1, tzinfo=timezone.utc)
DESPUES = datetime(2026, 6, 1, tzinfo=timezone.utc)

CELDA = DerivedCellState(
    cell_code="P-00001",
    elevation_m=2105.0,
    slope_deg=1.2,
    soil_quality=0.68,
    plant_density=4.0,
    health_factor=0.90,
    base_yield_factor=1.0,
)


def observacion(kind: Provenance, severidad: float = 0.8) -> ObservedEvent:
    return ObservedEvent(
        observed_at=T, type=ObservationType.DISEASE, severity=severidad, source_kind=kind
    )


def sanidad(kind_dataset: Provenance, kind_obs: Provenance) -> float:
    estado = state_at(CELDA, [observacion(kind_obs)], DESPUES, kind_dataset)
    return estado.health_factor


# --- Las tres combinaciones que pidio la fase -------------------------------


def test_synthetic_dataset_plus_synthetic_observation_moves_the_state():
    """La finca sintetica puede tener eje temporal.

    Sin esto, `state_at` devolveria el estado base para cualquier fecha en La
    Cuadricula y los eventos no producirian ningun cambio.
    """
    assert sanidad(Provenance.SYNTHETIC, Provenance.SYNTHETIC) < CELDA.health_factor


def test_measured_dataset_plus_synthetic_observation_does_not_move_the_state():
    """LA LINEA QUE PROTEGE.

    Un dato que generamos nosotros no puede alterar una celda medida en campo.
    Este es el test que se cae si alguien borra el filtro en vez de cambiarlo.
    """
    assert sanidad(Provenance.MEASURED, Provenance.SYNTHETIC) == CELDA.health_factor


def test_measured_dataset_plus_measured_observation_moves_the_state():
    """Y lo medido sigue moviendo lo medido, como antes de esta fase."""
    assert sanidad(Provenance.MEASURED, Provenance.MEASURED) < CELDA.health_factor


# --- El resto del vocabulario -----------------------------------------------


def test_a_measured_observation_moves_a_synthetic_dataset_too():
    """Mas solida que el dataset: entra."""
    assert sanidad(Provenance.SYNTHETIC, Provenance.MEASURED) < CELDA.health_factor


@pytest.mark.parametrize("kind", [Provenance.UNKNOWN])
def test_unknown_never_moves_anything(kind: Provenance):
    """`unknown` no respalda nada, ni como dato ni como despliegue."""
    assert sanidad(Provenance.SYNTHETIC, kind) == CELDA.health_factor
    assert sanidad(kind, Provenance.SYNTHETIC) == CELDA.health_factor


def test_an_unknown_deployment_is_the_conservative_case_not_the_permissive_one():
    """El caso que la comparacion pura habria dejado al reves.

    `unknown` es el rango mas bajo, asi que "al menos tan solido como el
    dataset" lo admitiria TODO. Es justo lo contrario de lo que toca: un
    despliegue que no puede respaldar sus propias celdas es el que menos puede
    permitirse creerse una observacion cualquiera.
    """
    assert admissible_provenances(Provenance.UNKNOWN) == frozenset({Provenance.MEASURED})


def test_the_admissible_set_shrinks_as_the_dataset_gets_more_solid():
    """Cuanto mas respaldado el dataset, menos observaciones lo pueden mover."""
    tamanos = [
        len(admissible_provenances(k))
        for k in (Provenance.SYNTHETIC, Provenance.ESTIMATED, Provenance.DERIVED, Provenance.MEASURED)
    ]
    assert tamanos == sorted(tamanos, reverse=True)
    assert admissible_provenances(Provenance.MEASURED) == frozenset({Provenance.MEASURED})


# --- La fecha sigue mandando -------------------------------------------------


def test_provenance_does_not_override_the_date():
    """Una observacion admisible pero futura sigue sin contar."""
    antes = datetime(2026, 4, 1, tzinfo=timezone.utc)
    assert applies(observacion(Provenance.SYNTHETIC), antes, Provenance.SYNTHETIC) is False
    assert applies(observacion(Provenance.SYNTHETIC), DESPUES, Provenance.SYNTHETIC) is True


def test_the_default_dataset_kind_is_the_deployments():
    """Sin argumento explicito se usa `provenance.DATASET_KIND`.

    Es lo que hace que los servicios no tengan que enterarse de nada.
    """
    from app.core.provenance import DATASET_KIND

    assert applies(observacion(DATASET_KIND), DESPUES) is True
