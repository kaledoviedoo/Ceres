"""Tests de la formula de riesgo (fase 3).

    risk_score = 0.45*(1-sanidad) + 0.30*(1-suelo) + 0.25*pendiente_norm
"""

from __future__ import annotations

import pytest

from app.core.prediction.features import NormalizedFeatures
from app.core.prediction.risk import (
    HEALTH_WEIGHT,
    SLOPE_WEIGHT,
    SOIL_WEIGHT,
    classify_risk,
    compute_risk_score,
)
from app.domain.enums import RiskLevel


def features(slope_norm=0.0, soil_quality=1.0, health=1.0, density_ratio=1.0):
    return NormalizedFeatures(
        slope_norm=slope_norm,
        soil_quality=soil_quality,
        health=health,
        density_ratio=density_ratio,
    )


def test_weights_sum_to_one():
    """Es lo que garantiza que el score caiga en 0..1 sin necesidad de recortar."""
    assert HEALTH_WEIGHT + SOIL_WEIGHT + SLOPE_WEIGHT == pytest.approx(1.0)


def test_perfect_cell_has_zero_risk():
    assert compute_risk_score(features()) == pytest.approx(0.0)


def test_worst_cell_has_maximum_risk():
    worst = features(slope_norm=1.0, soil_quality=0.0, health=0.0)

    assert compute_risk_score(worst) == pytest.approx(1.0)


@pytest.mark.parametrize(
    ("kwargs", "expected"),
    [
        ({"health": 0.0}, HEALTH_WEIGHT),
        ({"soil_quality": 0.0}, SOIL_WEIGHT),
        ({"slope_norm": 1.0}, SLOPE_WEIGHT),
    ],
)
def test_each_factor_contributes_its_weight(kwargs, expected):
    assert compute_risk_score(features(**kwargs)) == pytest.approx(expected)


def test_health_weighs_more_than_soil_and_soil_more_than_slope():
    """La sanidad es lo accionable; el terreno es una condicion fija."""
    health_risk = compute_risk_score(features(health=0.0))
    soil_risk = compute_risk_score(features(soil_quality=0.0))
    slope_risk = compute_risk_score(features(slope_norm=1.0))

    assert health_risk > soil_risk > slope_risk


@pytest.mark.parametrize("slope_norm", [0.0, 0.5, 1.0])
@pytest.mark.parametrize("health", [0.0, 0.5, 1.0])
@pytest.mark.parametrize("soil_quality", [0.0, 0.5, 1.0])
def test_risk_is_always_within_bounds(slope_norm, health, soil_quality):
    value = compute_risk_score(
        features(slope_norm=slope_norm, health=health, soil_quality=soil_quality)
    )

    assert 0.0 <= value <= 1.0


@pytest.mark.parametrize(
    ("score", "expected"),
    [
        (0.0, RiskLevel.LOW),
        (0.32, RiskLevel.LOW),
        (0.33, RiskLevel.MEDIUM),
        (0.65, RiskLevel.MEDIUM),
        (0.66, RiskLevel.HIGH),
        (1.0, RiskLevel.HIGH),
    ],
)
def test_classification_matches_the_domain_thresholds(score, expected):
    assert classify_risk(score) is expected


def test_risk_is_monotonic_in_health():
    values = [compute_risk_score(features(health=h)) for h in (1.0, 0.75, 0.5, 0.25, 0.0)]

    assert values == sorted(values)
