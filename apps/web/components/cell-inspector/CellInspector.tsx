"use client";

/**
 * Panel de la celda seleccionada.
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
 *
 * Sin celda seleccionada el panel no se queda vacío: muestra el resumen del
 * lote. Un hueco de 360 píxeles esperando un clic es espacio desperdiciado.
 */

import { MetricGroup, MetricRow } from "@/components/cell-inspector/MetricRow";
import { PredictionPanel } from "@/components/cell-inspector/PredictionPanel";
import { RiskBadge } from "@/components/ui/Badge";
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
import { riskDistribution } from "@/lib/presentation/risk";
import type { CellDetail, CellOverview, Plot } from "@/lib/types/api";

interface CellInspectorProps {
  cell: CellDetail | null;
  overview: CellOverview | null;
  cells: CellOverview[];
  plot: Plot | null;
  cropCycleId: string | null;
  isLoading: boolean;
  error: string | null;
  onRetry?: () => void;
  onClear: () => void;
}

export function CellInspector({
  cell,
  overview,
  cells,
  plot,
  cropCycleId,
  isLoading,
  error,
  onRetry,
  onClear,
}: CellInspectorProps) {
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (isLoading) return <Spinner label="Cargando la celda" />;
  if (!cell) return <PlotSummary plot={plot} cells={cells} />;

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Celda</p>
          <h2 className="tabular text-2xl font-medium leading-tight text-bone-100">
            {cell.cell_code}
          </h2>
          <p className="tabular mt-1 text-[11px] text-bone-400">
            x {cell.x} · y {cell.y} · {formatMeters(cell.elevation_m)} s.&nbsp;n.&nbsp;m.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {overview && <RiskBadge level={overview.risk_level} />}
          <button
            type="button"
            onClick={onClear}
            aria-label="Cerrar la celda y volver al resumen del lote"
            className="text-bone-600 transition-colors hover:text-bone-100"
          >
            <span aria-hidden="true" className="text-sm">
              ✕
            </span>
          </button>
        </div>
      </header>

      {overview && (
        <MetricGroup title="Estimación actual · sin guardar">
          <Headline value={formatKg(overview.projected_yield_kg)} label="Rendimiento proyectado" />
          <MetricRow label="Cajas proyectadas" value={formatInteger(overview.projected_boxes)} />
          <MetricRow
            label="Pérdida estimada"
            value={formatPercent(overview.estimated_loss_percentage)}
          />
          <MetricRow label="Risk score" value={formatScore(overview.risk_score)} />
          <MetricRow label="Nivel de riesgo" value={<RiskBadge level={overview.risk_level} />} />
        </MetricGroup>
      )}

      <MetricGroup title="Estado del terreno">
        <MetricRow label="Pendiente" value={formatDegrees(cell.slope_deg)} />
        <MetricRow label="Calidad de suelo" value={formatIndex(cell.soil_quality)} />
        <MetricRow label="Densidad de siembra" value={formatDensity(cell.plant_density)} />
        <MetricRow label="Sanidad" value={formatIndex(cell.health_factor)} />
        <MetricRow label="Factor residual" value={formatScore(cell.base_yield_factor)} />
      </MetricGroup>

      <MetricGroup title="Histórico">
        <PredictionPanel cellId={cell.id} cropCycleId={cropCycleId} />
      </MetricGroup>
    </div>
  );
}

/** Cifra destacada: número grande, etiqueta pequeña. */
function Headline({ value, label }: { value: string; label: string }) {
  return (
    <div className="mb-2 border-b border-soil-700 pb-2">
      <p className="tabular text-3xl font-medium leading-none text-bone-100">{value}</p>
      <p className="eyebrow mt-1.5">{label}</p>
    </div>
  );
}

/** Lo que se ve cuando no hay ninguna celda abierta. */
function PlotSummary({ plot, cells }: { plot: Plot | null; cells: CellOverview[] }) {
  if (!plot) {
    return (
      <p className="text-sm text-bone-400">
        Selecciona un lote y un ciclo de cultivo para inspeccionar el terreno.
      </p>
    );
  }

  const counts = riskDistribution(cells);
  const total = cells.length;

  return (
    <div className="space-y-5">
      <header>
        <p className="eyebrow">Lote</p>
        <h2 className="text-2xl font-medium leading-tight text-bone-100">{plot.name}</h2>
        <p className="tabular mt-1 text-[11px] text-bone-400">
          {plot.grid_width} × {plot.grid_height} · {formatInteger(plot.area_m2)} m² ·{" "}
          {plot.cell_size_m} m por celda
        </p>
      </header>

      {total > 0 && (
        <MetricGroup title="Reparto del riesgo">
          <Headline value={formatInteger(counts.high)} label="Celdas en riesgo alto" />
          <MetricRow label="Riesgo medio" value={formatInteger(counts.medium)} />
          <MetricRow label="Riesgo bajo" value={formatInteger(counts.low)} />
          <MetricRow label="Celdas evaluadas" value={formatInteger(total)} />
        </MetricGroup>
      )}

      <p className="text-xs leading-relaxed text-bone-600">
        Haz clic en una celda del terreno para inspeccionarla. Con el teclado, tabula hasta la
        malla y recórrela con las flechas.
      </p>
    </div>
  );
}
