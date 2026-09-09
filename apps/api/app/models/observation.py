"""Observation: lo que un humano ve en campo sobre una celda concreta.

Es la entrada de realidad cualitativa del ciclo
STATE -> PREDICT -> OBSERVE -> HARVEST -> VALIDATE.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.enums import ObservationType, Provenance
from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin, UUIDType

if TYPE_CHECKING:
    from app.models.crop import CropCycle
    from app.models.grid_cell import GridCell
    from app.models.organization import User


class Observation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "observations"
    __table_args__ = (
        CheckConstraint("severity >= 0 AND severity <= 1", name="severity_range"),
        CheckConstraint(
            "type IN ('pest', 'disease', 'water_stress', 'physical_damage', 'other')",
            name="type_valid",
        ),
        CheckConstraint(
            "source_kind IN ('measured', 'derived', 'estimated', 'synthetic', 'unknown')",
            name="observations_source_kind_valid",
        ),
    )

    cell_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType,
        ForeignKey("grid_cells.id", ondelete="CASCADE"),
        nullable=False,
    )
    #: Opcional: una observacion puede existir fuera de un ciclo de cultivo
    #: (p.ej. dano fisico del terreno entre temporadas).
    crop_cycle_id: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType,
        ForeignKey("crop_cycles.id", ondelete="SET NULL"),
    )

    type: Mapped[ObservationType] = mapped_column(String(32), nullable=False)
    #: Gravedad normalizada: 0 (irrelevante) .. 1 (critico).
    severity: Mapped[float] = mapped_column(Float, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    observed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUIDType, ForeignKey("users.id", ondelete="SET NULL")
    )

    #: De donde sale esta observacion.
    #:
    #: Solo `measured` mueve el estado derivado de la celda. El defecto es
    #: `synthetic` y no `measured` por la misma razon que en el resto del
    #: contrato: una medicion inexistente es la unica mentira que un cliente no
    #: puede detectar.
    source_kind: Mapped[str] = mapped_column(
        String(16), nullable=False, default=Provenance.SYNTHETIC.value
    )

    cell: Mapped["GridCell"] = relationship(back_populates="observations")
    crop_cycle: Mapped["CropCycle | None"] = relationship(back_populates="observations")
    author: Mapped["User | None"] = relationship()

    def __repr__(self) -> str:
        return f"<Observation {self.type} sev={self.severity}>"
