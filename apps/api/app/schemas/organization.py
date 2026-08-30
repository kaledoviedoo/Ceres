"""Contrato de API: organizacion y usuario."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import EmailStr, Field

from app.domain.enums import UserRole
from app.schemas.common import CeresORMSchema


class OrganizationRead(CeresORMSchema):
    id: uuid.UUID
    name: str
    slug: str
    created_at: datetime


class UserRead(CeresORMSchema):
    id: uuid.UUID
    organization_id: uuid.UUID
    email: EmailStr
    full_name: str
    role: UserRole = Field(description="Rol dentro de la organizacion")
    created_at: datetime
