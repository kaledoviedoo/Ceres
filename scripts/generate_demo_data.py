"""Genera el dataset sintetico de demo de CERES.

    py scripts/generate_demo_data.py                  # escribe el seed SQL
    py scripts/generate_demo_data.py --seed 7         # otra seed
    py scripts/generate_demo_data.py --apply          # ademas lo ejecuta en la BD
    py scripts/generate_demo_data.py --stdout         # lo imprime sin escribir

DEMO / SYNTHETIC DATA: la finca es ficticia. Con la misma seed el resultado es
byte a byte identico, y los UUID son deterministas, asi que reaplicar el seed
actualiza las filas existentes en lugar de duplicarlas.
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys
import uuid
from pathlib import Path
from typing import Any

import _bootstrap  # noqa: F401  (efecto lateral: ajusta sys.path)

from app.core.synthetic.demo import DEFAULT_SEED, DemoDataset, TableRows, build_demo_dataset

REPO_ROOT = Path(__file__).resolve().parent.parent
SEED_DIR = REPO_ROOT / "database" / "seeds"
SEED_FILE = SEED_DIR / "0001_demo_data.sql"

#: Columnas que identifican la fila y que por tanto no se actualizan.
CONFLICT_TARGET = "id"


def sql_literal(value: Any) -> str:
    """Serializa un valor Python a un literal SQL de Postgres."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, uuid.UUID):
        return f"'{value}'::uuid"
    if isinstance(value, dt.datetime):
        return f"'{value.isoformat()}'::timestamptz"
    if isinstance(value, dt.date):
        return f"'{value.isoformat()}'::date"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, str):
        escaped = value.replace("'", "''")
        return f"'{escaped}'"
    raise TypeError(f"No se sabe serializar {type(value).__name__} a SQL")


def render_table(table: TableRows) -> str:
    """INSERT idempotente para una tabla completa."""
    if not table.rows:
        return f"-- {table.name}: sin filas\n"

    columns = table.columns
    column_list = ", ".join(columns)
    updates = ", ".join(
        f"{column} = EXCLUDED.{column}" for column in columns if column != CONFLICT_TARGET
    )

    values = ",\n".join(
        "    (" + ", ".join(sql_literal(row[column]) for column in columns) + ")"
        for row in table.rows
    )

    return (
        f"-- {table.name} ({len(table.rows)} filas)\n"
        f"INSERT INTO {table.name} ({column_list}) VALUES\n"
        f"{values}\n"
        f"ON CONFLICT ({CONFLICT_TARGET}) DO UPDATE SET {updates};\n"
    )


def render_seed(dataset: DemoDataset) -> str:
    header = (
        "-- =============================================================================\n"
        "-- CERES - seed de demo (GENERADO AUTOMATICAMENTE, NO EDITAR A MANO)\n"
        "--\n"
        "-- DEMO / SYNTHETIC DATA: finca ficticia con datos sinteticos deterministas.\n"
        "-- Estos valores existen para validar tecnicamente el sistema; no son datos\n"
        "-- agronomicos reales.\n"
        "--\n"
        f"-- Regenerar con: py scripts/generate_demo_data.py --seed {dataset.seed}\n"
        f"-- Seed: {dataset.seed}\n"
        "-- ============================================================================="
        "\n\nBEGIN;\n\n"
    )
    body = "\n".join(render_table(table) for table in dataset.tables)
    footer = "\nCOMMIT;\n"
    return header + body + footer


def apply_to_database(sql: str) -> None:
    """Ejecuta el seed contra la base de datos configurada en DATABASE_URL."""
    from sqlalchemy import text

    from app.config import get_settings
    from app.db import engine

    settings = get_settings()
    print(f"-> Aplicando seed en {settings.database_url.split('@')[-1]}")
    with engine.begin() as connection:
        connection.execute(text(sql))
    print("-> Seed aplicado")


def main() -> int:
    parser = argparse.ArgumentParser(description="Genera el dataset sintetico de CERES")
    parser.add_argument(
        "--seed",
        type=int,
        default=DEFAULT_SEED,
        help=f"Seed del generador (por defecto {DEFAULT_SEED})",
    )
    parser.add_argument("--width", type=int, default=20, help="Ancho de la malla")
    parser.add_argument("--height", type=int, default=20, help="Alto de la malla")
    parser.add_argument(
        "--output",
        type=Path,
        default=SEED_FILE,
        help="Ruta del archivo SQL a escribir",
    )
    parser.add_argument("--stdout", action="store_true", help="Imprimir en vez de escribir")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Ejecutar el seed contra DATABASE_URL despues de generarlo",
    )
    args = parser.parse_args()

    dataset = build_demo_dataset(
        seed=args.seed, grid_width=args.width, grid_height=args.height
    )
    sql = render_seed(dataset)

    if args.stdout:
        sys.stdout.write(sql)
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(sql, encoding="utf-8")
        print(f"-> Seed escrito en {args.output}")

    for name, count in dataset.summary().items():
        print(f"   {name:<16} {count:>5}")

    if args.apply:
        apply_to_database(sql)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
