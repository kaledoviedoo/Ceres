"""Fixtures de los tests contra PostgreSQL real (Supabase).

## Como se activan

Solo se ejecutan si `TEST_DATABASE_URL` esta definida en el entorno o en `.env`.
Sin ella, pytest los **salta**: nunca fallan por no tener credenciales y nunca
tocan una base de datos real por accidente.

```bash
pytest                       # los salta si no hay TEST_DATABASE_URL
pytest -m postgres           # solo estos
pytest -m "not postgres"     # todo lo demas
```

## Advertencia

Estos tests **escriben** en la base de datos apuntada por `TEST_DATABASE_URL`.
Usa un proyecto desechable, nunca uno con datos que te importen. Cada test
limpia lo que crea, pero un fallo a mitad puede dejar filas sueltas.

Las predicciones son la excepcion: el trigger de inmutabilidad impide borrarlas
con DELETE, asi que la limpieza usa TRUNCATE, que no dispara triggers de fila.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker


def _test_database_url() -> str | None:
    """URL de la base de datos de pruebas, desde el entorno o desde .env.

    Nunca se registra en un log ni se imprime: solo se pasa a create_engine.
    """
    url = os.environ.get("TEST_DATABASE_URL")
    if url:
        return url

    from app.config import get_settings

    return getattr(get_settings(), "test_database_url", None) or None


TEST_DATABASE_URL = _test_database_url()

#: Se aplica a todos los tests del paquete: marca + skip automatico.
pytestmark = [
    pytest.mark.postgres,
    pytest.mark.skipif(
        not TEST_DATABASE_URL,
        reason="TEST_DATABASE_URL no definida: se omiten los tests contra PostgreSQL real",
    ),
]


@pytest.fixture(scope="session")
def pg_engine():
    """Engine contra el PostgreSQL real. Una sola conexion para toda la sesion."""
    if not TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL no definida")

    engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
    with engine.connect() as connection:
        version = connection.execute(text("SHOW server_version")).scalar()
        assert version, "no se pudo leer la version del servidor"

    yield engine
    engine.dispose()


@pytest.fixture
def pg_session(pg_engine) -> Iterator[Session]:
    factory = sessionmaker(bind=pg_engine, autoflush=False, expire_on_commit=False)
    with factory() as session:
        yield session


@pytest.fixture
def pg_client(pg_engine):
    """TestClient de FastAPI conectado al PostgreSQL real.

    Es la app completa: los mismos routers, servicios y motor que en produccion.
    Lo unico sustituido es de donde sale la sesion.
    """
    from fastapi.testclient import TestClient

    from app.api.deps import db_session
    from app.main import create_app

    factory = sessionmaker(bind=pg_engine, autoflush=False, expire_on_commit=False)

    def override_session() -> Iterator[Session]:
        with factory() as session:
            yield session

    app = create_app()
    app.dependency_overrides[db_session] = override_session

    with TestClient(app) as client:
        yield client

    app.dependency_overrides.clear()


@pytest.fixture
def cleanup_transactional_rows(pg_session):
    """Borra predicciones, cosechas y observaciones creadas por un test.

    TRUNCATE y no DELETE porque el trigger de inmutabilidad bloquea el DELETE
    sobre `predictions`. Es justo la friccion que se busco al escribirlo.
    """
    yield
    pg_session.execute(text("TRUNCATE TABLE predictions, harvests, observations"))
    pg_session.commit()


@pytest.fixture
def seeded_cell(pg_session):
    """La celda A-00240 del dataset sintetico (la favorable de la fase 3)."""
    cell_id = pg_session.execute(
        text("SELECT id FROM grid_cells WHERE cell_code = 'A-00240'")
    ).scalar()
    if cell_id is None:
        pytest.skip("El seed no esta cargado: ejecuta generate_demo_data.py --apply")
    return cell_id


@pytest.fixture
def seeded_cycle(pg_session):
    cycle_id = pg_session.execute(text("SELECT id FROM crop_cycles LIMIT 1")).scalar()
    if cycle_id is None:
        pytest.skip("El seed no esta cargado: ejecuta generate_demo_data.py --apply")
    return cycle_id


@pytest.fixture
def seeded_prediction(pg_session, seeded_cell, seeded_cycle):
    """Una prediccion real insertada para probar el trigger de inmutabilidad.

    Se limpia con TRUNCATE porque el propio trigger impide borrarla con DELETE.
    """
    prediction_id = pg_session.execute(
        text("""
        INSERT INTO predictions (cell_id, crop_cycle_id, model_version, projected_yield_kg,
            projected_boxes, estimated_loss_percentage, risk_score, risk_level, factors, inputs)
        VALUES (:cell, :cycle, 'rule-based-v0.1', 11.9634, 2, 9.18, 0.1492, 'low',
            '{"density_factor":1.0604,"soil_factor":1.0610,"health_factor":0.9290,
              "terrain_factor":0.9662,"base_yield_factor":0.9872}'::jsonb,
            '{"cell_code":"A-00240"}'::jsonb)
        RETURNING id
        """),
        {"cell": seeded_cell, "cycle": seeded_cycle},
    ).scalar()
    pg_session.commit()

    yield prediction_id

    pg_session.rollback()
    pg_session.execute(text("TRUNCATE TABLE predictions, harvests, observations"))
    pg_session.commit()
