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

## Advertencia y aislamiento

Estos tests **escriben** en la base de datos apuntada por `TEST_DATABASE_URL`.
Usa un proyecto desechable, nunca uno con datos que te importen.

En el MVP `TEST_DATABASE_URL` apunta a la MISMA base que `DATABASE_URL`: el
proyecto Supabase `ceres-mvp` existe solo para esto y sus datos son sinteticos.
Eso obliga a que la limpieza sea quirurgica:

- `predictions` y `harvests` se vacian con TRUNCATE. El seed no crea ninguna
  fila en esas tablas, asi que vaciarlas no destruye nada. TRUNCATE y no DELETE
  porque el trigger de inmutabilidad bloquea el DELETE sobre `predictions`: es
  justo la friccion que se busco al escribirlo.
- `observations` NO se vacia. El seed carga 24 y hay un test que las cuenta. Las
  creadas por los tests se distinguen porque llegan por la API, que todavia no
  asigna autor (`created_by IS NULL`), mientras que las del seed llevan el
  usuario agronomo. Solo se borran las primeras.

Cuando exista autenticacion, `created_by` dejara de servir como discriminador y
habra que separar las bases o marcar las filas de test de otra forma.
"""

from __future__ import annotations

import json
import os
import pathlib
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

def pytest_collection_modifyitems(config, items):
    """Marca `postgres` y salta todo lo de este directorio si no hay credenciales.

    Un `pytestmark` a nivel de conftest NO se propaga a los modulos de test; hay
    que hacerlo con este hook. Se filtra por ruta para no marcar los tests de
    unit/ ni de integration/.
    """
    here = pathlib.Path(__file__).parent
    skip = pytest.mark.skip(
        reason="TEST_DATABASE_URL no definida: se omiten los tests contra PostgreSQL real"
    )

    for item in items:
        try:
            item_path = pathlib.Path(str(item.fspath))
        except AttributeError:  # pragma: no cover
            continue
        if here not in item_path.parents:
            continue
        item.add_marker(pytest.mark.postgres)
        if not TEST_DATABASE_URL:
            item.add_marker(skip)


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


#: Limpieza que preserva el seed. Ver el aislamiento explicado arriba.
CLEANUP_STATEMENTS = (
    "TRUNCATE TABLE predictions, harvests",
    "DELETE FROM observations WHERE created_by IS NULL",
)


def _clean(session) -> None:
    session.rollback()
    for statement in CLEANUP_STATEMENTS:
        session.execute(text(statement))
    session.commit()


@pytest.fixture(autouse=True)
def cleanup_transactional_rows(pg_session):
    """Deja la base como estaba: seed intacto, filas de test borradas.

    `autouse`: se aplica a todos los tests del paquete, antes y despues, para
    que ninguno dependa del orden ni herede basura de otro.
    """
    _clean(pg_session)
    yield
    _clean(pg_session)


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
    # El JSON viaja como parametro, no como literal incrustado: dentro de
    # `text()` cada `:` de un literal JSON ("soil_factor":1.06) se interpretaria
    # como un parametro de vinculacion.
    factors = json.dumps(
        {
            "density_factor": 1.0604,
            "soil_factor": 1.0610,
            "health_factor": 0.9290,
            "terrain_factor": 0.9662,
            "base_yield_factor": 0.9872,
        }
    )
    inputs = json.dumps({"cell_code": "A-00240"})

    prediction_id = pg_session.execute(
        text("""
        INSERT INTO predictions (cell_id, crop_cycle_id, model_version, projected_yield_kg,
            projected_boxes, estimated_loss_percentage, risk_score, risk_level, factors, inputs)
        VALUES (:cell, :cycle, 'rule-based-v0.1', 11.9634, 2, 9.18, 0.1492, 'low',
            CAST(:factors AS jsonb), CAST(:inputs AS jsonb))
        RETURNING id
        """),
        {
            "cell": seeded_cell,
            "cycle": seeded_cycle,
            "factors": factors,
            "inputs": inputs,
        },
    ).scalar()
    pg_session.commit()
    return prediction_id
