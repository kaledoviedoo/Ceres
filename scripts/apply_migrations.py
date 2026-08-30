"""Aplica las migraciones SQL pendientes.

    py scripts/apply_migrations.py           # aplica lo que falte
    py scripts/apply_migrations.py --status  # solo informa

Runner minimo a proposito: las migraciones son SQL plano, versionado y legible.
Alembic o el CLI de Supabase pueden sustituirlo mas adelante sin reescribir los
archivos .sql.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import _bootstrap  # noqa: F401  (efecto lateral: ajusta sys.path)

from sqlalchemy import text

REPO_ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = REPO_ROOT / "database" / "migrations"


def discover_migrations() -> list[Path]:
    """Migraciones ordenadas por nombre (el prefijo numerico define el orden)."""
    return sorted(MIGRATIONS_DIR.glob("*.sql"))


def applied_versions(connection) -> set[str]:
    exists = connection.execute(text("SELECT to_regclass('public.schema_migrations')")).scalar()
    if exists is None:
        return set()
    rows = connection.execute(text("SELECT version FROM schema_migrations")).scalars().all()
    return set(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="Aplica las migraciones de CERES")
    parser.add_argument("--status", action="store_true", help="Solo mostrar el estado")
    args = parser.parse_args()

    from app.config import get_settings
    from app.db import engine

    settings = get_settings()
    print(f"-> Base de datos: {settings.database_url.split('@')[-1]}")

    migrations = discover_migrations()
    if not migrations:
        print("No hay migraciones en database/migrations/")
        return 1

    # AUTOCOMMIT porque cada archivo gestiona su propia transaccion con
    # BEGIN/COMMIT.
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        done = applied_versions(connection)

        for path in migrations:
            version = path.stem
            if version in done:
                print(f"   [ok]      {version}")
                continue
            if args.status:
                print(f"   [pending] {version}")
                continue
            print(f"   [apply]   {version}")
            connection.exec_driver_sql(path.read_text(encoding="utf-8"))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
