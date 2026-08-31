"""Test diferencial: la vista SQL debe coincidir con la capa Python.

Es la red de seguridad de la duplicacion aceptada en D-018. Ejecuta los mismos
casos por los dos caminos y compara:

    tests/performance_cases.py
            |
            +--> app/domain/performance.py   (Python, fuente de verdad)
            |
            +--> vista cell_performance      (SQL, espejo)
            |
            v
        deben ser identicos

No compara formulas re-escritas a mano: inserta filas reales y lee la vista de
verdad, la misma que consultaria un BI conectado a Supabase.

Cada caso usa una celda distinta porque la vista empareja cada prediccion con la
cosecha mas reciente de SU celda y ciclo; reutilizar una celda mezclaria los
casos entre si.

Los tests recorren todos los casos y acumulan las discrepancias en lugar de
parar en la primera: si una formula se rompe, se ve el patron completo de una
vez, no un caso suelto.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

from app.domain.performance import ERROR_DECIMALS, absolute_error_kg, percentage_error
from tests.performance_cases import ERROR_CASES

PARITY_MODEL_VERSION = "parity-test"


@pytest.fixture
def parity_rows(pg_session, seeded_cycle):
    """Inserta un par prediccion+cosecha por caso y devuelve lo que ve la vista.

    Los INSERT van en lote (executemany) para no pagar una ida y vuelta a
    Supabase por cada caso.
    """
    cells = list(
        pg_session.execute(
            text("""
            SELECT gc.id FROM grid_cells gc
            JOIN plots p ON p.id = gc.plot_id
            WHERE p.code = 'A'
            ORDER BY gc.cell_code
            LIMIT :n
            """),
            {"n": len(ERROR_CASES)},
        ).scalars()
    )
    if len(cells) < len(ERROR_CASES):
        pytest.skip("El seed no esta cargado o tiene menos celdas de las necesarias")

    predictions = [
        {"cell": cell, "cycle": seeded_cycle, "projected": case.projected_yield_kg}
        for cell, case in zip(cells, ERROR_CASES, strict=True)
    ]
    harvests = [
        {"cell": cell, "cycle": seeded_cycle, "actual": case.actual_yield_kg}
        for cell, case in zip(cells, ERROR_CASES, strict=True)
    ]

    pg_session.execute(
        text("""
        INSERT INTO predictions (cell_id, crop_cycle_id, model_version,
            projected_yield_kg, projected_boxes, estimated_loss_percentage,
            risk_score, risk_level)
        VALUES (:cell, :cycle, 'parity-test', :projected, 0, 0, 0, 'low')
        """),
        predictions,
    )
    pg_session.execute(
        text("""
        INSERT INTO harvests (cell_id, crop_cycle_id, actual_yield_kg,
            actual_boxes, harvested_at)
        VALUES (:cell, :cycle, :actual, 0, '2026-06-20')
        """),
        harvests,
    )
    pg_session.commit()

    rows = {
        row.cell_id: row
        for row in pg_session.execute(
            text("""
            SELECT cell_id, absolute_error_kg, percentage_error
            FROM cell_performance
            WHERE model_version = :version
            """),
            {"version": PARITY_MODEL_VERSION},
        ).all()
    }

    return [(case, rows[cell]) for cell, case in zip(cells, ERROR_CASES, strict=True)]


def test_every_case_reached_the_view(parity_rows):
    assert len(parity_rows) == len(ERROR_CASES)


def test_absolute_error_matches_across_every_case(parity_rows):
    mismatches = [
        f"{case.projected_yield_kg} vs {case.actual_yield_kg} ({case.motivo}): "
        f"SQL={row.absolute_error_kg} Python={absolute_error_kg(case.projected_yield_kg, case.actual_yield_kg)}"
        for case, row in parity_rows
        if float(row.absolute_error_kg)
        != absolute_error_kg(case.projected_yield_kg, case.actual_yield_kg)
    ]

    assert not mismatches, "absolute_error_kg difiere:\n  " + "\n  ".join(mismatches)


def test_percentage_error_matches_across_every_case(parity_rows):
    mismatches = []
    for case, row in parity_rows:
        expected = percentage_error(case.projected_yield_kg, case.actual_yield_kg)
        actual = None if row.percentage_error is None else float(row.percentage_error)
        if actual != expected:
            mismatches.append(
                f"{case.projected_yield_kg} vs {case.actual_yield_kg} ({case.motivo}): "
                f"SQL={actual} Python={expected}"
            )

    assert not mismatches, "percentage_error difiere:\n  " + "\n  ".join(mismatches)


def test_null_percentage_appears_exactly_where_actual_is_zero(parity_rows):
    """La regla de la division por cero tiene que ser la misma en los dos lados."""
    for case, row in parity_rows:
        if case.actual_yield_kg == 0:
            assert row.percentage_error is None, case.motivo
        else:
            assert row.percentage_error is not None, case.motivo


def test_both_sides_round_to_the_same_precision(parity_rows):
    for case, row in parity_rows:
        assert row.absolute_error_kg.as_tuple().exponent >= -ERROR_DECIMALS, case.motivo
        if row.percentage_error is not None:
            assert row.percentage_error.as_tuple().exponent >= -ERROR_DECIMALS, case.motivo


def test_the_api_serves_the_same_numbers_as_the_view(
    pg_client, pg_session, seeded_cell, seeded_cycle
):
    """Cierra el circulo: motor -> API -> vista SQL, todo el mismo numero."""
    prediction = pg_client.post(
        "/api/v1/predictions",
        json={"cell_id": str(seeded_cell), "crop_cycle_id": str(seeded_cycle)},
    ).json()

    pg_client.post(
        "/api/v1/harvests",
        json={
            "cell_id": str(seeded_cell),
            "crop_cycle_id": str(seeded_cycle),
            "actual_yield_kg": 10.4,
            "actual_boxes": 2,
            "harvested_at": "2026-06-20",
        },
    )

    api_entry = pg_client.get(f"/api/v1/cells/{seeded_cell}/performance").json()["entries"][0]
    view_row = pg_session.execute(
        text("""
        SELECT absolute_error_kg, percentage_error
        FROM cell_performance WHERE prediction_id = :pid
        """),
        {"pid": prediction["id"]},
    ).one()

    assert api_entry["absolute_error_kg"] == float(view_row.absolute_error_kg)
    assert api_entry["percentage_error"] == float(view_row.percentage_error)
