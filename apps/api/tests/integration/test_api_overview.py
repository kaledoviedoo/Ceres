"""Tests de los endpoints que alimentan el frontend (fase 5).

`GET /plots/{id}/crop-cycles` y `GET /plots/{id}/overview` existen porque sin
ellos el frontend no podria ni pedir una prediccion (falta el crop_cycle_id) ni
colorear la malla sin recalcular agricultura en TypeScript.
"""

from __future__ import annotations

from sqlalchemy import func, select

from app.models import Prediction

MISSING_ID = "00000000-0000-0000-0000-000000000000"


# --- Ciclos de cultivo de un lote ---------------------------------------------


def test_list_crop_cycles_of_a_plot(client, plot_a_id, crop_cycle_id):
    response = client.get(f"/api/v1/plots/{plot_a_id}/crop-cycles")

    assert response.status_code == 200
    cycles = response.json()
    assert len(cycles) == 1
    assert cycles[0]["id"] == str(crop_cycle_id)


def test_crop_cycle_embeds_the_crop_parameters(client, plot_a_id):
    """El frontend necesita box_capacity_kg para mostrar cajas sin calcularlas."""
    cycle = client.get(f"/api/v1/plots/{plot_a_id}/crop-cycles").json()[0]

    assert cycle["crop"]["slug"] == "tomato"
    assert cycle["crop"]["box_capacity_kg"] == 6.0


def test_plot_without_cycles_returns_empty_list(client, other_plot_id):
    """Un lote sin ciclo devuelve lista vacia, no 404."""
    response = client.get(f"/api/v1/plots/{other_plot_id}/crop-cycles")

    assert response.status_code == 200
    assert response.json() == []


def test_crop_cycles_of_missing_plot_returns_404(client):
    assert client.get(f"/api/v1/plots/{MISSING_ID}/crop-cycles").status_code == 404


# --- Vista general del lote ---------------------------------------------------


def test_overview_returns_every_cell(client, plot_a_id, crop_cycle_id):
    response = client.get(
        f"/api/v1/plots/{plot_a_id}/overview", params={"crop_cycle_id": str(crop_cycle_id)}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["grid_width"] == 20
    assert body["grid_height"] == 20
    assert len(body["cells"]) == 400
    assert body["model_version"] == "rule-based-v0.1"


def test_overview_cells_are_ordered_by_row(client, plot_a_id, crop_cycle_id):
    cells = client.get(
        f"/api/v1/plots/{plot_a_id}/overview", params={"crop_cycle_id": str(crop_cycle_id)}
    ).json()["cells"]

    assert (cells[0]["x"], cells[0]["y"]) == (0, 0)
    assert (cells[-1]["x"], cells[-1]["y"]) == (19, 19)


def test_overview_carries_the_three_risk_levels(client, plot_a_id, crop_cycle_id):
    """Sin los tres niveles la malla no podria mostrar sus tres colores."""
    cells = client.get(
        f"/api/v1/plots/{plot_a_id}/overview", params={"crop_cycle_id": str(crop_cycle_id)}
    ).json()["cells"]

    assert {cell["risk_level"] for cell in cells} == {"low", "medium", "high"}


def test_overview_does_not_persist_anything(client, session, plot_a_id, crop_cycle_id):
    """La regla central de este endpoint: colorear no ensucia el historico."""
    before = session.scalar(select(func.count()).select_from(Prediction))

    client.get(
        f"/api/v1/plots/{plot_a_id}/overview", params={"crop_cycle_id": str(crop_cycle_id)}
    )

    after = session.scalar(select(func.count()).select_from(Prediction))
    assert before == after == 0


def test_overview_declares_that_it_is_not_persisted(client, plot_a_id, crop_cycle_id):
    """El aviso viaja en el contrato, no solo en la documentacion."""
    body = client.get(
        f"/api/v1/plots/{plot_a_id}/overview", params={"crop_cycle_id": str(crop_cycle_id)}
    ).json()

    assert body["persisted"] is False
    assert all("id" not in cell for cell in body["cells"])


def test_overview_matches_a_persisted_prediction_for_the_same_cell(
    client, plot_a_id, crop_cycle_id, cell_id
):
    """El color de la malla y el numero del panel tienen que coincidir."""
    overview = client.get(
        f"/api/v1/plots/{plot_a_id}/overview", params={"crop_cycle_id": str(crop_cycle_id)}
    ).json()
    from_grid = next(c for c in overview["cells"] if c["cell_id"] == str(cell_id))

    persisted = client.post(
        "/api/v1/predictions",
        json={"cell_id": str(cell_id), "crop_cycle_id": str(crop_cycle_id)},
    ).json()

    assert from_grid["projected_yield_kg"] == persisted["projected_yield_kg"]
    assert from_grid["risk_score"] == persisted["risk_score"]
    assert from_grid["risk_level"] == persisted["risk_level"]
    assert from_grid["projected_boxes"] == persisted["projected_boxes"]


def test_overview_requires_a_crop_cycle(client, plot_a_id):
    assert client.get(f"/api/v1/plots/{plot_a_id}/overview").status_code == 422


def test_overview_of_missing_plot_returns_404(client, crop_cycle_id):
    response = client.get(
        f"/api/v1/plots/{MISSING_ID}/overview", params={"crop_cycle_id": str(crop_cycle_id)}
    )
    assert response.status_code == 404


def test_overview_with_a_cycle_from_another_plot_returns_409(
    client, other_plot_id, crop_cycle_id
):
    response = client.get(
        f"/api/v1/plots/{other_plot_id}/overview", params={"crop_cycle_id": str(crop_cycle_id)}
    )
    assert response.status_code == 409
