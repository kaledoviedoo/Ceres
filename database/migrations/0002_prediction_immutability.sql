-- =============================================================================
-- CERES — 0002_prediction_immutability
--
-- Una prediccion es una fotografia historica: responde "que predijo CERES en
-- ese momento y con que version del modelo". Si se pudiera editar, la historia
-- cambiaria retroactivamente y el ciclo de validacion perderia sentido.
--
-- La regla se aplica en la base de datos, no solo en el codigo, para que
-- tambien resista scripts sueltos y el editor SQL de Supabase.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION ceres_reject_prediction_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'Las predicciones son inmutables: no se puede % la fila %. Inserta una prediccion nueva.',
        lower(TG_OP), OLD.id
        USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER trg_predictions_immutable
    BEFORE UPDATE OR DELETE ON predictions
    FOR EACH ROW
    EXECUTE FUNCTION ceres_reject_prediction_mutation();

-- Nota: el borrado en cascada desde grid_cells / crop_cycles tampoco puede
-- ejecutarse mientras el trigger este activo. Es intencional: purgar datos de
-- demo requiere un DROP/TRUNCATE explicito (ver scripts/reset_demo_data.sql).

INSERT INTO schema_migrations (version) VALUES ('0002_prediction_immutability')
ON CONFLICT (version) DO NOTHING;

COMMIT;
