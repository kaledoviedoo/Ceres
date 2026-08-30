-- =============================================================================
-- CERES — reset de datos de demo
--
-- Borra TODOS los datos (incluidas predicciones historicas) sin tocar el
-- esquema. El trigger de inmutabilidad de `predictions` bloquea DELETE, asi que
-- hay que usar TRUNCATE, que no dispara triggers de fila.
--
-- Uso:
--   psql "$DATABASE_URL" -f scripts/reset_demo_data.sql
--   py scripts/generate_demo_data.py --apply
-- =============================================================================

BEGIN;

TRUNCATE TABLE
    harvests,
    observations,
    predictions,
    grid_cells,
    crop_cycles,
    crops,
    plots,
    farms,
    users,
    organizations
RESTART IDENTITY CASCADE;

COMMIT;
