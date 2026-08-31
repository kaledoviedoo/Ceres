/**
 * De valores a colores.
 *
 * Esta es la única "lógica" del frontend y es puramente visual: el backend
 * manda `risk_level: "high"` y aquí se decide que eso se pinta rojo. Ninguna
 * fórmula agrícola vive en TypeScript.
 *
 * Por eso el backend no devuelve colores: devuelve valores, y cambiar la paleta
 * no obliga a tocar Python. Ver docs/architecture.md.
 */

import type { CellOverview, RiskLevel } from "@/lib/types/api";

export type ViewMode = "risk" | "yield" | "loss";

export const VIEW_MODES: { id: ViewMode; label: string; description: string }[] = [
  { id: "risk", label: "Riesgo", description: "Factores de riesgo presentes en la celda" },
  { id: "yield", label: "Rendimiento", description: "Kilogramos proyectados" },
  { id: "loss", label: "Pérdida", description: "Porcentaje de pérdida estimada" },
];

/** Paleta de riesgo: verde sano, ámbar atención, rojo crítico. */
export const RISK_COLORS: Record<RiskLevel, { fill: string; text: string; label: string }> = {
  low: { fill: "#22c55e", text: "#052e16", label: "Bajo" },
  medium: { fill: "#eab308", text: "#422006", label: "Medio" },
  high: { fill: "#ef4444", text: "#450a0a", label: "Alto" },
};

/**
 * Trama superpuesta al color, como señal NO cromática del nivel de riesgo.
 *
 * Verde, ámbar y rojo son precisamente los tonos que se confunden en un
 * daltonismo rojo-verde, que afecta a alrededor del 8% de los hombres. Si el
 * nivel se comunica solo con el color, para esas personas el mapa de riesgo no
 * dice nada.
 *
 * La densidad crece con la gravedad —liso, rayado suave, rayado marcado— así
 * que el nivel también se lee en escala de grises o impreso en blanco y negro.
 * `undefined` en `low` deja el verde limpio: la ausencia de trama ya es señal.
 */
export const RISK_PATTERNS: Record<RiskLevel, string | undefined> = {
  low: undefined,
  medium:
    "repeating-linear-gradient(45deg, rgba(0,0,0,0.28) 0 1.5px, transparent 1.5px 5px)",
  high: "repeating-linear-gradient(45deg, rgba(0,0,0,0.42) 0 2.5px, transparent 2.5px 5px)",
};

/**
 * Rampa continua verde -> ámbar -> rojo.
 *
 * `t` va de 0 (mejor) a 1 (peor). Se interpola en RGB, que para tres paradas
 * tan separadas es suficiente y no necesita una librería de color.
 */
function ramp(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const stops = [
    { at: 0.0, rgb: [34, 197, 94] }, // verde
    { at: 0.5, rgb: [234, 179, 8] }, // ámbar
    { at: 1.0, rgb: [239, 68, 68] }, // rojo
  ] as const;

  const upperIndex = clamped <= stops[1].at ? 1 : 2;
  const lower = stops[upperIndex - 1]!;
  const upper = stops[upperIndex]!;
  const span = upper.at - lower.at;
  const local = span === 0 ? 0 : (clamped - lower.at) / span;

  const channel = (i: number) =>
    Math.round(lower.rgb[i]! + (upper.rgb[i]! - lower.rgb[i]!) * local);

  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

/** Rango de una métrica en el lote, para normalizar la rampa de color. */
export interface MetricRange {
  min: number;
  max: number;
}

export function metricRange(cells: CellOverview[], mode: ViewMode): MetricRange {
  if (mode === "risk") return { min: 0, max: 1 };

  const values = cells.map((cell) =>
    mode === "yield" ? cell.projected_yield_kg : cell.estimated_loss_percentage,
  );
  if (values.length === 0) return { min: 0, max: 1 };

  return { min: Math.min(...values), max: Math.max(...values) };
}

/**
 * Color de una celda según el modo de vista.
 *
 * En modo riesgo se usan los tres colores discretos, no la rampa: el nivel es
 * una decisión del dominio (umbrales en `app/domain/units.py`) y difuminarlo
 * escondería justo la información que el agrónomo busca.
 */
export function cellColor(cell: CellOverview, mode: ViewMode, range: MetricRange): string {
  if (mode === "risk") return RISK_COLORS[cell.risk_level].fill;

  const span = range.max - range.min;
  if (span === 0) return ramp(0.5);

  if (mode === "yield") {
    // Más rendimiento es mejor: se invierte para que el verde sea lo alto.
    return ramp(1 - (cell.projected_yield_kg - range.min) / span);
  }
  return ramp((cell.estimated_loss_percentage - range.min) / span);
}

/** Cuántas celdas hay en cada nivel. Alimenta la leyenda. */
export function riskDistribution(cells: CellOverview[]): Record<RiskLevel, number> {
  const counts: Record<RiskLevel, number> = { low: 0, medium: 0, high: 0 };
  for (const cell of cells) counts[cell.risk_level] += 1;
  return counts;
}
