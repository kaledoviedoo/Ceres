"use client";

/**
 * Leyenda de la vista activa.
 *
 * En modo riesgo, los tres niveles con su recuento real y —lo que la fase 7 no
 * tenía— la proporción dibujada. "34 de 400" obliga a dividir de cabeza; un
 * segmento rojo que ocupa una franja estrecha se lee de un vistazo. El dato es
 * exactamente el mismo, y sale de las celdas: no hay nada escrito a mano.
 *
 * Esa barra es además lo que le da a la leyenda una relación con el terreno.
 * Antes era una tabla de equivalencias en una esquina; ahora dice cuánta
 * superficie ocupa cada nivel, que es la pregunta siguiente a "qué significa
 * este color".
 *
 * En los modos continuos no hay niveles, así que no hay barra: solo la rampa con
 * los extremos reales del lote.
 */

import { formatInteger, formatKg, formatPercent } from "@/lib/presentation/format";
import {
  RISK_COLORS,
  RISK_PATTERNS,
  metricRange,
  rampCss,
  riskDistribution,
  type ViewMode,
} from "@/lib/presentation/risk";
import type { CellOverview, RiskLevel } from "@/lib/types/api";

const LEVELS: RiskLevel[] = ["low", "medium", "high"];

export function RiskLegend({ cells, viewMode }: { cells: CellOverview[]; viewMode: ViewMode }) {
  if (cells.length === 0) return null;

  if (viewMode === "risk") {
    const counts = riskDistribution(cells);
    const total = cells.length;

    return (
      <div className="floating w-[13.5rem] rounded-lg px-3 py-2.5">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <p className="eyebrow">Nivel de riesgo</p>
          <span className="tabular text-[10px] text-muted">
            {formatInteger(total)} celdas
          </span>
        </div>

        {/* Proporción de superficie por nivel. Misma trama que el terreno, así
            que también se distingue en escala de grises. */}
        <div
          aria-hidden="true"
          className="mb-2.5 flex h-1.5 w-full overflow-hidden rounded-full bg-line-soft"
        >
          {LEVELS.map((level) =>
            counts[level] > 0 ? (
              <span
                key={level}
                className="h-full"
                style={{
                  width: `${(counts[level] / total) * 100}%`,
                  backgroundColor: RISK_COLORS[level].fill,
                  backgroundImage: RISK_PATTERNS[level],
                }}
              />
            ) : null,
          )}
        </div>

        <ul className="space-y-1">
          {LEVELS.map((level) => (
            <li key={level} className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                style={{
                  backgroundColor: RISK_COLORS[level].fill,
                  backgroundImage: RISK_PATTERNS[level],
                }}
              />
              <span className="text-xs text-ink-soft">{RISK_COLORS[level].label}</span>
              <span className="tabular ml-auto text-xs text-ink">
                {formatInteger(counts[level])}
              </span>
            </li>
          ))}
        </ul>

        {counts.high > 0 && (
          <p className="mt-2.5 flex items-center gap-2 border-t border-line pt-2 text-[10px] leading-tight text-muted">
            <span aria-hidden="true" className="h-px w-4 shrink-0 bg-ink" />
            La línea clara sobre el terreno marca el límite de la zona en riesgo alto.
          </p>
        )}
      </div>
    );
  }

  const range = metricRange(cells, viewMode);
  const format = viewMode === "yield" ? formatKg : formatPercent;
  // Las dos rampas van de mínimo a máximo de izquierda a derecha. Lo que cambia
  // es el significado: en rendimiento el extremo derecho es lo bueno (azul), en
  // pérdida es lo malo (rojo). Invertir una de las dos para "que el verde quede
  // siempre a la izquierda" haría que dos leyendas idénticas dijeran cosas
  // opuestas.
  const [low, high] = [range.min, range.max];

  return (
    <div className="floating rounded-lg px-3 py-2.5">
      <p className="eyebrow mb-2">{viewMode === "yield" ? "Rendimiento" : "Pérdida estimada"}</p>
      <div className="flex items-center gap-2">
        <span className="tabular text-[11px] text-muted">{format(low)}</span>
        <span
          aria-hidden="true"
          className="h-2 w-24 rounded-sm"
          style={{ background: rampCss(viewMode) }}
        />
        <span className="tabular text-[11px] text-muted">{format(high)}</span>
      </div>
    </div>
  );
}
