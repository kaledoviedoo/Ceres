-- =============================================================================
-- CERES — 0001_init
-- Esquema base del Digital Twin agricola (MVP).
--
-- Fuente de verdad del esquema. Los modelos de apps/api/app/models/ deben
-- mantenerse sincronizados con este archivo.
--
-- Compatible con PostgreSQL 14+ y con Supabase.
-- =============================================================================

BEGIN;

-- gen_random_uuid() es nativo desde PG13, pero pgcrypto lo garantiza en
-- instalaciones mas antiguas y esta disponible en Supabase.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- Control de migraciones aplicadas
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- organizations — tenant raiz
-- -----------------------------------------------------------------------------
CREATE TABLE organizations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL,
    slug        varchar(64) NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE organizations IS 'Tenant raiz. Todo el resto del modelo cuelga de aqui.';

-- -----------------------------------------------------------------------------
-- users — permisos finos y RLS quedan fuera del MVP
-- -----------------------------------------------------------------------------
CREATE TABLE users (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    email            text        NOT NULL UNIQUE,
    full_name        text        NOT NULL,
    role             varchar(32) NOT NULL DEFAULT 'viewer',
    created_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ck_users_role_valid
        CHECK (role IN ('owner', 'agronomist', 'viewer'))
);

CREATE INDEX ix_users_organization_id ON users (organization_id);

-- -----------------------------------------------------------------------------
-- farms — finca
-- -----------------------------------------------------------------------------
CREATE TABLE farms (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    name             text        NOT NULL,
    country          varchar(2)  NOT NULL DEFAULT 'CO',
    region           text,
    -- Centroide aproximado. Cuando entre PostGIS se sustituye por
    -- geography(Point, 4326); mientras tanto, columnas planas.
    latitude         double precision NOT NULL,
    longitude        double precision NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ck_farms_latitude_range  CHECK (latitude  BETWEEN -90  AND 90),
    CONSTRAINT ck_farms_longitude_range CHECK (longitude BETWEEN -180 AND 180)
);

CREATE INDEX ix_farms_organization_id ON farms (organization_id);

-- -----------------------------------------------------------------------------
-- plots — lote y definicion de su malla
-- -----------------------------------------------------------------------------
CREATE TABLE plots (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    farm_id           uuid        NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
    name              text        NOT NULL,
    -- Prefijo corto usado para construir cell_code legible: 'A' -> 'A-00001'.
    code              varchar(8)  NOT NULL,

    grid_width        integer     NOT NULL,
    grid_height       integer     NOT NULL,
    -- Lado de la celda en metros. 1.0 en el MVP => cada celda es ~1 m2.
    cell_size_m       double precision NOT NULL DEFAULT 1.0,

    -- Esquina suroeste de la malla (x=0, y=0).
    -- x crece hacia el este, y crece hacia el norte.
    origin_latitude   double precision NOT NULL,
    origin_longitude  double precision NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_plots_farm_id_code UNIQUE (farm_id, code),
    CONSTRAINT ck_plots_grid_dimensions_positive CHECK (grid_width > 0 AND grid_height > 0),
    CONSTRAINT ck_plots_cell_size_positive       CHECK (cell_size_m > 0)
);

CREATE INDEX ix_plots_farm_id ON plots (farm_id);

-- -----------------------------------------------------------------------------
-- crops — catalogo de cultivos con sus parametros agronomicos
-- -----------------------------------------------------------------------------
CREATE TABLE crops (
    id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id               uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    name                          text        NOT NULL,
    slug                          varchar(64) NOT NULL,
    variety                       text,

    -- kg que caben en una caja de cosecha (projected_boxes).
    box_capacity_kg               double precision NOT NULL,
    -- Rendimiento de referencia en condiciones ideales (kg/m2).
    base_yield_kg_per_m2          double precision NOT NULL,
    -- Densidad de siembra optima (plantas/m2).
    optimal_plant_density_per_m2  double precision NOT NULL,
    cycle_days                    integer,
    created_at                    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_crops_organization_id_slug UNIQUE (organization_id, slug),
    CONSTRAINT ck_crops_box_capacity_positive     CHECK (box_capacity_kg > 0),
    CONSTRAINT ck_crops_base_yield_positive       CHECK (base_yield_kg_per_m2 > 0),
    CONSTRAINT ck_crops_optimal_density_positive  CHECK (optimal_plant_density_per_m2 > 0)
);

-- -----------------------------------------------------------------------------
-- crop_cycles — lo que ata un cultivo a un lote en una temporada concreta.
-- Un lote puede sembrar productos distintos en temporadas distintas, por eso
-- el cultivo NO cuelga directamente del lote.
-- -----------------------------------------------------------------------------
CREATE TABLE crop_cycles (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plot_id              uuid        NOT NULL REFERENCES plots (id) ON DELETE CASCADE,
    crop_id              uuid        NOT NULL REFERENCES crops (id) ON DELETE RESTRICT,
    name                 text        NOT NULL,
    slug                 varchar(64) NOT NULL,
    status               varchar(16) NOT NULL DEFAULT 'active',
    planted_at           date,
    expected_harvest_at  date,
    created_at           timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_crop_cycles_plot_id_slug UNIQUE (plot_id, slug),
    CONSTRAINT ck_crop_cycles_status_valid
        CHECK (status IN ('planned', 'active', 'harvested', 'closed')),
    CONSTRAINT ck_crop_cycles_dates_ordered
        CHECK (expected_harvest_at IS NULL OR planted_at IS NULL
               OR expected_harvest_at >= planted_at)
);

CREATE INDEX ix_crop_cycles_plot_id ON crop_cycles (plot_id);
CREATE INDEX ix_crop_cycles_crop_id ON crop_cycles (crop_id);

-- -----------------------------------------------------------------------------
-- grid_cells — la unidad atomica del Digital Twin (~1 m2).
-- Guarda estado estatico del terreno, nunca resultados.
-- -----------------------------------------------------------------------------
CREATE TABLE grid_cells (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plot_id             uuid        NOT NULL REFERENCES plots (id) ON DELETE CASCADE,
    -- Identificador legible y estable, p.ej. 'A-00123'. La identidad canonica
    -- sigue siendo id; cell_code es para humanos y UI.
    cell_code           varchar(24) NOT NULL,
    x                   integer     NOT NULL,  -- 0 = oeste
    y                   integer     NOT NULL,  -- 0 = sur

    elevation_m         double precision NOT NULL,  -- msnm
    slope_deg           double precision NOT NULL,  -- grados
    soil_quality        double precision NOT NULL,  -- 0 pobre .. 1 optimo
    plant_density       double precision NOT NULL,  -- plantas/m2
    health_factor       double precision NOT NULL,  -- 0 muerto .. 1 sano
    base_yield_factor   double precision NOT NULL,  -- multiplicador residual, ~1.0

    centroid_latitude   double precision NOT NULL,
    centroid_longitude  double precision NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_grid_cells_plot_id_x_y       UNIQUE (plot_id, x, y),
    CONSTRAINT uq_grid_cells_plot_id_cell_code UNIQUE (plot_id, cell_code),
    CONSTRAINT ck_grid_cells_coordinates_non_negative CHECK (x >= 0 AND y >= 0),
    CONSTRAINT ck_grid_cells_slope_range              CHECK (slope_deg BETWEEN 0 AND 90),
    CONSTRAINT ck_grid_cells_soil_quality_range       CHECK (soil_quality BETWEEN 0 AND 1),
    CONSTRAINT ck_grid_cells_health_factor_range      CHECK (health_factor BETWEEN 0 AND 1),
    CONSTRAINT ck_grid_cells_plant_density_non_negative CHECK (plant_density >= 0),
    CONSTRAINT ck_grid_cells_base_yield_factor_positive CHECK (base_yield_factor > 0)
);

CREATE INDEX ix_grid_cells_plot_id ON grid_cells (plot_id);

-- -----------------------------------------------------------------------------
-- predictions — fotografia historica e INMUTABLE de lo que CERES estimo.
-- Nunca se sobrescribe: cada ejecucion del motor inserta una fila nueva.
-- (La inmutabilidad se refuerza con un trigger en 0002.)
-- -----------------------------------------------------------------------------
CREATE TABLE predictions (
    id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cell_id                    uuid        NOT NULL REFERENCES grid_cells (id) ON DELETE CASCADE,
    crop_cycle_id              uuid        NOT NULL REFERENCES crop_cycles (id) ON DELETE CASCADE,

    model_version              varchar(32) NOT NULL,

    projected_yield_kg         double precision NOT NULL,
    projected_boxes            integer          NOT NULL,
    estimated_loss_percentage  double precision NOT NULL,
    risk_score                 double precision NOT NULL,
    risk_level                 varchar(16)      NOT NULL,

    -- Desglose explicable: {"soil_factor": 1.1, "health_factor": 0.85, ...}
    factors                    jsonb       NOT NULL DEFAULT '{}'::jsonb,
    -- Copia de las entradas, para poder reproducir la prediccion aunque la
    -- celda cambie despues.
    inputs                     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at                 timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ck_predictions_yield_non_negative CHECK (projected_yield_kg >= 0),
    CONSTRAINT ck_predictions_boxes_non_negative CHECK (projected_boxes >= 0),
    CONSTRAINT ck_predictions_loss_percentage_range
        CHECK (estimated_loss_percentage BETWEEN 0 AND 100),
    CONSTRAINT ck_predictions_risk_score_range CHECK (risk_score BETWEEN 0 AND 1),
    CONSTRAINT ck_predictions_risk_level_valid CHECK (risk_level IN ('low', 'medium', 'high'))
);

-- Consulta dominante: historial de una celda, mas reciente primero.
CREATE INDEX ix_predictions_cell_id_created_at ON predictions (cell_id, created_at DESC);
CREATE INDEX ix_predictions_crop_cycle_id      ON predictions (crop_cycle_id);

-- -----------------------------------------------------------------------------
-- observations — lo que un humano ve en campo
-- -----------------------------------------------------------------------------
CREATE TABLE observations (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cell_id        uuid        NOT NULL REFERENCES grid_cells (id) ON DELETE CASCADE,
    -- Opcional: puede haber observaciones fuera de un ciclo de cultivo.
    crop_cycle_id  uuid        REFERENCES crop_cycles (id) ON DELETE SET NULL,
    type           varchar(32) NOT NULL,
    severity       double precision NOT NULL,  -- 0 irrelevante .. 1 critico
    description    text,
    observed_at    timestamptz NOT NULL DEFAULT now(),
    created_by     uuid        REFERENCES users (id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ck_observations_severity_range CHECK (severity BETWEEN 0 AND 1),
    CONSTRAINT ck_observations_type_valid
        CHECK (type IN ('pest', 'disease', 'water_stress', 'physical_damage', 'other'))
);

CREATE INDEX ix_observations_cell_id_observed_at ON observations (cell_id, observed_at DESC);
CREATE INDEX ix_observations_crop_cycle_id       ON observations (crop_cycle_id);

-- -----------------------------------------------------------------------------
-- harvests — el ground truth contra el que se valida la prediccion
-- -----------------------------------------------------------------------------
CREATE TABLE harvests (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cell_id          uuid        NOT NULL REFERENCES grid_cells (id) ON DELETE CASCADE,
    crop_cycle_id    uuid        NOT NULL REFERENCES crop_cycles (id) ON DELETE CASCADE,
    actual_yield_kg  double precision NOT NULL,
    actual_boxes     integer          NOT NULL,
    harvested_at     date        NOT NULL,
    notes            text,
    created_by       uuid        REFERENCES users (id) ON DELETE SET NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ck_harvests_actual_yield_non_negative CHECK (actual_yield_kg >= 0),
    CONSTRAINT ck_harvests_actual_boxes_non_negative CHECK (actual_boxes >= 0)
);

CREATE INDEX ix_harvests_cell_id_harvested_at ON harvests (cell_id, harvested_at DESC);
CREATE INDEX ix_harvests_crop_cycle_id        ON harvests (crop_cycle_id);

INSERT INTO schema_migrations (version) VALUES ('0001_init')
ON CONFLICT (version) DO NOTHING;

COMMIT;
