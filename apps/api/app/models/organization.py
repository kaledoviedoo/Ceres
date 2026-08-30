"""Organizacion y usuarios.

Multi-tenant simple: todo cuelga de una organizacion. Permisos finos y RLS
quedan explicitamente fuera del MVP.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.enums import UserRole
from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.crop import Crop
    from app.models.farm import Farm


class Organization(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)

    farms: Mapped[list["Farm"]] = relationship(back_populates="organization")
    users: Mapped[list["User"]] = relationship(back_populates="organization")
    crops: Mapped[list["Crop"]] = relationship(back_populates="organization")

    def __repr__(self) -> str:
        return f"<Organization {self.slug}>"


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "users"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    email: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    full_name: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[UserRole] = mapped_column(String(32), nullable=False, default=UserRole.VIEWER)

    organization: Mapped["Organization"] = relationship(back_populates="users")

    def __repr__(self) -> str:
        return f"<User {self.email}>"
