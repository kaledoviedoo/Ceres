"""GridCell: la unidad atomica del Digital Twin (~1 m2).

Guarda el ESTADO ESTATICO del terreno. No guarda resultados: las predicciones,
observaciones y cosechas viven en sus propias tablas y apuntan aqui.

Convencion de ejes:
    x -> 0 = oeste, grid_width-1 = este
    y -> 0 = sur,   grid_height-1 = norte
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.farm import Plot
    from app.models.harvest import Harvest
    from app.models.observation import Observation
    from app.models.prediction import Prediction


class GridCell(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "grid_cells"
    __table_args__ = (
        UniqueConstraint("plot_id", "x", "y", name="uq_grid_cells_plot_id_x_y"),
        UniqueConstraint("plot_id", "cell_code", name="uq_grid_cells_plot_id_cell_code"),
        CheckConstraint("x >= 0 AND y >= 0", name="coordinates_non_negative"),
        CheckConstraint("slope_deg >= 0 AND slope_deg <= 90", name="slope_range"),
        CheckConstraint("soil_quality >= 0 AND soil_quality <= 1", name="soil_quality_range"),
        CheckConstraint("health_factor >= 0 AND health_factor <= 1", name="health_factor_range"),
        CheckConstraint("plant_density >= 0", name="plant_density_non_negative"),
        CheckConstraint("base_yield_factor > 0", name="base_yield_factor_positive"),
    )

    plot_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("plots.id", ondelete="CASCADE"),
        nullable=False,
    )

    #: Identificador legible y estable de la celda, p.ej. "A-00123".
    #: La identidad canonica sigue siendo `id`; `cell_code` es para humanos y UI.
    cell_code: Mapped[str] = mapped_column(String(24), nullable=False)

    x: Mapped[int] = mapped_column(Integer, nullable=False)
    y: Mapped[int] = mapped_column(Integer, nullable=False)

    # --- Caracteristicas del terreno -----------------------------------------
    #: Altitud sobre el nivel del mar, en metros.
    elevation_m: Mapped[float] = mapped_column(Float, nullable=False)
    #: Pendiente en grados, derivada del gradiente de elevacion.
    slope_deg: Mapped[float] = mapped_column(Float, nullable=False)
    #: Indice de calidad del suelo, 0 (pobre) .. 1 (optimo).
    soil_quality: Mapped[float] = mapped_column(Float, nullable=False)
    #: Densidad de siembra real en plantas/m2.
    plant_density: Mapped[float] = mapped_column(Float, nullable=False)
    #: Indice de sanidad del cultivo, 0 (muerto) .. 1 (sano).
    health_factor: Mapped[float] = mapped_column(Float, nullable=False)
    #: Multiplicador residual que captura variacion local no explicada por el
    #: resto de variables. Centrado en 1.0.
    base_yield_factor: Mapped[float] = mapped_column(Float, nullable=False)

    #: Centroide geografico de la celda. Preparado para migrar a PostGIS.
    centroid_latitude: Mapped[float] = mapped_column(Float, nullable=False)
    centroid_longitude: Mapped[float] = mapped_column(Float, nullable=False)

    plot: Mapped["Plot"] = relationship(back_populates="cells")
    predictions: Mapped[list["Prediction"]] = relationship(back_populates="cell")
    observations: Mapped[list["Observation"]] = relationship(back_populates="cell")
    harvests: Mapped[list["Harvest"]] = relationship(back_populates="cell")

    def __repr__(self) -> str:
        return f"<GridCell {self.cell_code} ({self.x},{self.y})>"
