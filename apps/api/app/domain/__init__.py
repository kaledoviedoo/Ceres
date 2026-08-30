"""Vocabulario del dominio agricola.

Este paquete no depende de la base de datos ni de FastAPI: solo define los
enums y constantes que comparten `models/` (persistencia), `schemas/` (contrato
de API) y `core/prediction/` (motor). Es el unico punto donde se define, por
ejemplo, que significa "riesgo alto".
"""

from app.domain.enums import (
    CropCycleStatus,
    ObservationType,
    RiskLevel,
    UserRole,
)
from app.domain.units import (
    KG_PER_TON,
    RISK_HIGH_THRESHOLD,
    RISK_MEDIUM_THRESHOLD,
    risk_level_from_score,
)

__all__ = [
    "CropCycleStatus",
    "ObservationType",
    "RiskLevel",
    "UserRole",
    "KG_PER_TON",
    "RISK_HIGH_THRESHOLD",
    "RISK_MEDIUM_THRESHOLD",
    "risk_level_from_score",
]
