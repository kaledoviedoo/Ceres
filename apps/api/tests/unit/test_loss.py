"""Tests de la formula de perdida (fase 3).

    loss = 3 + 12*pendiente_norm + 25*(1-sanidad) + 10*(1-suelo)
"""

from __future__ import annotations

import pytest

from app.core.prediction.features import NormalizedFeatures
from app.core.prediction.loss import (
    BASE_LOSS_PCT,
    MAX_THEORETICAL_LOSS_PCT,
    compute_loss_percentage,
)


def features(slope_norm=0.0, soil_quality=1.0, health=1.0, density_ratio=1.0):
    return NormalizedFeatures(
        slope_norm=slope_norm,
        soil_quality=soil_quality,
        health=health,
        density_ratio=density_ratio,
    )


def test_perfect_cell_only_carries_base_loss():
    assert compute_loss_percentage(features()) == pytest.approx(BASE_LOSS_PCT)


def test_worst_cell_reaches_the_theoretical_maximum():
    worst = features(slope_norm=1.0, soil_quality=0.0, health=0.0)

    assert compute_loss_percentage(worst) == pytest.approx(MAX_THEORETICAL_LOSS_PCT)
    assert MAX_THEORETICAL_LOSS_PCT == pytest.approx(50.0)


@pytest.mark.parametrize(
    ("kwargs", "expected"),
    [
        ({"health": 0.0}, BASE_LOSS_PCT + 25.0),
        ({"soil_quality": 0.0}, BASE_LOSS_PCT + 10.0),
        ({"slope_norm": 1.0}, BASE_LOSS_PCT + 12.0),
        ({"health": 0.5}, BASE_LOSS_PCT + 12.5),
        ({"slope_norm": 0.5}, BASE_LOSS_PCT + 6.0),
    ],
)
def test_each_cause_contributes_its_documented_weight(kwargs, expected):
    assert compute_loss_percentage(features(**kwargs)) == pytest.approx(expected)


def test_causes_accumulate():
    """Una celda empinada Y enferma pierde por las dos razones."""
    only_slope = compute_loss_percentage(features(slope_norm=1.0))
    only_health = compute_loss_percentage(features(health=0.0))
    both = compute_loss_percentage(features(slope_norm=1.0, health=0.0))

    assert both == pytest.approx(only_slope + only_health - BASE_LOSS_PCT)


@pytest.mark.parametrize("slope_norm", [0.0, 0.25, 0.5, 0.75, 1.0])
@pytest.mark.parametrize("health", [0.0, 0.5, 1.0])
@pytest.mark.parametrize("soil_quality", [0.0, 0.5, 1.0])
def test_loss_is_always_within_bounds(slope_norm, health, soil_quality):
    value = compute_loss_percentage(
        features(slope_norm=slope_norm, health=health, soil_quality=soil_quality)
    )

    assert 0.0 <= value <= 100.0


def test_loss_is_monotonic_in_health():
    values = [compute_loss_percentage(features(health=h)) for h in (1.0, 0.75, 0.5, 0.25, 0.0)]

    assert values == sorted(values)
