"""Aplicacion FastAPI.

    uvicorn app.main:app --reload

Swagger en http://localhost:8000/docs
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.exception_handlers import EXCEPTION_HANDLERS
from app.api.v1 import api_router
from app.config import get_settings

DESCRIPTION = """
API del Digital Twin agricola CERES.

**DEMO / SYNTHETIC DATA.** La finca es ficticia y sus datos son sinteticos.
El motor de prediccion es un modelo **experimental y demostrativo**
(`rule-based-v0.1`), no una prediccion agronomica cientificamente validada.

Flujo del sistema:

    GridCell + CropCycle -> Prediction Engine -> Prediction -> Observation
    -> Harvest -> Prediction vs Realidad

Las predicciones son **inmutables**: `POST /predictions` siempre crea una fila
nueva. No existe PUT ni DELETE sobre ellas, ni los habra.
"""


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="CERES API",
        version=__version__,
        description=DESCRIPTION,
        docs_url="/docs",
        openapi_url="/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    for exception_type, handler in EXCEPTION_HANDLERS.items():
        app.add_exception_handler(exception_type, handler)

    app.include_router(api_router)
    return app


app = create_app()
