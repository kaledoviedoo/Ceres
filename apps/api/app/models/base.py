"""Base declarativa de SQLAlchemy y mixins comunes.

Los modelos de este paquete son el mapeo de persistencia: reflejan uno a uno
las tablas definidas en `database/migrations/`. La fuente de verdad del esquema
son las migraciones SQL; estos modelos deben mantenerse sincronizados con ellas.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, MetaData, func, text
from sqlalchemy.dialects.postgresql import UUID as PgUUID
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


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class UUIDPrimaryKeyMixin:
    """PK UUID generada en el servidor.

    Se usa UUID en vez de serial porque el seed sintetico genera identificadores
    deterministas (uuid5) fuera de la base de datos.
    """

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )


class TimestampMixin:
    """`created_at` gestionado por la base de datos."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
