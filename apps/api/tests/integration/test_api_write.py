"""Tests de integracion: observaciones, cosechas y cierre del ciclo.

El ultimo bloque recorre entero el flujo del Digital Twin:
prediccion -> cosecha real -> error.
"""

from __future__ import annotations

MISSING_ID = "00000000-0000-0000-0000-000000000000"


def post_observation(client, cell_id, **overrides):
    payload = {
        "cell_id": str(cell_id),
        "type": "disease",
        "severity": 0.7,
        "description": "Manchas foliares en el tercio inferior.",
    }
    payload.update(overrides)
    return client.post("/api/v1/observations", json=payload)


#: Fecha de la cosecha en estos tests, y un momento anterior del que puedan
#: hablar las predicciones. Sin `as_of` anterior no hay error medible: una
#: prediccion posterior a la cosecha no predijo nada.
HARVEST_DATE = "2026-06-20"
BEFORE_HARVEST = "2026-06-01T09:00:00+00:00"


def post_prediction(client, cell_id, crop_cycle_id, as_of=BEFORE_HARVEST):
    return client.post(
        "/api/v1/predictions",
        json={
            "cell_id": str(cell_id),
            "crop_cycle_id": str(crop_cycle_id),
            "as_of": as_of,
        },
    )


def post_harvest(client, cell_id, crop_cycle_id, **overrides):
    payload = {
        "cell_id": str(cell_id),
        "crop_cycle_id": str(crop_cycle_id),
        "actual_yield_kg": 16.2,
        "actual_boxes": 3,
        "harvested_at": HARVEST_DATE,
    }
    payload.update(overrides)
    return client.post("/api/v1/harvests", json=payload)


# --- Observaciones ------------------------------------------------------------


def test_create_observation_returns_201(client, cell_id):
    response = post_observation(client, cell_id)

    assert response.status_code == 201
    body = response.json()
    assert body["cell_id"] == str(cell_id)
    assert body["type"] == "disease"
    assert body["severity"] == 0.7
    assert body["observed_at"] is not None


def test_observed_at_defaults_to_now_when_omitted(client, cell_id):
    body = post_observation(client, cell_id).json()

    assert body["observed_at"]


def test_observation_accepts_an_explicit_timestamp(client, cell_id):
    body = post_observation(client, cell_id, observed_at="2026-04-01T14:00:00Z").json()

    assert body["observed_at"].startswith("2026-04-01")


def test_observation_appears_in_the_cell_history(client, cell_id):
    created = post_observation(client, cell_id).json()

    listed = client.get(f"/api/v1/cells/{cell_id}/observations").json()

    assert [item["id"] for item in listed] == [created["id"]]


def test_observation_severity_is_validated(client, cell_id):
    assert post_observation(client, cell_id, severity=1.4).status_code == 422
    assert post_observation(client, cell_id, severity=-0.1).status_code == 422


def test_observation_type_is_validated(client, cell_id):
    assert post_observation(client, cell_id, type="alien_invasion").status_code == 422


def test_observation_rejects_unknown_fields(client, cell_id):
    assert post_observation(client, cell_id, health_factor=0.1).status_code == 422


def test_observation_on_missing_cell_returns_404(client):
    assert post_observation(client, MISSING_ID).status_code == 404


def test_observation_with_mismatched_cycle_returns_409(
    client, cell_in_other_plot, crop_cycle_id
):
    response = post_observation(
        client, cell_in_other_plot["id"], crop_cycle_id=str(crop_cycle_id)
    )

    assert response.status_code == 409


# --- Cosechas -----------------------------------------------------------------


def test_create_harvest_returns_201(client, cell_id, crop_cycle_id):
    response = post_harvest(client, cell_id, crop_cycle_id)

    assert response.status_code == 201
    body = response.json()
    assert body["actual_yield_kg"] == 16.2
    assert body["actual_boxes"] == 3
    assert body["harvested_at"] == "2026-06-20"
    assert body["actual_yield_tons"] == 0.0162


def test_harvest_appears_in_the_cell_history(client, cell_id, crop_cycle_id):
    created = post_harvest(client, cell_id, crop_cycle_id).json()

    listed = client.get(f"/api/v1/cells/{cell_id}/harvests").json()

    assert [item["id"] for item in listed] == [created["id"]]


def test_harvest_rejects_negative_values(client, cell_id, crop_cycle_id):
    assert post_harvest(client, cell_id, crop_cycle_id, actual_yield_kg=-1).status_code == 422
    assert post_harvest(client, cell_id, crop_cycle_id, actual_boxes=-1).status_code == 422


def test_harvest_requires_a_date(client, cell_id, crop_cycle_id):
    response = client.post(
        "/api/v1/harvests",
        json={
            "cell_id": str(cell_id),
            "crop_cycle_id": str(crop_cycle_id),
            "actual_yield_kg": 10.0,
            "actual_boxes": 2,
        },
    )

    assert response.status_code == 422


def test_harvest_on_missing_cell_returns_404(client, crop_cycle_id):
    assert post_harvest(client, MISSING_ID, crop_cycle_id).status_code == 404


def test_harvest_with_mismatched_cycle_returns_409(client, cell_in_other_plot, crop_cycle_id):
    assert post_harvest(client, cell_in_other_plot["id"], crop_cycle_id).status_code == 409


def test_harvests_of_missing_cell_return_404(client):
    assert client.get(f"/api/v1/cells/{MISSING_ID}/harvests").status_code == 404


# --- Cierre del ciclo: prediccion vs realidad ---------------------------------


def test_performance_is_empty_of_error_before_the_harvest(client, cell_id, crop_cycle_id):
    post_prediction(client, cell_id, crop_cycle_id)

    body = client.get(f"/api/v1/cells/{cell_id}/performance").json()

    assert len(body["entries"]) == 1
    entry = body["entries"][0]
    assert entry["actual_yield_kg"] is None
    assert entry["absolute_error_kg"] is None
    assert entry["percentage_error"] is None


def test_full_cycle_predict_harvest_compare(client, cell_id, crop_cycle_id):
    """Paso 1 a 13 del criterio de exito del MVP, sin frontend."""
    prediction = post_prediction(client, cell_id, crop_cycle_id).json()

    post_harvest(client, cell_id, crop_cycle_id, actual_yield_kg=5.0, actual_boxes=1)

    response = client.get(f"/api/v1/cells/{cell_id}/performance")

    assert response.status_code == 200
    body = response.json()
    assert body["cell_code"]

    entry = body["entries"][0]
    assert entry["prediction_id"] == prediction["id"]
    assert entry["actual_yield_kg"] == 5.0

    # Los errores se redondean a 4 decimales para no llevar ruido de coma
    # flotante hasta la interfaz (ver app/domain/performance.py).
    expected_abs = round(abs(prediction["projected_yield_kg"] - 5.0), 4)
    assert entry["absolute_error_kg"] == expected_abs
    assert entry["percentage_error"] == round(expected_abs / 5.0 * 100.0, 4)


def test_percentage_error_is_null_when_actual_yield_is_zero(
    client, cell_id, crop_cycle_id
):
    """No se inventa un porcentaje para una division imposible."""
    post_prediction(client, cell_id, crop_cycle_id)
    post_harvest(client, cell_id, crop_cycle_id, actual_yield_kg=0.0, actual_boxes=0)

    entry = client.get(f"/api/v1/cells/{cell_id}/performance").json()["entries"][0]

    assert entry["actual_yield_kg"] == 0.0
    assert entry["absolute_error_kg"] is not None
    assert entry["percentage_error"] is None


def test_every_prediction_is_compared_against_the_same_harvest(
    client, cell_id, crop_cycle_id
):
    """El historial completo se evalua, no solo la ultima prediccion.

    Con una condicion que antes no estaba: solo las predicciones ANTERIORES a la
    cosecha. Las tres de este test lo son.
    """
    for dia in ("2026-05-01", "2026-05-20", "2026-06-10"):
        post_prediction(client, cell_id, crop_cycle_id, f"{dia}T09:00:00+00:00")
    post_harvest(client, cell_id, crop_cycle_id, actual_yield_kg=5.0, actual_boxes=1)

    entries = client.get(f"/api/v1/cells/{cell_id}/performance").json()["entries"]

    assert len(entries) == 3
    assert all(entry["actual_yield_kg"] == 5.0 for entry in entries)


def test_performance_of_missing_cell_returns_404(client):
    assert client.get(f"/api/v1/cells/{MISSING_ID}/performance").status_code == 404


def test_performance_without_any_prediction_returns_404(client, cell_id):
    """Sin predicciones no hay ciclo que evaluar ni forma de saber el ciclo."""
    assert client.get(f"/api/v1/cells/{cell_id}/performance").status_code == 404


# --- El contrato celda <-> ciclo en /performance ------------------------------
#
# Antes, `crop_cycle_id` era un filtro SQL y nada mas: no se cargaba el ciclo,
# asi que un ciclo de otro lote —o uno que no existia— devolvia 200 con la lista
# vacia y el UUID pedido devuelto como propio. Tres preguntas distintas con la
# misma respuesta. `docs/api.md` promete 404 y 409 para toda la API, y el resto
# de endpoints lo cumplia; este no.


def test_performance_with_mismatched_cycle_returns_409(
    client, cell_in_other_plot, crop_cycle_id
):
    response = client.get(
        f"/api/v1/cells/{cell_in_other_plot['id']}/performance",
        params={"crop_cycle_id": str(crop_cycle_id)},
    )

    assert response.status_code == 409
    assert cell_in_other_plot["cell_code"] in response.json()["detail"]


def test_performance_with_missing_cycle_returns_404(client, cell_id):
    response = client.get(
        f"/api/v1/cells/{cell_id}/performance", params={"crop_cycle_id": MISSING_ID}
    )

    assert response.status_code == 404
    # Y no devuelve como propio un ciclo que no existe: antes la respuesta
    # traia `crop_cycle_id` con el UUID pedido, tal cual, y `entries: []`.
    assert "crop_cycle_id" not in response.json()


def test_performance_and_prediction_agree_on_a_foreign_cycle(
    client, cell_in_other_plot, crop_cycle_id
):
    """EL TEST DE C3: leer y escribir el mismo par incoherente contestan lo mismo.

    Si divergen, un cliente puede creer que un ciclo es valido para una celda
    porque la lectura no protesta, y estrellarse al escribir.
    """
    par = {"cell_id": str(cell_in_other_plot["id"]), "crop_cycle_id": str(crop_cycle_id)}

    leer = client.get(f"/api/v1/cells/{par['cell_id']}/performance", params=par)
    escribir = client.post("/api/v1/predictions", json=par)

    assert leer.status_code == escribir.status_code == 409


def test_performance_of_a_valid_cycle_without_predictions_is_an_empty_list(
    client, cell_id, crop_cycle_id
):
    """La verificacion no puede convertir 'todavia nada' en un error.

    Ninguna prediccion es una respuesta, no un fallo: el ciclo existe, es de
    este lote, y CERES aun no ha hablado de esta celda.
    """
    response = client.get(
        f"/api/v1/cells/{cell_id}/performance", params={"crop_cycle_id": str(crop_cycle_id)}
    )

    assert response.status_code == 200
    assert response.json()["entries"] == []
    assert response.json()["crop_cycle_id"] == str(crop_cycle_id)


# El otro lector por celda tenia el mismo defecto, linea a linea. Arreglar solo
# `/performance` habria dejado a los dos lectores discrepando entre si.


def test_prediction_list_with_mismatched_cycle_returns_409(
    client, cell_in_other_plot, crop_cycle_id
):
    response = client.get(
        f"/api/v1/cells/{cell_in_other_plot['id']}/predictions",
        params={"crop_cycle_id": str(crop_cycle_id)},
    )

    assert response.status_code == 409
    assert cell_in_other_plot["cell_code"] in response.json()["detail"]


def test_prediction_list_with_missing_cycle_returns_404(client, cell_id):
    response = client.get(
        f"/api/v1/cells/{cell_id}/predictions", params={"crop_cycle_id": MISSING_ID}
    )

    assert response.status_code == 404


def test_the_two_cell_readers_agree_on_a_foreign_cycle(
    client, cell_in_other_plot, crop_cycle_id
):
    """`/predictions` y `/performance` de una celda contestan lo mismo al mismo par."""
    params = {"crop_cycle_id": str(crop_cycle_id)}
    base = f"/api/v1/cells/{cell_in_other_plot['id']}"

    historial = client.get(f"{base}/predictions", params=params)
    rendimiento = client.get(f"{base}/performance", params=params)

    assert historial.status_code == rendimiento.status_code == 409


def test_prediction_list_of_a_valid_cycle_without_predictions_is_empty(
    client, cell_id, crop_cycle_id
):
    response = client.get(
        f"/api/v1/cells/{cell_id}/predictions", params={"crop_cycle_id": str(crop_cycle_id)}
    )

    assert response.status_code == 200
    assert response.json()["predictions"] == []
