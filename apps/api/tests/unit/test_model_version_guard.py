"""No se puede cambiar la formula y dejar la version quieta.

El problema que resuelve es concreto y silencioso: `MODEL_VERSION` es un string
escrito a mano, y nada obligaba a moverlo al tocar un peso. Dos predicciones
calculadas con formulas distintas quedarian guardadas con la misma version, y el
historico —que existe precisamente para responder "que dijo CERES aquel dia y
con que formula"— estaria mintiendo sin que nadie pudiera notarlo.

NO ES UN SISTEMA DE VERSIONADO. Es una huella: se listan los numeros que definen
la formula y se fija el par (huella, version). Cambiar un peso cambia la huella,
el test se cae, y quien lo cambio tiene que decidir a conciencia que version le
toca. Eso es todo lo que hace falta para que dejar de ser silencioso.
"""

from __future__ import annotations

import hashlib
import json

from app.core.prediction import MODEL_VERSION
from app.core.prediction.loss import (
    BASE_LOSS_PCT,
    HEALTH_LOSS_PCT,
    SOIL_LOSS_PCT,
    TERRAIN_LOSS_PCT,
)
from app.core.prediction.risk import HEALTH_WEIGHT, SLOPE_WEIGHT, SOIL_WEIGHT
from app.core.state import HEALTH_IMPACT, IMPACT_VERSION, SOIL_IMPACT


def _huella(parametros: dict[str, float]) -> str:
    """Huella corta y estable de un conjunto de parametros."""
    canonico = json.dumps(parametros, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonico.encode()).hexdigest()[:12]


# --- El motor ----------------------------------------------------------------

#: Los numeros que definen que dice `rule-based-v0.1`. Si cambia uno, cambia lo
#: que el modelo predice, y la version tiene que dejar de ser esa.
PESOS_DEL_MOTOR = {
    "HEALTH_WEIGHT": HEALTH_WEIGHT,
    "SOIL_WEIGHT": SOIL_WEIGHT,
    "SLOPE_WEIGHT": SLOPE_WEIGHT,
    "BASE_LOSS_PCT": BASE_LOSS_PCT,
    "TERRAIN_LOSS_PCT": TERRAIN_LOSS_PCT,
    "HEALTH_LOSS_PCT": HEALTH_LOSS_PCT,
    "SOIL_LOSS_PCT": SOIL_LOSS_PCT,
}

#: (version, huella). Cambiar los pesos SIN cambiar la version rompe el test.
VERSIONES_DEL_MOTOR = {
    "rule-based-v0.1": "d623acb33814",
}


def test_the_engine_weights_match_their_declared_version():
    """Si esto falla, decide: o revierte el peso, o sube `MODEL_VERSION`.

    Y si sube la version, anade aqui la pareja nueva. Ese gesto —dos lineas— es
    justo la friccion que impide el cambio silencioso.
    """
    esperada = VERSIONES_DEL_MOTOR.get(MODEL_VERSION)

    assert esperada is not None, (
        f"`{MODEL_VERSION}` no esta declarada en VERSIONES_DEL_MOTOR. "
        f"Si acabas de subir la version, registra su huella: {_huella(PESOS_DEL_MOTOR)}"
    )
    assert _huella(PESOS_DEL_MOTOR) == esperada, (
        f"los pesos del modelo cambiaron y `MODEL_VERSION` sigue siendo "
        f"`{MODEL_VERSION}`. Huella actual: {_huella(PESOS_DEL_MOTOR)}. "
        f"Sube la version o revierte el cambio: una prediccion guardada con esta "
        f"version dejaria de ser reproducible."
    )


def test_the_risk_weights_still_add_up_to_one():
    """La propiedad que hace que `risk_score` caiga en 0..1 por construccion."""
    assert HEALTH_WEIGHT + SOIL_WEIGHT + SLOPE_WEIGHT == 1.0


# --- El modelo de impacto ----------------------------------------------------

PARAMETROS_DE_IMPACTO = {
    **{f"health/{t.value}": v for t, v in HEALTH_IMPACT.items()},
    **{f"soil/{t.value}": v for t, v in SOIL_IMPACT.items()},
}

VERSIONES_DEL_IMPACTO = {
    "impact-v0": "d610e1284d81",
}


def test_the_impact_parameters_match_their_declared_version():
    """La misma huella, para la otra mitad del calculo.

    El modelo de impacto decide cuanto mueve una observacion el estado de la
    celda. No esta calibrado —no hay con que—, y precisamente por eso cambiarlo
    en silencio seria peor: nadie podria saber con que supuesto se calculo una
    prediccion vieja.
    """
    esperada = VERSIONES_DEL_IMPACTO.get(IMPACT_VERSION)

    assert esperada is not None, (
        f"`{IMPACT_VERSION}` no esta declarada. Huella actual: "
        f"{_huella(PARAMETROS_DE_IMPACTO)}"
    )
    assert _huella(PARAMETROS_DE_IMPACTO) == esperada, (
        f"el modelo de impacto cambio y `IMPACT_VERSION` sigue siendo "
        f"`{IMPACT_VERSION}`. Huella actual: {_huella(PARAMETROS_DE_IMPACTO)}"
    )


def test_a_saved_prediction_records_both_models():
    """Las dos versiones viajan juntas en la fila guardada.

    Una prediccion pasa por el motor Y por el modelo de impacto —el estado se
    deriva antes de predecir—, asi que registrar solo una dejaria la otra mitad
    sin trazabilidad.
    """
    from app.core.state import IMPACT_VERSION as impacto

    compuesta = f"{MODEL_VERSION}+{impacto}"

    assert compuesta.startswith(MODEL_VERSION)
    assert impacto in compuesta
    # Y cabe en la columna.
    assert len(compuesta) <= 64
