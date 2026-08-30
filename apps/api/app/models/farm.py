"""Finca y lote: la parte espacial estatica del Digital Twin.

Un `Plot` define la malla (ancho x alto x tamano de celda) sobre la que se
generan las `GridCell`. No conoce nada de cultivos: eso vive en `CropCycle`.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin, UUIDType

if TYPE_CHECKING:
    from app.models.crop import CropCycle
    from app.models.grid_cell import GridCell
    from app.models.organization import Organization


class Farm(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "farms"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    country: Mapped[str] = mapped_column(String(2), nullable=False, default="CO")
    region: Mapped[str | None] = mapped_column(Text)

    # Centroide aproximado de la finca. Campos planos por ahora; cuando entre
    # PostGIS se sustituyen por una columna `geography(Point, 4326)`.
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)

    organization: Mapped["Organization"] = relationship(back_populates="farms")
    plots: Mapped[list["Plot"]] = relationship(back_populates="farm")

    def __repr__(self) -> str:
        return f"<Farm {self.name}>"


class Plot(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "plots"
    __table_args__ = (
        UniqueConstraint("farm_id", "code", name="uq_plots_farm_id_code"),
        CheckConstraint("grid_width > 0 AND grid_height > 0", name="grid_dimensions_positive"),
        CheckConstraint("cell_size_m > 0", name="cell_size_positive"),
    )

    farm_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType,
        ForeignKey("farms.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    #: Prefijo corto usado para construir el `cell_code` legible ("A" -> "A-00001").
    code: Mapped[str] = mapped_column(String(8), nullable=False)

    grid_width: Mapped[int] = mapped_column(Integer, nullable=False)
    grid_height: Mapped[int] = mapped_column(Integer, nullable=False)
    #: Lado de la celda en metros. 1.0 en el MVP => cada celda es ~1 m2.
    cell_size_m: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)

    #: Esquina suroeste de la malla (x=0, y=0). El eje x crece hacia el este,
    #: el eje y hacia el norte.
    origin_latitude: Mapped[float] = mapped_column(Float, nullable=False)
    origin_longitude: Mapped[float] = mapped_column(Float, nullable=False)

    farm: Mapped["Farm"] = relationship(back_populates="plots")
    cells: Mapped[list["GridCell"]] = relationship(back_populates="plot")
    crop_cycles: Mapped[list["CropCycle"]] = relationship(back_populates="plot")

    @property
    def cell_count(self) -> int:
        return self.grid_width * self.grid_height

    @property
    def area_m2(self) -> float:
        return self.cell_count * (self.cell_size_m**2)

    def __repr__(self) -> str:
        return f"<Plot {self.code} {self.grid_width}x{self.grid_height}>"
