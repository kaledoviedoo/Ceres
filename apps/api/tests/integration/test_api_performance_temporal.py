"""`/performance` ATADO AL EJE TEMPORAL.

    GET /cells/{id}/performance?crop_cycle_id=...&as_of=...

El mapa ya seguia al momento seleccionado; el inspector no. Estos tests fijan la
mitad que faltaba y, sobre todo, vigilan la trampa: que alguien conecte el
inspector al momento EQUIVOCADO y nadie se entere porque las cifras siguen
pareciendo razonables.

LA DIFERENCIA CON `overview`, que conviene tener presente al leer esto:

    overview(as_of)      RECALCULA el estado de aquel momento
    performance(as_of)   FILTRA lo que CERES dijo en aquel momento

`/performance` responde "que predijo CERES aquel dia", y eso es un hecho
historico. Rederivarlo dejaria que la respuesta cambiara al cambiar el modelo.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

T0 = datetime(2026, 4, 1, 12, 0, tzinfo=timezone.utc)
T2 = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)
COSECHA = "2026-06-20"


def predecir(client, cell_id, crop_cycle_id, cuando):
    return client.post(
        "/api/v1/predictions",
        json={
            "cell_id": str(cell_id),
            "crop_cycle_id": str(crop_cycle_id),
            "as_of": cuando.isoformat(),
        },
    ).json()


def cosechar(client, cell_id, crop_cycle_id, kg=3.0):
    return client.post(
        "/api/v1/harvests",
        json={
            "cell_id": str(cell_id),
            "crop_cycle_id": str(crop_cycle_id),
            "actual_yield_kg": kg,
            "actual_boxes": 1,
            "harvested_at": COSECHA,
        },
    )


def rendimiento(client, cell_id, crop_cycle_id, as_of=None):
    params = {"crop_cycle_id": str(crop_cycle_id)}
    if as_of is not None:
        params["as_of"] = as_of if isinstance(as_of, str) else as_of.isoformat()
    return client.get(f"/api/v1/cells/{cell_id}/performance", params=params).json()


@pytest.fixture
def celda_con_serie(client, session, cell_id, crop_cycle_id):
    """Una celda con dos momentos y una cosecha, y estados distintos entre ellos.

    La observacion en medio es lo que hace que t0 y t2 NO sean el mismo numero:
    sin ella los dos momentos darian lo mismo y estos tests no probarian nada.
    """
    from app.models import Observation

    session.add(
        Observation(
            cell_id=cell_id,
            crop_cycle_id=crop_cycle_id,
            type="disease",
            severity=0.8,
            observed_at=T0 + timedelta(days=10),
            source_kind="synthetic",
        )
    )
    session.commit()

    p0 = predecir(client, cell_id, crop_cycle_id, T0)
    p2 = predecir(client, cell_id, crop_cycle_id, T2)
    cosechar(client, cell_id, crop_cycle_id, kg=3.0)
    return {"t0": p0, "t2": p2}


# --- El parametro existe y hace lo que dice ---------------------------------


def test_without_as_of_the_full_history_still_comes_back(
    client, cell_id, crop_cycle_id, celda_con_serie
):
    """El comportamiento de siempre no cambia. Es media parte del contrato."""
    cuerpo = rendimiento(client, cell_id, crop_cycle_id)

    assert len(cuerpo["entries"]) == 2


def test_as_of_narrows_the_history_to_that_single_moment(
    client, cell_id, crop_cycle_id, celda_con_serie
):
    for cuando in (T0, T2):
        entradas = rendimiento(client, cell_id, crop_cycle_id, cuando)["entries"]
        assert len(entradas) == 1, f"{cuando} devolvio {len(entradas)} entradas"


def test_the_moment_that_comes_back_is_the_one_that_was_asked_for(
    client, cell_id, crop_cycle_id, celda_con_serie
):
    """EL TEST QUE DETECTA UNA CONEXION AL MOMENTO EQUIVOCADO.

    No basta con que llegue UNA entrada: tiene que ser la del instante pedido.
    Si alguien invirtiera el orden, cogiera `entries[0]` a ciegas o filtrara por
    `created_at`, aqui se veria --las dos predicciones se ejecutaron con
    segundos de diferencia y solo `as_of` las distingue--.
    """
    for cuando in (T0, T2):
        entrada = rendimiento(client, cell_id, crop_cycle_id, cuando)["entries"][0]
        devuelto = datetime.fromisoformat(entrada["as_of"])
        if devuelto.tzinfo is None:
            devuelto = devuelto.replace(tzinfo=timezone.utc)

        assert devuelto == cuando


def test_each_moment_carries_its_own_prediction(
    client, cell_id, crop_cycle_id, celda_con_serie
):
    """Y son la MISMA fila que se guardo, no una recalculada."""
    for clave, cuando in (("t0", T0), ("t2", T2)):
        entrada = rendimiento(client, cell_id, crop_cycle_id, cuando)["entries"][0]
        guardada = celda_con_serie[clave]

        assert entrada["prediction_id"] == guardada["id"]
        assert entrada["projected_yield_kg"] == guardada["projected_yield_kg"]


def test_the_two_moments_really_differ(client, cell_id, crop_cycle_id, celda_con_serie):
    """Sin esto los tests de arriba pasarian aunque todo devolviera lo mismo.

    Entre t0 y t2 hay una observacion, asi que el estado derivado cambia y con el
    la prediccion. Si algun dia dejaran de diferir, el resto de este fichero
    dejaria de demostrar nada y este test avisa.
    """
    a = rendimiento(client, cell_id, crop_cycle_id, T0)["entries"][0]
    b = rendimiento(client, cell_id, crop_cycle_id, T2)["entries"][0]

    assert b["projected_yield_kg"] < a["projected_yield_kg"]
    assert b["absolute_error_kg"] != a["absolute_error_kg"]


# --- La cosecha es la verdad y no se mueve ----------------------------------


def test_the_real_harvest_is_identical_at_every_moment(
    client, cell_id, crop_cycle_id, celda_con_serie
):
    """LA GARANTIA QUE SEPARA VERDAD DE PREDICCION.

    El rendimiento real de una celda no depende del momento desde el que se
    mire: se cosecho lo que se cosecho. Lo que cambia es la prediccion contra la
    que se compara, y por tanto el error.

    Si `as_of` llegara a filtrar tambien las cosechas, un momento se quedaria
    sin ground truth y su error desapareceria sin que nada fallara.
    """
    a = rendimiento(client, cell_id, crop_cycle_id, T0)["entries"][0]
    b = rendimiento(client, cell_id, crop_cycle_id, T2)["entries"][0]

    assert a["harvest_id"] == b["harvest_id"]
    assert a["actual_yield_kg"] == b["actual_yield_kg"] == 3.0
    assert a["harvested_at"] == b["harvested_at"] == COSECHA


def test_the_error_is_computed_against_that_same_harvest(
    client, cell_id, crop_cycle_id, celda_con_serie
):
    """El error de cada momento sale de SU prediccion y de LA MISMA cosecha."""
    for cuando in (T0, T2):
        e = rendimiento(client, cell_id, crop_cycle_id, cuando)["entries"][0]
        esperado = round(abs(e["projected_yield_kg"] - e["actual_yield_kg"]), 4)

        assert e["absolute_error_kg"] == esperado
        assert e["percentage_error"] == round(esperado / e["actual_yield_kg"] * 100, 4)


# --- Lo que NO debe colarse --------------------------------------------------


def test_a_moment_with_no_prediction_is_an_explicit_absence(
    client, cell_id, crop_cycle_id, celda_con_serie
):
    """Ni error ni invento: la lista vacia.

    Pedir un instante del que CERES nunca hablo tiene una respuesta correcta, y
    es decir que no hay nada. Devolver la entrada mas cercana seria ensenar un
    momento por otro.
    """
    respuesta = client.get(
        f"/api/v1/cells/{cell_id}/performance",
        params={
            "crop_cycle_id": str(crop_cycle_id),
            "as_of": datetime(2020, 1, 1, tzinfo=timezone.utc).isoformat(),
        },
    )

    assert respuesta.status_code == 200
    assert respuesta.json()["entries"] == []


def test_the_answer_is_about_the_cell_that_was_asked_for(
    client, cell_id, crop_cycle_id, celda_con_serie
):
    cuerpo = rendimiento(client, cell_id, crop_cycle_id, T0)

    assert cuerpo["cell_id"] == str(cell_id)
    assert cuerpo["crop_cycle_id"] == str(crop_cycle_id)
    for entrada in cuerpo["entries"]:
        assert entrada["prediction_id"] in {
            celda_con_serie["t0"]["id"],
            celda_con_serie["t2"]["id"],
        }


def test_another_cell_at_the_same_moment_is_a_different_answer(
    client, session, cell_id, crop_cycle_id, celda_con_serie
):
    """Mismo instante, otra celda: no se mezclan.

    Se comprueba porque `as_of` es lo unico que comparten dos celdas del mismo
    lote, y un filtro mal puesto podria devolver la prediccion de la vecina.
    """
    from app.models import GridCell

    otra = session.scalars(
        __import__("sqlalchemy").select(GridCell).where(GridCell.id != cell_id).limit(1)
    ).one()
    propia = predecir(client, otra.id, crop_cycle_id, T0)

    mia = rendimiento(client, cell_id, crop_cycle_id, T0)["entries"][0]
    suya = rendimiento(client, otra.id, crop_cycle_id, T0)["entries"][0]

    assert mia["prediction_id"] != suya["prediction_id"]
    assert suya["prediction_id"] == propia["id"]


def test_the_model_version_matches_the_stored_prediction(
    client, cell_id, crop_cycle_id, celda_con_serie
):
    """Lo que se ensena y lo que se guardo llevan la misma etiqueta.

    Es lo que permite comparar una ficha con una fila de `predictions` sin
    tener que confiar en que sean lo mismo.
    """
    from app.core.state import IMPACT_VERSION

    for clave, cuando in (("t0", T0), ("t2", T2)):
        entrada = rendimiento(client, cell_id, crop_cycle_id, cuando)["entries"][0]

        assert entrada["model_version"] == celda_con_serie[clave]["model_version"]
        assert IMPACT_VERSION in entrada["model_version"]


def test_as_of_filters_predictions_not_harvests(
    client, cell_id, crop_cycle_id, celda_con_serie
):
    """El filtro se aplica a una sola de las dos consultas, y se comprueba.

    Con `as_of` en el momento de t0 sigue habiendo cosecha: si el filtro se
    hubiera colado en la consulta de `harvests` --que no tiene `as_of`-- la
    entrada volveria sin ground truth.
    """
    entrada = rendimiento(client, cell_id, crop_cycle_id, T0)["entries"][0]

    assert entrada["harvest_id"] is not None
    assert entrada["actual_yield_kg"] is not None
    assert entrada["absolute_error_kg"] is not None


def test_a_prediction_after_the_harvest_still_has_no_error(
    client, cell_id, crop_cycle_id
):
    """La regla de emparejamiento sigue mandando por encima del filtro.

    Pedir explicitamente un momento POSTERIOR a la cosecha no convierte su
    diferencia en un error de prediccion: esa prediccion no predijo nada.
    """
    tarde = datetime.fromisoformat(f"{COSECHA}T12:00:00+00:00") + timedelta(days=10)
    predecir(client, cell_id, crop_cycle_id, tarde)
    cosechar(client, cell_id, crop_cycle_id, kg=3.0)

    entrada = rendimiento(client, cell_id, crop_cycle_id, tarde)["entries"][0]

    assert entrada["actual_yield_kg"] is None
    assert entrada["absolute_error_kg"] is None


# --- LA PROCEDENCIA TEMPORAL: `as_of` manda, `created_at` no ----------------


@pytest.fixture
def orden_invertido(client, session, cell_id, crop_cycle_id):
    """Dos predicciones cuyo orden de EJECUCION es el contrario al de sus momentos.

        B  created_at 2026-09-09 20:50:06   as_of 2026-06-01  (momento TARDIO)
        A  created_at 2026-09-09 20:50:08   as_of 2026-04-01  (momento TEMPRANO)

    Ordenar por `as_of` descendente da [B, A]; por `created_at` descendente da
    [A, B]. Son listas distintas, asi que el orden distingue una implementacion
    de la otra.

    LOS `created_at` SE FIJAN A MANO, y esa es la parte que importa. La primera
    version de esta fixture lanzaba las dos predicciones por HTTP confiando en
    que la segunda quedara despues: `created_at` usa `server_default=func.now()`
    y las dos salian con el MISMO valor, asi que el desempate secundario por
    `as_of` decidia igual y cambiar el `ORDER BY` no rompia nada. Comprobado:
    con aquella fixture, sustituir `as_of` por `created_at` en el servicio
    dejaba pasar los diecisiete tests del fichero.

    Se escriben directamente con el modelo porque `created_at` no es un campo
    que la API acepte --y no debe serlo: describe cuando corrio el calculo--.
    """
    from app.models import Observation, Prediction

    session.add(
        Observation(
            cell_id=cell_id,
            crop_cycle_id=crop_cycle_id,
            type="disease",
            severity=0.8,
            observed_at=T0 + timedelta(days=10),
            source_kind="synthetic",
        )
    )
    session.commit()

    creados = {}
    for clave, momento, ejecutado in (
        ("tardio", T2, datetime(2026, 9, 9, 20, 50, 6, tzinfo=timezone.utc)),
        ("temprano", T0, datetime(2026, 9, 9, 20, 50, 8, tzinfo=timezone.utc)),
    ):
        datos = predecir(client, cell_id, crop_cycle_id, momento)
        fila = session.get(Prediction, uuid.UUID(datos["id"]))
        fila.created_at = ejecutado
        session.add(fila)
        creados[clave] = datos
    session.commit()

    cosechar(client, cell_id, crop_cycle_id, kg=3.0)
    return creados


def test_the_two_dates_really_disagree_in_this_fixture(
    session, cell_id, crop_cycle_id, orden_invertido
):
    """El control del escenario: si las dos fechas coincidieran, no probaria nada.

    Se comprueba contra la base y no contra la respuesta: lo que tiene que estar
    invertido es lo GUARDADO.
    """
    from sqlalchemy import select

    from app.models import Prediction

    filas = {
        str(p.id): p
        for p in session.scalars(
            select(Prediction).where(Prediction.cell_id == cell_id)
        )
    }
    temprano = filas[orden_invertido["temprano"]["id"]]
    tardio = filas[orden_invertido["tardio"]["id"]]

    assert temprano.as_of < tardio.as_of
    # ESTRICTO, no `>=`: con `>=` dos marcas iguales pasaban el control y la
    # fixture no invertia nada. Fue asi como un `ORDER BY created_at` se colo.
    assert temprano.created_at > tardio.created_at


def test_the_history_is_ordered_by_the_moment_not_by_the_execution(
    client, cell_id, crop_cycle_id, orden_invertido
):
    """EL TEST QUE CAZA UN `ORDER BY created_at`.

    Sin `as_of` la lista sale entera y su orden es observable. Con este
    escenario las dos ordenaciones dan listas DISTINTAS, asi que sustituir
    `Prediction.as_of.desc()` por `Prediction.created_at.desc()` invierte el
    resultado y este test se cae.

    Comprobado rompiendo el servicio a proposito antes de darlo por bueno.
    """
    entradas = rendimiento(client, cell_id, crop_cycle_id)["entries"]

    assert len(entradas) == 2
    assert entradas[0]["prediction_id"] == orden_invertido["tardio"]["id"]
    assert entradas[1]["prediction_id"] == orden_invertido["temprano"]["id"]
    # Y dicho sobre las fechas, que es lo que significa: mas reciente primero.
    assert entradas[0]["as_of"] > entradas[1]["as_of"]
    # El orden de ejecucion es el CONTRARIO, y aun asi la lista sale por momento.
    assert entradas[0]["predicted_at"] <= entradas[1]["predicted_at"]


def test_asking_for_a_moment_ignores_which_ran_first(
    client, cell_id, crop_cycle_id, orden_invertido
):
    """Y con filtro, cada instante devuelve SU prediccion.

    Si alguien filtrara por `created_at` en vez de por `as_of`, ninguna de las
    dos coincidiria --son marcas de tiempo completamente distintas-- y las dos
    respuestas saldrian vacias.

    Si alguien cogiera "la mas reciente" en vez de la del momento pedido, las
    dos devolverian la misma.
    """
    temprano = rendimiento(client, cell_id, crop_cycle_id, T0)["entries"]
    tardio = rendimiento(client, cell_id, crop_cycle_id, T2)["entries"]

    assert len(temprano) == 1 and len(tardio) == 1
    assert temprano[0]["prediction_id"] == orden_invertido["temprano"]["id"]
    assert tardio[0]["prediction_id"] == orden_invertido["tardio"]["id"]
    assert temprano[0]["prediction_id"] != tardio[0]["prediction_id"]


def test_the_harvest_never_becomes_a_time_series(
    client, cell_id, crop_cycle_id, orden_invertido
):
    """LA COSECHA ES LA VERDAD Y SE QUEDA QUIETA.

    Este test existe para que sea imposible convertir `harvests` en algo que
    depende del instante. Si alguien anadiera `as_of` al filtro de cosechas
    --que no tiene esa columna-- o emparejara por proximidad de fechas, uno de
    los dos momentos se quedaria sin ground truth y su error desapareceria.

    La prediccion SI cambia entre los dos momentos: es lo que hace que el test
    no pase por casualidad sobre dos respuestas identicas.
    """
    a = rendimiento(client, cell_id, crop_cycle_id, T0)["entries"][0]
    b = rendimiento(client, cell_id, crop_cycle_id, T2)["entries"][0]

    # La verdad, idéntica.
    assert a["harvest_id"] == b["harvest_id"]
    assert a["actual_yield_kg"] == b["actual_yield_kg"]
    assert a["harvested_at"] == b["harvested_at"]
    assert a["actual_boxes"] == b["actual_boxes"]
    # La predicción, distinta. Y por tanto el error.
    assert a["projected_yield_kg"] != b["projected_yield_kg"]
    assert a["absolute_error_kg"] != b["absolute_error_kg"]
