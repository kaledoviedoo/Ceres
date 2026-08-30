"""Tests de integracion: endpoints de lectura.

Base de datos: SQLite en memoria (ver tests/conftest.py). Lo que se verifica es
el cableado HTTP -> servicio -> ORM -> schema de respuesta.
"""

from __future__ import annotations

import uuid

MISSING_ID = "00000000-0000-0000-0000-000000000000"


# --- Health -------------------------------------------------------------------


def test_health_reports_ok(client):
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"
    assert body["model_version"] == "rule-based-v0.1"


def test_health_carries_the_synthetic_data_disclaimer(client):
    """El aviso viaja en el contrato, no solo en la documentacion."""
    body = client.get("/api/v1/health").json()

    assert "SYNTHETIC" in body["disclaimer"].upper()
    assert "experimental" in body["disclaimer"].lower()


# --- Fincas -------------------------------------------------------------------


def test_list_farms(client, farm_id):
    response = client.get("/api/v1/farms")

    assert response.status_code == 200
    farms = response.json()
    assert len(farms) == 1
    assert farms[0]["id"] == str(farm_id)
    assert farms[0]["country"] == "CO"


def test_get_farm_includes_its_plots(client, farm_id):
    response = client.get(f"/api/v1/farms/{farm_id}")

    assert response.status_code == 200
    farm = response.json()
    assert farm["name"] == "CERES Demo Farm"
    assert len(farm["plots"]) == 2
    assert {plot["code"] for plot in farm["plots"]} == {"A", "B"}


def test_get_missing_farm_returns_404(client):
    response = client.get(f"/api/v1/farms/{MISSING_ID}")

    assert response.status_code == 404
    assert "Farm" in response.json()["detail"]


def test_malformed_uuid_returns_422(client):
    response = client.get("/api/v1/farms/not-a-uuid")

    assert response.status_code == 422


# --- Lotes --------------------------------------------------------------------


def test_get_plot_exposes_the_grid_definition(client, plot_a_id):
    response = client.get(f"/api/v1/plots/{plot_a_id}")

    assert response.status_code == 200
    plot = response.json()
    assert plot["grid_width"] == 20
    assert plot["grid_height"] == 20
    assert plot["cell_size_m"] == 1.0
    assert plot["cell_count"] == 400
    assert plot["area_m2"] == 400.0


def test_get_missing_plot_returns_404(client):
    assert client.get(f"/api/v1/plots/{MISSING_ID}").status_code == 404


# --- Celdas de un lote --------------------------------------------------------


def test_list_plot_cells_returns_the_whole_grid_at_once(client, plot_a_id):
    response = client.get(f"/api/v1/plots/{plot_a_id}/cells")

    assert response.status_code == 200
    body = response.json()
    assert body["grid_width"] == 20
    assert body["grid_height"] == 20
    assert len(body["cells"]) == 400


def test_plot_cells_are_ordered_by_row(client, plot_a_id):
    """De sur a norte y de oeste a este: el orden en que se pinta la malla."""
    cells = client.get(f"/api/v1/plots/{plot_a_id}/cells").json()["cells"]

    assert (cells[0]["x"], cells[0]["y"]) == (0, 0)
    assert (cells[1]["x"], cells[1]["y"]) == (1, 0)
    assert (cells[20]["x"], cells[20]["y"]) == (0, 1)
    assert (cells[-1]["x"], cells[-1]["y"]) == (19, 19)


def test_cell_summary_is_lean(client, plot_a_id):
    """CellSummary se multiplica por 400: no debe arrastrar campos de detalle."""
    cell = client.get(f"/api/v1/plots/{plot_a_id}/cells").json()["cells"][0]

    assert set(cell) == {
        "id",
        "cell_code",
        "x",
        "y",
        "elevation_m",
        "slope_deg",
        "soil_quality",
        "plant_density",
        "health_factor",
        "base_yield_factor",
    }


def test_list_cells_of_missing_plot_returns_404(client):
    assert client.get(f"/api/v1/plots/{MISSING_ID}/cells").status_code == 404


# --- Celda concreta -----------------------------------------------------------


def test_get_cell_returns_the_full_detail(client, cell):
    response = client.get(f"/api/v1/cells/{cell['id']}")

    assert response.status_code == 200
    body = response.json()
    assert body["cell_code"] == cell["cell_code"]
    assert body["x"] == 10 and body["y"] == 10
    assert body["centroid_latitude"] == cell["centroid_latitude"]
    assert body["plot_id"] == str(cell["plot_id"])


def test_get_missing_cell_returns_404(client):
    assert client.get(f"/api/v1/cells/{MISSING_ID}").status_code == 404


def test_cell_values_match_the_synthetic_dataset(client, cell):
    """La API no transforma los datos: los devuelve tal como se generaron."""
    body = client.get(f"/api/v1/cells/{cell['id']}").json()

    assert body["soil_quality"] == cell["soil_quality"]
    assert body["health_factor"] == cell["health_factor"]
    assert body["slope_deg"] == cell["slope_deg"]


# --- Observaciones del dataset ------------------------------------------------


def test_list_observations_of_a_cell_without_any(client, cell_id):
    response = client.get(f"/api/v1/cells/{cell_id}/observations")

    assert response.status_code == 200
    assert response.json() == []


def test_seeded_observations_are_readable(client, demo_dataset):
    seeded = demo_dataset.table("observations").rows[0]

    response = client.get(f"/api/v1/cells/{seeded['cell_id']}/observations")

    assert response.status_code == 200
    body = response.json()
    assert any(item["id"] == str(seeded["id"]) for item in body)


def test_list_observations_of_missing_cell_returns_404(client):
    assert client.get(f"/api/v1/cells/{MISSING_ID}/observations").status_code == 404


def test_openapi_document_is_generated(client):
    """Si el documento se genera, todos los response_model son coherentes."""
    response = client.get("/openapi.json")

    assert response.status_code == 200
    paths = response.json()["paths"]
    assert "/api/v1/predictions" in paths
    assert "/api/v1/cells/{cell_id}/performance" in paths


def test_uuid_fixture_is_a_real_uuid(cell_id):
    assert isinstance(cell_id, uuid.UUID)
