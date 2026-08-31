"""El motor ejecutado sobre las 400 celdas reales del dataset sintetico.

Los tests con celdas fabricadas comprueban las formulas; estos comprueban que el
motor sobrevive a los datos que realmente va a recibir. Sigue sin tocar la base
de datos: el dataset se construye en memoria.
"""

from __future__ import annotations

import pytest

from app.core.prediction import CropParameters, PredictionInput, predict_from_input
from app.core.synthetic.demo import build_demo_dataset
from app.domain.enums import RiskLevel


@pytest.fixture(scope="module")
def dataset():
    return build_demo_dataset()


@pytest.fixture(scope="module")
def crop(dataset):
    row = dataset.table("crops").rows[0]
    return CropParameters(
        slug=row["slug"],
        base_yield_kg_per_m2=row["base_yield_kg_per_m2"],
        box_capacity_kg=row["box_capacity_kg"],
        optimal_plant_density_per_m2=row["optimal_plant_density_per_m2"],
    )


@pytest.fixture(scope="module")
def plot_a_cells(dataset):
    plot_a_id = dataset.table("plots").rows[0]["id"]
    return [cell for cell in dataset.table("grid_cells").rows if cell["plot_id"] == plot_a_id]


def to_input(cell: dict, crop: CropParameters) -> PredictionInput:
    return PredictionInput(
        cell_id=cell["id"],
        cell_code=cell["cell_code"],
        area_m2=1.0,
        elevation_m=cell["elevation_m"],
        slope_deg=cell["slope_deg"],
        soil_quality=cell["soil_quality"],
        plant_density=cell["plant_density"],
        health_factor=cell["health_factor"],
        base_yield_factor=cell["base_yield_factor"],
        crop=crop,
    )


@pytest.fixture(scope="module")
def predictions(plot_a_cells, crop):
    return [predict_from_input(to_input(cell, crop)) for cell in plot_a_cells]


def test_every_cell_of_the_plot_predicts_successfully(predictions):
    assert len(predictions) == 400


def test_no_prediction_violates_its_invariants(predictions):
    for result in predictions:
        assert result.projected_yield_kg >= 0
        assert result.projected_boxes >= 0
        assert 0.0 <= result.estimated_loss_percentage <= 100.0
        assert 0.0 <= result.risk_score <= 1.0
        assert result.model_version == "rule-based-v0.1"


def test_predictions_are_deterministic_over_the_whole_plot(plot_a_cells, crop, predictions):
    again = [predict_from_input(to_input(cell, crop)) for cell in plot_a_cells]

    assert [r.to_payload() for r in again] == [r.to_payload() for r in predictions]


def test_the_plot_shows_real_variation(predictions):
    """Si el motor devolviera casi lo mismo en las 400 celdas, el mapa seria inutil."""
    yields = [r.projected_yield_kg for r in predictions]

    assert max(yields) > min(yields) * 1.5


def test_west_is_riskier_than_east(plot_a_cells, crop):
    """El foco de estres sintetico esta al oeste; el motor debe reflejarlo."""
    west = [c for c in plot_a_cells if c["x"] < 5]
    east = [c for c in plot_a_cells if c["x"] >= 15]

    west_risk = sum(predict_from_input(to_input(c, crop)).risk_score for c in west) / len(west)
    east_risk = sum(predict_from_input(to_input(c, crop)).risk_score for c in east) / len(east)

    assert west_risk > east_risk


def test_ranking_by_yield_is_coherent_with_the_cell_state(plot_a_cells, crop):
    """La celda de mayor rendimiento debe estar mas sana que la de menor."""
    ranked = sorted(
        plot_a_cells, key=lambda c: predict_from_input(to_input(c, crop)).projected_yield_kg
    )
    worst, best = ranked[0], ranked[-1]

    assert best["health_factor"] > worst["health_factor"]
    assert best["soil_quality"] > worst["soil_quality"]


def test_dataset_produces_the_three_risk_levels(predictions):
    """Los tres niveles, no dos.

    Hasta la fase 4.6 el dataset no llegaba a `high` y esta asercion solo pedia
    dos niveles. La zona critica sintetica cerro ese hueco; ver
    tests/unit/test_dataset_integrity.py y docs/synthetic-data.md.
    """
    levels = {result.risk_level for result in predictions}

    assert levels == {RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH}
