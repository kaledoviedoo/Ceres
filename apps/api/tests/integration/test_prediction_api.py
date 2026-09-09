"""Tests de integracion del endpoint de predicciones.

El nucleo de la fase 4: que HTTP -> servicio -> motor -> base de datos funcione
de extremo a extremo, y que el servidor sea la unica fuente de verdad.
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select

from app.core.prediction import (
    MODEL_VERSION,
    CropParameters,
    PredictionInput,
    predict_from_input,
)
from app.models import Prediction

MISSING_ID = "00000000-0000-0000-0000-000000000000"


def create(client, cell_id, crop_cycle_id):
    return client.post(
        "/api/v1/predictions",
        json={"cell_id": str(cell_id), "crop_cycle_id": str(crop_cycle_id)},
    )


# --- Creacion -----------------------------------------------------------------


def test_create_prediction_returns_201_and_a_full_result(client, cell_id, crop_cycle_id):
    response = create(client, cell_id, crop_cycle_id)

    assert response.status_code == 201
    body = response.json()
    for key in (
        "id",
        "cell_id",
        "crop_cycle_id",
        "model_version",
        "projected_yield_kg",
        "projected_yield_tons",
        "projected_boxes",
        "estimated_loss_percentage",
        "risk_score",
        "risk_level",
        "factors",
        "created_at",
    ):
        assert key in body


def test_prediction_respects_the_domain_ranges(client, cell_id, crop_cycle_id):
    body = create(client, cell_id, crop_cycle_id).json()

    assert body["projected_yield_kg"] >= 0
    assert body["projected_boxes"] >= 0
    assert 0 <= body["estimated_loss_percentage"] <= 100
    assert 0 <= body["risk_score"] <= 1
    assert body["risk_level"] in {"low", "medium", "high"}
    # Version COMPUESTA: motor + modelo de impacto. Una prediccion guardada pasa
    # por los dos —el estado se deriva de las observaciones antes de predecir—,
    # asi que las dos versiones tienen que quedar registradas. `/health` y
    # `/overview` siguen dando la del motor a secas porque ahi no interviene
    # ninguna derivacion de estado.
    assert body["model_version"] == "rule-based-v0.1+impact-v0"
    assert body["model_version"].startswith(MODEL_VERSION)


def test_prediction_exposes_the_five_explanatory_factors(client, cell_id, crop_cycle_id):
    factors = create(client, cell_id, crop_cycle_id).json()["factors"]

    assert set(factors) == {
        "density_factor",
        "soil_factor",
        "health_factor",
        "terrain_factor",
        "base_yield_factor",
    }


# --- El endpoint usa realmente el motor ---------------------------------------


def test_endpoint_result_matches_the_engine_run_directly(client, cell, crop_cycle_id, demo_dataset):
    """La API no recalcula ni aproxima: devuelve exactamente lo que da predict()."""
    crop_row = demo_dataset.table("crops").rows[0]
    expected = predict_from_input(
        PredictionInput(
            cell_id=cell["id"],
            cell_code=cell["cell_code"],
            area_m2=1.0,
            elevation_m=cell["elevation_m"],
            slope_deg=cell["slope_deg"],
            soil_quality=cell["soil_quality"],
            plant_density=cell["plant_density"],
            health_factor=cell["health_factor"],
            base_yield_factor=cell["base_yield_factor"],
            crop=CropParameters(
                slug=crop_row["slug"],
                base_yield_kg_per_m2=crop_row["base_yield_kg_per_m2"],
                box_capacity_kg=crop_row["box_capacity_kg"],
                optimal_plant_density_per_m2=crop_row["optimal_plant_density_per_m2"],
            ),
        )
    )

    body = create(client, cell["id"], crop_cycle_id).json()

    assert body["projected_yield_kg"] == expected.projected_yield_kg
    assert body["projected_boxes"] == expected.projected_boxes
    assert body["estimated_loss_percentage"] == expected.estimated_loss_percentage
    assert body["risk_score"] == expected.risk_score
    assert body["risk_level"] == expected.risk_level.value
    assert body["factors"] == expected.factors.as_dict()


def test_prediction_is_deterministic_across_requests(client, cell_id, crop_cycle_id):
    first = create(client, cell_id, crop_cycle_id).json()
    second = create(client, cell_id, crop_cycle_id).json()

    assert first["projected_yield_kg"] == second["projected_yield_kg"]
    assert first["risk_score"] == second["risk_score"]
    assert first["id"] != second["id"]  # pero son filas distintas


def test_different_cells_predict_differently(client, demo_dataset, plot_a_id, crop_cycle_id):
    cells = [c for c in demo_dataset.table("grid_cells").rows if c["plot_id"] == plot_a_id]
    healthiest = max(cells, key=lambda c: c["health_factor"])
    sickest = min(cells, key=lambda c: c["health_factor"])

    good = create(client, healthiest["id"], crop_cycle_id).json()
    bad = create(client, sickest["id"], crop_cycle_id).json()

    assert good["projected_yield_kg"] > bad["projected_yield_kg"]
    assert good["risk_score"] < bad["risk_score"]


# --- Persistencia e inmutabilidad ---------------------------------------------


def test_prediction_is_persisted(client, session, cell_id, crop_cycle_id):
    body = create(client, cell_id, crop_cycle_id).json()

    stored = session.get(Prediction, uuid.UUID(body["id"]))
    assert stored is not None
    assert stored.projected_yield_kg == body["projected_yield_kg"]
    assert stored.model_version == "rule-based-v0.1+impact-v0"


def test_each_call_adds_a_new_row_instead_of_overwriting(
    client, session, cell_id, crop_cycle_id
):
    ids = [create(client, cell_id, crop_cycle_id).json()["id"] for _ in range(3)]

    assert len(set(ids)) == 3

    stored = session.scalar(
        select(func.count()).select_from(Prediction).where(Prediction.cell_id == cell_id)
    )
    assert stored == 3


def test_history_endpoint_returns_every_prediction_newest_first(
    client, cell_id, crop_cycle_id
):
    for _ in range(3):
        create(client, cell_id, crop_cycle_id)

    response = client.get(f"/api/v1/cells/{cell_id}/predictions")

    assert response.status_code == 200
    body = response.json()
    assert body["cell_id"] == str(cell_id)
    assert len(body["predictions"]) == 3

    timestamps = [p["created_at"] for p in body["predictions"]]
    assert timestamps == sorted(timestamps, reverse=True)


def test_no_update_or_delete_route_exists_for_predictions(client):
    """La inmutabilidad empieza por no ofrecer la operacion."""
    paths = client.get("/openapi.json").json()["paths"]

    assert set(paths["/api/v1/predictions"]) == {"post"}
    assert "/api/v1/predictions/{prediction_id}" not in paths


def test_inputs_snapshot_is_stored(client, session, cell, crop_cycle_id):
    body = create(client, cell["id"], crop_cycle_id).json()

    stored = session.get(Prediction, uuid.UUID(body["id"]))
    assert stored.inputs["soil_quality"] == cell["soil_quality"]
    assert stored.inputs["cell_code"] == cell["cell_code"]


# --- El servidor es la fuente de verdad ---------------------------------------


def test_client_cannot_send_agronomic_values(client, cell_id, crop_cycle_id):
    """Enviar soil_quality, health_factor o risk_score debe rechazarse."""
    for forbidden in (
        {"soil_quality": 1.0},
        {"health_factor": 1.0},
        {"slope_deg": 0.0},
        {"projected_yield_kg": 9999.0},
        {"risk_score": 0.0},
        {"model_version": "hacked-v9"},
    ):
        response = client.post(
            "/api/v1/predictions",
            json={
                "cell_id": str(cell_id),
                "crop_cycle_id": str(crop_cycle_id),
                **forbidden,
            },
        )
        assert response.status_code == 422, f"{forbidden} deberia rechazarse"


def test_request_requires_both_identifiers(client, cell_id):
    assert client.post("/api/v1/predictions", json={}).status_code == 422
    assert (
        client.post("/api/v1/predictions", json={"cell_id": str(cell_id)}).status_code == 422
    )


# --- Errores ------------------------------------------------------------------


def test_missing_cell_returns_404(client, crop_cycle_id):
    response = create(client, MISSING_ID, crop_cycle_id)

    assert response.status_code == 404
    assert "Cell" in response.json()["detail"]


def test_missing_crop_cycle_returns_404(client, cell_id):
    response = create(client, cell_id, MISSING_ID)

    assert response.status_code == 404
    assert "CropCycle" in response.json()["detail"]


def test_cell_from_another_plot_returns_409(client, cell_in_other_plot, crop_cycle_id):
    """No tiene sentido predecir una celda de Plot B bajo un ciclo de Plot A."""
    response = create(client, cell_in_other_plot["id"], crop_cycle_id)

    assert response.status_code == 409
    assert "lote" in response.json()["detail"]


def test_history_of_missing_cell_returns_404(client):
    assert client.get(f"/api/v1/cells/{MISSING_ID}/predictions").status_code == 404


def test_history_is_empty_before_any_prediction(client, cell_id):
    body = client.get(f"/api/v1/cells/{cell_id}/predictions").json()

    assert body["predictions"] == []
