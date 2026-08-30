"""Constantes de conversion y umbrales del dominio.

Existen para evitar magic numbers repartidos por el codigo. Cada valor lleva la
justificacion de por que tiene ese valor.
"""

from __future__ import annotations

from app.domain.enums import RiskLevel

#: 1 tonelada metrica = 1000 kg.
KG_PER_TON = 1000.0

#: Umbrales del risk_score continuo (0..1) hacia el bucket cualitativo.
#: Elegidos para partir el rango en tres tercios aproximados; son una decision
#: de producto, no un resultado experimental. Documentado en
#: docs/prediction-model.md.
RISK_MEDIUM_THRESHOLD = 0.33
RISK_HIGH_THRESHOLD = 0.66


def risk_level_from_score(risk_score: float) -> RiskLevel:
    """Traduce un `risk_score` continuo (0..1) a su nivel cualitativo.

    Unico lugar del sistema donde se hace esta traduccion, para que backend y
    frontend nunca discrepen sobre que es "riesgo alto".
    """
    if not 0.0 <= risk_score <= 1.0:
        raise ValueError(f"risk_score debe estar en [0, 1], se recibio {risk_score}")
    if risk_score >= RISK_HIGH_THRESHOLD:
        return RiskLevel.HIGH
    if risk_score >= RISK_MEDIUM_THRESHOLD:
        return RiskLevel.MEDIUM
    return RiskLevel.LOW
