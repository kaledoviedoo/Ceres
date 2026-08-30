"""Tests del motor de prediccion (fase 3).

Cubren el contrato completo: invariantes de rango, determinismo, explicabilidad
y coherencia entre celdas distintas.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.prediction import (
    MODEL_VERSION,
    CropParameters,
    PredictionInput,
    build_prediction_input,
    predict,
    predict_from_input,
)
from app.core.prediction.yield_model import DENSITY_FACTOR_CAP
from app.domain.enums import RiskLevel
from tests.factories import (
    AVERAGE_CELL,
    OPTIMAL_CELL,
    POOR_CELL,
    TOMATO_BASE_YIELD_KG_PER_M2,
    TOMATO_BOX_CAPACITY_KG,
    TOMATO_OPTIMAL_DENSITY,
    FakeCrop,
    make_cell,
)

CROP = FakeCrop()


# --- Invariantes que debe cumplir cualquier prediccion ------------------------


@pytest.mark.parametrize("cell", [OPTIMAL_CELL, AVERAGE_CELL, POOR_CELL])
def test_output_always_respects_domain_ranges(cell):
    result = predict(cell, CROP)

    assert result.projected_yield_kg >= 0
    assert result.projected_boxes >= 0
    assert 0.0 <= result.estimated_loss_percentage <= 100.0
    assert 0.0 <= result.risk_score <= 1.0
    assert result.risk_level in set(RiskLevel)


@pytest.mark.parametrize("cell", [OPTIMAL_CELL, AVERAGE_CELL, POOR_CELL])
def test_result_carries_model_version(cell):
    assert predict(cell, CROP).model_version == "rule-based-v0.1"
    assert MODEL_VERSION == "rule-based-v0.1"


@pytest.mark.parametrize("cell", [OPTIMAL_CELL, AVERAGE_CELL, POOR_CELL])
def test_tons_are_consistent_with_kg(cell):
    result = predict(cell, CROP)
    assert result.projected_yield_tons == pytest.approx(result.projected_yield_kg / 1000)


# --- Celda optima -------------------------------------------------------------


def test_optimal_cell_reaches_the_crop_potential():
    """Todos los factores neutros o maximos: el rendimiento es el potencial x 1.2.

    soil_factor = 0.70 + 0.50*1.0 = 1.20; el resto de factores valen 1.0.
    """
    result = predict(OPTIMAL_CELL, CROP)

    assert result.projected_yield_kg == pytest.approx(TOMATO_BASE_YIELD_KG_PER_M2 * 1.20)
    assert result.factors.density_factor == pytest.approx(1.0)
    assert result.factors.soil_factor == pytest.approx(1.20)
    assert result.factors.health_factor == pytest.approx(1.0)
    assert result.factors.terrain_factor == pytest.approx(1.0)


def test_optimal_cell_has_minimum_loss_and_risk():
    result = predict(OPTIMAL_CELL, CROP)

    # Solo queda la perdida base inevitable.
    assert result.estimated_loss_percentage == pytest.approx(3.0)
    assert result.risk_score == pytest.approx(0.0)
    assert result.risk_level is RiskLevel.LOW


# --- Celda deficiente ---------------------------------------------------------


def test_poor_cell_yields_far_less_than_optimal():
    poor = predict(POOR_CELL, CROP)
    optimal = predict(OPTIMAL_CELL, CROP)

    assert poor.projected_yield_kg < optimal.projected_yield_kg / 10


def test_poor_cell_is_high_risk():
    result = predict(POOR_CELL, CROP)

    assert result.risk_level is RiskLevel.HIGH
    assert result.risk_score > 0.66


def test_poor_cell_loss_stays_within_bounds():
    result = predict(POOR_CELL, CROP)

    # 3 base + 12 terreno + 25*0.95 sanidad + 10 suelo = 48.75
    assert result.estimated_loss_percentage == pytest.approx(48.75)
    assert result.estimated_loss_percentage <= 100.0


# --- Densidad -----------------------------------------------------------------


def test_low_density_reduces_yield_proportionally():
    half = make_cell(plant_density=TOMATO_OPTIMAL_DENSITY / 2)
    full = make_cell(plant_density=TOMATO_OPTIMAL_DENSITY)

    assert predict(half, CROP).factors.density_factor == pytest.approx(0.5)
    assert predict(half, CROP).projected_yield_kg == pytest.approx(
        predict(full, CROP).projected_yield_kg / 2
    )


def test_high_density_is_capped():
    """Sembrar el triple no triplica la cosecha: las plantas compiten."""
    overplanted = make_cell(plant_density=TOMATO_OPTIMAL_DENSITY * 3)
    result = predict(overplanted, CROP)

    assert result.factors.density_factor == pytest.approx(DENSITY_FACTOR_CAP)


def test_zero_density_produces_zero_yield():
    result = predict(make_cell(plant_density=0.0), CROP)

    assert result.projected_yield_kg == 0.0
    assert result.projected_boxes == 0


# --- Terreno: elevacion y pendiente -------------------------------------------


def test_elevation_alone_does_not_change_the_prediction():
    """La elevacion no entra en ninguna formula: solo la pendiente derivada."""
    low = predict(make_cell(elevation_m=800.0), CROP)
    high = predict(make_cell(elevation_m=2800.0), CROP)

    assert low.projected_yield_kg == high.projected_yield_kg
    assert low.risk_score == high.risk_score


def test_steep_slope_reduces_yield_and_raises_risk():
    flat = predict(make_cell(slope_deg=0.0), CROP)
    steep = predict(make_cell(slope_deg=15.0), CROP)

    assert steep.factors.terrain_factor == pytest.approx(0.75)
    assert steep.projected_yield_kg < flat.projected_yield_kg
    assert steep.risk_score > flat.risk_score
    assert steep.estimated_loss_percentage > flat.estimated_loss_percentage


def test_slope_penalty_saturates_at_the_reference():
    """Mas alla de la pendiente de referencia el castigo no sigue creciendo."""
    at_reference = predict(make_cell(slope_deg=15.0), CROP)
    beyond = predict(make_cell(slope_deg=80.0), CROP)

    assert beyond.projected_yield_kg == at_reference.projected_yield_kg
    assert beyond.risk_score == at_reference.risk_score


# --- Sanidad ------------------------------------------------------------------


def test_low_health_dominates_the_prediction():
    healthy = predict(make_cell(health_factor=1.0), CROP)
    sick = predict(make_cell(health_factor=0.2), CROP)

    assert sick.projected_yield_kg == pytest.approx(healthy.projected_yield_kg * 0.2)
    assert sick.risk_score > healthy.risk_score
    assert sick.estimated_loss_percentage > healthy.estimated_loss_percentage


def test_dead_crop_produces_nothing():
    result = predict(make_cell(health_factor=0.0), CROP)

    assert result.projected_yield_kg == 0.0
    assert result.projected_boxes == 0


def test_health_alone_cannot_reach_high_risk():
    """Propiedad conocida del modelo v0.1, no un fallo.

    La sanidad pesa 0.45 y el umbral de riesgo alto es 0.66, asi que una celda
    con el cultivo muerto pero buen suelo y terreno plano sale MEDIUM. El
    `risk_score` mide "cuantos factores de riesgo hay presentes", no "como de
    malo es el desenlace"; el desenlace ya lo dicen `projected_yield_kg` (0) y
    `estimated_loss_percentage`.

    Si al validar contra cosechas reales resulta contraintuitivo, se corrige
    subiendo HEALTH_WEIGHT y publicando rule-based-v0.2.
    """
    dead_but_good_land = predict(make_cell(health_factor=0.0, soil_quality=1.0), CROP)

    assert dead_but_good_land.projected_yield_kg == 0.0
    assert dead_but_good_land.risk_score == pytest.approx(0.45)
    assert dead_but_good_land.risk_level is RiskLevel.MEDIUM


def test_high_risk_requires_more_than_one_bad_factor():
    unhealthy_and_poor_soil = predict(make_cell(health_factor=0.1, soil_quality=0.1), CROP)

    assert unhealthy_and_poor_soil.risk_level is RiskLevel.HIGH


# --- Cajas --------------------------------------------------------------------


def test_boxes_round_up():
    """13 kg en cajas de 6 kg son 3 cajas: la fraccion tambien necesita caja."""
    result = predict(OPTIMAL_CELL, CROP)

    expected = -(-result.projected_yield_kg // TOMATO_BOX_CAPACITY_KG)
    assert result.projected_boxes == expected
    assert result.projected_boxes * TOMATO_BOX_CAPACITY_KG >= result.projected_yield_kg


def test_boxes_scale_with_area():
    one_m2 = predict(AVERAGE_CELL, CROP, area_m2=1.0)
    ten_m2 = predict(AVERAGE_CELL, CROP, area_m2=10.0)

    assert ten_m2.projected_yield_kg == pytest.approx(one_m2.projected_yield_kg * 10)
    assert ten_m2.projected_boxes > one_m2.projected_boxes


# --- Determinismo -------------------------------------------------------------


@pytest.mark.parametrize("cell", [OPTIMAL_CELL, AVERAGE_CELL, POOR_CELL])
def test_same_input_produces_identical_output(cell):
    first = predict(cell, CROP)
    second = predict(cell, CROP)

    assert first.to_payload() == second.to_payload()


def test_engine_is_stateless_across_calls():
    """Una llamada intermedia con otra celda no altera el resultado."""
    before = predict(AVERAGE_CELL, CROP).to_payload()
    predict(POOR_CELL, CROP)
    after = predict(AVERAGE_CELL, CROP).to_payload()

    assert before == after


# --- Explicabilidad -----------------------------------------------------------


def test_factors_explain_the_result():
    """El producto de los factores por el potencial reconstruye el rendimiento."""
    result = predict(AVERAGE_CELL, CROP)

    reconstructed = TOMATO_BASE_YIELD_KG_PER_M2 * 1.0 * result.factors.combined()
    assert reconstructed == pytest.approx(result.projected_yield_kg, abs=1e-3)


def test_factors_expose_the_five_documented_multipliers():
    factors = predict(AVERAGE_CELL, CROP).factors.as_dict()

    assert set(factors) == {
        "density_factor",
        "soil_factor",
        "health_factor",
        "terrain_factor",
        "base_yield_factor",
    }
    assert all(value >= 0 for value in factors.values())


def test_payload_contains_every_required_field():
    payload = predict(AVERAGE_CELL, CROP).to_payload()

    for key in (
        "cell_id",
        "cell_code",
        "projected_yield_kg",
        "projected_yield_tons",
        "projected_boxes",
        "estimated_loss_percentage",
        "risk_score",
        "risk_level",
        "model_version",
        "factors",
    ):
        assert key in payload


def test_inputs_are_snapshotted_for_reproducibility():
    result = predict(AVERAGE_CELL, CROP)

    assert result.inputs["soil_quality"] == AVERAGE_CELL.soil_quality
    assert result.inputs["crop_slug"] == CROP.slug


# --- Coherencia entre celdas distintas ----------------------------------------


def test_better_cell_predicts_better_on_every_axis():
    """Dos celdas distintas deben ordenarse de forma coherente, no arbitraria."""
    good = predict(OPTIMAL_CELL, CROP)
    bad = predict(POOR_CELL, CROP)

    assert good.projected_yield_kg > bad.projected_yield_kg
    assert good.projected_boxes >= bad.projected_boxes
    assert good.estimated_loss_percentage < bad.estimated_loss_percentage
    assert good.risk_score < bad.risk_score


def test_ranking_of_three_cells_is_monotonic():
    good, mid, bad = (predict(c, CROP) for c in (OPTIMAL_CELL, AVERAGE_CELL, POOR_CELL))

    assert good.projected_yield_kg > mid.projected_yield_kg > bad.projected_yield_kg
    assert good.risk_score < mid.risk_score < bad.risk_score
    assert (
        good.estimated_loss_percentage
        < mid.estimated_loss_percentage
        < bad.estimated_loss_percentage
    )


def test_only_the_changed_variable_moves_the_result():
    """Aislar una variable cambia el resultado por esa via y no por otras."""
    base = predict(make_cell(soil_quality=0.5), CROP)
    better_soil = predict(make_cell(soil_quality=0.9), CROP)

    assert better_soil.projected_yield_kg > base.projected_yield_kg
    assert better_soil.factors.health_factor == base.factors.health_factor
    assert better_soil.factors.terrain_factor == base.factors.terrain_factor


# --- Entrada: validacion y empaquetado ----------------------------------------


def test_cell_id_travels_to_the_result():
    cell_id = uuid.uuid4()
    result = predict(make_cell(id=cell_id), CROP)

    assert result.cell_id == cell_id
    assert result.to_payload()["cell_id"] == str(cell_id)


def test_build_prediction_input_maps_every_field():
    prediction_input = build_prediction_input(AVERAGE_CELL, CROP, area_m2=4.0)

    assert prediction_input.cell_code == AVERAGE_CELL.cell_code
    assert prediction_input.area_m2 == 4.0
    assert prediction_input.crop.slug == CROP.slug


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("soil_quality", 1.5),
        ("soil_quality", -0.1),
        ("health_factor", 1.2),
        ("slope_deg", 95.0),
        ("plant_density", -1.0),
        ("base_yield_factor", 0.0),
        ("area_m2", 0.0),
    ],
)
def test_engine_rejects_impossible_input(field: str, value: float):
    payload = {
        "cell_code": "A-00001",
        "area_m2": 1.0,
        "elevation_m": 1180.0,
        "slope_deg": 2.0,
        "soil_quality": 0.5,
        "plant_density": 2.5,
        "health_factor": 0.8,
        "base_yield_factor": 1.0,
        "crop": CropParameters(
            slug="tomato",
            base_yield_kg_per_m2=TOMATO_BASE_YIELD_KG_PER_M2,
            box_capacity_kg=TOMATO_BOX_CAPACITY_KG,
            optimal_plant_density_per_m2=TOMATO_OPTIMAL_DENSITY,
        ),
    }
    payload[field] = value

    with pytest.raises(ValueError):
        predict_from_input(PredictionInput(**payload))


def test_engine_rejects_impossible_crop():
    with pytest.raises(ValueError):
        CropParameters(
            slug="broken",
            base_yield_kg_per_m2=12.0,
            box_capacity_kg=0.0,
            optimal_plant_density_per_m2=2.5,
        )
