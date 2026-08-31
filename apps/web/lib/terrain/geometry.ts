/**
 * Geometría del terreno: de datos de celda a posiciones en la escena.
 *
 * Todo lo que hay aquí es PRESENTACIÓN. Convierte coordenadas de malla y metros
 * sobre el nivel del mar en unidades de mundo 3D. No calcula rendimiento, ni
 * pérdida, ni riesgo, ni ninguna otra cosa que le corresponda al motor.
 *
 * Convención de ejes, heredada del dominio:
 *
 *     x del dato  → +X del mundo   (0 = oeste)
 *     y del dato  → −Z del mundo   (0 = sur, así que el norte queda hacia −Z)
 *     elevación   → +Y del mundo
 *
 * La inversión de Z existe porque en Three.js la cámara mira por defecto hacia
 * −Z: con esta convención, la vista inicial deja el norte al fondo y el oeste a
 * la izquierda, igual que en la malla 2D y que en un mapa.
 */

import type { CellSummary } from "@/lib/types/api";

/** Lado de una celda en unidades de mundo. 1 celda = 1 m² = 1 unidad. */
export const CELL_SIZE = 1;

/**
 * Separación entre celdas.
 *
 * Muy pequeña a propósito: lo bastante para que se distinga la retícula, no
 * tanto como para que el terreno se lea como cuatrocientas columnas sueltas. La
 * parcela tiene que verse como UNA superficie con relieve.
 */
export const CELL_GAP = 0.02;

/**
 * Exageración vertical, en unidades de mundo para todo el rango de elevación
 * del lote.
 *
 * El terreno real varía 3,01 m sobre 20 × 20 m (σ = 0,63 m). A escala 1:1 el
 * relieve —incluida la hondonada de la zona crítica sintética— sería casi
 * invisible desde una cámara que abarca el lote entero. Se exagera para que la
 * forma se lea, del mismo modo que un mapa topográfico exagera el perfil.
 *
 * NO altera ningún dato: la elevación real sigue mostrándose en metros en el
 * inspector. Esto solo decide cuántos píxeles ocupa esa diferencia.
 */
export const VERTICAL_EXAGGERATION = 1.5;

/**
 * Grosor del bloque bajo la celda más baja.
 *
 * Es lo que convierte la parcela en un volumen: el canto que se ve al orbitar
 * es la pared de tierra de una muestra extraída del campo. Con una lámina fina,
 * el terreno sería un mapa flotando en el vacío.
 *
 * Grueso respecto a la exageración vertical, para que el relieve se lea como
 * ondulación de una superficie y no como barras de un gráfico.
 */
export const BASE_THICKNESS = 2.6;

/** Rango de elevación de un lote, en metros sobre el nivel del mar. */
export interface ElevationRange {
  min: number;
  max: number;
}

export function elevationRange(cells: Pick<CellSummary, "elevation_m">[]): ElevationRange {
  if (cells.length === 0) return { min: 0, max: 1 };

  let min = Infinity;
  let max = -Infinity;
  for (const cell of cells) {
    if (cell.elevation_m < min) min = cell.elevation_m;
    if (cell.elevation_m > max) max = cell.elevation_m;
  }
  return { min, max };
}

/**
 * Altura del bloque de una celda, en unidades de mundo.
 *
 * La elevación se normaliza dentro del propio lote —no contra una escala
 * absoluta— porque lo que interesa leer es el relieve relativo de ESTA parcela.
 * Un lote perfectamente plano da todas las alturas iguales en vez de una
 * división por cero.
 */
export function cellHeight(elevationM: number, range: ElevationRange): number {
  const span = range.max - range.min;
  const normalized = span === 0 ? 0.5 : (elevationM - range.min) / span;
  return BASE_THICKNESS + normalized * VERTICAL_EXAGGERATION;
}

/** Centro del lote en coordenadas de malla, para orbitar alrededor de él. */
export function gridCenter(gridWidth: number, gridHeight: number): [number, number] {
  return [(gridWidth - 1) / 2, (gridHeight - 1) / 2];
}

/**
 * Posición del centro del bloque de una celda.
 *
 * Se devuelve el CENTRO y no la base porque un `boxGeometry` de Three.js está
 * centrado en su origen: para que todos los bloques apoyen en el mismo plano,
 * cada uno se sube la mitad de su altura.
 */
export function cellPosition(
  x: number,
  y: number,
  height: number,
  gridWidth: number,
  gridHeight: number,
): [number, number, number] {
  const [centerX, centerY] = gridCenter(gridWidth, gridHeight);
  const pitch = CELL_SIZE + CELL_GAP;

  return [(x - centerX) * pitch, height / 2, -(y - centerY) * pitch];
}

/** Punto sobre la cara superior de una celda, para anclar marcadores. */
export function cellTop(
  x: number,
  y: number,
  height: number,
  gridWidth: number,
  gridHeight: number,
): [number, number, number] {
  const [worldX, , worldZ] = cellPosition(x, y, height, gridWidth, gridHeight);
  return [worldX, height, worldZ];
}

/** Lado del lote en unidades de mundo. Fija los límites de zoom de la cámara. */
export function plotExtent(gridWidth: number, gridHeight: number): number {
  return Math.max(gridWidth, gridHeight) * (CELL_SIZE + CELL_GAP);
}
