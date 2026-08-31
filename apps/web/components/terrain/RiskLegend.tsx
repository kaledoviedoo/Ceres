"use client";

/**
 * Leyenda de la vista activa.
 *
 * En modo riesgo muestra los tres niveles con su recuento real; en los modos
 * continuos, la rampa con los extremos del lote. Los números salen de las
 * celdas, no están escritos a mano.
 */

import { formatInteger, formatKg, formatPercent } from "@/lib/presentation/format";
import {
  RISK_COLORS,
  RISK_PATTERNS,
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
      <div className="floating rounded-lg px-3 py-2.5">
        <p className="eyebrow mb-2">Nivel de riesgo</p>
        <ul className="space-y-1.5">
          {LEVELS.map((level) => (
            <li key={level} className="flex items-center gap-2.5">
              {/* Misma trama que el terreno: la leyenda tiene que ser legible
                  con los mismos medios que el mapa, también en escala de grises. */}
              <span
                aria-hidden="true"
                className="h-3 w-3 shrink-0 rounded-[2px]"
                style={{
                  backgroundColor: RISK_COLORS[level].fill,
                  backgroundImage: RISK_PATTERNS[level],
                }}
              />
              <span className="text-xs text-bone-300">{RISK_COLORS[level].label}</span>
              <span className="tabular ml-auto text-xs text-bone-100">
                {formatInteger(counts[level])}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const range = metricRange(cells, viewMode);
  const format = viewMode === "yield" ? formatKg : formatPercent;
  // En rendimiento, más es mejor: el verde queda en el extremo alto.
  const [low, high] = viewMode === "yield" ? [range.max, range.min] : [range.min, range.max];

  return (
    <div className="floating rounded-lg px-3 py-2.5">
      <p className="eyebrow mb-2">{viewMode === "yield" ? "Rendimiento" : "Pérdida estimada"}</p>
      <div className="flex items-center gap-2">
        <span className="tabular text-[11px] text-bone-400">{format(low)}</span>
        <span
          aria-hidden="true"
          className="h-2 w-24 rounded-sm"
          style={{ background: "linear-gradient(to right, #22c55e, #eab308, #ef4444)" }}
        />
        <span className="tabular text-[11px] text-bone-400">{format(high)}</span>
      </div>
    </div>
  );
}
