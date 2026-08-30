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


def post_harvest(client, cell_id, crop_cycle_id, **overrides):
    payload = {
        "cell_id": str(cell_id),
        "crop_cycle_id": str(crop_cycle_id),
        "actual_yield_kg": 16.2,
        "actual_boxes": 3,
        "harvested_at": "2026-06-20",
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
    client, cell_in_plot_b, crop_cycle_id
):
    response = post_observation(
        client, cell_in_plot_b["id"], crop_cycle_id=str(crop_cycle_id)
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


def test_harvest_with_mismatched_cycle_returns_409(client, cell_in_plot_b, crop_cycle_id):
    assert post_harvest(client, cell_in_plot_b["id"], crop_cycle_id).status_code == 409


def test_harvests_of_missing_cell_return_404(client):
    assert client.get(f"/api/v1/cells/{MISSING_ID}/harvests").status_code == 404


# --- Cierre del ciclo: prediccion vs realidad ---------------------------------


def test_performance_is_empty_of_error_before_the_harvest(client, cell_id, crop_cycle_id):
    client.post(
        "/api/v1/predictions",
        json={"cell_id": str(cell_id), "crop_cycle_id": str(crop_cycle_id)},
    )

    body = client.get(f"/api/v1/cells/{cell_id}/performance").json()

    assert len(body["entries"]) == 1
    entry = body["entries"][0]
    assert entry["actual_yield_kg"] is None
    assert entry["absolute_error_kg"] is None
    assert entry["percentage_error"] is None


def test_full_cycle_predict_harvest_compare(client, cell_id, crop_cycle_id):
    """Paso 1 a 13 del criterio de exito del MVP, sin frontend."""
    prediction = client.post(
        "/api/v1/predictions",
        json={"cell_id": str(cell_id), "crop_cycle_id": str(crop_cycle_id)},
    ).json()

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
    client.post(
        "/api/v1/predictions",
        json={"cell_id": str(cell_id), "crop_cycle_id": str(crop_cycle_id)},
    )
    post_harvest(client, cell_id, crop_cycle_id, actual_yield_kg=0.0, actual_boxes=0)

    entry = client.get(f"/api/v1/cells/{cell_id}/performance").json()["entries"][0]

    assert entry["actual_yield_kg"] == 0.0
    assert entry["absolute_error_kg"] is not None
    assert entry["percentage_error"] is None


def test_every_prediction_is_compared_against_the_same_harvest(
    client, cell_id, crop_cycle_id
):
    """El historial completo se evalua, no solo la ultima prediccion."""
    for _ in range(3):
        client.post(
            "/api/v1/predictions",
            json={"cell_id": str(cell_id), "crop_cycle_id": str(crop_cycle_id)},
        )
    post_harvest(client, cell_id, crop_cycle_id, actual_yield_kg=5.0, actual_boxes=1)

    entries = client.get(f"/api/v1/cells/{cell_id}/performance").json()["entries"]

    assert len(entries) == 3
    assert all(entry["actual_yield_kg"] == 5.0 for entry in entries)


def test_performance_of_missing_cell_returns_404(client):
    assert client.get(f"/api/v1/cells/{MISSING_ID}/performance").status_code == 404


def test_performance_without_any_prediction_returns_404(client, cell_id):
    """Sin predicciones no hay ciclo que evaluar ni forma de saber el ciclo."""
    assert client.get(f"/api/v1/cells/{cell_id}/performance").status_code == 404
