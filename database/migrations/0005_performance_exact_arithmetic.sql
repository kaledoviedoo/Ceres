-- =============================================================================
-- CERES — 0005_performance_exact_arithmetic
--
-- Corrige una divergencia real entre la vista y la capa Python, encontrada por
-- el test diferencial de la fase 4.6.
--
-- La version anterior (0003) restaba en double precision y casteaba DESPUES:
--
--     round((abs(p.projected_yield_kg - h.actual_yield_kg))::numeric, 4)
--
-- PostgreSQL convierte double precision a numeric con 15 cifras significativas,
-- asi que el resultado binario 1.0002499999999999 se le convertia en 1.00025
-- —un empate exacto— y redondeaba a 1.0003. Python, que usa la representacion
-- mas corta que reproduce el float (17 cifras), veia un 4 en la quinta posicion
-- y daba 1.0002.
--
-- La correccion es castear CADA OPERANDO a numeric antes de operar, de modo que
-- la resta y la division ocurran en aritmetica decimal exacta. Los valores
-- almacenados tienen 4 decimales, asi que su conversion a numeric es exacta y
-- coincide con la de Python.
--
-- app/domain/performance.py hace exactamente lo mismo con `decimal.Decimal`.
-- Esa es la fuente de verdad conceptual; esta vista es su espejo para consultas
-- ad-hoc y BI. La paridad la vigila tests/postgres/test_performance_parity.py.
--
-- Solo cambia el CALCULO. El emparejamiento prediccion <-> cosecha es identico.
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

    -- Cada operando a numeric ANTES de restar: aritmetica decimal exacta.
    CASE
        WHEN h.actual_yield_kg IS NULL THEN NULL
        ELSE round(
            abs(p.projected_yield_kg::numeric - h.actual_yield_kg::numeric), 4
        )
    END                             AS absolute_error_kg,

    -- Error relativo respecto al valor REAL (convencion estandar de MAPE).
    -- NULL si el real es 0: no se inventa un porcentaje infinito.
    CASE
        WHEN h.actual_yield_kg IS NULL OR h.actual_yield_kg = 0 THEN NULL
        ELSE round(
            abs(p.projected_yield_kg::numeric - h.actual_yield_kg::numeric)
            / h.actual_yield_kg::numeric * 100, 4
        )
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
    'Espejo SQL de app/domain/performance.py para consultas ad-hoc y BI. La fuente de verdad conceptual es el modulo Python; la paridad la vigila tests/postgres/test_performance_parity.py.';

-- La vista se recrea, asi que hay que volver a fijar security_invoker (0004).
ALTER VIEW cell_performance SET (security_invoker = on);

INSERT INTO schema_migrations (version) VALUES ('0005_performance_exact_arithmetic')
ON CONFLICT (version) DO NOTHING;

COMMIT;
