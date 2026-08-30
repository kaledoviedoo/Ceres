"""Fixtures compartidas.

## Que motor de base de datos usan los tests

Los tests de integracion levantan el esquema con `Base.metadata.create_all()`
sobre **SQLite en memoria**, no sobre PostgreSQL. En esta maquina no hay Docker,
asi que no hay forma de verificar contra Postgres de verdad.

Lo que SI se verifica con SQLite:
  - el cableado HTTP -> servicio -> motor -> ORM -> respuesta
  - los schemas de request y response
  - los 404, 409 y 422
  - que las predicciones se persisten y nunca se sobrescriben *via API*

Lo que NO se verifica y queda pendiente contra PostgreSQL/Supabase:
  - las migraciones SQL de `database/migrations/` (aqui el esquema lo crea el
    ORM, no las migraciones)
  - el trigger de inmutabilidad de `predictions` (0002): es PL/pgSQL
  - la vista `cell_performance` (0003): usa LEFT JOIN LATERAL
  - los CHECK constraints tal como los escribe el SQL
  - tipos nativos: `uuid`, `jsonb`, `timestamptz`

Esa lista esta en docs/api.md y hay que ejecutarla en cuanto haya un Postgres
disponible.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, insert
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import db_session
from app.core.synthetic.demo import build_demo_dataset
from app.main import create_app
from app.models import Base


def _strip_timezone(rows: list[dict]) -> list[dict]:
    """SQLite no guarda offsets: normaliza los datetimes a UTC naive.

    Solo afecta al motor de test. En PostgreSQL las columnas son `timestamptz`
    y conservan la zona.
    """
    normalized = []
    for row in rows:
        copy = dict(row)
        for key, value in copy.items():
            if hasattr(value, "tzinfo") and getattr(value, "tzinfo", None) is not None:
                copy[key] = value.replace(tzinfo=None)
        normalized.append(copy)
    return normalized


@pytest.fixture(scope="session")
def demo_dataset():
    """Dataset sintetico completo, construido una sola vez."""
    return build_demo_dataset()


@pytest.fixture
def db_engine(demo_dataset):
    """SQLite en memoria con el esquema del ORM y el dataset de demo cargado."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)

    with engine.begin() as connection:
        for table in demo_dataset.tables:
            if not table.rows:
                continue
            connection.execute(
                insert(Base.metadata.tables[table.name]), _strip_timezone(table.rows)
            )

    yield engine

    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture
def session(db_engine) -> Iterator[Session]:
    factory = sessionmaker(bind=db_engine, autoflush=False, expire_on_commit=False)
    with factory() as session:
        yield session


@pytest.fixture
def client(db_engine) -> Iterator[TestClient]:
    """Cliente HTTP con la dependencia de sesion apuntando a la base de test."""
    factory = sessionmaker(bind=db_engine, autoflush=False, expire_on_commit=False)

    def override_session() -> Iterator[Session]:
        with factory() as session:
            yield session

    app = create_app()
    app.dependency_overrides[db_session] = override_session

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()


# --- Atajos a los identificadores del dataset de demo -------------------------


@pytest.fixture
def farm_id(demo_dataset):
    return demo_dataset.table("farms").rows[0]["id"]


@pytest.fixture
def plot_a_id(demo_dataset):
    return demo_dataset.table("plots").rows[0]["id"]


@pytest.fixture
def plot_b_id(demo_dataset):
    return demo_dataset.table("plots").rows[1]["id"]


@pytest.fixture
def crop_cycle_id(demo_dataset):
    return demo_dataset.table("crop_cycles").rows[0]["id"]


@pytest.fixture
def cell(demo_dataset, plot_a_id):
    """Una celda concreta y estable de Plot A."""
    return next(
        row
        for row in demo_dataset.table("grid_cells").rows
        if row["plot_id"] == plot_a_id and row["x"] == 10 and row["y"] == 10
    )


@pytest.fixture
def cell_id(cell):
    return cell["id"]


@pytest.fixture
def cell_in_plot_b(demo_dataset, plot_b_id):
    """Celda del otro lote: sirve para probar la validacion de coherencia."""
    return next(
        row for row in demo_dataset.table("grid_cells").rows if row["plot_id"] == plot_b_id
    )
