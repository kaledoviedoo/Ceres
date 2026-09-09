"""LA PRIMERA EVIDENCIA TEMPORAL DE CERES, de extremo a extremo por HTTP.

Se recorre el camino minimo completo:

    POST /observations (source_kind=measured)
          -> state_at(t)
          -> POST /predictions (as_of=t)
          -> otra observacion
          -> otra prediccion

Y se comprueba que t0, t1 y t2 son estados REALMENTE distintos.

QUE NO SE HACE AQUI
-------------------
No se fabrica historia. Las observaciones de este fichero:

  * las crea el test, contra una base de datos de test que se tira al terminar;
  * declaran `measured` explicitamente, en una llamada visible;
  * no tocan ni sustituyen a las 24 sinteticas del dataset.

Y las predicciones que se generan viven lo que vive el test. La base de
desarrollo sigue con 0 predicciones y 0 cosechas.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

T0 = datetime(2026, 5, 1, tzinfo=timezone.utc)
T1 = T0 + timedelta(days=15)
T2 = T0 + timedelta(days=45)


def observar(client, cell_id, crop_cycle_id, cuando, *, tipo, severidad, kind="measured"):
    """Registra una observacion por HTTP, declarando su procedencia."""
    return client.post(
        "/api/v1/observations",
        json={
            "cell_id": str(cell_id),
            "crop_cycle_id": str(crop_cycle_id),
            "type": tipo,
            "severity": severidad,
            "observed_at": cuando.isoformat(),
            "source_kind": kind,
        },
    )


def predecir(client, cell_id, crop_cycle_id, cuando):
    return client.post(
        "/api/v1/predictions",
        json={
            "cell_id": str(cell_id),
            "crop_cycle_id": str(crop_cycle_id),
            "as_of": cuando.isoformat(),
        },
    )


# --- El endpoint puede declarar procedencia ---------------------------------


def test_the_endpoint_accepts_a_declared_provenance(client, cell_id, crop_cycle_id):
    """Antes no podia: `ObservationCreate` no tenia el campo.

    Todo lo que entraba por HTTP quedaba como `synthetic` —el defecto de la
    columna—, que era falso: quien llama a la API no es el generador.
    """
    respuesta = observar(
        client, cell_id, crop_cycle_id, T1, tipo="disease", severidad=0.7
    )

    assert respuesta.status_code == 201
    assert respuesta.json()["source_kind"] == "measured"


def test_omitting_the_provenance_yields_unknown_never_measured(
    client, cell_id, crop_cycle_id
):
    """Una llamada HTTP no demuestra que nadie haya salido al campo.

    Por eso el defecto es `unknown`: reclamar una medicion tiene que ser un acto
    explicito, igual que en el resto del contrato.
    """
    respuesta = client.post(
        "/api/v1/observations",
        json={
            "cell_id": str(cell_id),
            "crop_cycle_id": str(crop_cycle_id),
            "type": "disease",
            "severity": 0.9,
        },
    )

    assert respuesta.status_code == 201
    assert respuesta.json()["source_kind"] == "unknown"


def test_an_unknown_observation_does_not_move_the_state(
    client, cell_id, crop_cycle_id
):
    """Y `unknown` tampoco mueve nada. Solo `measured`."""
    antes = predecir(client, cell_id, crop_cycle_id, T2).json()

    client.post(
        "/api/v1/observations",
        json={
            "cell_id": str(cell_id),
            "crop_cycle_id": str(crop_cycle_id),
            "type": "disease",
            "severity": 1.0,
            "observed_at": T1.isoformat(),
        },
    )

    despues = predecir(client, cell_id, crop_cycle_id, T2).json()
    assert despues["inputs"] == antes["inputs"]


def test_the_api_records_who_declared_it_or_admits_it_does_not_know(
    client, cell_id, crop_cycle_id
):
    """`created_by` queda NULL, y es lo correcto.

    El endpoint no tiene forma de saber quien llama —no hay autenticacion— y
    rellenarlo con un usuario de desarrollo seria inventar un autor.
    """
    creada = observar(
        client, cell_id, crop_cycle_id, T1, tipo="disease", severidad=0.5
    ).json()

    assert creada["created_by"] is None


# --- t0 -> t1 -> t2 ---------------------------------------------------------


@pytest.fixture
def serie(client, cell_id, crop_cycle_id):
    """Dos observaciones medidas y las tres predicciones que las rodean."""
    observar(client, cell_id, crop_cycle_id, T1, tipo="disease", severidad=0.6)
    observar(client, cell_id, crop_cycle_id, T2, tipo="water_stress", severidad=0.5)

    return {
        "t0": predecir(client, cell_id, crop_cycle_id, T0).json(),
        "t1": predecir(client, cell_id, crop_cycle_id, T1 + timedelta(days=1)).json(),
        "t2": predecir(client, cell_id, crop_cycle_id, T2 + timedelta(days=1)).json(),
    }


def test_the_three_moments_are_three_different_states(serie):
    """LA PRUEBA DE LA FASE.

    Misma celda, mismo ciclo, mismo modelo. Lo unico que cambia es de que
    momento habla cada prediccion, y entre los momentos hay observaciones
    medidas.
    """
    salud = [serie[t]["inputs"]["health_factor"] for t in ("t0", "t1", "t2")]

    assert salud[0] > salud[1] > salud[2], f"los tres estados no difieren: {salud}"


def test_the_prediction_changes_with_the_state(serie):
    """Y el resultado sigue al estado, que es para lo que sirve el eje."""
    assert serie["t2"]["projected_yield_kg"] < serie["t0"]["projected_yield_kg"]
    assert serie["t2"]["risk_score"] > serie["t0"]["risk_score"]


def test_t0_is_still_the_base_state_and_reproducible(
    client, cell_id, crop_cycle_id, serie
):
    """El estado base sobrevive a todo lo que pase despues.

    Es la propiedad que separa tener historia de simularla: las observaciones
    no editaron `grid_cells`, asi que t0 se vuelve a derivar igual DESPUES de
    haber registrado las dos observaciones.
    """
    celda = client.get(f"/api/v1/cells/{cell_id}").json()
    de_nuevo = predecir(client, cell_id, crop_cycle_id, T0).json()

    assert de_nuevo["inputs"] == serie["t0"]["inputs"]
    # Y coincide con lo que sigue guardado en la celda.
    assert de_nuevo["inputs"]["health_factor"] == celda["health_factor"]
    assert de_nuevo["inputs"]["soil_quality"] == celda["soil_quality"]


def test_the_boundary_is_exactly_observed_at(client, cell_id, crop_cycle_id):
    """Un instante antes, el estado anterior. En el instante justo, ya cuenta."""
    observar(client, cell_id, crop_cycle_id, T1, tipo="disease", severidad=0.6)

    justo_antes = predecir(
        client, cell_id, crop_cycle_id, T1 - timedelta(seconds=1)
    ).json()
    justo = predecir(client, cell_id, crop_cycle_id, T1).json()

    assert justo["inputs"]["health_factor"] < justo_antes["inputs"]["health_factor"]


def test_the_insertion_order_does_not_change_the_result(
    client, session, cell_id, crop_cycle_id
):
    """Registrar t2 antes que t1 da el mismo estado final.

    Lo que decide es `observed_at`, no el orden en que llegaron las filas: una
    observacion registrada hoy sobre algo visto en marzo pertenece a marzo.
    """
    observar(client, cell_id, crop_cycle_id, T2, tipo="water_stress", severidad=0.5)
    observar(client, cell_id, crop_cycle_id, T1, tipo="disease", severidad=0.6)
    desordenado = predecir(client, cell_id, crop_cycle_id, T2 + timedelta(days=1)).json()

    # Y el mismo par en el orden natural, sobre otra celda, da lo mismo.
    otra = client.get(f"/api/v1/plots/{_plot_de(client, cell_id)}/cells").json()["cells"]
    otra_id = next(c["id"] for c in otra if c["id"] != str(cell_id))
    observar(client, otra_id, crop_cycle_id, T1, tipo="disease", severidad=0.6)
    observar(client, otra_id, crop_cycle_id, T2, tipo="water_stress", severidad=0.5)
    ordenado = predecir(client, otra_id, crop_cycle_id, T2 + timedelta(days=1)).json()

    # Las celdas parten de estados base distintos, asi que se compara la
    # PROPORCION de sanidad que queda, que es lo que aplica el modelo.
    def fraccion(prediccion, cell):
        base = client.get(f"/api/v1/cells/{cell}").json()["health_factor"]
        return prediccion["inputs"]["health_factor"] / base

    assert fraccion(desordenado, cell_id) == pytest.approx(
        fraccion(ordenado, otra_id), rel=1e-9
    )


def _plot_de(client, cell_id):
    return client.get(f"/api/v1/cells/{cell_id}").json()["plot_id"]


# --- Lo que guarda cada prediccion ------------------------------------------


def test_each_prediction_records_the_moment_it_speaks_of(serie):
    momentos = {serie[t]["as_of"] for t in ("t0", "t1", "t2")}
    assert len(momentos) == 3


def test_created_at_is_later_than_as_of_without_breaking_anything(serie):
    """Las tres se ejecutaron hoy y hablan de mayo de 2026.

    Que `created_at` sea posterior a `as_of` es lo normal —se predice sobre el
    pasado— y no rompe la lectura: el orden de la serie lo da `as_of`.
    """
    for clave in ("t0", "t1", "t2"):
        assert serie[clave]["created_at"] != serie[clave]["as_of"]

    # Ordenar por `as_of` da el orden de los hechos.
    por_momento = sorted((serie[k]["as_of"], k) for k in ("t0", "t1", "t2"))
    assert [k for _, k in por_momento] == ["t0", "t1", "t2"]


def test_the_inputs_match_the_state_that_was_used(serie):
    """`inputs` no es decorativo: es el estado exacto con el que se calculo."""
    for clave in ("t0", "t1", "t2"):
        entradas = serie[clave]["inputs"]
        assert set(entradas) >= {
            "elevation_m",
            "slope_deg",
            "soil_quality",
            "plant_density",
            "health_factor",
            "base_yield_factor",
        }


def test_the_model_version_identifies_both_models(serie):
    for clave in ("t0", "t1", "t2"):
        version = serie[clave]["model_version"]
        assert version.startswith("rule-based-v0.1")
        assert "impact-v0" in version


# --- Las sinteticas siguen intactas -----------------------------------------


def test_the_seeded_observations_are_untouched(session):
    """Ni editadas, ni borradas, ni promovidas."""
    from sqlalchemy import func, select

    from app.models import Observation

    por_kind = dict(
        session.execute(
            select(Observation.source_kind, func.count()).group_by(Observation.source_kind)
        ).all()
    )

    assert por_kind.get("synthetic", 0) == 24
    assert por_kind.get("measured", 0) == 0
