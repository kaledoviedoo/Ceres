"""Decide si una base de datos se puede vaciar desde los tests.

Los tests de este paquete hacen `TRUNCATE` de tablas enteras. Contar filas
protege un dataset ya cargado; esto protege la base en si: mira a DONDE apunta
la URL y no lo levanta ninguna variable de entorno.

Es una funcion pura sobre la URL para poder probarla en la suite SQLite sin
tocar ningun servidor.
"""

from __future__ import annotations

from urllib.parse import urlsplit

#: Hosts que solo pueden ser una maquina de desarrollo.
_HOSTS_LOCALES = frozenset({"localhost", "127.0.0.1", "::1"})

#: Dominios de Supabase: directo y pooler. Nunca son un destino que vaciar.
_DOMINIOS_SUPABASE = (".supabase.co", ".supabase.com")


def _host_y_base(url: str) -> tuple[str, str]:
    partes = urlsplit(url)
    return (partes.hostname or "").lower(), partes.path.lstrip("/")


def razon_destino_inseguro(test_url: str, app_url: str | None) -> str | None:
    """Por que NO se puede vaciar la base de `test_url`. `None` si es segura.

    Cuatro reglas, en orden:

    0. Tiene que tener host. Una URL mal formada no se aprueba por lo que
       parezca decir su ultimo segmento.
    1. No puede ser la base de la aplicacion (`DATABASE_URL`): mismo host y
       mismo nombre. Es el caso que tenia este repositorio.
    2. No puede estar en Supabase, sea cual sea el proyecto. Si algun dia hace
       falta un proyecto desechable ahi, esta regla se cambia a sabiendas.
    3. Fuera de eso, o es local o su nombre termina en `_test`.

    El motivo nunca incluye credenciales: solo host y nombre de base.
    """
    host, base = _host_y_base(test_url)

    if not host:
        return "la URL no tiene host: no se puede saber a que base apunta"

    if app_url:
        app_host, app_base = _host_y_base(app_url)
        if host == app_host and base == app_base:
            return (
                f"es la misma base que DATABASE_URL ({host}/{base}), la de la aplicacion"
            )

    if host.endswith(_DOMINIOS_SUPABASE):
        return f"apunta a Supabase ({host}); estos tests vacian tablas enteras"

    if host not in _HOSTS_LOCALES and not base.endswith("_test"):
        return f"no es local ({host}) y la base '{base}' no termina en _test"

    return None
