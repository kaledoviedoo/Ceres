"""EL CIRCUITO COMPLETO: prediccion temporal -> cosecha -> error medible.

    POST /observations (measured)
        -> POST /predictions (as_of anterior a la cosecha)
        -> POST /harvests
        -> GET  /cells/{id}/performance
        -> absolute_error_kg y percentage_error

La cosecha de estos tests la crea el test contra la base de test, que se tira al
terminar. La base de desarrollo sigue con 0 cosechas: no hay ninguna real, y
inventarla para que el circuito "funcione" seria justo lo que no debe hacerse.

Lo que estos tests demuestran es que el circuito recibe una cosecha real en
cuanto exista, no que exista.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

COSECHA = "2026-06-20"
ANTES = datetime(2026, 6, 1, 9, 0, tzinfo=timezone.utc)
DESPUES = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)


def predecir(client, cell, cycle, as_of):
    return client.post(
        "/api/v1/predictions",
        json={
            "cell_id": str(cell),
            "crop_cycle_id": str(cycle),
            "as_of": as_of.isoformat(),
        },
    ).json()


def cosechar(client, cell, cycle, kg=5.0, cajas=1, cuando=COSECHA):
    return client.post(
        "/api/v1/harvests",
        json={
            "cell_id": str(cell),
            "crop_cycle_id": str(cycle),
            "actual_yield_kg": kg,
            "actual_boxes": cajas,
            "harvested_at": cuando,
        },
    )


def rendimiento(client, cell, cycle):
    return client.get(
        f"/api/v1/cells/{cell}/performance", params={"crop_cycle_id": str(cycle)}
    ).json()["entries"]


# --- El endpoint de cosecha basta tal cual ----------------------------------


def test_the_harvest_endpoint_accepts_exactly_what_validation_needs(
    client, cell_id, crop_cycle_id
):
    """`cell_id + crop_cycle_id + harvested_at + actual_yield_kg + actual_boxes`.

    No hizo falta ampliarlo. Se comprueba aqui para que quede constancia de que
    la auditoria lo dio por suficiente y no por olvido.
    """
    respuesta = cosechar(client, cell_id, crop_cycle_id, kg=12.5, cajas=2)

    assert respuesta.status_code == 201
    creada = respuesta.json()
    assert creada["actual_yield_kg"] == 12.5
    assert creada["harvested_at"] == COSECHA


# --- El circuito entero ------------------------------------------------------


def test_the_full_circuit_produces_a_measurable_error(client, cell_id, crop_cycle_id):
    """EL TEST DE LA FASE.

    Una prediccion fechada antes de la cosecha, una cosecha, y un error que se
    puede leer. Cada pieza queda a la vista para que el informe pueda citarla.
    """
    prediccion = predecir(client, cell_id, crop_cycle_id, ANTES)
    cosechar(client, cell_id, crop_cycle_id, kg=5.0, cajas=1)

    entrada = rendimiento(client, cell_id, crop_cycle_id)[0]

    # Que prediccion se selecciono, y de que momento hablaba.
    assert entrada["prediction_id"] == prediccion["id"]
    assert entrada["as_of"] is not None
    # Que predijo, que ocurrio, y cuanto se equivoco.
    assert entrada["projected_yield_kg"] == prediccion["projected_yield_kg"]
    assert entrada["actual_yield_kg"] == 5.0
    esperado = round(abs(prediccion["projected_yield_kg"] - 5.0), 4)
    assert entrada["absolute_error_kg"] == esperado
    assert entrada["percentage_error"] == round(esperado / 5.0 * 100, 4)


def test_the_entry_reports_both_moments(client, cell_id, crop_cycle_id):
    """`as_of` y `predicted_at` son cosas distintas y las dos viajan.

    Sin `as_of` en la respuesta, quien lea el historial ve el momento de
    EJECUCION y no tiene forma de saber de que momento habla cada fila.
    """
    predecir(client, cell_id, crop_cycle_id, ANTES)
    cosechar(client, cell_id, crop_cycle_id)

    entrada = rendimiento(client, cell_id, crop_cycle_id)[0]

    assert entrada["as_of"][:10] == "2026-06-01"
    assert entrada["predicted_at"] != entrada["as_of"]


# --- Que se empareja y que no -----------------------------------------------


def test_a_prediction_after_the_harvest_gets_no_error(client, cell_id, crop_cycle_id):
    """No predijo nada: describia un lote ya recogido.

    Sigue en el historial —es parte de lo que ocurrio— pero sin cosecha ni
    error. Antes de esta fase se le calculaba uno.
    """
    predecir(client, cell_id, crop_cycle_id, DESPUES)
    cosechar(client, cell_id, crop_cycle_id)

    entrada = rendimiento(client, cell_id, crop_cycle_id)[0]

    assert entrada["actual_yield_kg"] is None
    assert entrada["absolute_error_kg"] is None
    assert entrada["percentage_error"] is None


def test_several_predictions_before_a_harvest_are_all_evaluated(
    client, cell_id, crop_cycle_id
):
    """El historial completo se evalua, no solo la ultima.

    Es lo que permitira ver si el modelo mejora segun avanza la temporada.
    """
    momentos = [
        datetime(2026, 5, 1, tzinfo=timezone.utc),
        datetime(2026, 5, 20, tzinfo=timezone.utc),
        datetime(2026, 6, 10, tzinfo=timezone.utc),
    ]
    for cuando in momentos:
        predecir(client, cell_id, crop_cycle_id, cuando)
    cosechar(client, cell_id, crop_cycle_id, kg=5.0)

    entradas = rendimiento(client, cell_id, crop_cycle_id)

    assert len(entradas) == 3
    assert all(e["absolute_error_kg"] is not None for e in entradas)


def test_the_list_is_ordered_by_the_moment_it_speaks_of(client, cell_id, crop_cycle_id):
    """Ordenar por `created_at` mezclaria ejecucion con hechos.

    Las tres se lanzan ahora, en orden inverso al de sus `as_of`: si la lista
    siguiera el orden de ejecucion, saldrian al reves.
    """
    for cuando in (
        datetime(2026, 5, 1, tzinfo=timezone.utc),
        datetime(2026, 6, 10, tzinfo=timezone.utc),
        datetime(2026, 5, 20, tzinfo=timezone.utc),
    ):
        predecir(client, cell_id, crop_cycle_id, cuando)

    fechas = [e["as_of"] for e in rendimiento(client, cell_id, crop_cycle_id)]

    assert fechas == sorted(fechas, reverse=True)


def test_the_newest_eligible_prediction_is_the_first_entry(
    client, cell_id, crop_cycle_id
):
    """La "prediccion seleccionada" para una cosecha, sin colapsar la lista.

    Ordenada por `as_of` descendente, la primera entrada CON cosecha es la mas
    reciente que precede al corte. La lista completa se conserva.
    """
    predecir(client, cell_id, crop_cycle_id, DESPUES)
    esperada = predecir(client, cell_id, crop_cycle_id, datetime(2026, 6, 14, tzinfo=timezone.utc))
    predecir(client, cell_id, crop_cycle_id, datetime(2026, 5, 1, tzinfo=timezone.utc))
    cosechar(client, cell_id, crop_cycle_id)

    con_cosecha = [
        e for e in rendimiento(client, cell_id, crop_cycle_id) if e["harvest_id"]
    ]

    assert con_cosecha[0]["prediction_id"] == esperada["id"]


def test_without_a_harvest_there_is_no_metric_only_absence(
    client, cell_id, crop_cycle_id
):
    """"Sin datos de validacion", nunca un cero.

    Un cero seria una afirmacion sobre la precision del modelo.
    """
    predecir(client, cell_id, crop_cycle_id, ANTES)

    entrada = rendimiento(client, cell_id, crop_cycle_id)[0]

    assert entrada["harvest_id"] is None
    assert entrada["actual_yield_kg"] is None
    assert entrada["absolute_error_kg"] is None


def test_no_prediction_at_all_is_a_404_not_an_empty_metric(client, cell_id):
    """Sin predicciones no hay ciclo que evaluar, y se dice."""
    assert client.get(f"/api/v1/cells/{cell_id}/performance").status_code == 404


# --- La aritmetica sigue siendo la de siempre --------------------------------


def test_a_zero_harvest_yields_no_percentage(client, cell_id, crop_cycle_id):
    """Dividir por cero no produce un porcentaje enorme: no produce nada."""
    predecir(client, cell_id, crop_cycle_id, ANTES)
    cosechar(client, cell_id, crop_cycle_id, kg=0.0, cajas=0)

    entrada = rendimiento(client, cell_id, crop_cycle_id)[0]

    assert entrada["absolute_error_kg"] is not None
    assert entrada["percentage_error"] is None


@pytest.mark.parametrize("kg", [1.0, 5.0, 12.3456])
def test_the_error_is_measured_against_reality_not_against_the_forecast(
    client, cell_id, crop_cycle_id, kg
):
    """Convencion del MAPE: se divide por lo que de verdad ocurrio."""
    prediccion = predecir(client, cell_id, crop_cycle_id, ANTES)
    cosechar(client, cell_id, crop_cycle_id, kg=kg)

    entrada = rendimiento(client, cell_id, crop_cycle_id)[0]
    absoluto = round(abs(prediccion["projected_yield_kg"] - kg), 4)

    assert entrada["percentage_error"] == round(absoluto / kg * 100, 4)
