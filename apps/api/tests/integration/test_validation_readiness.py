"""¿Puede CERES validarse contra la realidad? El puente existe; falta la orilla.

Este fichero no calcula ninguna metrica de precision, y ese es su contenido: con
cero cosechas reales, la respuesta correcta a "cuanto se equivoco el modelo" es
**no evaluable todavia**, no un numero.

Lo que si comprueba es que la maquinaria esta puesta y que se comporta
honestamente cuando no tiene con que trabajar.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.models import Harvest, Observation

T = datetime(2026, 5, 1, tzinfo=timezone.utc)


# --- El puente predicción / realidad ----------------------------------------


def test_the_bridge_exists_and_says_nothing_when_there_is_nothing(
    client, cell_id, crop_cycle_id
):
    """`GET /cells/{id}/performance` devuelve una lista vacia, no un cero.

    Es la diferencia entre "no lo se" y "el error es 0 %". Un cero seria una
    afirmacion sobre la precision del modelo, y no hay ninguna que hacer.
    """
    respuesta = client.get(
        f"/api/v1/cells/{cell_id}/performance",
        params={"crop_cycle_id": str(crop_cycle_id)},
    )

    assert respuesta.status_code == 200
    assert respuesta.json()["entries"] == []


def test_a_prediction_alone_produces_no_metric(client, cell_id, crop_cycle_id):
    """Predecir no es validar.

    Aunque haya predicciones, sin cosecha no hay contra que compararlas. El
    endpoint no puede inventarse la mitad que falta.
    """
    client.post(
        "/api/v1/predictions",
        json={
            "cell_id": str(cell_id),
            "crop_cycle_id": str(crop_cycle_id),
            "as_of": T.isoformat(),
        },
    )

    entradas = client.get(
        f"/api/v1/cells/{cell_id}/performance",
        params={"crop_cycle_id": str(crop_cycle_id)},
    ).json()["entries"]

    for entrada in entradas:
        assert entrada.get("actual_yield_kg") is None
        assert entrada.get("percentage_error") is None


def test_the_harvest_schema_can_already_hold_what_validation_needs(session):
    """Auditoria del esquema: no le falta nada.

    `cell_id`, `crop_cycle_id`, fecha y cantidad estan los cuatro. No hay que
    ampliarlo; lo que falta son filas, y esas no se inventan.
    """
    columnas = set(Harvest.__table__.columns.keys())

    assert {"cell_id", "crop_cycle_id", "harvested_at", "actual_yield_kg"} <= columnas
    assert "actual_boxes" in columnas


def test_there_are_no_harvests_to_validate_against(session):
    """El dato que falta, contado. Si esto deja de ser cero, se puede empezar."""
    assert session.scalar(select(func.count()).select_from(Harvest)) == 0


# --- Las cinco procedencias, separadas --------------------------------------


def test_a_synthetic_observation_is_never_presented_as_measured(client, cell_id):
    """Las 24 del dataset se sirven como lo que son."""
    for observacion in client.get(f"/api/v1/cells/{cell_id}/observations").json():
        assert observacion["source_kind"] != "measured"


def test_a_measured_observation_is_never_presented_as_synthetic(
    client, cell_id, crop_cycle_id
):
    """Y una declarada medida no se degrada por el camino."""
    creada = client.post(
        "/api/v1/observations",
        json={
            "cell_id": str(cell_id),
            "crop_cycle_id": str(crop_cycle_id),
            "type": "disease",
            "severity": 0.4,
            "observed_at": T.isoformat(),
            "source_kind": "measured",
        },
    ).json()

    leidas = client.get(f"/api/v1/cells/{cell_id}/observations").json()
    servida = next(o for o in leidas if o["id"] == creada["id"])

    assert servida["source_kind"] == "measured"


def test_the_three_things_are_three_things(client, cell_id, crop_cycle_id):
    """MEASURED != DERIVED != ESTIMATED, comprobado sobre una misma celda.

        observacion  measured   lo que alguien vio
        estado       derived    lo que `impact-v0` deduce de eso
        prediccion   estimated  lo que el motor calcula del estado
    """
    observacion = client.post(
        "/api/v1/observations",
        json={
            "cell_id": str(cell_id),
            "crop_cycle_id": str(crop_cycle_id),
            "type": "disease",
            "severity": 0.6,
            "observed_at": T.isoformat(),
            "source_kind": "measured",
        },
    ).json()

    prediccion = client.post(
        "/api/v1/predictions",
        json={
            "cell_id": str(cell_id),
            "crop_cycle_id": str(crop_cycle_id),
            "as_of": (T + timedelta(days=1)).isoformat(),
        },
    ).json()

    celda = client.get(f"/api/v1/cells/{cell_id}").json()

    # 1. La observacion es lo unico medido, y lo declara.
    assert observacion["source_kind"] == "measured"
    # 2. El estado usado es DERIVADO: no coincide con la celda ni con la severidad.
    derivada = prediccion["inputs"]["health_factor"]
    assert derivada != celda["health_factor"]
    assert derivada != observacion["severity"]
    # 3. La prediccion es ESTIMADA, y dice con que modelos.
    assert "impact-v0" in prediccion["model_version"]
    assert prediccion["projected_yield_kg"] != derivada


def test_the_impact_model_is_still_declared_uncalibrated():
    """El supuesto sigue estando escrito donde se lee antes de creerse un numero.

    Si alguien borra la advertencia, este test se cae. Es barato y es lo unico
    que impide que `impact-v0` empiece a leerse como agronomia.
    """
    from pathlib import Path

    import app.core.state as modulo

    fuente = Path(modulo.__file__).read_text(encoding="utf-8")

    assert "NO ESTAN CALIBRADOS" in fuente
    assert "QUE NO PODEMOS AFIRMAR" in fuente
    assert "harvests` tiene 0 filas" in fuente or "harvests` tiene\n#     CERO filas" in fuente


def test_the_seeded_observations_survive_everything(session):
    """Ni editadas, ni borradas, ni sustituidas por otras sinteticas."""
    total = session.scalar(select(func.count()).select_from(Observation))
    sinteticas = session.scalar(
        select(func.count()).select_from(Observation).where(
            Observation.source_kind == "synthetic"
        )
    )

    assert sinteticas == 24
    assert total >= sinteticas
