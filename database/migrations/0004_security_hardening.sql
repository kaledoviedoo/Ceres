-- =============================================================================
-- CERES — 0004_security_hardening
--
-- Motivada por el linter de Supabase al desplegar por primera vez contra un
-- proyecto real (fase 4.5). Tres avisos, los tres reales:
--
--   ERROR  rls_disabled_in_public      x10 tablas
--   ERROR  security_definer_view       cell_performance
--   WARN   function_search_path_mutable  ceres_reject_prediction_mutation
--
-- El primero es el importante: Supabase publica automaticamente el esquema
-- `public` a traves de PostgREST. Sin RLS, cualquiera con la anon key (que es
-- publica por diseno y acaba en el bundle del frontend) podria leer y escribir
-- las 10 tablas. En un Postgres normal esto no pasaria; en Supabase si.
--
-- CERES no usa PostgREST: el backend se conecta por DATABASE_URL con el rol
-- `postgres`, que es propietario de las tablas y por tanto NO esta sujeto a RLS
-- (no se usa FORCE ROW LEVEL SECURITY). Activar RLS sin ninguna politica cierra
-- la puerta de PostgREST y deja intacto el acceso del backend.
--
-- Esto NO es el sistema de permisos del producto; eso llega cuando haya auth de
-- verdad. Es cerrar una puerta que Supabase abre por defecto.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. RLS activado, cero politicas => PostgREST no puede tocar nada.
-- -----------------------------------------------------------------------------
ALTER TABLE organizations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE farms            ENABLE ROW LEVEL SECURITY;
ALTER TABLE plots            ENABLE ROW LEVEL SECURITY;
ALTER TABLE crops            ENABLE ROW LEVEL SECURITY;
ALTER TABLE crop_cycles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE grid_cells       ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE observations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE harvests         ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 2. La vista debe evaluar permisos como quien consulta, no como quien la creo.
--    Sin esto, cell_performance seria una via para leer predictions y harvests
--    saltandose el RLS que acabamos de activar.
-- -----------------------------------------------------------------------------
ALTER VIEW cell_performance SET (security_invoker = on);

-- -----------------------------------------------------------------------------
-- 3. search_path fijo en la funcion del trigger.
--    Sin el, un rol con permiso de creacion en otro esquema podria anteponer
--    objetos suyos y alterar lo que hace la funcion.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ceres_reject_prediction_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
    RAISE EXCEPTION
        'Las predicciones son inmutables: no se puede % la fila %. Inserta una prediccion nueva.',
        lower(TG_OP), OLD.id
        USING ERRCODE = 'restrict_violation';
END;
$$;

INSERT INTO schema_migrations (version) VALUES ('0004_security_hardening')
ON CONFLICT (version) DO NOTHING;

COMMIT;
