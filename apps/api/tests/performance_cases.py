"""Casos de prueba compartidos para el error prediccion vs realidad.

Una sola lista, consumida por dos tests distintos:

- `tests/unit/test_performance.py` la ejecuta contra la implementacion Python.
- `tests/postgres/test_performance_parity.py` la ejecuta contra la vista SQL y
  compara los dos resultados.

Que la lista viva aqui es lo que garantiza que ambas implementaciones reciban
exactamente las mismas entradas. Anadir un caso lo anade a los dos lados.
"""

from __future__ import annotations

from typing import NamedTuple


class ErrorCase(NamedTuple):
    """Un par (predicho, real) con el motivo por el que esta en la lista."""

    projected_yield_kg: float
    actual_yield_kg: float
    motivo: str


#: Casos normales, limites y trampas de redondeo.
ERROR_CASES: tuple[ErrorCase, ...] = (
    # --- Normales ------------------------------------------------------------
    ErrorCase(11.9634, 10.4, "el caso real de A-00240"),
    ErrorCase(18.4, 16.2, "el ejemplo del brief: 2.2 kg, 13.58%"),
    ErrorCase(5.0, 7.5, "subestimacion"),
    ErrorCase(7.5, 5.0, "sobreestimacion"),
    # --- Prediccion perfecta -------------------------------------------------
    ErrorCase(10.0, 10.0, "sin error: 0 y 0%"),
    ErrorCase(0.0, 0.0, "ambos cero: real 0 -> porcentaje None"),
    # --- Division por cero ---------------------------------------------------
    ErrorCase(10.0, 0.0, "real cero: error absoluto si, porcentual None"),
    ErrorCase(0.0, 10.0, "predicho cero: 100% de error"),
    # --- Decimales periodicos ------------------------------------------------
    ErrorCase(1.0, 3.0, "66.6666...%"),
    ErrorCase(2.0, 3.0, "33.3333...%"),
    ErrorCase(1.0, 7.0, "85.714285...%"),
    # --- Empates de redondeo: aqui es donde Python y PostgreSQL divergian ----
    ErrorCase(2.00005, 1.0, "error absoluto 1.00005, empate exacto"),
    ErrorCase(10.00005, 0.0001, "empate en el absoluto y porcentaje enorme"),
    ErrorCase(1.00015, 1.0, "empate en el cuarto decimal"),
    ErrorCase(3.00025, 2.0, "otro empate"),
    ErrorCase(1.56345, 1.0, "empate que Python redondea hacia arriba"),
    # --- Magnitudes extremas -------------------------------------------------
    ErrorCase(0.0001, 1000.0, "error relativo casi total sobre un real grande"),
    ErrorCase(999999.9999, 0.0001, "porcentaje astronomico"),
    ErrorCase(0.0001, 0.0002, "dos magnitudes minusculas"),
    ErrorCase(12.0, 11.999999, "diferencia por debajo del redondeo"),
)
