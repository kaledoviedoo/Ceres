"""Motor de prediccion.

FASE 1 (actual): solo estan definidos los contratos de entrada y salida.
FASE 3: se implementa `predict(cell, crop_cycle) -> PredictionResult` junto con
sus tests, sin tocar FastAPI.

El motor es intencionalmente reemplazable: hoy es determinista basado en
reglas, manana puede ser estadistico o ML. Lo que no cambia es este contrato ni
el hecho de que cada resultado lleve su `model_version`.
"""

from app.core.prediction.contracts import (
    MODEL_VERSION,
    CropParameters,
    PredictionInput,
    PredictionResult,
    YieldFactors,
)

__all__ = [
    "MODEL_VERSION",
    "CropParameters",
    "PredictionInput",
    "PredictionResult",
    "YieldFactors",
]
