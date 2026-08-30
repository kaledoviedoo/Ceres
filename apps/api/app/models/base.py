"""Base declarativa de SQLAlchemy, tipos y mixins comunes.

Los modelos de este paquete son el mapeo de persistencia: reflejan uno a uno
las tablas definidas en `database/migrations/`. La fuente de verdad del esquema
son las migraciones SQL; estos modelos deben mantenerse sincronizados con ellas.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, MetaData, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Convencion de nombres para indices y constraints: hace que los nombres
# generados coincidan con los escritos a mano en las migraciones.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s",
    "pk": "pk_%(table_name)s",
}

#: Tipo UUID de la aplicacion. En PostgreSQL es `uuid` nativo; en SQLite (que se
#: usa solo en los tests de integracion) degrada a CHAR(32) automaticamente.
#: Se usa el tipo generico de SQLAlchemy y no `postgresql.UUID` precisamente
#: para que el esquema pueda levantarse en ambos motores.
UUIDType = Uuid(as_uuid=True)

#: JSON de la aplicacion. JSONB en PostgreSQL, JSON de texto en el resto.
JSONType = JSON().with_variant(JSONB(), "postgresql")


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class UUIDPrimaryKeyMixin:
    """PK UUID generada por la aplicacion.

    Se usa UUID en vez de serial porque el seed sintetico genera identificadores
    deterministas (uuid5) fuera de la base de datos.

    La generacion es del lado de Python (`uuid.uuid4`) y no un
    `DEFAULT gen_random_uuid()` en el modelo: asi el ORM conoce el id sin tener
    que releer la fila, y el esquema no depende de una funcion especifica de
    PostgreSQL. Las migraciones SQL SI declaran el default del servidor, para
    quien inserte directamente con psql o desde el editor de Supabase.
    """

    id: Mapped[uuid.UUID] = mapped_column(
        UUIDType,
        primary_key=True,
        default=uuid.uuid4,
    )


class TimestampMixin:
    """`created_at` gestionado por la base de datos."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
