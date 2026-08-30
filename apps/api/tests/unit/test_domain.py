"""Tests del vocabulario del dominio (fase 1)."""

from __future__ import annotations

import pytest

from app.domain import RiskLevel, risk_level_from_score
from app.domain.units import RISK_HIGH_THRESHOLD, RISK_MEDIUM_THRESHOLD


@pytest.mark.parametrize(
    ("score", "expected"),
    [
        (0.0, RiskLevel.LOW),
        (RISK_MEDIUM_THRESHOLD - 0.001, RiskLevel.LOW),
        (RISK_MEDIUM_THRESHOLD, RiskLevel.MEDIUM),
        (RISK_HIGH_THRESHOLD - 0.001, RiskLevel.MEDIUM),
        (RISK_HIGH_THRESHOLD, RiskLevel.HIGH),
        (1.0, RiskLevel.HIGH),
    ],
)
def test_risk_level_thresholds(score: float, expected: RiskLevel):
    assert risk_level_from_score(score) is expected


@pytest.mark.parametrize("score", [-0.01, 1.01])
def test_risk_level_rejects_scores_out_of_range(score: float):
    with pytest.raises(ValueError):
        risk_level_from_score(score)


def test_enums_serialize_as_plain_strings():
    """Los CHECK constraints del SQL comparan contra estos literales."""
    assert RiskLevel.LOW.value == "low"
