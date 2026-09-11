"""El eje temporal: observaciones fechadas -> estado a una fecha.

Lo que se fija aqui, por orden de importancia:

  1. que el estado base NO se destruya. Es la diferencia entre tener historia y
     simular que se tiene;
  2. que solo una MEDICION mueva el estado;
  3. que la fecha decida que entra, y que el orden no cambie el resultado;
  4. que la derivacion sea reproducible: misma celda, misma fecha, mismo estado.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import pytest

from app.core.state import (
    HEALTH_FLOOR,
    HEALTH_IMPACT,
    SOIL_IMPACT,
    ObservedEvent,
    base_state,
    state_at,
)
from app.domain.enums import ObservationType, Provenance

T0 = datetime(2026, 3, 1, tzinfo=timezone.utc)


@dataclass
class Celda:
    """Un `GridCell` reducido al protocolo `CellState`."""

    cell_code: str = "A-00001"
    elevation_m: float = 1180.0
    slope_deg: float = 2.0
    soil_quality: float = 0.80
    plant_density: float = 2.5
    health_factor: float = 0.90
    base_yield_factor: float = 1.0


def evento(dias: int, tipo=ObservationType.DISEASE, severidad=1.0, medida=True):
    return ObservedEvent(
        observed_at=T0 + timedelta(days=dias),
        type=tipo,
        severity=severidad,
        source_kind=Provenance.MEASURED if medida else Provenance.SYNTHETIC,
    )


# --- 1 · El estado base sobrevive -------------------------------------------


def test_deriving_a_state_never_touches_the_cell():
    """Si una observacion editara la celda, el estado anterior desapareceria.

    Es LA condicion de la fase: se deriva, no se destruye.
    """
    celda = Celda()
    antes = (celda.health_factor, celda.soil_quality)

    state_at(celda, [evento(0)], T0 + timedelta(days=10))

    assert (celda.health_factor, celda.soil_quality) == antes


def test_the_same_date_always_yields_the_same_state():
    """Reproducible, y por eso no hace falta guardar que se aplico.

    Con `cell_id` y `as_of` se vuelve a derivar el mismo estado: guardarlo seria
    duplicar informacion que ya se puede recalcular.
    """
    celda = Celda()
    eventos = [evento(1), evento(5, ObservationType.WATER_STRESS, 0.4)]
    cuando = T0 + timedelta(days=30)

    a = state_at(celda, eventos, cuando)
    b = state_at(celda, list(reversed(eventos)), cuando)

    assert a.health_factor == b.health_factor
    assert a.soil_quality == b.soil_quality


# --- 2 · La evidencia tiene que estar a la altura del dataset ---------------
#
# Esta seccion decia "solo lo medido mueve el estado". La regla cambio al
# construir la finca sintetica La Cuadricula: ahora se compara la procedencia de
# la observacion con la que el despliegue puede respaldar para sus celdas.
#
# Lo que NO cambio es la linea que protege --una observacion sintetica no puede
# mover una celda medida-- y es la que se comprueba aqui. Las tres
# combinaciones completas viven en `test_state_provenance_gate.py`.


def test_a_synthetic_observation_cannot_move_a_measured_dataset():
    """LA PROTECCION, que sigue intacta.

    Un dato que generamos nosotros no puede alterar una celda medida en campo.
    Si alguien "simplifica" la puerta borrando el filtro en vez de cambiarlo,
    este test se cae.
    """
    celda = Celda()
    derivado = state_at(
        celda, [evento(0, medida=False)], T0 + timedelta(days=10), Provenance.MEASURED
    )

    assert derivado.health_factor == celda.health_factor
    assert derivado.applied == 0


def test_a_synthetic_observation_moves_a_synthetic_dataset():
    """Y lo que cambio, dicho explicitamente.

    En un despliegue sintetico el estado base ya sale de un generador, asi que
    rechazar ahi una observacion sintetica no protegia de nada: solo impedia
    que el eje temporal existiera. Es lo que hace posible La Cuadricula.
    """
    celda = Celda()
    derivado = state_at(
        celda, [evento(0, medida=False)], T0 + timedelta(days=10), Provenance.SYNTHETIC
    )

    assert derivado.health_factor < celda.health_factor
    assert derivado.applied == 1


def test_a_measured_observation_does_move_it():
    celda = Celda()
    derivado = state_at(celda, [evento(0)], T0 + timedelta(days=10))

    assert derivado.health_factor < celda.health_factor
    assert derivado.applied == 1


def test_the_circularity_of_the_demo_observations_is_now_the_generators_problem():
    """DEUDA CONOCIDA, anotada donde se ve.

    Las 24 observaciones sinteticas de la finca demo tienen `severity` derivada
    de `health_factor` (correlacion -0,94 medida en su momento). Con la regla
    nueva SI mueven el estado de esa finca, o sea que la circularidad vuelve a
    estar activa ALLI: la sanidad usada como prueba de que la sanidad bajo.

    Nada en el esquema distingue una finca sintetica de otra, asi que la puerta
    no puede separarlas. La responsabilidad se traslada a quien genera: la
    severidad de La Cuadricula sale del campo latente de humedad y no de
    `health_factor`, que es lo que la mantiene fuera del bucle.

    Este test no comprueba una garantia; deja escrito el limite para que no se
    descubra por sorpresa.
    """
    celda = Celda()
    sinteticas = [evento(d, medida=False) for d in range(0, 60, 3)]

    inicial = state_at(celda, sinteticas, T0 - timedelta(days=1), Provenance.SYNTHETIC)
    final = state_at(celda, sinteticas, T0 + timedelta(days=1000), Provenance.SYNTHETIC)

    assert inicial.applied == 0
    assert final.applied == len(sinteticas)
    # Y en un despliegue de datos medidos ninguna de ellas contaria.
    medido = state_at(celda, sinteticas, T0 + timedelta(days=1000), Provenance.MEASURED)
    assert medido.applied == 0


# --- 3 · La fecha decide qué entra ------------------------------------------


def test_an_observation_in_the_future_does_not_count_yet():
    celda = Celda()
    antes = state_at(celda, [evento(10)], T0 + timedelta(days=5))
    despues = state_at(celda, [evento(10)], T0 + timedelta(days=15))

    assert antes.health_factor == celda.health_factor
    assert despues.health_factor < celda.health_factor


def test_two_observations_in_order_compound():
    """El caso del enunciado: t1 y t2, con estados distintos en cada uno."""
    celda = Celda()
    eventos = [evento(1, severidad=0.5), evento(20, severidad=0.5)]

    t1 = state_at(celda, eventos, T0 + timedelta(days=10))
    t2 = state_at(celda, eventos, T0 + timedelta(days=30))

    assert t1.applied == 1
    assert t2.applied == 2
    assert t2.health_factor < t1.health_factor < celda.health_factor


def test_the_boundary_is_inclusive():
    """Una observacion cuenta en el instante exacto en que se observo."""
    celda = Celda()
    justo = state_at(celda, [evento(7)], T0 + timedelta(days=7))

    assert justo.applied == 1


def test_observed_at_decides_not_created_at():
    """Lo que importa es cuando paso en el campo, no cuando se tecleo.

    `ObservedEvent` no lleva `created_at` a proposito: no hay forma de que el
    momento del registro se cuele en el calculo.
    """
    assert "created_at" not in ObservedEvent.__annotations__
    assert "observed_at" in ObservedEvent.__annotations__


# --- 4 · La funcion de impacto ----------------------------------------------


def test_severity_is_not_health_factor():
    """La relacion del seed NO se reutiliza.

    En el dataset, `severity = 0,25 + (1 - health) * 0,70`. Aqui la severidad es
    la magnitud de un EVENTO y lo que hace es llevarse una fraccion de la
    sanidad que quedaba. Una celda sana y una enferma con la misma observacion
    acaban en sitios distintos, cosa que con la formula del seed no pasaria.
    """
    sana = state_at(Celda(health_factor=0.9), [evento(0, severidad=0.5)], T0)
    enferma = state_at(Celda(health_factor=0.3), [evento(0, severidad=0.5)], T0)

    assert sana.health_factor != enferma.health_factor
    # Y ninguna de las dos coincide con la severidad ni con su complemento.
    assert sana.health_factor != pytest.approx(0.5)
    assert sana.health_factor != pytest.approx(0.5)


def test_severity_zero_changes_nothing():
    celda = Celda()
    derivado = state_at(celda, [evento(0, severidad=0.0)], T0)

    assert derivado.health_factor == celda.health_factor
    # Cuenta como aplicada aunque no mueva nada: se vio, y no cambio el estado.
    assert derivado.applied == 1


def test_an_unclassified_observation_changes_nothing():
    """`other` es "anomalia pendiente de clasificar".

    No se sabe que se vio. Convertir eso en una perdida de sanidad seria
    inventar el diagnostico ademas de la magnitud.
    """
    celda = Celda()
    derivado = state_at(celda, [evento(0, ObservationType.OTHER, 1.0)], T0)

    assert derivado.health_factor == celda.health_factor
    assert HEALTH_IMPACT[ObservationType.OTHER] == 0.0


def test_only_physical_damage_touches_the_soil():
    """Una plaga no erosiona. Es la unica asimetria del modelo, y es estructural."""
    celda = Celda()
    plaga = state_at(celda, [evento(0, ObservationType.PEST, 1.0)], T0)
    dano = state_at(celda, [evento(0, ObservationType.PHYSICAL_DAMAGE, 1.0)], T0)

    assert plaga.soil_quality == celda.soil_quality
    assert dano.soil_quality < celda.soil_quality
    assert set(SOIL_IMPACT) == {ObservationType.PHYSICAL_DAMAGE}


def test_health_never_goes_below_the_floor():
    """Sin suelo, cien observaciones graves dejarian la sanidad en negativo."""
    celda = Celda()
    muchas = [evento(d, severidad=1.0) for d in range(50)]
    derivado = state_at(celda, muchas, T0 + timedelta(days=100))

    assert derivado.health_factor >= HEALTH_FLOOR
    assert derivado.soil_quality > 0


def test_the_derived_state_declares_which_moment_it_describes():
    derivado = state_at(Celda(), [], T0)
    assert derivado.as_of == T0
    # Y el estado base no finge tener fecha.
    assert base_state(Celda()).as_of is None
