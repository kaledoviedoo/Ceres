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

#: Variable de entorno con la que se autoriza la limpieza destructiva.
TRUNCATE_OPT_IN = "CERES_PG_TESTS_MAY_TRUNCATE"

#: Cuantas filas de mas hacen sospechar que la base guarda un dataset que estos
#: tests destruirian. Las que crea el propio paquete son unas pocas por test.
_UMBRAL_DATASET = 100


def _clean(session) -> None:
    session.rollback()
    for statement in CLEANUP_STATEMENTS:
        session.execute(text(statement))
    session.commit()


def _filas_en_riesgo(session) -> tuple[int, int, int]:
    """Predicciones, cosechas y observaciones sin autor que la limpieza borraria."""
    session.rollback()
    return session.execute(
        text("""
        SELECT (SELECT count(*) FROM predictions),
               (SELECT count(*) FROM harvests),
               (SELECT count(*) FROM observations WHERE created_by IS NULL)
        """)
    ).one()


@pytest.fixture(autouse=True)
def cleanup_transactional_rows(pg_session):
    """Deja la base como estaba: seed intacto, filas de test borradas.

    `autouse`: se aplica a todos los tests del paquete, antes y despues, para
    que ninguno dependa del orden ni herede basura de otro.

    POR QUE HAY UNA PUERTA DELANTE
    ------------------------------
    La limpieza es un `TRUNCATE` de tabla entera, y tiene que serlo: la
    migracion 0002 pone un trigger que prohibe `DELETE` sobre `predictions`, asi
    que no hay forma de borrar solo las filas del test. Mientras la base de
    desarrollo tuvo 0 predicciones y 0 cosechas eso no destruia nada.

    Dejo de ser inofensivo con la finca sintetica La Cuadricula: 120.000
    predicciones, 40.000 cosechas y 9.900 observaciones sin autor --que es
    justo lo que la segunda sentencia borra-- desaparecian al correr los tests,
    en silencio, y recargarlas cuesta tres minutos.

    Asi que la destruccion pasa a ser explicita. Si la base guarda un dataset,
    estos tests se saltan y dicen por que; para ejecutarlos hay que autorizarlo
    con la variable de entorno, sabiendo que despues habra que recargar.
    """
    predicciones, cosechas, observaciones = _filas_en_riesgo(pg_session)
    total = predicciones + cosechas + observaciones

    if total > _UMBRAL_DATASET and not os.environ.get(TRUNCATE_OPT_IN):
        pytest.skip(
            f"La base guarda un dataset que estos tests destruirian "
            f"({predicciones} predicciones, {cosechas} cosechas, "
            f"{observaciones} observaciones sin autor). Para ejecutarlos de "
            f"todas formas: {TRUNCATE_OPT_IN}=1, y despues recarga con "
            f"`py scripts/generate_cuadricula.py --apply`."
        )

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
def seeded_cycle(pg_session, seeded_cell):
    """El ciclo DEL LOTE de `seeded_cell`, no el primero que aparezca.

    Cogia `LIMIT 1` sin filtrar, lo cual funciono mientras hubo un solo ciclo en
    la base. Con la finca sintetica La Cuadricula hay cinco, y el que salia era
    de otro lote: la API respondia 409 --correctamente, porque una prediccion
    exige que celda y ciclo compartan lote-- y los tests se caian por un fallo
    del fixture, no del sistema.
    """
    cycle_id = pg_session.execute(
        text("""
        SELECT c.id FROM crop_cycles c
        JOIN grid_cells g ON g.plot_id = c.plot_id
        WHERE g.id = :cell
        LIMIT 1
        """),
        {"cell": seeded_cell},
    ).scalar()
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
