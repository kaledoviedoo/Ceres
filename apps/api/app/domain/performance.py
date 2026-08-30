"""Error entre prediccion y realidad.

Definicion UNICA de como se mide que tan equivocada estuvo CERES. La vista SQL
`cell_performance` (migracion 0003) calcula lo mismo para consultas ad-hoc y BI;
si una cambia, la otra tiene que cambiar con ella. Ver decisions.md D-018.
"""

from __future__ import annotations

#: Decimales de los errores. Debe coincidir con el ROUND de la vista SQL.
ERROR_DECIMALS = 4


def absolute_error_kg(projected_yield_kg: float, actual_yield_kg: float) -> float:
    """Diferencia en valor absoluto, en kg.

    Se redondea para que la respuesta no arrastre ruido de coma flotante
    (11.9634 - 10.4 = 1.5633999999999997) hasta la interfaz.
    """
    return round(abs(projected_yield_kg - actual_yield_kg), ERROR_DECIMALS)


def percentage_error(projected_yield_kg: float, actual_yield_kg: float) -> float | None:
    """Error relativo respecto al valor REAL, en porcentaje.

    Convencion estandar (la del MAPE): se divide por lo que de verdad ocurrio,
    no por lo que se predijo.

    Devuelve `None` si el rendimiento real es 0. Dividir por cero no produce un
    porcentaje enorme, no produce nada; es mejor decirlo que inventarse un
    numero que luego alguien promedie.
    """
    if actual_yield_kg == 0:
        return None
    raw = abs(projected_yield_kg - actual_yield_kg) / actual_yield_kg * 100.0
    return round(raw, ERROR_DECIMALS)
