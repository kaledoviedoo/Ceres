-- =============================================================================
-- CERES — 0003_cell_performance_view
--
-- Prediccion vs realidad. La comparacion vive en SQL (una sola definicion) en
-- lugar de repetirse en el backend y en el frontend.
--
-- Emparejamiento: para cada prediccion se busca la cosecha de la misma celda y
-- el mismo ciclo de cultivo. Si una celda se cosecha varias veces en un ciclo,
-- se toma la mas reciente; el MVP asume una cosecha por celda y ciclo.
-- =============================================================================

BEGIN;

CREATE OR REPLACE VIEW cell_performance AS
SELECT
    p.id                            AS prediction_id,
    p.cell_id,
    gc.cell_code,
    p.crop_cycle_id,
    p.created_at                    AS predicted_at,
    p.model_version,
    p.projected_yield_kg,
    p.projected_boxes,
    p.estimated_loss_percentage,
    p.risk_score,
    p.risk_level,

    h.id                            AS harvest_id,
    h.harvested_at,
    h.actual_yield_kg,
    h.actual_boxes,

    CASE
        WHEN h.actual_yield_kg IS NULL THEN NULL
        ELSE abs(p.projected_yield_kg - h.actual_yield_kg)
    END                             AS absolute_error_kg,

    -- Error relativo respecto al valor REAL (convencion estandar de MAPE).
    -- Se deja NULL si el real es 0: no se inventa un porcentaje infinito.
    CASE
        WHEN h.actual_yield_kg IS NULL OR h.actual_yield_kg = 0 THEN NULL
        ELSE abs(p.projected_yield_kg - h.actual_yield_kg) / h.actual_yield_kg * 100.0
    END                             AS percentage_error

FROM predictions p
JOIN grid_cells gc ON gc.id = p.cell_id
LEFT JOIN LATERAL (
    SELECT hv.*
    FROM harvests hv
    WHERE hv.cell_id = p.cell_id
      AND hv.crop_cycle_id = p.crop_cycle_id
    ORDER BY hv.harvested_at DESC, hv.created_at DESC
    LIMIT 1
) h ON TRUE;

COMMENT ON VIEW cell_performance IS
    'Prediccion emparejada con su cosecha real. absolute_error_kg y percentage_error son NULL mientras no exista cosecha.';

INSERT INTO schema_migrations (version) VALUES ('0003_cell_performance_view')
ON CONFLICT (version) DO NOTHING;

COMMIT;
