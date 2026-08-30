"""Router agregador de la version 1 de la API."""

from fastapi import APIRouter

from app.api.v1 import cells, farms, harvests, health, observations, predictions

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(health.router)
api_router.include_router(farms.router)
api_router.include_router(cells.router)
api_router.include_router(predictions.router)
api_router.include_router(observations.router)
api_router.include_router(harvests.router)

__all__ = ["api_router"]
