"""El motor: orquesta las etapas y construye el resultado.

    GridCell + Crop
          |
          v
    build_prediction_input   (etapa 0: empaquetar y validar)
          |
          v
    extract_features         (etapa 1: normalizar)
          |
          +--> compute_factors + compute_yield_kg   (etapa 2: rendimiento)
          +--> compute_loss_percentage              (etapa 3: perdida)
          +--> compute_risk_score + classify_risk   (etapa 4: riesgo)
          +--> compute_boxes                        (etapa 5: cajas)
          |
          v
    PredictionResult         (etapa 6: resultado tipado y validado)

Este modulo no importa FastAPI, SQLAlchemy ni nada de red. Se puede ejecutar
desde un test, un script o un notebook.

MODELO EXPERIMENTAL / DEMOSTRATIVO: opera sobre datos sinteticos y no constituye
una prediccion agronomica cientificamente validada.
"""

from __future__ import annotations

from app.core.prediction.boxes import compute_boxes
from app.core.prediction.contracts import (
    MODEL_VERSION,
    PredictionInput,
    PredictionResult,
    YieldFactors,
)
from app.core.prediction.features import (
    CellState,
    CropSpec,
    build_prediction_input,
    extract_features,
)
from app.core.prediction.loss import compute_loss_percentage
from app.core.prediction.risk import classify_risk, compute_risk_score
from app.core.prediction.yield_model import compute_factors, compute_yield_kg

#: Decimales a los que se redondea cada salida.
#:
#: El redondeo del rendimiento ocurre ANTES de calcular las cajas, y es
#: deliberado: `ceil(12.000000000000002 / 6)` da 3 cajas en vez de 2. Redondear
#: primero elimina esa clase de sorpresa y garantiza que las cajas que se
#: guardan corresponden al rendimiento que se guarda.
YIELD_DECIMALS = 4
LOSS_DECIMALS = 2
RISK_DECIMALS = 4
FACTOR_DECIMALS = 4


def _round_factors(factors: YieldFactors) -> YieldFactors:
    """Redondea los factores que se muestran y se persisten.

    Los factores redondeados son para explicar; el calculo del rendimiento usa
    los valores sin redondear, para no arrastrar el error del redondeo.
    """
    return YieldFactors(
        **{key: round(value, FACTOR_DECIMALS) for key, value in factors.as_dict().items()}
    )


def predict_from_input(prediction_input: PredictionInput) -> PredictionResult:
    """Ejecuta el modelo sobre una entrada ya empaquetada y validada.

    Determinista: la misma entrada produce exactamente la misma salida. No hay
    aleatoriedad, ni reloj, ni estado compartido.
    """
    features = extract_features(prediction_input)

    raw_factors = compute_factors(features, prediction_input.base_yield_factor)
    factors = _round_factors(raw_factors)

    projected_yield_kg = round(
        compute_yield_kg(prediction_input, raw_factors), YIELD_DECIMALS
    )
    projected_boxes = compute_boxes(
        projected_yield_kg, prediction_input.crop.box_capacity_kg
    )

    estimated_loss_percentage = round(compute_loss_percentage(features), LOSS_DECIMALS)

    risk_score = round(compute_risk_score(features), RISK_DECIMALS)
    risk_level = classify_risk(risk_score)

    return PredictionResult(
        cell_id=prediction_input.cell_id,
        cell_code=prediction_input.cell_code,
        projected_yield_kg=projected_yield_kg,
        projected_boxes=projected_boxes,
        estimated_loss_percentage=estimated_loss_percentage,
        risk_score=risk_score,
        risk_level=risk_level,
        model_version=MODEL_VERSION,
        factors=factors,
        inputs=prediction_input.as_dict(),
    )


def predict(cell: CellState, crop: CropSpec, area_m2: float = 1.0) -> PredictionResult:
    """Punto de entrada del motor.

        result = predict(cell, crop_cycle.crop, area_m2=plot.cell_size_m ** 2)

    `cell` y `crop` solo tienen que exponer los atributos de los protocolos de
    `features.py`; un `GridCell` y un `Crop` de SQLAlchemy los cumplen sin
    heredar de nada.
    """
    return predict_from_input(build_prediction_input(cell, crop, area_m2))
