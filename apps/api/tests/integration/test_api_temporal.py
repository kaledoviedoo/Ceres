"""El eje temporal, de extremo a extremo.

Lo que demuestra: que dos predicciones pueden diferir porque cambio el estado
OBSERVADO de la celda, y no porque alguien pulso guardar dos veces.

Y lo que NO hace: fabricar historia. Las observaciones que mueven el estado en
estos tests se crean AQUI y se declaran medidas explicitamente. Las 24 del
dataset siguen siendo sinteticas y no mueven nada.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.models import Observation

T0 = datetime(2026, 4, 1, tzinfo=timezone.utc)


def crear(client, cell_id, crop_cycle_id, as_of=None):
    cuerpo = {"cell_id": str(cell_id), "crop_cycle_id": str(crop_cycle_id)}
    if as_of is not None:
        cuerpo["as_of"] = as_of.isoformat()
    return client.post("/api/v1/predictions", json=cuerpo)


@pytest.fixture
def observacion_medida(session, cell_id, crop_cycle_id):
    """Una observacion declarada MEDIDA, creada por el test.

    Se marca `measured` a mano y a conciencia: es el unico modo de que mueva el
    estado, y el dataset real no tiene ninguna asi.
    """

    def _crear(dias: int, severidad: float = 0.8, tipo: str = "disease"):
        obs = Observation(
            cell_id=cell_id,
            crop_cycle_id=crop_cycle_id,
            type=tipo,
            severity=severidad,
            description="Registrada por el test",
            observed_at=T0 + timedelta(days=dias),
            source_kind="measured",
        )
        session.add(obs)
        session.commit()
        return obs

    return _crear


# --- Lo esencial de la fase --------------------------------------------------


def test_two_predictions_differ_because_the_state_changed(
    client, session, cell_id, crop_cycle_id, observacion_medida
):
    """EL TEST DE LA FASE.

    Misma celda, mismo ciclo, mismo modelo. Lo unico distinto es de que momento
    habla cada prediccion, y entre los dos momentos hay una observacion medida.
    """
    observacion_medida(dias=10, severidad=0.8)

    antes = crear(client, cell_id, crop_cycle_id, T0 + timedelta(days=5)).json()
    despues = crear(client, cell_id, crop_cycle_id, T0 + timedelta(days=20)).json()

    # Las ENTRADAS son distintas: es lo que hace legible la serie.
    assert despues["inputs"]["health_factor"] < antes["inputs"]["health_factor"]
    # Y por tanto el resultado tambien.
    assert despues["projected_yield_kg"] < antes["projected_yield_kg"]
    assert despues["risk_score"] > antes["risk_score"]


def test_pressing_save_twice_does_not_change_anything(
    client, cell_id, crop_cycle_id
):
    """El control del test anterior.

    Sin observaciones medidas de por medio, dos ejecuciones sobre el mismo
    momento dan exactamente lo mismo. Que es justo lo que pasaba antes de esta
    fase con CUALQUIER par de predicciones.
    """
    momento = T0 + timedelta(days=5)
    a = crear(client, cell_id, crop_cycle_id, momento).json()
    b = crear(client, cell_id, crop_cycle_id, momento).json()

    assert a["id"] != b["id"], "cada ejecucion sigue siendo una fila nueva"
    assert a["inputs"] == b["inputs"]
    assert a["projected_yield_kg"] == b["projected_yield_kg"]


def test_three_moments_form_an_ordered_series(
    client, session, cell_id, crop_cycle_id, observacion_medida
):
    """t0 -> observacion -> t1 -> observacion -> t2, con estados distintos."""
    observacion_medida(dias=10, severidad=0.5)
    observacion_medida(dias=30, severidad=0.5, tipo="water_stress")

    serie = [
        crear(client, cell_id, crop_cycle_id, T0 + timedelta(days=d)).json()
        for d in (1, 20, 40)
    ]
    salud = [p["inputs"]["health_factor"] for p in serie]

    assert salud[0] > salud[1] > salud[2]


# --- `created_at` frente a `as_of` -------------------------------------------


def test_created_at_and_as_of_are_different_things(
    client, cell_id, crop_cycle_id
):
    """Dos predicciones lanzadas ahora que hablan de momentos distintos.

    Sin `as_of` serian indistinguibles en la tabla, y una serie ordenada por
    `created_at` mezclaria el orden de EJECUCION con el orden de los HECHOS.
    """
    marzo = crear(client, cell_id, crop_cycle_id, T0).json()
    mayo = crear(client, cell_id, crop_cycle_id, T0 + timedelta(days=60)).json()

    assert marzo["as_of"] != mayo["as_of"]
    # Las dos se ejecutaron ahora, no en 2026-04.
    assert marzo["created_at"] != marzo["as_of"]
    assert marzo["created_at"][:4] != "2026" or marzo["as_of"][:4] == "2026"


def test_omitting_as_of_means_now(client, cell_id, crop_cycle_id):
    """El comportamiento de siempre, ahora explicito.

    Antes de esta fase una prediccion no decia de que momento hablaba. Ahora sin
    fecha habla del presente, y lo dice.
    """
    antes = datetime.now(timezone.utc)
    creada = crear(client, cell_id, crop_cycle_id).json()

    assert creada["as_of"] is not None
    # Se compara normalizando a UTC: segun el driver, la fecha vuelve con zona o
    # sin ella, y eso es una propiedad del almacenamiento, no de la semantica.
    devuelta = datetime.fromisoformat(creada["as_of"])
    if devuelta.tzinfo is None:
        devuelta = devuelta.replace(tzinfo=timezone.utc)
    assert devuelta >= antes - timedelta(seconds=5)


def test_the_client_can_choose_the_moment_but_never_the_state(
    client, cell_id, crop_cycle_id
):
    """`as_of` es una fecha, no una puerta trasera.

    El cliente sigue sin poder mandar `health_factor` ni `soil_quality`:
    `extra="forbid"` lo rechaza. Lo unico que elige es el instante; el estado lo
    deriva el servidor de las observaciones que ya tenia.
    """
    respuesta = client.post(
        "/api/v1/predictions",
        json={
            "cell_id": str(cell_id),
            "crop_cycle_id": str(crop_cycle_id),
            "health_factor": 0.1,
        },
    )
    assert respuesta.status_code == 422


# --- Las sinteticas no cuentan ----------------------------------------------


def test_a_synthetic_observation_moves_the_prediction_in_a_synthetic_deployment(
    client, session, cell_id, crop_cycle_id
):
    """La regla nueva, comprobada por HTTP.

    Este despliegue declara `DATASET_KIND = synthetic`: sus celdas las escribio
    un generador. Una observacion sintetica esta al mismo nivel que ellas, asi
    que mueve el estado. Antes no lo hacia, y la consecuencia era que una finca
    sintetica no podia tener eje temporal.

    La proteccion que importa --que una observacion sintetica NO pueda mover una
    celda medida-- se comprueba en `tests/unit/test_state_provenance_gate.py`,
    que es donde se puede fijar la procedencia del despliegue.
    """
    antes = crear(client, cell_id, crop_cycle_id, T0 + timedelta(days=50)).json()

    session.add(
        Observation(
            cell_id=cell_id,
            crop_cycle_id=crop_cycle_id,
            type="disease",
            severity=1.0,
            observed_at=T0 + timedelta(days=10),
            source_kind="synthetic",
        )
    )
    session.commit()

    despues = crear(client, cell_id, crop_cycle_id, T0 + timedelta(days=50)).json()

    assert despues["inputs"]["health_factor"] < antes["inputs"]["health_factor"]
    assert despues["projected_yield_kg"] < antes["projected_yield_kg"]


def test_observations_declare_their_source(client, cell_id):
    """Y la API lo cuenta, para que nadie tenga que suponerlo."""
    observaciones = client.get(f"/api/v1/cells/{cell_id}/observations").json()

    for observacion in observaciones:
        assert "source_kind" in observacion
        assert observacion["source_kind"] != "measured", (
            "el dataset no contiene ninguna medicion de campo"
        )


def test_the_seeded_observations_are_all_synthetic(session):
    """Las 24 siguen siendo lo que eran. No se convirtieron en reales."""
    from sqlalchemy import func, select

    conteo = session.execute(
        select(Observation.source_kind, func.count()).group_by(Observation.source_kind)
    ).all()

    for kind, _ in conteo:
        assert kind != "measured"


# --- El mapa tambien tiene eje temporal -------------------------------------


def test_the_map_without_a_date_shows_the_base_state(client, plot_a_id, crop_cycle_id):
    """Comportamiento de siempre: sin `as_of`, el estado base.

    No cambio al anadir el parametro, y ese es medio contrato del endpoint.
    """
    respuesta = client.get(
        f"/api/v1/plots/{plot_a_id}/overview", params={"crop_cycle_id": str(crop_cycle_id)}
    )

    assert respuesta.status_code == 200
    assert respuesta.json()["persisted"] is False


def test_the_map_with_a_date_derives_every_cell(client, session, plot_a_id, crop_cycle_id):
    """LA OTRA MITAD, y la que faltaba.

    Sin fecha el mapa no puede ensenar lo que ha pasado: una finca con miles de
    observaciones fechadas se pintaba entera del mismo color porque el mapa no
    las miraba. Las zonas de evento solo existian en las predicciones guardadas,
    que el mapa no lee.

    Se registra una observacion grave sobre una celda concreta y se comprueba
    que el mapa la ve --y solo a ella--.
    """
    fecha = (T0 + timedelta(days=1)).isoformat()
    params = {"crop_cycle_id": str(crop_cycle_id), "as_of": fecha}

    # Se compara MISMA FECHA contra misma fecha, antes y despues de anadir la
    # observacion. Comparar contra el estado base no aislaria nada: el dataset de
    # demo trae 24 observaciones fechadas que tambien mueven el estado desde que
    # una observacion sintetica cuenta en un despliegue sintetico.
    antes = {
        c["cell_id"]: c
        for c in client.get(f"/api/v1/plots/{plot_a_id}/overview", params=params).json()["cells"]
    }
    objetivo = next(iter(antes))

    client.post(
        "/api/v1/observations",
        json={
            "cell_id": objetivo,
            "crop_cycle_id": str(crop_cycle_id),
            "type": "disease",
            "severity": 0.9,
            "observed_at": T0.isoformat(),
            "source_kind": "synthetic",
        },
    )

    despues = {
        c["cell_id"]: c
        for c in client.get(f"/api/v1/plots/{plot_a_id}/overview", params=params).json()["cells"]
    }

    assert despues[objetivo]["projected_yield_kg"] < antes[objetivo]["projected_yield_kg"]
    # Y ninguna otra celda se movio: la fecha deriva, no reescribe.
    movidas = [
        cid
        for cid in antes
        if despues[cid]["projected_yield_kg"] != antes[cid]["projected_yield_kg"]
    ]
    assert movidas == [objetivo]


def test_a_date_before_the_observation_leaves_the_map_untouched(
    client, plot_a_id, crop_cycle_id
):
    """El corte sigue siendo `observed_at`, tambien para el mapa.

    Una observacion registrada hoy sobre algo visto en abril no puede cambiar el
    mapa de marzo.
    """
    params = {
        "crop_cycle_id": str(crop_cycle_id),
        "as_of": (T0 - timedelta(days=1)).isoformat(),
    }
    antes = client.get(f"/api/v1/plots/{plot_a_id}/overview", params=params).json()["cells"]

    client.post(
        "/api/v1/observations",
        json={
            "cell_id": antes[0]["cell_id"],
            "crop_cycle_id": str(crop_cycle_id),
            "type": "disease",
            "severity": 1.0,
            "observed_at": T0.isoformat(),
            "source_kind": "synthetic",
        },
    )

    despues = client.get(f"/api/v1/plots/{plot_a_id}/overview", params=params).json()["cells"]

    assert [c["projected_yield_kg"] for c in despues] == [
        c["projected_yield_kg"] for c in antes
    ]
