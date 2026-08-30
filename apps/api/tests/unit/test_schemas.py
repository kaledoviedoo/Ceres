"""Tests del contrato de API (fase 1).

Verifican que los schemas rechacen valores imposibles antes de que lleguen a la
base de datos, y que los campos derivados se calculen en un solo sitio.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

import pytest
from pydantic import ValidationError

from app.core.prediction import MODEL_VERSION
from app.domain.enums import ObservationType, RiskLevel
from app.schemas import (
    HarvestRead,
    ObservationCreate,
    PlotRead,
    PredictionRead,
)


def _prediction_payload(**overrides):
    payload = {
        "id": uuid.uuid4(),
        "cell_id": uuid.uuid4(),
        "crop_cycle_id": uuid.uuid4(),
        "model_version": MODEL_VERSION,
        "projected_yield_kg": 18.4,
        "projected_boxes": 4,
        "estimated_loss_percentage": 7.8,
        "risk_score": 0.21,
        "risk_level": RiskLevel.LOW,
        "factors": {
            "density_factor": 0.95,
            "soil_factor": 1.10,
            "health_factor": 0.85,
            "terrain_factor": 0.92,
            "base_yield_factor": 1.0,
        },
        "created_at": datetime.now(timezone.utc),
    }
    payload.update(overrides)
    return payload


def test_prediction_derives_tons_from_kg():
    prediction = PredictionRead(**_prediction_payload())
    assert prediction.projected_yield_tons == pytest.approx(0.0184)


def test_prediction_carries_model_version():
    prediction = PredictionRead(**_prediction_payload())
    assert prediction.model_version == "rule-based-v0.1"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("projected_yield_kg", -1.0),
        ("projected_boxes", -1),
        ("estimated_loss_percentage", 101.0),
        ("estimated_loss_percentage", -0.1),
        ("risk_score", 1.5),
    ],
)
def test_prediction_rejects_impossible_values(field: str, value):
    with pytest.raises(ValidationError):
        PredictionRead(**_prediction_payload(**{field: value}))


def test_plot_derives_cell_count_and_area():
    plot = PlotRead(
        id=uuid.uuid4(),
        farm_id=uuid.uuid4(),
        name="Plot A",
        code="A",
        grid_width=20,
        grid_height=20,
        cell_size_m=1.0,
        origin_latitude=5.6,
        origin_longitude=-73.5,
        created_at=datetime.now(timezone.utc),
    )
    assert plot.cell_count == 400
    assert plot.area_m2 == pytest.approx(400.0)


def test_observation_severity_is_bounded():
    with pytest.raises(ValidationError):
        ObservationCreate(
            cell_id=uuid.uuid4(),
            type=ObservationType.PEST,
            severity=1.4,
        )


def test_observation_rejects_unknown_fields():
    """extra='forbid' evita que el frontend mande campos que el backend ignora."""
    with pytest.raises(ValidationError):
        ObservationCreate(
            cell_id=uuid.uuid4(),
            type=ObservationType.PEST,
            severity=0.5,
            unexpected_field="boom",
        )


def test_harvest_derives_tons():
    harvest = HarvestRead(
        id=uuid.uuid4(),
        cell_id=uuid.uuid4(),
        crop_cycle_id=uuid.uuid4(),
        actual_yield_kg=16.2,
        actual_boxes=3,
        harvested_at=date(2026, 6, 20),
        created_at=datetime.now(timezone.utc),
    )
    assert harvest.actual_yield_tons == pytest.approx(0.0162)


# --- Compatibilidad entre el motor (fase 3) y el contrato de API (fase 1) -----


def test_engine_output_fits_the_api_schema():
    """Todo PredictionResult del motor debe poder serializarse como PredictionRead."""
    from app.core.prediction import predict
    from tests.factories import AVERAGE_CELL, OPTIMAL_CELL, POOR_CELL, FakeCrop

    for cell in (OPTIMAL_CELL, AVERAGE_CELL, POOR_CELL):
        result = predict(cell, FakeCrop())
        schema = PredictionRead(
            **_prediction_payload(
                projected_yield_kg=result.projected_yield_kg,
                projected_boxes=result.projected_boxes,
                estimated_loss_percentage=result.estimated_loss_percentage,
                risk_score=result.risk_score,
                risk_level=result.risk_level,
                factors=result.factors.as_dict(),
            )
        )
        assert schema.projected_yield_kg == result.projected_yield_kg


def test_schema_accepts_zero_health_and_density_factors():
    """Una celda con el cultivo muerto produce factores 0: no puede rechazarse."""
    from app.core.prediction import predict
    from tests.factories import FakeCrop, make_cell

    result = predict(make_cell(health_factor=0.0, plant_density=0.0), FakeCrop())
    assert result.projected_yield_kg == 0.0

    schema = PredictionRead(
        **_prediction_payload(
            projected_yield_kg=0.0,
            projected_boxes=0,
            estimated_loss_percentage=result.estimated_loss_percentage,
            risk_score=result.risk_score,
            risk_level=result.risk_level,
            factors=result.factors.as_dict(),
        )
    )
    assert schema.factors.health_factor == 0.0
    assert schema.factors.density_factor == 0.0
