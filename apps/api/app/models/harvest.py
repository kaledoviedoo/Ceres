"""Harvest: el resultado real de cosecha de una celda.

Es el ground truth contra el que se valida la prediccion. Sin esta tabla no
existe el ciclo de feedback y CERES seria solo una calculadora bonita.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Date, Float, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.crop import CropCycle
    from app.models.grid_cell import GridCell
    from app.models.organization import User


class Harvest(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "harvests"
    __table_args__ = (
        CheckConstraint("actual_yield_kg >= 0", name="actual_yield_non_negative"),
        CheckConstraint("actual_boxes >= 0", name="actual_boxes_non_negative"),
    )

    cell_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("grid_cells.id", ondelete="CASCADE"),
        nullable=False,
    )
    crop_cycle_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("crop_cycles.id", ondelete="CASCADE"),
        nullable=False,
    )

    actual_yield_kg: Mapped[float] = mapped_column(Float, nullable=False)
    actual_boxes: Mapped[int] = mapped_column(Integer, nullable=False)
    harvested_at: Mapped[date] = mapped_column(Date, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)

    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    cell: Mapped["GridCell"] = relationship(back_populates="harvests")
    crop_cycle: Mapped["CropCycle"] = relationship(back_populates="harvests")
    author: Mapped["User | None"] = relationship()

    def __repr__(self) -> str:
        return f"<Harvest {self.actual_yield_kg:.2f}kg @ {self.harvested_at}>"
