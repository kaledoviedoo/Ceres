/**
 * Conversión entre coordenadas de malla y coordenadas de mundo.
 *
 * Es el único módulo que las dos ramas de la arquitectura comparten, y es
 * deliberadamente tonto: no sabe qué es una elevación ni qué es un riesgo. Solo
 * traduce posiciones.
 *
 *     ElevationSource → ElevationField → TerrainGeometry ──┐
 *                                                          ├→ coords
 *     AgriculturalData → AnalysisLayer ────────────────────┘
 *
 * CONVENIO DE EJES, heredado del dominio:
 *
 *     x del dato  → +X del mundo   (0 = oeste)
 *     y del dato  → −Z del mundo   (0 = sur, así que el norte queda hacia −Z)
 *     elevación   → +Y del mundo
 *
 * La inversión de Z existe porque en Three.js la cámara mira por defecto hacia
 * −Z: con este convenio, la vista inicial deja el norte al fondo y el oeste a la
 * izquierda, igual que en la malla 2D y que en un mapa.
 */

/** Lado de una celda en unidades de mundo. 1 celda = 1 m² = 1 unidad. */
export const CELL_SIZE = 1;

/** Centro del lote en coordenadas de malla, para orbitar alrededor de él. */
export function gridCenter(gridWidth: number, gridHeight: number): [number, number] {
  return [(gridWidth - 1) / 2, (gridHeight - 1) / 2];
}

/** Lado del lote en unidades de mundo. Fija los límites de zoom de la cámara. */
export function plotExtent(gridWidth: number, gridHeight: number): number {
  return Math.max(gridWidth, gridHeight) * CELL_SIZE;
}

export function worldToGrid(
  worldX: number,
  worldZ: number,
  gridWidth: number,
  gridHeight: number,
): [number, number] {
  const [centerX, centerY] = gridCenter(gridWidth, gridHeight);
  return [worldX / CELL_SIZE + centerX, centerY - worldZ / CELL_SIZE];
}

export function gridToWorld(
  gx: number,
  gy: number,
  gridWidth: number,
  gridHeight: number,
): [number, number] {
  const [centerX, centerY] = gridCenter(gridWidth, gridHeight);
  return [(gx - centerX) * CELL_SIZE, -(gy - centerY) * CELL_SIZE];
}

/** Los cuatro bordes de una celda en coordenadas de mundo. */
export function cellBounds(gx: number, gy: number, gridWidth: number, gridHeight: number) {
  const [worldX, worldZ] = gridToWorld(gx, gy, gridWidth, gridHeight);
  const half = CELL_SIZE / 2;
  return {
    west: worldX - half,
    east: worldX + half,
    north: worldZ - half,
    south: worldZ + half,
  };
}
