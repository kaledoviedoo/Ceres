"""La barrera que impide vaciar una base que no es de test.

Los tests de `tests/postgres/` hacen TRUNCATE de tablas enteras. Hasta ahora lo
unico que los frenaba era contar filas: si la base guardaba un dataset, se
saltaban. Eso protege el dataset, no la base. `TEST_DATABASE_URL` apuntaba al
MISMO Supabase que `DATABASE_URL`, y con la variable de opt-in puesta la
limpieza habria corrido igual.

La barrera mira a DONDE apunta la URL, no cuantas filas hay, y no la levanta
ninguna variable de entorno. Se prueba aqui, en SQLite, porque es una funcion
pura sobre la URL: no hace falta ninguna base para saber que un host de
Supabase no es un destino que se pueda vaciar.
"""

from __future__ import annotations

import pytest

from tests.postgres.guard import razon_destino_inseguro

APP = "postgresql+psycopg://postgres:secreto@db.abcdefghij.supabase.co:5432/postgres"


def test_la_misma_base_que_la_aplicacion_no_es_segura():
    # El caso real de este repositorio: TEST_DATABASE_URL == DATABASE_URL.
    motivo = razon_destino_inseguro(APP, APP)

    assert motivo is not None
    assert "DATABASE_URL" in motivo


def test_supabase_nunca_es_segura_aunque_no_sea_la_base_de_la_aplicacion():
    otra = "postgresql+psycopg://postgres:x@db.zzzzzzzzzz.supabase.co:5432/postgres"

    assert razon_destino_inseguro(otra, APP) is not None


def test_el_pooler_de_supabase_tampoco():
    pooler = "postgresql+psycopg://postgres.ref:x@aws-0-us-east-1.pooler.supabase.com:6543/postgres"

    assert razon_destino_inseguro(pooler, APP) is not None


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "[::1]"])
def test_una_base_local_llamada_ceres_test_es_segura(host):
    assert razon_destino_inseguro(f"postgresql+psycopg://ceres:ceres@{host}:5432/ceres_test", APP) is None


def test_una_base_local_con_el_nombre_de_la_aplicacion_no_lo_es():
    # `ceres` es el nombre por defecto de `database_url` en config.py: si alguien
    # desarrolla contra un Postgres local, esa base tiene sus datos.
    local_app = "postgresql+psycopg://ceres:ceres@localhost:5432/ceres"

    assert razon_destino_inseguro("postgresql+psycopg://ceres:ceres@localhost:5432/ceres", local_app)


def test_una_base_remota_solo_es_segura_si_se_llama_test():
    remota = "postgresql+psycopg://u:p@pg.interno.example:5432/{base}"

    assert razon_destino_inseguro(remota.format(base="ceres"), APP) is not None
    assert razon_destino_inseguro(remota.format(base="ceres_test"), APP) is None


def test_sin_url_de_aplicacion_la_regla_de_host_sigue_valiendo():
    assert razon_destino_inseguro(APP, None) is not None
    assert razon_destino_inseguro("postgresql+psycopg://c:c@localhost/ceres_test", None) is None


def test_el_motivo_no_filtra_la_contrasena():
    motivo = razon_destino_inseguro(APP, APP)

    assert "secreto" not in (motivo or "")


def test_una_url_sin_host_no_es_segura():
    # Ocurrio de verdad: un `.env` con la clave duplicada en el valor
    # (`TEST_DATABASE_URL=TEST_DATABASE_URL=postgresql://...`) no tiene host
    # parseable y todo el texto cae en el nombre de base, que termina en
    # `_test`. La barrera lo aceptaba. Sin host no hay destino que aprobar.
    rota = "TEST_DATABASE_URL=postgresql+psycopg://ceres:x@localhost:5432/ceres_test"

    assert razon_destino_inseguro(rota, APP) is not None
    assert razon_destino_inseguro("", APP) is not None
