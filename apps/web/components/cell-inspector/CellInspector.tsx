"use client";

/**
 * Panel lateral de la celda seleccionada.
 *
 * Mezcla dos orígenes y lo dice claramente en pantalla:
 *
 * - ESTADO: lo que la celda es (pendiente, suelo, densidad, sanidad). Viene de
 *   `GET /cells/{id}` y está guardado en la base de datos.
 * - ESTIMACIÓN: lo que el motor calcula ahora mismo sobre ese estado. Viene del
 *   overview y NO está guardado.
 *
 * Confundir las dos cosas sería el error más fácil de cometer aquí, y el que
 * más caro saldría: el valor del Digital Twin está en poder distinguir lo que
 * se midió de lo que se estimó.
 */

import { MetricGroup, MetricRow } from "@/components/cell-inspector/MetricRow";
import { PredictionPanel } from "@/components/cell-inspector/PredictionPanel";
import { RiskBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Spinner } from "@/components/ui/Spinner";
import {
  formatDegrees,
  formatDensity,
  formatIndex,
  formatInteger,
  formatKg,
  formatMeters,
  formatPercent,
  formatScore,
} from "@/lib/presentation/format";
import type { CellDetail, CellOverview } from "@/lib/types/api";

interface CellInspectorProps {
  cell: CellDetail | null;
  overview: CellOverview | null;
  cropCycleId: string | null;
  isLoading: boolean;
  error: string | null;
  onRetry?: () => void;
}

export function CellInspector({
  cell,
  overview,
  cropCycleId,
  isLoading,
  error,
  onRetry,
}: CellInspectorProps) {
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (isLoading) return <Spinner label="Cargando la celda" />;

  if (!cell) {
    return (
      <EmptyState
        title="Ninguna celda seleccionada"
        hint="Haz click en un cuadro de la malla para inspeccionarlo."
      />
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <div className="flex items-center justify-between gap-3">
          <h2 className="tabular text-lg font-semibold text-ceres-text">{cell.cell_code}</h2>
          {overview && <RiskBadge level={overview.risk_level} />}
        </div>
        <p className="tabular mt-0.5 text-xs text-ceres-muted">
          x={cell.x} · y={cell.y} · {formatMeters(cell.elevation_m)} s. n. m.
        </p>
      </header>

      <MetricGroup title="Estado del terreno">
        <MetricRow label="Posición X" value={formatInteger(cell.x)} hint="0 = oeste" />
        <MetricRow label="Posición Y" value={formatInteger(cell.y)} hint="0 = sur" />
        <MetricRow label="Elevación" value={formatMeters(cell.elevation_m)} />
        <MetricRow label="Pendiente" value={formatDegrees(cell.slope_deg)} />
        <MetricRow label="Calidad de suelo" value={formatIndex(cell.soil_quality)} />
        <MetricRow label="Densidad de siembra" value={formatDensity(cell.plant_density)} />
        <MetricRow label="Sanidad" value={formatIndex(cell.health_factor)} />
        <MetricRow label="Factor residual" value={formatScore(cell.base_yield_factor)} />
      </MetricGroup>

      {overview ? (
        <MetricGroup title="Estimación actual (sin guardar)">
          <MetricRow
            label="Rendimiento proyectado"
            value={formatKg(overview.projected_yield_kg)}
          />
          <MetricRow label="Cajas proyectadas" value={formatInteger(overview.projected_boxes)} />
          <MetricRow
            label="Pérdida estimada"
            value={formatPercent(overview.estimated_loss_percentage)}
          />
          <MetricRow label="Risk score" value={formatScore(overview.risk_score)} />
          <MetricRow label="Nivel de riesgo" value={<RiskBadge level={overview.risk_level} />} />
        </MetricGroup>
      ) : (
        <p className="text-xs text-ceres-dim">
          Sin estimación para esta celda: el lote no tiene un ciclo de cultivo seleccionado.
        </p>
      )}

      <MetricGroup title="Histórico">
        <PredictionPanel cellId={cell.id} cropCycleId={cropCycleId} />
      </MetricGroup>
    </div>
  );
}
