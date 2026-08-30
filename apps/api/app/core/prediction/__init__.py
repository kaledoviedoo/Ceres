"""Motor de prediccion.

    from app.core.prediction import predict
    result = predict(cell, crop, area_m2=1.0)

Independiente de FastAPI, de SQLAlchemy y de React. Determinista: misma entrada,
misma salida, siempre.

MODELO EXPERIMENTAL / DEMOSTRATIVO. Este MVP usa datos geograficos y agricolas
sinteticos, de modo que el motor debe considerarse un modelo demostrativo y NO
una prediccion agronomica cientificamente validada.

Formulas documentadas en docs/prediction-model.md. Version actual:
`rule-based-v0.1`. El motor es reemplazable: cuando llegue un modelo estadistico
o de ML, cambia la implementacion pero no este contrato, y las predicciones
antiguas siguen diciendo con que version se hicieron.
"""

from app.core.prediction.boxes import compute_boxes
from app.core.prediction.contracts import (
    MODEL_VERSION,
    CropParameters,
    PredictionInput,
    PredictionResult,
    YieldFactors,
)
from app.core.prediction.engine import predict, predict_from_input
from app.core.prediction.features import (
    SLOPE_REFERENCE_DEG,
    CellState,
    CropSpec,
    NormalizedFeatures,
    build_prediction_input,
    extract_features,
)
from app.core.prediction.loss import compute_loss_percentage
from app.core.prediction.risk import classify_risk, compute_risk_score
from app.core.prediction.yield_model import compute_factors, compute_yield_kg

__all__ = [
    # Punto de entrada
    "predict",
    "predict_from_input",
    # Contratos
    "MODEL_VERSION",
    "CropParameters",
    "PredictionInput",
    "PredictionResult",
    "YieldFactors",
    # Etapas, expuestas para poder testearlas por separado
    "CellState",
    "CropSpec",
    "NormalizedFeatures",
    "SLOPE_REFERENCE_DEG",
    "build_prediction_input",
    "extract_features",
    "compute_factors",
    "compute_yield_kg",
    "compute_loss_percentage",
    "compute_risk_score",
    "classify_risk",
    "compute_boxes",
]
