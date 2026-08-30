"""Calculo del rendimiento proyectado.

Modelo multiplicativo: cada factor es un porcentaje del potencial del cultivo.
Se eligio multiplicativo y no aditivo por dos razones: el desglose se lee directo
en la UI ("Suelo +10%, Sanidad -15%, Terreno -8%"), y una celda con sanidad 0
debe dar 0 kg, cosa que un modelo aditivo no garantiza.

    projected_yield_kg =
          base_yield_kg_per_m2 * area_m2
        * density_factor * soil_factor * health_factor
        * terrain_factor * base_yield_factor
"""

from __future__ import annotations

from app.core.prediction.contracts import PredictionInput, YieldFactors
from app.core.prediction.features import NormalizedFeatures, clamp

#: Techo del factor de densidad. Sembrar mas denso ayuda hasta un punto; pasado
#: ese punto las plantas compiten entre si. Sin techo, una celda sobresembrada
#: daria un rendimiento absurdo.
#: SUPUESTO SINTETICO.
DENSITY_FACTOR_CAP = 1.15

#: El factor de suelo mapea soil_quality 0..1 sobre 0.70..1.20. Ni el peor suelo
#: anula la cosecha ni el mejor la duplica.
#: SUPUESTO SINTETICO.
SOIL_FACTOR_FLOOR = 0.70
SOIL_FACTOR_SPAN = 0.50

#: Penalizacion maxima del terreno: una celda en la pendiente de referencia
#: rinde un 25% menos que la misma celda en plano.
#: SUPUESTO SINTETICO.
TERRAIN_SLOPE_PENALTY = 0.25


def compute_factors(
    features: NormalizedFeatures,
    base_yield_factor: float,
) -> YieldFactors:
    """Los cinco multiplicadores que explican el resultado."""
    return YieldFactors(
        density_factor=clamp(features.density_ratio, 0.0, DENSITY_FACTOR_CAP),
        soil_factor=SOIL_FACTOR_FLOOR + SOIL_FACTOR_SPAN * features.soil_quality,
        # La sanidad entra directa: ya es un indice 0..1, y un cultivo muerto
        # (health = 0) debe producir 0 kg.
        health_factor=features.health,
        terrain_factor=1.0 - TERRAIN_SLOPE_PENALTY * features.slope_norm,
        base_yield_factor=base_yield_factor,
    )


def compute_yield_kg(prediction_input: PredictionInput, factors: YieldFactors) -> float:
    """Rendimiento proyectado en kg para la celda completa.

    Nunca negativo: todos los factores son >= 0 y `base_yield_kg_per_m2` > 0.
    """
    potential_kg = prediction_input.crop.base_yield_kg_per_m2 * prediction_input.area_m2
    return potential_kg * factors.combined()
