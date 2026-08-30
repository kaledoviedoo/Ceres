"""Calculo del riesgo.

    risk_score = 0.45*(1-sanidad) + 0.30*(1-suelo) + 0.25*pendiente_norm

Los pesos SUMAN 1.00 y cada termino esta en 0..1, asi que el resultado cae en
0..1 por construccion, no por recorte. El `clamp` final solo protege frente a
errores de redondeo en coma flotante.

Sanidad pesa mas que suelo, y suelo mas que terreno, porque la sanidad es lo que
puede cambiar de una semana a otra y sobre lo que un agronomo puede actuar; el
terreno es una condicion fija.
"""

from __future__ import annotations

from app.core.prediction.features import NormalizedFeatures, clamp
from app.domain.enums import RiskLevel
from app.domain.units import risk_level_from_score

#: Pesos del score. Deben sumar 1.0.
#: SUPUESTO SINTETICO: el orden de importancia esta razonado, no medido.
HEALTH_WEIGHT = 0.45
SOIL_WEIGHT = 0.30
SLOPE_WEIGHT = 0.25


def compute_risk_score(features: NormalizedFeatures) -> float:
    """Riesgo normalizado: 0 = bajo, 1 = alto."""
    score = (
        HEALTH_WEIGHT * (1.0 - features.health)
        + SOIL_WEIGHT * (1.0 - features.soil_quality)
        + SLOPE_WEIGHT * features.slope_norm
    )
    return clamp(score, 0.0, 1.0)


def classify_risk(risk_score: float) -> RiskLevel:
    """Bucket cualitativo.

    Delega en `app.domain` para que backend, base de datos y frontend nunca
    discrepen sobre que es "riesgo alto".
    """
    return risk_level_from_score(risk_score)
