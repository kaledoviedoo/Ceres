"""Calculo de cajas proyectadas.

    projected_boxes = ceil(projected_yield_kg / box_capacity_kg)

Se calcula sobre el rendimiento BRUTO, no sobre el neto de perdidas: la pregunta
operativa es cuantas cajas llevar al campo, y sobran mejor que faltan.

Pendiente de revisar en la fase 9, cuando existan cosechas reales con las que
comparar el error sistematico.
"""

from __future__ import annotations

import math


def compute_boxes(projected_yield_kg: float, box_capacity_kg: float) -> int:
    """Cajas necesarias, redondeando hacia arriba. Nunca negativo."""
    if box_capacity_kg <= 0:
        raise ValueError("box_capacity_kg debe ser > 0")
    if projected_yield_kg < 0:
        raise ValueError("projected_yield_kg no puede ser negativo")
    return math.ceil(projected_yield_kg / box_capacity_kg)
