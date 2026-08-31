"""Tests de la aritmetica del error prediccion vs realidad.

Funciones puras, sin base de datos. La vista SQL `cell_performance` calcula lo
mismo para consultas ad-hoc; estos valores son la referencia de ambas.
"""

from __future__ import annotations

import pytest

from app.domain.performance import absolute_error_kg, percentage_error
from tests.performance_cases import ERROR_CASES


def test_example_from_the_brief():
    """Predicho 18.4 kg, real 16.2 kg -> 2.2 kg de error, 13.58%."""
    assert absolute_error_kg(18.4, 16.2) == pytest.approx(2.2)
    assert percentage_error(18.4, 16.2) == pytest.approx(13.58, abs=0.01)


def test_error_is_symmetric_in_absolute_terms():
    """Sobreestimar 2 kg y subestimar 2 kg son el mismo error absoluto."""
    assert absolute_error_kg(12.0, 10.0) == absolute_error_kg(8.0, 10.0)


def test_percentage_error_divides_by_the_actual_value():
    """Convencion MAPE: se divide por lo que ocurrio, no por lo que se predijo."""
    assert percentage_error(15.0, 10.0) == pytest.approx(50.0)
    assert percentage_error(10.0, 15.0) == pytest.approx(33.333, abs=0.01)


def test_perfect_prediction_has_no_error():
    assert absolute_error_kg(10.0, 10.0) == 0.0
    assert percentage_error(10.0, 10.0) == 0.0


def test_percentage_error_is_none_when_actual_is_zero():
    """Dividir por cero no da un porcentaje enorme: no da nada."""
    assert absolute_error_kg(10.0, 0.0) == 10.0
    assert percentage_error(10.0, 0.0) is None


def test_percentage_error_is_never_negative():
    for projected, actual in ((5.0, 10.0), (10.0, 5.0), (0.0, 10.0)):
        assert percentage_error(projected, actual) >= 0


def test_errors_are_rounded_to_four_decimals():
    """Sin redondeo la API devolveria 1.5633999999999997 a la interfaz."""
    assert absolute_error_kg(11.9634, 10.4) == 1.5634
    assert percentage_error(11.9634, 10.4) == 15.0327


# --- Casos compartidos con el test diferencial contra PostgreSQL --------------


@pytest.mark.parametrize(
    "case",
    ERROR_CASES,
    ids=[f"{c.projected_yield_kg}_vs_{c.actual_yield_kg}" for c in ERROR_CASES],
)
def test_shared_cases_produce_valid_python_results(case):
    """Los mismos casos que ejecuta tests/postgres/test_performance_parity.py.

    Aqui solo se comprueba que Python los resuelve de forma coherente; la
    comparacion con la vista SQL necesita PostgreSQL y vive alli.
    """
    absolute = absolute_error_kg(case.projected_yield_kg, case.actual_yield_kg)
    relative = percentage_error(case.projected_yield_kg, case.actual_yield_kg)

    assert absolute >= 0, case.motivo
    if case.actual_yield_kg == 0:
        assert relative is None, case.motivo
    else:
        assert relative is not None and relative >= 0, case.motivo


def test_decimal_arithmetic_avoids_binary_subtraction_error():
    """El caso que hacia divergir Python y PostgreSQL antes de la fase 4.6.

    Restando en float, 2.00005 - 1.0 da 1.0000499999999999 y Python redondeaba a
    1.0000 mientras PostgreSQL daba 1.0001. En decimal exacto la resta es
    1.00005 y ambos dan 1.0001.
    """
    assert absolute_error_kg(2.00005, 1.0) == 1.0001
    assert absolute_error_kg(3.00025, 2.0) == 1.0003


def test_rounding_is_half_up_not_bankers():
    """`round()` de Python daria 2.0 aqui; PostgreSQL da 2.0001."""
    assert absolute_error_kg(2.00005, 0.0) == 2.0001
