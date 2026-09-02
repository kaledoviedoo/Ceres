/**
 * LA RAMA DEL ANALISIS.
 *
 *     AgriculturalData → AnalysisLayer → color / contornos / anotaciones
 *
 * Este módulo no sabe qué es una elevación. Solo traduce lo que el motor
 * calculó —riesgo, rendimiento, pérdida— a color y a fronteras en coordenadas de
 * malla.
 *
 * La simetría con `elevation.ts` es intencionada: ninguno de los dos puede leer
 * los datos del otro, así que ni el riesgo puede deformar el terreno ni la
 * pendiente puede teñir una celda. Componerlos es trabajo del componente que los
 * dibuja, y ahí la regla es una sola:
 *
 *     la elevación pone la FORMA y la LUMINOSIDAD
 *     el análisis pone el TONO
 *
 * Ninguna fórmula agronómica vive aquí. Comparar dos `risk_level` que el motor
 * ya decidió no es modelar: los umbrales están en `app/domain/units.py`.
 */

import { cellColor, type MetricRange, type ViewMode } from "@/lib/presentation/risk";
import type { CellOverview, RiskLevel } from "@/lib/types/api";

// --- Color -------------------------------------------------------------------

const HEX = /^#([0-9a-f]{6})$/i;
const RGB = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i;

/** `cellColor` devuelve CSS; aquí hace falta en componentes numéricos. */
export function parseColor(css: string): [number, number, number] {
  const hex = HEX.exec(css);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = RGB.exec(css);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return [255, 255, 255];
}

/**
 * Un RGB por celda, en orden de fila (fila 0 = sur).
 *
 * El mapeo valor → color sigue siendo el de `lib/presentation/risk.ts`: aquí
 * solo se cambia de formato para poder pintarlo en un lienzo.
 */
export function metricRgb(
  cells: CellOverview[],
  gridWidth: number,
  gridHeight: number,
  mode: ViewMode,
  range: MetricRange,
): Uint8ClampedArray {
  const rgb = new Uint8ClampedArray(gridWidth * gridHeight * 3);
  for (const cell of cells) {
    if (cell.x < 0 || cell.x >= gridWidth || cell.y < 0 || cell.y >= gridHeight) continue;
    const [r, g, b] = parseColor(cellColor(cell, mode, range));
    const offset = (cell.y * gridWidth + cell.x) * 3;
    rgb[offset] = r;
    rgb[offset + 1] = g;
    rgb[offset + 2] = b;
  }
  return rgb;
}

// --- Percentiles -------------------------------------------------------------

/**
 * En qué percentil del lote cae un valor, de 0 a 1.
 *
 * Es lo que convierte una cifra suelta en una lectura. "Suelo 18,1 %" no dice si
 * eso es bueno; "18,1 %, percentil 4 del lote" sí. Ordenar valores que el motor
 * ya calculó no es una fórmula agronómica: no hay ningún umbral nuevo, solo un
 * recuento.
 */
export function percentile(values: number[], value: number): number {
  if (values.length === 0) return 0;
  let below = 0;
  for (const v of values) if (v < value) below += 1;
  return below / values.length;
}

// --- Frontera de la zona en riesgo -------------------------------------------

interface ZonePlacement {
  x: number;
  y: number;
  risk_level: RiskLevel;
}

/** Qué lados de una celda son frontera de la zona. Lo usa la vista en planta. */
export interface ZoneBorders {
  north: boolean;
  south: boolean;
  east: boolean;
  west: boolean;
}

/**
 * Frontera de la región en riesgo, celda a celda.
 *
 * Un manchón rojo dice "por aquí hay problema", pero no DONDE empieza ni dónde
 * acaba, que es la pregunta de quien tiene que ir al campo.
 *
 * Solo se contornea `high`. Perfilar los tres niveles dibujaría una maraña
 * —`medium` es la mayoría de las celdas— y perdería justo lo que el contorno
 * aporta: señalar UNA región.
 */
export function zoneBorders(
  cells: ZonePlacement[],
  level: RiskLevel = "high",
): Map<string, ZoneBorders> {
  const inside = new Set<string>();
  for (const cell of cells) {
    if (cell.risk_level === level) inside.add(`${cell.x},${cell.y}`);
  }

  const borders = new Map<string, ZoneBorders>();
  for (const cell of cells) {
    if (cell.risk_level !== level) continue;
    // Fuera de la malla cuenta como "no es zona": así el contorno se cierra
    // cuando la región llega al límite del lote.
    borders.set(`${cell.x},${cell.y}`, {
      west: !inside.has(`${cell.x - 1},${cell.y}`),
      east: !inside.has(`${cell.x + 1},${cell.y}`),
      south: !inside.has(`${cell.x},${cell.y - 1}`),
      north: !inside.has(`${cell.x},${cell.y + 1}`),
    });
  }
  return borders;
}

function at(field: Float32Array, width: number, height: number, x: number, y: number) {
  const cx = Math.min(width - 1, Math.max(0, x));
  const cy = Math.min(height - 1, Math.max(0, y));
  return field[cy * width + cx] ?? 0;
}

/**
 * Campo binario "esta celda es del nivel buscado", suavizado.
 *
 * El suavizado es lo que hace orgánico el contorno. Sobre el campo crudo,
 * marching squares produce un borde de escalones a 45°: correcto pero anguloso,
 * y sobre un terreno con relieve canta.
 */
function levelField(
  cells: ZonePlacement[],
  gridWidth: number,
  gridHeight: number,
  level: RiskLevel,
  passes = 2,
): Float32Array {
  let field = new Float32Array(gridWidth * gridHeight);
  for (const cell of cells) {
    if (cell.risk_level === level && cell.x >= 0 && cell.x < gridWidth) {
      field[cell.y * gridWidth + cell.x] = 1;
    }
  }

  for (let p = 0; p < passes; p += 1) {
    const next = new Float32Array(field.length);
    for (let y = 0; y < gridHeight; y += 1) {
      for (let x = 0; x < gridWidth; x += 1) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= gridWidth || ny < 0 || ny >= gridHeight) continue;
            // Peso central mayor: suaviza sin engordar la región.
            const w = dx === 0 && dy === 0 ? 4 : 1;
            sum += (field[ny * gridWidth + nx] ?? 0) * w;
            n += w;
          }
        }
        next[y * gridWidth + x] = sum / n;
      }
    }
    field = next;
  }
  return field;
}

/**
 * Contorno de la región, por marching squares sobre el campo suavizado.
 *
 * Devuelve pares de puntos en coordenadas continuas de malla. Proyectarlos sobre
 * el relieve es trabajo del componente: este módulo no sabe de alturas.
 */
export function zoneContour(
  cells: ZonePlacement[],
  gridWidth: number,
  gridHeight: number,
  level: RiskLevel = "high",
  iso = 0.42,
): [number, number][] {
  const field = levelField(cells, gridWidth, gridHeight, level, 2);
  const value = (x: number, y: number) => at(field, gridWidth, gridHeight, x, y);
  const points: [number, number][] = [];

  const inBounds = (px: number, py: number) =>
    px >= 0 && px < gridWidth && py >= 0 && py < gridHeight;

  // Un anillo extra para que la región se cierre contra el borde del lote.
  for (let y = -1; y < gridHeight; y += 1) {
    for (let x = -1; x < gridWidth; x += 1) {
      const v = [
        inBounds(x, y) ? value(x, y) : 0,
        inBounds(x + 1, y) ? value(x + 1, y) : 0,
        inBounds(x + 1, y + 1) ? value(x + 1, y + 1) : 0,
        inBounds(x, y + 1) ? value(x, y + 1) : 0,
      ];

      let code = 0;
      if (v[0]! >= iso) code |= 1;
      if (v[1]! >= iso) code |= 2;
      if (v[2]! >= iso) code |= 4;
      if (v[3]! >= iso) code |= 8;
      if (code === 0 || code === 15) continue;

      const cross = (
        ax: number, ay: number, av: number,
        bx: number, by: number, bv: number,
      ): [number, number] => {
        const d = bv - av;
        const t = d === 0 ? 0.5 : Math.min(1, Math.max(0, (iso - av) / d));
        return [ax + (bx - ax) * t, ay + (by - ay) * t];
      };

      const bottom = () => cross(x, y, v[0]!, x + 1, y, v[1]!);
      const right = () => cross(x + 1, y, v[1]!, x + 1, y + 1, v[2]!);
      const top = () => cross(x, y + 1, v[3]!, x + 1, y + 1, v[2]!);
      const left = () => cross(x, y, v[0]!, x, y + 1, v[3]!);

      const edges: Record<number, [() => [number, number], () => [number, number]][]> = {
        1: [[left, bottom]],
        2: [[bottom, right]],
        3: [[left, right]],
        4: [[right, top]],
        5: [[left, top], [bottom, right]],
        6: [[bottom, top]],
        7: [[left, top]],
        8: [[top, left]],
        9: [[top, bottom]],
        10: [[top, left], [right, bottom]],
        11: [[top, right]],
        12: [[right, left]],
        13: [[right, bottom]],
        14: [[bottom, left]],
      };

      for (const [a, b] of edges[code] ?? []) points.push(a(), b());
    }
  }

  return points;
}
