-- =============================================================================
-- CERES — 0007_performance_temporal_pairing
--
-- La vista emparejaba TODA prediccion de un ciclo con la cosecha de ese ciclo,
-- sin mirar fechas. Se escribio antes de que existiera `predictions.as_of`
-- (migracion 0006) y desde entonces dice algo falso: que la diferencia entre
-- una prediccion POSTERIOR a la cosecha y el rendimiento real es un error de
-- prediccion. No lo es. Esa prediccion no predijo nada; describia un lote ya
-- recogido.
--
-- LA REGLA, la misma que `app/domain/performance.py`:
--
--     una prediccion se empareja con una cosecha si
--         as_of < harvested_at a las 00:00 UTC
--
-- El inicio del dia y no el final porque la cosecha ocurrio en algun momento de
-- ese dia y no sabemos cual: una prediccion fechada ese mismo dia pudo hacerse
-- con el fruto ya recogido. Entre perder un emparejamiento legitimo y afirmar
-- un error de prediccion que no lo es, se pierde el emparejamiento.
--
-- `as_of IS NULL` no empareja: un estado sin fecha no se puede situar antes ni
-- despues de nada.
--
-- Se anade tambien `as_of` a la vista. Sin esa columna, quien consulte desde un
-- BI ve `predicted_at` —el momento de EJECUCION— y no tiene forma de saber de
-- que momento habla cada fila.
--
-- Python sigue siendo la fuente de verdad; esto es el espejo, y la paridad la
-- vigila `tests/postgres/test_performance_parity.py`.
-- =============================================================================

BEGIN;

-- DROP y CREATE, no CREATE OR REPLACE: `as_of` va en medio del SELECT y
-- PostgreSQL solo deja anadir columnas al final al reemplazar una vista
-- ("cannot change name of view column"). Nada depende de esta vista salvo BI y
-- tests, asi que recrearla es seguro.
DROP VIEW IF EXISTS cell_performance;

CREATE VIEW cell_performance AS
SELECT
    p.id                            AS prediction_id,
    p.cell_id,
    gc.cell_code,
    p.crop_cycle_id,
    p.created_at                    AS predicted_at,
    p.as_of,
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
      -- La regla temporal. `p.as_of IS NULL` hace la condicion NULL y la fila
      -- no entra, que es exactamente lo que se quiere.
      --
      -- `::timestamp AT TIME ZONE 'UTC'` y NO `::timestamptz AT TIME ZONE
      -- 'UTC'`, que es lo que parece equivalente y no lo es: el segundo
      -- interpreta la fecha en la zona de LA SESION y luego la convierte, asi
      -- que con TimeZone='America/Bogota' el corte se iba a las 05:00 UTC.
      -- Comprobado contra Postgres antes de escribir esto. El primero toma la
      -- medianoche sin zona y la declara UTC: mismo instante en cualquier
      -- sesion.
      AND p.as_of < (hv.harvested_at::timestamp AT TIME ZONE 'UTC')
    ORDER BY hv.harvested_at DESC, hv.created_at DESC
    LIMIT 1
) h ON TRUE;

COMMENT ON VIEW cell_performance IS
    'Espejo SQL de app/domain/performance.py para consultas ad-hoc y BI. Empareja una prediccion con una cosecha solo si as_of precede al dia de la cosecha. La fuente de verdad conceptual es el modulo Python; la paridad la vigila tests/postgres/test_performance_parity.py.';

-- La vista se recrea, asi que hay que volver a fijar security_invoker (0004).
ALTER VIEW cell_performance SET (security_invoker = on);

INSERT INTO schema_migrations (version) VALUES ('0007_performance_temporal_pairing')
ON CONFLICT (version) DO NOTHING;

COMMIT;
