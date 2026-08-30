"""Tests de los modelos de persistencia (fase 1).

No tocan la base de datos: comprueban que el mapeo declarativo es coherente
(relaciones bien escritas, tablas esperadas) y que los modelos coinciden con las
migraciones SQL.
"""

from __future__ import annotations

import re
from pathlib import Path

from sqlalchemy.orm import configure_mappers

from app.models import Base

# tests/unit/test_models.py -> tests -> api -> apps -> raiz del repositorio
REPO_ROOT = Path(__file__).resolve().parents[4]
MIGRATION_FILE = REPO_ROOT / "database" / "migrations" / "0001_init.sql"

EXPECTED_TABLES = {
    "organizations",
    "users",
    "farms",
    "plots",
    "crops",
    "crop_cycles",
    "grid_cells",
    "predictions",
    "observations",
    "harvests",
}


def test_all_relationships_resolve():
    """Falla si alguna relationship apunta a un modelo o campo inexistente."""
    configure_mappers()


def test_declared_tables_match_the_brief():
    assert set(Base.metadata.tables) == EXPECTED_TABLES


def test_migration_creates_the_same_tables():
    sql = MIGRATION_FILE.read_text(encoding="utf-8")
    created = set(re.findall(r"CREATE TABLE (?:IF NOT EXISTS )?(\w+)", sql))

    # schema_migrations es infraestructura del runner, no parte del dominio.
    assert created - {"schema_migrations"} == EXPECTED_TABLES


def test_grid_cell_columns_match_migration():
    sql = MIGRATION_FILE.read_text(encoding="utf-8")
    block = sql.split("CREATE TABLE grid_cells (")[1].split(");")[0]

    for column in Base.metadata.tables["grid_cells"].columns:
        assert re.search(rf"\b{column.name}\b", block), f"falta {column.name} en la migracion"
