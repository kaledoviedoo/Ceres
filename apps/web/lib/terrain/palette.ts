/**
 * Colores del terreno 3D.
 *
 * Envuelve `lib/presentation/risk.ts` —que sigue siendo la única fuente del
 * mapeo valor → color— y lo traduce a `THREE.Color`. Aquí no se decide nada
 * nuevo sobre qué significa un color; solo se cambia de formato.
 */

import { Color } from "three";

import { cellColor, type MetricRange, type ViewMode } from "@/lib/presentation/risk";
import type { CellOverview } from "@/lib/types/api";

/**
 * Tierra de las paredes del bloque.
 *
 * El análisis se pinta solo en la cara superior; los laterales son suelo. Esa
 * separación es lo que hace que el terreno se lea como una parcela física con
 * una capa analítica encima, y no como una gráfica de barras cuadrada.
 */
export const SOIL_SIDE = new Color("#3a3128");
export const SOIL_SIDE_DEEP = new Color("#241f1a");

/** Hueso: selección y foco. Acromático, así que nunca se confunde con un nivel. */
export const SIGNAL = new Color("#edeae3");

/** Suelo de la escena, bajo el bloque. */
export const SCENE_FLOOR = new Color("#0b0d0c");

// Instancia reutilizada: convertir un color no debe reservar memoria en cada
// llamada, y esto se llama 400 veces por cambio de modo de vista.
const scratch = new Color();

/**
 * Color de la cara superior de una celda.
 *
 * `setStyle` interpreta el valor como sRGB y lo lleva al espacio de trabajo
 * lineal por sí solo, porque la gestión de color de Three.js está activa por
 * defecto. Convertir otra vez a mano lavaría la rampa —y con una escala
 * semántica, lavar los tonos es perder la información—.
 */
export function surfaceColor(
  cell: CellOverview,
  mode: ViewMode,
  range: MetricRange,
  target: Color = scratch,
): Color {
  return target.setStyle(cellColor(cell, mode, range));
}

/** Mezcla hacia el color de señal, para resaltar sin perder el nivel de riesgo. */
export function highlight(base: Color, amount: number, target: Color): Color {
  return target.copy(base).lerp(SIGNAL, amount);
}
