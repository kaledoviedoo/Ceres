"""Traduccion de errores de servicio a respuestas HTTP.

Los servicios no conocen HTTP: lanzan `NotFoundError` o `ConflictError`. Aqui, y
solo aqui, se decide que eso es un 404 o un 409. Registrado una vez en
`main.py`, asi que ningun router necesita try/except.
"""

from __future__ import annotations

from fastapi import Request, status
from fastapi.responses import JSONResponse

from app.services.errors import ConflictError, NotFoundError


async def not_found_handler(_: Request, exc: NotFoundError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_404_NOT_FOUND,
        content={"detail": str(exc)},
    )


async def conflict_handler(_: Request, exc: ConflictError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": str(exc)},
    )


EXCEPTION_HANDLERS = {
    NotFoundError: not_found_handler,
    ConflictError: conflict_handler,
}
