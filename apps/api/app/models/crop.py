"""Cultivo y ciclo de cultivo.

Decision clave del modelo: un `Crop` (tomate, cafe...) es un catalogo reusable.
Lo que ata un cultivo a un lote es el `CropCycle`, porque un mismo lote puede
sembrar productos distintos en temporadas distintas.

    Plot A --> CropCycle 2026 --> Tomato
    Plot A --> CropCycle 2027 --> Pepper
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    Date,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.enums import CropCycleStatus
from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.farm import Plot
    from app.models.harvest import Harvest
    from app.models.observation import Observation
    from app.models.organization import Organization
    from app.models.prediction import Prediction


class Crop(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Catalogo de cultivos con sus parametros agronomicos de referencia."""

    __tablename__ = "crops"
    __table_args__ = (
        UniqueConstraint("organization_id", "slug", name="uq_crops_organization_id_slug"),
        CheckConstraint("box_capacity_kg > 0", name="box_capacity_positive"),
        CheckConstraint("base_yield_kg_per_m2 > 0", name="base_yield_positive"),
        CheckConstraint("optimal_plant_density_per_m2 > 0", name="optimal_density_positive"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    variety: Mapped[str | None] = mapped_column(Text)

    #: kg que caben en una caja de cosecha. Usado para projected_boxes.
    box_capacity_kg: Mapped[float] = mapped_column(Float, nullable=False)
    #: Rendimiento de referencia en condiciones ideales (kg/m2). Punto de
    #: partida del motor de prediccion, antes de aplicar factores por celda.
    base_yield_kg_per_m2: Mapped[float] = mapped_column(Float, nullable=False)
    #: Densidad de siembra optima (plantas/m2). Sirve para convertir la
    #: densidad real de una celda en un factor relativo.
    optimal_plant_density_per_m2: Mapped[float] = mapped_column(Float, nullable=False)
    #: Duracion tipica del ciclo, en dias. Informativo en el MVP.
    cycle_days: Mapped[int | None] = mapped_column(Integer)

    organization: Mapped["Organization"] = relationship(back_populates="crops")
    cycles: Mapped[list["CropCycle"]] = relationship(back_populates="crop")

    def __repr__(self) -> str:
        return f"<Crop {self.slug}>"


class CropCycle(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Una temporada concreta de un cultivo sobre un lote."""

    __tablename__ = "crop_cycles"
    __table_args__ = (
        UniqueConstraint("plot_id", "slug", name="uq_crop_cycles_plot_id_slug"),
    )

    plot_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("plots.id", ondelete="CASCADE"),
        nullable=False,
    )
    crop_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("crops.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[CropCycleStatus] = mapped_column(
        String(16), nullable=False, default=CropCycleStatus.ACTIVE
    )

    planted_at: Mapped[date | None] = mapped_column(Date)
    expected_harvest_at: Mapped[date | None] = mapped_column(Date)

    plot: Mapped["Plot"] = relationship(back_populates="crop_cycles")
    crop: Mapped["Crop"] = relationship(back_populates="cycles")
    predictions: Mapped[list["Prediction"]] = relationship(back_populates="crop_cycle")
    observations: Mapped[list["Observation"]] = relationship(back_populates="crop_cycle")
    harvests: Mapped[list["Harvest"]] = relationship(back_populates="crop_cycle")

    def __repr__(self) -> str:
        return f"<CropCycle {self.slug}>"
