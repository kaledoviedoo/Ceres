"""Tests de la aritmetica del error prediccion vs realidad.

Funciones puras, sin base de datos. La vista SQL `cell_performance` calcula lo
mismo para consultas ad-hoc; estos valores son la referencia de ambas.
"""

from __future__ import annotations

import pytest

from app.domain.performance import absolute_error_kg, percentage_error


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
