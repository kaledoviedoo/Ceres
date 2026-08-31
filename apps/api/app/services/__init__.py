"""Casos de uso y consultas.

Toda la interaccion con la base de datos vive aqui. Los routers de `app/api/`
solo traducen HTTP; el motor de `app/core/prediction/` solo calcula. Esta capa
es la que los une.

Regla: ninguna consulta SQL fuera de este paquete.
"""

from app.services.errors import ConflictError, NotFoundError
from app.services.farms import (
    get_cell,
    get_farm,
    get_plot,
    list_cells_for_plot,
    list_crop_cycles_for_plot,
    list_farms,
)
from app.services.harvests import create_harvest, list_harvests_for_cell
from app.services.observations import create_observation, list_observations_for_cell
from app.services.performance import get_cell_performance
from app.services.predictions import (
    build_plot_overview,
    create_prediction,
    list_predictions_for_cell,
)

__all__ = [
    "NotFoundError",
    "ConflictError",
    "list_farms",
    "get_farm",
    "get_plot",
    "list_cells_for_plot",
    "list_crop_cycles_for_plot",
    "get_cell",
    "create_prediction",
    "build_plot_overview",
    "list_predictions_for_cell",
    "create_observation",
    "list_observations_for_cell",
    "create_harvest",
    "list_harvests_for_cell",
    "get_cell_performance",
]
