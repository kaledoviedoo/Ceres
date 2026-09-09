"""Health check."""

from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text

from app import __version__
from app.api.deps import SessionDep
from app.core.prediction import MODEL_VERSION
# La misma frase que respalda `provenance.dataset.kind`: una sola fuente para
# las dos formas de decir lo mismo.
from app.core.provenance import DISCLAIMER
from app.schemas.common import CeresORMSchema

router = APIRouter(tags=["health"])


class HealthResponse(CeresORMSchema):
    status: str
    version: str
    model_version: str
    database: str
    #: Recordatorio permanente en el contrato, no solo en la documentacion.
    disclaimer: str


@router.get("/health", response_model=HealthResponse)
def health(session: SessionDep) -> HealthResponse:
    """Estado del servicio y de su conexion a la base de datos.

    Nunca devuelve 5xx por una base de datos caida: informa `database:
    "unavailable"` para que un balanceador pueda distinguir "la app no arranca"
    de "la app vive pero la base de datos no responde".
    """
    try:
        session.execute(text("SELECT 1"))
        database = "ok"
    except Exception:  # noqa: BLE001 - el detalle no debe salir al cliente
        database = "unavailable"

    return HealthResponse(
        status="ok",
        version=__version__,
        model_version=MODEL_VERSION,
        database=database,
        disclaimer=DISCLAIMER,
    )
