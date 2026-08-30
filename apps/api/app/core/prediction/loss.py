"""Calculo de la perdida estimada.

Aditivo, al reves que el rendimiento, porque las causas de perdida se acumulan:
una celda empinada Y enferma pierde por las dos razones.

    loss = base + terreno + sanidad + suelo,  recortado a [0, 100]
"""

from __future__ import annotations

from app.core.prediction.features import NormalizedFeatures, clamp

#: Perdida inevitable de manejo y postcosecha, en puntos porcentuales.
#: SUPUESTO SINTETICO.
BASE_LOSS_PCT = 3.0

#: Perdida maxima por terreno: erosion y dificultad de recoleccion en pendiente.
#: SUPUESTO SINTETICO.
TERRAIN_LOSS_PCT = 12.0

#: Perdida maxima por sanidad. Es la causa dominante del modelo.
#: SUPUESTO SINTETICO.
HEALTH_LOSS_PCT = 25.0

#: Perdida maxima por calidad de suelo.
#: SUPUESTO SINTETICO.
SOIL_LOSS_PCT = 10.0

#: Techo teorico de la suma: 3 + 12 + 25 + 10 = 50.
MAX_THEORETICAL_LOSS_PCT = (
    BASE_LOSS_PCT + TERRAIN_LOSS_PCT + HEALTH_LOSS_PCT + SOIL_LOSS_PCT
)


def compute_loss_percentage(features: NormalizedFeatures) -> float:
    """Perdida estimada en porcentaje, garantizada dentro de [0, 100].

    El recorte esta aunque la suma de los pesos no pueda superar 50: un cambio
    de pesos manana no puede permitirse producir un 130% de perdida.
    """
    terrain_loss = TERRAIN_LOSS_PCT * features.slope_norm
    health_loss = HEALTH_LOSS_PCT * (1.0 - features.health)
    soil_loss = SOIL_LOSS_PCT * (1.0 - features.soil_quality)

    total = BASE_LOSS_PCT + terrain_loss + health_loss + soil_loss
    return clamp(total, 0.0, 100.0)
