"""Generacion de datos sinteticos DETERMINISTAS.

DEMO / SYNTHETIC DATA — la finca es ficticia y los valores existen para validar
tecnicamente el sistema, no para tomar decisiones agronomicas.

Con la misma seed, este paquete produce siempre exactamente el mismo dataset.
Eso permite que los tests comprueben valores concretos y que dos personas
distintas trabajen sobre la misma finca de demo.
"""

from app.core.synthetic.demo import (
    DEFAULT_SEED,
    DemoDataset,
    build_demo_dataset,
)
from app.core.synthetic.field import (
    CellFeatureGrid,
    TerrainProfile,
    generate_cell_features,
)
from app.core.synthetic.noise import smooth_noise

__all__ = [
    "DEFAULT_SEED",
    "DemoDataset",
    "build_demo_dataset",
    "CellFeatureGrid",
    "TerrainProfile",
    "generate_cell_features",
    "smooth_noise",
]
