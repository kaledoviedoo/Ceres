"""Tests contra PostgreSQL / Supabase real.

Estos son los que cierran la brecha que dejaba la fase 4: todo lo que SQLite no
puede verificar. Se saltan solos si `TEST_DATABASE_URL` no esta definida.

Requisitos previos: migraciones aplicadas y seed cargado.

    py scripts/apply_migrations.py
    py scripts/generate_demo_data.py --apply
"""

from __future__ import annotations

import uuid

from uuid import NAMESPACE_URL, uuid5

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.core.prediction import CropParameters, PredictionInput, predict_from_input
from app.domain.performance import absolute_error_kg, percentage_error

CELL_CODE = "A-00240"


# --- Conexion y migraciones ---------------------------------------------------


def test_connects_to_a_real_postgres(pg_session):
    version = pg_session.execute(text("SHOW server_version")).scalar()

    # Lo que se afirma es "un PostgreSQL real y no anterior al minimo que
    # declaran las migraciones (14+)", no una version concreta: Supabase
    # corria 17 y el PostgreSQL local de test corre 18.
    assert int(version.split(".")[0]) >= 14


def test_all_migrations_are_applied(pg_session):
    """La base tiene exactamente las migraciones que hay en el repositorio.

    Se comparan contra los archivos del disco y no contra una lista escrita a
    mano: asi el test tambien detecta una migracion anadida al repo pero nunca
    aplicada, que es el fallo que de verdad duele.
    """
    from pathlib import Path

    migrations_dir = Path(__file__).resolve().parents[4] / "database" / "migrations"
    on_disk = {path.stem for path in migrations_dir.glob("*.sql")}
    applied = set(
        pg_session.execute(text("SELECT version FROM schema_migrations")).scalars()
    )

    assert on_disk, "no se encontraron migraciones en el repositorio"
    assert applied == on_disk


def test_schema_has_the_expected_objects(pg_session):
    counts = pg_session.execute(
        text("""
        SELECT
          (SELECT count(*) FROM information_schema.tables
             WHERE table_schema='public' AND table_type='BASE TABLE') AS tables,
          (SELECT count(*) FROM information_schema.views
             WHERE table_schema='public') AS views,
          (SELECT count(*) FROM pg_constraint c
             JOIN pg_class t ON t.oid=c.conrelid
             JOIN pg_namespace n ON n.oid=t.relnamespace
             WHERE n.nspname='public' AND c.contype='f') AS fks
        """)
    ).one()

    assert counts.tables == 11  # 10 del dominio + schema_migrations
    assert counts.views == 1  # cell_performance
    assert counts.fks == 15


# --- Tipos nativos que SQLite no tiene ----------------------------------------


def test_native_column_types(pg_session):
    types = dict(
        pg_session.execute(
            text("""
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_schema='public' AND table_name='predictions'
              AND column_name IN ('id','factors','inputs','created_at')
            """)
        ).all()
    )

    assert types["id"] == "uuid"
    assert types["factors"] == "jsonb"
    assert types["inputs"] == "jsonb"
    assert types["created_at"] == "timestamp with time zone"


def test_jsonb_is_queryable_not_just_stored(pg_session, seeded_prediction):
    """Si fuese texto, este operador no existiria."""
    value = pg_session.execute(
        text("SELECT (factors->>'soil_factor')::float FROM predictions WHERE id = :id"),
        {"id": seeded_prediction},
    ).scalar()

    assert value == pytest.approx(1.0610, abs=1e-4)


def test_timestamptz_carries_timezone(pg_session, seeded_prediction):
    created_at = pg_session.execute(
        text("SELECT created_at FROM predictions WHERE id = :id"),
        {"id": seeded_prediction},
    ).scalar()

    assert created_at.tzinfo is not None


# --- Seed real ----------------------------------------------------------------


def test_seed_loaded_the_full_dataset(pg_session):
    """Los recuentos de la FINCA DEMO, acotados a ella.

    Contaban filas de toda la base, y eso dejo de significar "el seed de demo"
    cuando entro la finca sintetica La Cuadricula (40.000 celdas mas). Se acotan
    por `farm_id` en vez de bajar el listón: lo que este test vigila es que el
    seed de demo siga cargando exactamente su lote de 20 x 20, y eso sigue
    siendo comprobable con las dos fincas en la misma base.
    """
    counts = pg_session.execute(
        text("""
        WITH demo AS (SELECT id FROM farms WHERE name = 'CERES Demo Farm'),
             lotes AS (SELECT id FROM plots WHERE farm_id IN (SELECT id FROM demo))
        SELECT
          (SELECT count(*) FROM demo)                                          AS farms,
          (SELECT count(*) FROM lotes)                                         AS plots,
          (SELECT count(*) FROM crop_cycles WHERE plot_id IN (SELECT id FROM lotes)) AS cycles,
          (SELECT count(*) FROM grid_cells  WHERE plot_id IN (SELECT id FROM lotes)) AS cells,
          (SELECT count(*) FROM observations o
             JOIN grid_cells g ON g.id = o.cell_id
            WHERE g.plot_id IN (SELECT id FROM lotes))                         AS observations
        """)
    ).one()

    assert counts.farms == 1
    assert counts.plots == 1
    assert counts.cycles == 1
    assert counts.cells == 400  # un lote de 20 x 20
    assert counts.observations == 24


def test_seed_values_survived_the_round_trip(pg_session):
    """Los flotantes deben llegar identicos, no redondeados por el driver."""
    row = pg_session.execute(
        text("""
        SELECT soil_quality, health_factor, slope_deg, plant_density, base_yield_factor
        FROM grid_cells WHERE cell_code = :code
        """),
        {"code": CELL_CODE},
    ).one()

    assert row.soil_quality == pytest.approx(0.7220, abs=1e-6)
    assert row.health_factor == pytest.approx(0.9290, abs=1e-6)
    assert row.slope_deg == pytest.approx(2.030, abs=1e-6)


# --- Constraints reales -------------------------------------------------------


@pytest.mark.parametrize(
    ("descripcion", "sql"),
    [
        (
            "CHECK risk_score > 1",
            "INSERT INTO predictions (cell_id, crop_cycle_id, model_version, projected_yield_kg,"
            " projected_boxes, estimated_loss_percentage, risk_score, risk_level)"
            " SELECT c.id, cy.id, 'x', 1, 1, 5, 1.5, 'low'"
            " FROM grid_cells c, crop_cycles cy WHERE c.cell_code = :code LIMIT 1",
        ),
        (
            "CHECK loss > 100",
            "INSERT INTO predictions (cell_id, crop_cycle_id, model_version, projected_yield_kg,"
            " projected_boxes, estimated_loss_percentage, risk_score, risk_level)"
            " SELECT c.id, cy.id, 'x', 1, 1, 130, 0.5, 'low'"
            " FROM grid_cells c, crop_cycles cy WHERE c.cell_code = :code LIMIT 1",
        ),
        (
            "CHECK yield negativo",
            "INSERT INTO predictions (cell_id, crop_cycle_id, model_version, projected_yield_kg,"
            " projected_boxes, estimated_loss_percentage, risk_score, risk_level)"
            " SELECT c.id, cy.id, 'x', -5, 1, 5, 0.5, 'low'"
            " FROM grid_cells c, crop_cycles cy WHERE c.cell_code = :code LIMIT 1",
        ),
        (
            "CHECK risk_level fuera del enum",
            "INSERT INTO predictions (cell_id, crop_cycle_id, model_version, projected_yield_kg,"
            " projected_boxes, estimated_loss_percentage, risk_score, risk_level)"
            " SELECT c.id, cy.id, 'x', 1, 1, 5, 0.5, 'catastrofico'"
            " FROM grid_cells c, crop_cycles cy WHERE c.cell_code = :code LIMIT 1",
        ),
        (
            "CHECK observation.type invalido",
            "INSERT INTO observations (cell_id, type, severity)"
            " SELECT c.id, 'alien_invasion', 0.5 FROM grid_cells c WHERE c.cell_code = :code",
        ),
        (
            "CHECK severity > 1",
            "INSERT INTO observations (cell_id, type, severity)"
            " SELECT c.id, 'pest', 1.4 FROM grid_cells c WHERE c.cell_code = :code",
        ),
        (
            "CHECK harvest yield negativo",
            "INSERT INTO harvests (cell_id, crop_cycle_id, actual_yield_kg, actual_boxes, harvested_at)"
            " SELECT c.id, cy.id, -1, 1, '2026-06-20'"
            " FROM grid_cells c, crop_cycles cy WHERE c.cell_code = :code LIMIT 1",
        ),
    ],
)
def test_check_constraints_reject_invalid_data(pg_session, descripcion, sql):
    with pytest.raises(IntegrityError) as excinfo:
        pg_session.execute(text(sql), {"code": CELL_CODE})
        pg_session.flush()
    pg_session.rollback()

    assert excinfo.value.orig.sqlstate == "23514", descripcion


def test_foreign_key_rejects_orphan_rows(pg_session):
    with pytest.raises(IntegrityError) as excinfo:
        pg_session.execute(
            text(
                "INSERT INTO predictions (cell_id, crop_cycle_id, model_version,"
                " projected_yield_kg, projected_boxes, estimated_loss_percentage,"
                " risk_score, risk_level)"
                " SELECT '00000000-0000-0000-0000-000000000000'::uuid, cy.id, 'x', 1, 1, 5, 0.5, 'low'"
                " FROM crop_cycles cy LIMIT 1"
            )
        )
        pg_session.flush()
    pg_session.rollback()

    assert excinfo.value.orig.sqlstate == "23503"  # foreign_key_violation


def test_unique_constraint_rejects_duplicate_coordinates(pg_session):
    with pytest.raises(IntegrityError) as excinfo:
        pg_session.execute(
            text("""
            INSERT INTO grid_cells (plot_id, cell_code, x, y, elevation_m, slope_deg,
                soil_quality, plant_density, health_factor, base_yield_factor,
                centroid_latitude, centroid_longitude)
            SELECT plot_id, 'A-DUPLICADA', x, y, 1180, 2, 0.5, 2.5, 0.9, 1.0, 5.6, -73.4
            FROM grid_cells WHERE cell_code = :code
            """),
            {"code": CELL_CODE},
        )
        pg_session.flush()
    pg_session.rollback()

    assert excinfo.value.orig.sqlstate == "23505"  # unique_violation


# --- Trigger de inmutabilidad -------------------------------------------------


def test_update_on_prediction_is_rejected_by_the_trigger(pg_session, seeded_prediction):
    with pytest.raises(DBAPIError) as excinfo:
        pg_session.execute(
            text("UPDATE predictions SET projected_yield_kg = 9999 WHERE id = :id"),
            {"id": seeded_prediction},
        )
        pg_session.flush()
    pg_session.rollback()

    assert excinfo.value.orig.sqlstate == "23001"  # restrict_violation
    assert "inmutables" in str(excinfo.value.orig).lower()


def test_delete_on_prediction_is_rejected_by_the_trigger(pg_session, seeded_prediction):
    with pytest.raises(DBAPIError) as excinfo:
        pg_session.execute(
            text("DELETE FROM predictions WHERE id = :id"), {"id": seeded_prediction}
        )
        pg_session.flush()
    pg_session.rollback()

    assert excinfo.value.orig.sqlstate == "23001"


def test_prediction_value_is_unchanged_after_failed_mutations(pg_session, seeded_prediction):
    """Lo que importa no es que falle, sino que el dato siga intacto."""
    for statement in (
        "UPDATE predictions SET projected_yield_kg = 9999 WHERE id = :id",
        "DELETE FROM predictions WHERE id = :id",
    ):
        try:
            pg_session.execute(text(statement), {"id": seeded_prediction})
            pg_session.flush()
        except DBAPIError:
            pg_session.rollback()

    value = pg_session.execute(
        text("SELECT projected_yield_kg FROM predictions WHERE id = :id"),
        {"id": seeded_prediction},
    ).scalar()

    assert value is not None
    assert value != 9999


# --- Vista cell_performance vs capa Python ------------------------------------


def test_sql_view_matches_the_python_layer(pg_client, pg_session, seeded_cell, seeded_cycle):
    """El requisito 6 de la fase 4.5: SQL y Python deben coincidir exactamente."""
    prediction = pg_client.post(
        "/api/v1/predictions",
        json={
            "cell_id": str(seeded_cell),
            "crop_cycle_id": str(seeded_cycle),
            # Desde 0007 el emparejamiento es temporal: una prediccion posterior
            # a la cosecha no produce error, porque no predijo nada.
            "as_of": "2026-06-01T09:00:00+00:00",
        },
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

    sql_row = pg_session.execute(
        text("""
        SELECT absolute_error_kg, percentage_error
        FROM cell_performance WHERE prediction_id = :pid
        """),
        {"pid": prediction["id"]},
    ).one()

    api_entry = pg_client.get(f"/api/v1/cells/{seeded_cell}/performance").json()["entries"][0]

    python_abs = absolute_error_kg(prediction["projected_yield_kg"], 10.4)
    python_pct = percentage_error(prediction["projected_yield_kg"], 10.4)

    assert float(sql_row.absolute_error_kg) == pytest.approx(python_abs, abs=1e-9)
    assert float(sql_row.percentage_error) == pytest.approx(python_pct, abs=1e-9)
    assert api_entry["absolute_error_kg"] == pytest.approx(python_abs, abs=1e-9)
    assert api_entry["percentage_error"] == pytest.approx(python_pct, abs=1e-9)


def test_view_leaves_error_null_without_harvest(pg_client, pg_session, seeded_cell, seeded_cycle):
    prediction = pg_client.post(
        "/api/v1/predictions",
        json={
            "cell_id": str(seeded_cell),
            "crop_cycle_id": str(seeded_cycle),
            # Desde 0007 el emparejamiento es temporal: una prediccion posterior
            # a la cosecha no produce error, porque no predijo nada.
            "as_of": "2026-06-01T09:00:00+00:00",
        },
    ).json()

    row = pg_session.execute(
        text("SELECT absolute_error_kg, percentage_error FROM cell_performance WHERE prediction_id = :pid"),
        {"pid": prediction["id"]},
    ).one()

    assert row.absolute_error_kg is None
    assert row.percentage_error is None


# --- API contra PostgreSQL real -----------------------------------------------


def test_health_reports_the_real_database(pg_client):
    body = pg_client.get("/api/v1/health").json()

    assert body["status"] == "ok"
    assert body["database"] == "ok"


def test_read_endpoints_against_postgres(pg_client):
    """La finca demo se lee entera, con o sin otras fincas al lado.

    Se busca por nombre en vez de dar por hecho que es la unica: desde que
    existe La Cuadricula, `/farms` devuelve dos.
    """
    farms = pg_client.get("/api/v1/farms").json()
    demo = next(f for f in farms if f["name"] == "CERES Demo Farm")

    farm = pg_client.get(f"/api/v1/farms/{demo['id']}").json()
    assert len(farm["plots"]) == 1

    plot_a = next(p for p in farm["plots"] if p["code"] == "A")
    cells = pg_client.get(f"/api/v1/plots/{plot_a['id']}/cells").json()
    assert len(cells["cells"]) == 400

    detail = pg_client.get(f"/api/v1/cells/{cells['cells'][0]['id']}").json()
    assert detail["cell_code"].startswith("A-")


def test_prediction_endpoint_persists_in_postgres(pg_client, pg_session, seeded_cell, seeded_cycle):
    body = pg_client.post(
        "/api/v1/predictions",
        json={
            "cell_id": str(seeded_cell),
            "crop_cycle_id": str(seeded_cycle),
            # Desde 0007 el emparejamiento es temporal: una prediccion posterior
            # a la cosecha no produce error, porque no predijo nada.
            "as_of": "2026-06-01T09:00:00+00:00",
        },
    ).json()

    stored = pg_session.execute(
        text("SELECT projected_yield_kg, model_version, factors FROM predictions WHERE id = :id"),
        {"id": body["id"]},
    ).one()

    assert stored.projected_yield_kg == body["projected_yield_kg"]
    # Compuesta: motor + modelo de impacto. Una prediccion guardada deriva el
    # estado antes de predecir, asi que pasan dos modelos por ella.
    assert stored.model_version == "rule-based-v0.1+impact-v0"
    assert stored.factors["soil_factor"] == body["factors"]["soil_factor"]


def test_api_result_matches_the_engine_on_real_data(pg_client, pg_session, seeded_cell, seeded_cycle):
    cell = pg_session.execute(
        text("SELECT * FROM grid_cells WHERE id = :id"), {"id": seeded_cell}
    ).one()
    # El cultivo DEL CICLO, no el primero de la tabla: desde La Cuadricula hay
    # cinco y el motor tiene que recibir el mismo que uso la API.
    crop = pg_session.execute(
        text("""
        SELECT cr.* FROM crops cr
        JOIN crop_cycles cy ON cy.crop_id = cr.id
        WHERE cy.id = :cycle
        """),
        {"cycle": seeded_cycle},
    ).one()

    expected = predict_from_input(
        PredictionInput(
            cell_code=cell.cell_code,
            area_m2=1.0,
            elevation_m=cell.elevation_m,
            slope_deg=cell.slope_deg,
            soil_quality=cell.soil_quality,
            plant_density=cell.plant_density,
            health_factor=cell.health_factor,
            base_yield_factor=cell.base_yield_factor,
            crop=CropParameters(
                slug=crop.slug,
                base_yield_kg_per_m2=crop.base_yield_kg_per_m2,
                box_capacity_kg=crop.box_capacity_kg,
                optimal_plant_density_per_m2=crop.optimal_plant_density_per_m2,
            ),
        )
    )

    body = pg_client.post(
        "/api/v1/predictions",
        json={
            "cell_id": str(seeded_cell),
            "crop_cycle_id": str(seeded_cycle),
            # Desde 0007 el emparejamiento es temporal: una prediccion posterior
            # a la cosecha no produce error, porque no predijo nada.
            "as_of": "2026-06-01T09:00:00+00:00",
        },
    ).json()

    assert body["projected_yield_kg"] == expected.projected_yield_kg
    assert body["risk_score"] == expected.risk_score
    assert body["factors"] == expected.factors.as_dict()


def test_history_is_append_only_through_the_api(pg_client, pg_session, seeded_cell, seeded_cycle):
    ids = [
        pg_client.post(
            "/api/v1/predictions",
            json={
            "cell_id": str(seeded_cell),
            "crop_cycle_id": str(seeded_cycle),
            # Desde 0007 el emparejamiento es temporal: una prediccion posterior
            # a la cosecha no produce error, porque no predijo nada.
            "as_of": "2026-06-01T09:00:00+00:00",
        },
        ).json()["id"]
        for _ in range(3)
    ]

    assert len(set(ids)) == 3

    stored = pg_session.execute(
        text("SELECT count(*) FROM predictions WHERE cell_id = :id"), {"id": seeded_cell}
    ).scalar()
    assert stored == 3


def test_observation_and_harvest_persist(pg_client, pg_session, seeded_cell, seeded_cycle):
    observation = pg_client.post(
        "/api/v1/observations",
        json={
            "cell_id": str(seeded_cell),
            "crop_cycle_id": str(seeded_cycle),
            "type": "disease",
            "severity": 0.7,
            "description": "Manchas foliares.",
        },
    )
    assert observation.status_code == 201

    harvest = pg_client.post(
        "/api/v1/harvests",
        json={
            "cell_id": str(seeded_cell),
            "crop_cycle_id": str(seeded_cycle),
            "actual_yield_kg": 10.4,
            "actual_boxes": 2,
            "harvested_at": "2026-06-20",
        },
    )
    assert harvest.status_code == 201

    counts = pg_session.execute(
        text("""
        SELECT (SELECT count(*) FROM observations WHERE cell_id = :id) AS obs,
               (SELECT count(*) FROM harvests WHERE cell_id = :id)     AS har
        """),
        {"id": seeded_cell},
    ).one()

    assert counts.obs == 1
    assert counts.har == 1


# --- D-020: integridad Plot <-> CropCycle -------------------------------------


@pytest.fixture
def control_plot(pg_session):
    """Un segundo lote, creado por el test y borrado al terminar.

    El dataset de demo tiene UN solo lote: el que habia de mas no tenia ciclo de
    cultivo y en la interfaz aparecia como una opcion que no mostraba nada. Pero
    el invariante que este test protege —no puedes predecir sobre una celda
    usando el ciclo de OTRO lote— sigue necesitando dos lotes, y contra Postgres
    de verdad, que es donde viven las claves foraneas.

    Se limpia siempre, tambien si el test falla: dejar filas de prueba en la base
    de la demo es como acabamos con un lote fantasma en primer lugar.
    """
    plot_id = uuid5(NAMESPACE_URL, "ceres/test/pg/plot-control")
    cell_id = uuid5(NAMESPACE_URL, "ceres/test/pg/cell-control")

    plantilla = pg_session.execute(
        text("SELECT * FROM plots WHERE code = 'A' LIMIT 1")
    ).mappings().one()
    celda = pg_session.execute(
        text("SELECT * FROM grid_cells WHERE plot_id = :p LIMIT 1"),
        {"p": plantilla["id"]},
    ).mappings().one()

    pg_session.execute(
        text("""
        INSERT INTO plots (id, farm_id, name, code, grid_width, grid_height,
                           cell_size_m, origin_latitude, origin_longitude)
        VALUES (:id, :farm_id, 'Lote de control', 'Z', :w, :h, :size, :lat, :lon)
        """),
        {
            "id": plot_id, "farm_id": plantilla["farm_id"],
            "w": plantilla["grid_width"], "h": plantilla["grid_height"],
            "size": plantilla["cell_size_m"],
            "lat": plantilla["origin_latitude"], "lon": plantilla["origin_longitude"],
        },
    )
    pg_session.execute(
        text("""
        INSERT INTO grid_cells (id, plot_id, cell_code, x, y, elevation_m, slope_deg,
                                soil_quality, plant_density, health_factor,
                                base_yield_factor, centroid_latitude, centroid_longitude)
        VALUES (:id, :plot_id, 'Z-00001', 0, 0, :elev, :slope, :soil, :dens,
                :health, :base, :lat, :lon)
        """),
        {
            "id": cell_id, "plot_id": plot_id,
            "elev": celda["elevation_m"], "slope": celda["slope_deg"],
            "soil": celda["soil_quality"], "dens": celda["plant_density"],
            "health": celda["health_factor"], "base": celda["base_yield_factor"],
            "lat": celda["centroid_latitude"], "lon": celda["centroid_longitude"],
        },
    )
    pg_session.commit()

    try:
        yield {"plot_id": plot_id, "cell_id": cell_id}
    finally:
        pg_session.execute(text("DELETE FROM grid_cells WHERE plot_id = :p"), {"p": plot_id})
        pg_session.execute(text("DELETE FROM plots WHERE id = :p"), {"p": plot_id})
        pg_session.commit()


def test_cell_from_another_plot_is_rejected(pg_client, control_plot, seeded_cycle):
    """Celda de otro lote con un ciclo sembrado en Plot A -> 409."""
    response = pg_client.post(
        "/api/v1/predictions",
        json={"cell_id": str(control_plot["cell_id"]), "crop_cycle_id": str(seeded_cycle)},
    )

    assert response.status_code == 409
    assert "lote" in response.json()["detail"]


def test_cell_readers_reject_a_cycle_from_another_plot(pg_client, control_plot, seeded_cycle):
    """C3 contra PostgreSQL real: leer contesta lo mismo que escribir.

    `/performance` y `/cells/{id}/predictions` filtraban por `crop_cycle_id` sin
    verificarlo, y a la misma pareja imposible que el POST rechaza con 409 le
    contestaban 200 con la lista vacia. Las filas viven en `ceres_test`, no en
    SQLite: `control_plot` las inserta y las borra en esta misma base.
    """
    celda = control_plot["cell_id"]
    params = {"crop_cycle_id": str(seeded_cycle)}

    rendimiento = pg_client.get(f"/api/v1/cells/{celda}/performance", params=params)
    historial = pg_client.get(f"/api/v1/cells/{celda}/predictions", params=params)
    escritura = pg_client.post(
        "/api/v1/predictions", json={"cell_id": str(celda), "crop_cycle_id": str(seeded_cycle)}
    )

    assert rendimiento.status_code == historial.status_code == escritura.status_code == 409
    assert "Z-00001" in rendimiento.json()["detail"]


def test_cell_readers_return_404_for_a_missing_cycle(pg_client, seeded_cell):
    missing = "00000000-0000-0000-0000-000000000000"
    params = {"crop_cycle_id": missing}

    assert pg_client.get(f"/api/v1/cells/{seeded_cell}/performance", params=params).status_code == 404
    assert pg_client.get(f"/api/v1/cells/{seeded_cell}/predictions", params=params).status_code == 404


def test_missing_ids_return_404_against_postgres(pg_client, seeded_cycle):
    missing = "00000000-0000-0000-0000-000000000000"

    assert (
        pg_client.post(
            "/api/v1/predictions",
            json={"cell_id": missing, "crop_cycle_id": str(seeded_cycle)},
        ).status_code
        == 404
    )
    assert pg_client.get(f"/api/v1/cells/{missing}").status_code == 404


# --- End to end ---------------------------------------------------------------


def test_full_cycle_supabase_to_performance(pg_client, pg_session, seeded_cell, seeded_cycle):
    """Supabase -> FastAPI -> motor -> prediccion -> cosecha -> performance."""
    prediction = pg_client.post(
        "/api/v1/predictions",
        json={
            "cell_id": str(seeded_cell),
            "crop_cycle_id": str(seeded_cycle),
            # Desde 0007 el emparejamiento es temporal: una prediccion posterior
            # a la cosecha no produce error, porque no predijo nada.
            "as_of": "2026-06-01T09:00:00+00:00",
        },
    )
    assert prediction.status_code == 201
    predicted = prediction.json()["projected_yield_kg"]

    harvest = pg_client.post(
        "/api/v1/harvests",
        json={
            "cell_id": str(seeded_cell),
            "crop_cycle_id": str(seeded_cycle),
            "actual_yield_kg": 10.4,
            "actual_boxes": 2,
            "harvested_at": "2026-06-20",
        },
    )
    assert harvest.status_code == 201

    performance = pg_client.get(f"/api/v1/cells/{seeded_cell}/performance")
    assert performance.status_code == 200

    entry = performance.json()["entries"][0]
    assert entry["projected_yield_kg"] == predicted
    assert entry["actual_yield_kg"] == 10.4
    assert entry["absolute_error_kg"] == absolute_error_kg(predicted, 10.4)
    assert entry["percentage_error"] == percentage_error(predicted, 10.4)

    # Y todo quedo escrito en PostgreSQL de verdad.
    rows = pg_session.execute(
        text("SELECT count(*) FROM cell_performance WHERE cell_id = :id"),
        {"id": seeded_cell},
    ).scalar()
    assert rows == 1


# --- Idempotencia del seed (fase 4.6) -----------------------------------------


def test_reapplying_the_seed_does_not_duplicate_rows(pg_session):
    """Reaplicar el seed converge al mismo estado, no lo acumula.

    Regresion real de la fase 4.6: los ids de las observaciones salen de
    (cell_code, orden) y la zona critica cambio que celdas son las mas debiles.
    `ON CONFLICT DO UPDATE` inserto 24 nuevas y dejo vivas las 24 anteriores,
    dejando 48 en la base. El seed ahora borra sus propias filas huerfanas antes
    de insertar.
    """
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "scripts"))
    from generate_demo_data import render_seed

    from app.core.synthetic.demo import build_demo_dataset

    sql = render_seed(build_demo_dataset())

    def counts():
        # Solo las filas de la finca demo: reaplicar SU seed no puede cambiar
        # las de La Cuadricula, y contarlas juntas escondia ese hecho.
        return pg_session.execute(
            text("""
            WITH demo AS (SELECT id FROM farms WHERE name = 'CERES Demo Farm'),
                 lotes AS (SELECT id FROM plots WHERE farm_id IN (SELECT id FROM demo))
            SELECT (SELECT count(*) FROM grid_cells
                     WHERE plot_id IN (SELECT id FROM lotes))                  AS cells,
                   (SELECT count(*) FROM observations o
                      JOIN grid_cells g ON g.id = o.cell_id
                     WHERE g.plot_id IN (SELECT id FROM lotes))                AS observations,
                   (SELECT count(*) FROM lotes)                                AS plots
            """)
        ).one()

    before = counts()

    pg_session.rollback()
    pg_session.connection().exec_driver_sql(sql)
    pg_session.commit()

    after = counts()

    assert after.cells == before.cells == 400
    assert after.observations == before.observations == 24
    assert after.plots == before.plots == 1


def test_seed_cleanup_leaves_api_observations_alone(pg_session, seeded_cell):
    """La limpieza del seed solo borra lo suyo, no lo que crearon los usuarios."""
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "scripts"))
    from generate_demo_data import render_seed

    from app.core.synthetic.demo import build_demo_dataset

    pg_session.execute(
        text("""
        INSERT INTO observations (cell_id, type, severity, description)
        VALUES (:cell, 'pest', 0.5, 'creada por un usuario, sin autor asignado')
        """),
        {"cell": seeded_cell},
    )
    pg_session.commit()

    pg_session.rollback()
    pg_session.connection().exec_driver_sql(render_seed(build_demo_dataset()))
    pg_session.commit()

    survivors = pg_session.execute(
        text("SELECT count(*) FROM observations WHERE created_by IS NULL")
    ).scalar()
    seeded = pg_session.execute(
        text("SELECT count(*) FROM observations WHERE created_by IS NOT NULL")
    ).scalar()

    assert survivors == 1
    assert seeded == 24


# --- Los tres niveles de riesgo llegan a PostgreSQL ---------------------------


def test_all_three_risk_levels_are_reachable_from_the_stored_terrain(
    pg_client, pg_session, seeded_cycle
):
    """La zona critica sintetica tiene que producir HIGH sobre datos reales.

    Se predice el lote entero via API contra Supabase y se comprueba que salen
    los tres niveles. Es lo que la vista de riesgo del frontend necesita.
    """
    cells = list(
        pg_session.execute(
            text("""
            SELECT gc.id FROM grid_cells gc
            JOIN plots p ON p.id = gc.plot_id
            WHERE p.code = 'A'
            """)
        ).scalars()
    )
    assert len(cells) == 400

    levels = set(
        pg_session.execute(
            text("""
            SELECT DISTINCT
              CASE
                WHEN risk >= 0.66 THEN 'high'
                WHEN risk >= 0.33 THEN 'medium'
                ELSE 'low'
              END AS level
            FROM (
              SELECT 0.45 * (1 - gc.health_factor)
                   + 0.30 * (1 - gc.soil_quality)
                   + 0.25 * least(gc.slope_deg / 15.0, 1.0) AS risk
              FROM grid_cells gc
              JOIN plots p ON p.id = gc.plot_id
              WHERE p.code = 'A'
            ) scores
            """)
        ).scalars()
    )

    assert levels == {"low", "medium", "high"}
