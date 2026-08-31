"use client";

/**
 * Leyenda de la vista actual.
 *
 * En modo riesgo muestra los tres niveles con su recuento real; en los modos
 * continuos, la rampa con los extremos del lote. Los números salen de las
 * celdas, no están escritos a mano.
 */

import { formatInteger, formatKg, formatPercent } from "@/lib/presentation/format";
import {
  RISK_COLORS,
  metricRange,
  riskDistribution,
  type ViewMode,
} from "@/lib/presentation/risk";
import type { CellOverview, RiskLevel } from "@/lib/types/api";

const LEVELS: RiskLevel[] = ["low", "medium", "high"];

export function RiskLegend({ cells, viewMode }: { cells: CellOverview[]; viewMode: ViewMode }) {
  if (cells.length === 0) return null;

  if (viewMode === "risk") {
    const counts = riskDistribution(cells);
    return (
      <div className="flex flex-wrap items-center gap-4">
        {LEVELS.map((level) => (
          <div key={level} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-3 w-3 rounded-sm"
              style={{ backgroundColor: RISK_COLORS[level].fill }}
            />
            <span className="text-xs text-ceres-muted">
              {RISK_COLORS[level].label}
              <span className="tabular ml-1.5 text-ceres-text">
                {formatInteger(counts[level])}
              </span>
            </span>
          </div>
        ))}
      </div>
    );
  }

  const range = metricRange(cells, viewMode);
  const format = viewMode === "yield" ? formatKg : formatPercent;
  // En rendimiento, más es mejor: el verde queda en el extremo alto.
  const [low, high] =
    viewMode === "yield" ? [range.max, range.min] : [range.min, range.max];

  return (
    <div className="flex items-center gap-3">
      <span className="tabular text-xs text-ceres-muted">{format(low)}</span>
      <span
        aria-hidden="true"
        className="h-2 w-32 rounded-sm"
        style={{ background: "linear-gradient(to right, #22c55e, #eab308, #ef4444)" }}
      />
      <span className="tabular text-xs text-ceres-muted">{format(high)}</span>
    </div>
  );
}
