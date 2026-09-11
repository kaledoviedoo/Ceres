-- =============================================================================
-- CERES — 0006_temporal_axis
--
-- Dos columnas, y las dos existen para poder distinguir cosas que hasta ahora
-- se confundian.
--
-- 1. observations.source_kind
--
--    Una observacion puede ser una medicion de campo o un dato generado. Hasta
--    ahora no habia forma de saberlo: las 24 filas del dataset las escribio
--    `app.core.synthetic.demo` y no llevan ninguna marca.
--
--    Importa porque a partir de esta migracion una observacion puede MOVER el
--    estado de una celda, y solo una medicion tiene derecho a hacerlo. Las 24
--    actuales tienen `severity` correlacionada -0,94 con `health_factor`
--    —es esa misma variable recodificada—, asi que aplicarlas seria usar la
--    sanidad como prueba de que la sanidad bajo.
--
--    El DEFAULT es 'synthetic' y no 'measured' por la misma razon que en el
--    resto del contrato: afirmar una medicion que no existe es la unica mentira
--    que un cliente no puede detectar. Las filas ya existentes quedan marcadas
--    como lo que son.
--
-- 2. predictions.as_of
--
--    `created_at` dice CUANDO SE EJECUTO la prediccion. No dice DE QUE MOMENTO
--    habla. Sin esa distincion, dos predicciones lanzadas hoy sobre el estado de
--    marzo y el de mayo son indistinguibles en la tabla, y una serie temporal
--    ordenada por `created_at` mezclaria el orden de ejecucion con el orden de
--    los hechos.
--
--    NULL significa "el estado base, sin fechar": es lo que describen todas las
--    predicciones anteriores a esta migracion, si las hubiera. Hoy hay cero.
-- =============================================================================

BEGIN;

ALTER TABLE observations
    ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'synthetic';

ALTER TABLE observations
    DROP CONSTRAINT IF EXISTS observations_source_kind_valid;

ALTER TABLE observations
    ADD CONSTRAINT observations_source_kind_valid
    CHECK (source_kind IN ('measured', 'derived', 'estimated', 'synthetic', 'unknown'));

COMMENT ON COLUMN observations.source_kind IS
    'Procedencia de la observacion. Solo `measured` modifica el estado derivado de la celda.';

ALTER TABLE predictions
    ADD COLUMN IF NOT EXISTS as_of timestamptz;

COMMENT ON COLUMN predictions.as_of IS
    'De que momento del estado agronomico habla. NULL = estado base. Distinto de created_at, que es cuando se ejecuto.';

-- Consultar la serie de una celda ordenada por el momento del que habla, que es
-- lo que pedira el historico en cuanto exista.
CREATE INDEX IF NOT EXISTS predictions_cell_as_of_idx
    ON predictions (cell_id, as_of DESC);

INSERT INTO schema_migrations (version) VALUES ('0006_temporal_axis')
ON CONFLICT (version) DO NOTHING;

COMMIT;
