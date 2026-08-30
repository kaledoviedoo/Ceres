"""Prediction: fotografia historica e inmutable de lo que CERES estimo.

Regla dura del proyecto: una prediccion NUNCA se sobrescribe. Cada ejecucion
del motor crea una fila nueva con su `model_version`. Asi siempre podemos
responder "que predijo CERES el 30 de agosto y con que formula".

La inmutabilidad se refuerza en la base de datos con un trigger
(ver database/migrations/0002_prediction_immutability.sql).
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import CheckConstraint, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.enums import RiskLevel
from app.models.base import Base, JSONType, TimestampMixin, UUIDPrimaryKeyMixin, UUIDType

if TYPE_CHECKING:
    from app.models.crop import CropCycle
    from app.models.grid_cell import GridCell


class Prediction(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "predictions"
    __table_args__ = (
        CheckConstraint("projected_yield_kg >= 0", name="yield_non_negative"),
        CheckConstraint("projected_boxes >= 0", name="boxes_non_negative"),
        CheckConstraint(
            "estimated_loss_percentage >= 0 AND estimated_loss_percentage <= 100",
            name="loss_percentage_range",
        ),
        CheckConstraint("risk_score >= 0 AND risk_score <= 1", name="risk_score_range"),
        CheckConstraint(
            "risk_level IN ('low', 'medium', 'high')",
            name="risk_level_valid",
        ),
    )

    cell_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType,
        ForeignKey("grid_cells.id", ondelete="CASCADE"),
        nullable=False,
    )
    crop_cycle_id: Mapped[uuid.UUID] = mapped_column(
        UUIDType,
        ForeignKey("crop_cycles.id", ondelete="CASCADE"),
        nullable=False,
    )

    #: Version del modelo que produjo este resultado, p.ej. "rule-based-v0.1".
    model_version: Mapped[str] = mapped_column(String(32), nullable=False)

    projected_yield_kg: Mapped[float] = mapped_column(Float, nullable=False)
    projected_boxes: Mapped[int] = mapped_column(Integer, nullable=False)
    estimated_loss_percentage: Mapped[float] = mapped_column(Float, nullable=False)
    risk_score: Mapped[float] = mapped_column(Float, nullable=False)
    risk_level: Mapped[RiskLevel] = mapped_column(String(16), nullable=False)

    #: Desglose de factores multiplicativos que explican el resultado
    #: ({"soil_factor": 1.1, "health_factor": 0.85, ...}). Sirve para la UI
    #: "por que esta prediccion es asi".
    factors: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False, default=dict)
    #: Copia de las entradas usadas. Permite reproducir la prediccion aunque la
    #: celda cambie despues.
    inputs: Mapped[dict[str, Any]] = mapped_column(JSONType, nullable=False, default=dict)

    cell: Mapped["GridCell"] = relationship(back_populates="predictions")
    crop_cycle: Mapped["CropCycle"] = relationship(back_populates="predictions")

    def __repr__(self) -> str:
        return f"<Prediction {self.model_version} {self.projected_yield_kg:.2f}kg>"
