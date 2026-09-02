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

/** Una parada de color de una rampa: dónde cae y en qué RGB. */
interface Stop {
  at: number;
  rgb: readonly [number, number, number];
}

/**
 * Rampa de PERDIDA: verde -> ámbar -> rojo.
 *
 * Es la misma escala semántica del riesgo, así que usa los mismos tres tonos:
 * poca pérdida es verde, mucha es roja.
 */
const LOSS_STOPS: readonly Stop[] = [
  { at: 0.0, rgb: [34, 197, 94] },
  { at: 0.5, rgb: [234, 179, 8] },
  { at: 1.0, rgb: [239, 68, 68] },
];

/**
 * Rampa de RENDIMIENTO: rojo -> ámbar -> verde.
 *
 * Los mismos tres tonos del riesgo, pero al revés: en rendimiento, más es mejor,
 * así que el verde está en el extremo alto y el rojo en el bajo. `t` va de 0
 * (peor) a 1 (mejor).
 *
 * Tres tonos y no cuatro. Un cuarto color —azul en el extremo bueno— separaba
 * mejor esta escala de la de pérdida, pero metía en la paleta un tono que no
 * significa nada en el resto de la interfaz. Verde, ámbar y rojo son el
 * vocabulario que ya entiende quien mira este mapa; ampliarlo obliga a aprender
 * y solo se justifica si resuelve algo que no se pueda resolver con la leyenda.
 */
const YIELD_STOPS: readonly Stop[] = [
  { at: 0.0, rgb: [239, 68, 68] },
  { at: 0.5, rgb: [234, 179, 8] },
  { at: 1.0, rgb: [34, 197, 94] },
];

/**
 * Interpola una rampa en RGB.
 *
 * Para paradas tan separadas, interpolar en RGB es suficiente y no necesita una
 * librería de color.
 */
function ramp(t: number, stops: readonly Stop[]): string {
  const clamped = Math.min(1, Math.max(0, t));

  let upper = 1;
  while (upper < stops.length - 1 && clamped > stops[upper]!.at) upper += 1;

  const lo = stops[upper - 1]!;
  const hi = stops[upper]!;
  const span = hi.at - lo.at;
  const local = span === 0 ? 0 : (clamped - lo.at) / span;

  const channel = (i: number) => Math.round(lo.rgb[i]! + (hi.rgb[i]! - lo.rgb[i]!) * local);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

/** Extremos de cada rampa, para pintar la leyenda sin duplicar los tonos. */
export function rampCss(mode: ViewMode): string {
  const stops = mode === "yield" ? YIELD_STOPS : LOSS_STOPS;
  const paradas = stops.map((s) => `rgb(${s.rgb.join(", ")}) ${s.at * 100}%`).join(", ");
  return `linear-gradient(to right, ${paradas})`;
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

  if (mode === "yield") {
    // En rendimiento, `t` = 1 es lo mejor: la rampa ya está orientada así.
    if (span === 0) return ramp(0.5, YIELD_STOPS);
    return ramp((cell.projected_yield_kg - range.min) / span, YIELD_STOPS);
  }

  if (span === 0) return ramp(0.5, LOSS_STOPS);
  return ramp((cell.estimated_loss_percentage - range.min) / span, LOSS_STOPS);
}

/** Cuántas celdas hay en cada nivel. Alimenta la leyenda. */
export function riskDistribution(cells: CellOverview[]): Record<RiskLevel, number> {
  const counts: Record<RiskLevel, number> = { low: 0, medium: 0, high: 0 };
  for (const cell of cells) counts[cell.risk_level] += 1;
  return counts;
}
