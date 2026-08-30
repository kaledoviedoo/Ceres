"""Errores del dominio de servicios.

Los servicios no conocen HTTP. Lanzan estos errores y la capa de API los traduce
a codigos de estado (`app/api/exception_handlers.py`), de modo que los mismos
servicios sirven para un endpoint, un script o un worker.
"""

from __future__ import annotations


class ServiceError(Exception):
    """Base de los errores esperables de la capa de servicios."""


class NotFoundError(ServiceError):
    """El recurso solicitado no existe. La API lo traduce a 404."""

    def __init__(self, resource: str, identifier: object) -> None:
        super().__init__(f"{resource} {identifier} no encontrado")
        self.resource = resource
        self.identifier = identifier


class ConflictError(ServiceError):
    """La peticion es valida pero incoherente con el estado actual. -> 409."""
