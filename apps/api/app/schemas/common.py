"""Piezas compartidas por todos los schemas de la API."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class CeresSchema(BaseModel):
    """Base de todos los schemas de entrada."""

    model_config = ConfigDict(extra="forbid")


class CeresORMSchema(BaseModel):
    """Base de todos los schemas de salida que se construyen desde un modelo ORM."""

    model_config = ConfigDict(from_attributes=True)
