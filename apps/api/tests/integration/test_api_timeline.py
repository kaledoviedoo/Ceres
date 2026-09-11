"""EL EJE TEMPORAL, servido para que la interfaz pueda ofrecerlo.

    GET /plots/{id}/timeline  ->  de que momentos hay estado que ensenar
    GET /plots/{id}/overview?as_of=...  ->  el estado de ese momento

Lo que estos tests vigilan es que la lista de momentos SALGA DE LOS DATOS y no
de una constante, y que pedir un momento devuelva exactamente lo que CERES ya
habia dicho de el.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

T0 = datetime(2026, 4, 1, tzinfo=timezone.utc)
T2 = datetime(2026, 6, 1, tzinfo=timezone.utc)


def predecir(client, cell_id, crop_cycle_id, cuando):
    return client.post(
        "/api/v1/predictions",
        json={
            "cell_id": str(cell_id),
            "crop_cycle_id": str(crop_cycle_id),
            "as_of": cuando.isoformat(),
        },
    ).json()


def timeline(client, plot_id, crop_cycle_id):
    return client.get(
        f"/api/v1/plots/{plot_id}/timeline",
        params={"crop_cycle_id": str(crop_cycle_id)},
    )


def overview(client, plot_id, crop_cycle_id, as_of=None):
    params = {"crop_cycle_id": str(crop_cycle_id)}
    if as_of is not None:
        params["as_of"] = as_of
    return client.get(f"/api/v1/plots/{plot_id}/overview", params=params).json()


# --- De donde salen los momentos --------------------------------------------


def test_a_plot_without_predictions_has_no_timeline(client, plot_a_id, crop_cycle_id):
    """Y eso es una respuesta, no un hueco.

    Significa que no hay ningun momento del que ensenar el estado. Es el caso de
    la finca demo, y por eso alli la interfaz no muestra control temporal.
    """
    respuesta = timeline(client, plot_a_id, crop_cycle_id)

    assert respuesta.status_code == 200
    assert respuesta.json()["moments"] == []


def test_the_moments_are_the_as_of_that_exist_in_predictions(
    client, plot_a_id, cell_id, crop_cycle_id
):
    """LA PRUEBA DE QUE NO ES UNA LISTA ESCRITA A MANO.

    Se lanzan dos predicciones fechadas y la linea de tiempo pasa de vacia a
    tener exactamente esas dos fechas. Si la lista viniera de una constante, no
    reaccionaria.
    """
    assert timeline(client, plot_a_id, crop_cycle_id).json()["moments"] == []

    predecir(client, cell_id, crop_cycle_id, T0)
    predecir(client, cell_id, crop_cycle_id, T2)

    momentos = timeline(client, plot_a_id, crop_cycle_id).json()["moments"]

    assert len(momentos) == 2
    assert [m["as_of"][:10] for m in momentos] == ["2026-04-01", "2026-06-01"]


def test_the_moments_come_in_chronological_order(client, plot_a_id, cell_id, crop_cycle_id):
    """El orden es el de los HECHOS, no el de ejecucion.

    Se lanzan al reves a proposito: si la lista siguiera `created_at`, saldrian
    invertidas y el control temporal ofreceria T0 despues de T2.
    """
    predecir(client, cell_id, crop_cycle_id, T2)
    predecir(client, cell_id, crop_cycle_id, T0)

    fechas = [m["as_of"] for m in timeline(client, plot_a_id, crop_cycle_id).json()["moments"]]

    assert fechas == sorted(fechas)


def test_repeating_a_moment_does_not_repeat_it_in_the_timeline(
    client, plot_a_id, cell_id, crop_cycle_id
):
    """Diez mil celdas predichas en t0 son UN momento, no diez mil.

    El recuento viaja aparte, para que la interfaz pueda decir cuantas celdas
    respaldan cada instante.
    """
    predecir(client, cell_id, crop_cycle_id, T0)
    predecir(client, cell_id, crop_cycle_id, T0)

    momentos = timeline(client, plot_a_id, crop_cycle_id).json()["moments"]

    assert len(momentos) == 1
    assert momentos[0]["prediction_count"] == 2


def test_a_prediction_without_a_date_is_not_a_moment(client, plot_a_id, cell_id, crop_cycle_id):
    """`as_of NULL` es el estado base y no se puede situar en un eje.

    Hoy la API siempre fecha lo que guarda, asi que este caso solo llega desde
    filas antiguas; se comprueba porque el eje no puede ofrecer un instante que
    no existe.
    """
    from app.models import Prediction

    predecir(client, cell_id, crop_cycle_id, T0)
    momentos = timeline(client, plot_a_id, crop_cycle_id).json()["moments"]

    assert len(momentos) == 1
    assert all(m["as_of"] is not None for m in momentos)
    assert Prediction.as_of.nullable is True


# --- Ni las fechas del ciclo ni las de siembra sirven como momento -----------


def test_the_cycle_dates_travel_but_are_not_moments(
    client, plot_a_id, cell_id, crop_cycle_id
):
    """`planted_at` y `expected_harvest_at` estan para SITUAR, no para pedir.

    Es la razon de que este endpoint exista. En La Cuadricula, el lote de papa
    se siembra el 15 de marzo y su primer momento es el 14 de abril --siembra +
    30 dias--; se cosecha el 20 de agosto y su ultimo momento es el 13 --cosecha
    - 7--. Una interfaz que dedujera los instantes del ciclo pediria dos fechas
    que no existen en `predictions`.
    """
    predecir(client, cell_id, crop_cycle_id, T0)
    cuerpo = timeline(client, plot_a_id, crop_cycle_id).json()

    assert "planted_at" in cuerpo and "expected_harvest_at" in cuerpo
    fechas_ciclo = {cuerpo["planted_at"], cuerpo["expected_harvest_at"]}
    for momento in cuerpo["moments"]:
        assert momento["as_of"][:10] not in fechas_ciclo


# --- Integridad --------------------------------------------------------------


def test_a_cycle_from_another_plot_is_a_conflict(client, other_plot, crop_cycle_id):
    """Mismo criterio que el resto del servicio: el ciclo pertenece a un lote."""
    respuesta = timeline(client, other_plot["plot_id"], crop_cycle_id)

    assert respuesta.status_code == 409


def test_an_unknown_plot_is_a_404(client, crop_cycle_id):
    import uuid

    assert timeline(client, uuid.uuid4(), crop_cycle_id).status_code == 404


# --- LA PARIDAD: lo que pide el mapa es lo que CERES ya habia dicho ----------


def test_the_map_at_a_moment_equals_the_prediction_stored_for_it(
    client, plot_a_id, cell_id, crop_cycle_id
):
    """EL TEST QUE MAS IMPORTA DE ESTA FASE.

    El control temporal ofrece los `as_of` de `predictions`, pero el mapa NO lee
    esa tabla: recalcula al vuelo con `overview(as_of=...)`. Las dos cosas tienen
    que coincidir hasta el ultimo decimal, porque son el mismo motor sobre el
    mismo estado derivado.

    Si algun dia dejaran de coincidir, la interfaz estaria ofreciendo un momento
    y ensenando otra cosa, y nadie se daria cuenta mirando la pantalla.
    """
    guardada = predecir(client, cell_id, crop_cycle_id, T0)

    momentos = timeline(client, plot_a_id, crop_cycle_id).json()["moments"]
    celdas = overview(client, plot_a_id, crop_cycle_id, momentos[0]["as_of"])["cells"]
    pintada = next(c for c in celdas if c["cell_id"] == str(cell_id))

    assert pintada["projected_yield_kg"] == guardada["projected_yield_kg"]
    assert pintada["projected_boxes"] == guardada["projected_boxes"]
    assert pintada["estimated_loss_percentage"] == guardada["estimated_loss_percentage"]
    assert pintada["risk_score"] == guardada["risk_score"]
    assert pintada["risk_level"] == guardada["risk_level"]


def test_two_moments_give_two_different_maps(
    client, session, plot_a_id, cell_id, crop_cycle_id
):
    """Y esa diferencia es la que el usuario vera al pulsar T0 y T2.

    Entre los dos instantes se registra una observacion: sin ella los dos mapas
    serian iguales y el control no tendria nada que ensenar.
    """
    from app.models import Observation

    session.add(
        Observation(
            cell_id=cell_id,
            crop_cycle_id=crop_cycle_id,
            type="disease",
            severity=0.9,
            observed_at=T0 + timedelta(days=10),
            source_kind="synthetic",
        )
    )
    session.commit()

    predecir(client, cell_id, crop_cycle_id, T0)
    predecir(client, cell_id, crop_cycle_id, T2)
    momentos = timeline(client, plot_a_id, crop_cycle_id).json()["moments"]

    def rendimiento(as_of: str) -> float:
        celdas = overview(client, plot_a_id, crop_cycle_id, as_of)["cells"]
        return next(c for c in celdas if c["cell_id"] == str(cell_id))["projected_yield_kg"]

    assert rendimiento(momentos[1]["as_of"]) < rendimiento(momentos[0]["as_of"])


@pytest.mark.parametrize("cuando", [T0, T2])
def test_asking_for_a_moment_is_reproducible(
    client, plot_a_id, cell_id, crop_cycle_id, cuando
):
    """Dos peticiones del mismo instante dan lo mismo.

    Es lo que permite que la interfaz no cachee nada: volver a T0 despues de
    pasar por T2 no depende de por donde se haya pasado.
    """
    predecir(client, cell_id, crop_cycle_id, cuando)
    momento = timeline(client, plot_a_id, crop_cycle_id).json()["moments"][0]["as_of"]

    una = overview(client, plot_a_id, crop_cycle_id, momento)["cells"]
    otra = overview(client, plot_a_id, crop_cycle_id, momento)["cells"]

    assert una == otra


# --- Lo que el mapa declara sobre si mismo ----------------------------------


def test_the_map_names_both_models_when_it_derives_a_state(
    client, plot_a_id, crop_cycle_id
):
    """Con fecha intervienen DOS modelos, y los dos tienen que aparecer.

    Con `as_of`, cada celda pasa por `impact-v0` --que deriva su estado de las
    observaciones-- antes de llegar al motor de rendimiento. Declarar solo el
    segundo era afirmar de menos: una prediccion GUARDADA del mismo instante se
    identifica como `rule-based-v0.1+impact-v0`, y el mapa decia
    `rule-based-v0.1` para exactamente los mismos kilos.
    """
    from app.core.state import IMPACT_VERSION

    sin_fecha = overview(client, plot_a_id, crop_cycle_id)["model_version"]
    con_fecha = overview(client, plot_a_id, crop_cycle_id, T0.isoformat())["model_version"]

    assert IMPACT_VERSION not in sin_fecha
    assert IMPACT_VERSION in con_fecha


def test_the_map_and_a_saved_prediction_agree_on_the_model(
    client, plot_a_id, cell_id, crop_cycle_id
):
    """Mismos numeros, misma etiqueta. Es lo que permite compararlos."""
    guardada = predecir(client, cell_id, crop_cycle_id, T0)
    pintado = overview(client, plot_a_id, crop_cycle_id, T0.isoformat())

    assert pintado["model_version"] == guardada["model_version"]
