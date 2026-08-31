/**
 * La celda tal como la necesita el terreno 3D.
 *
 * Es la unión de los dos endpoints, y el reparto no es casual:
 *
 *   GET /plots/{id}/cells     → estado del terreno  → geometría (altura)
 *   GET /plots/{id}/overview  → métricas del motor  → color
 *
 * La elevación describe cómo ES la parcela; las métricas, qué predice el motor
 * sobre ella. Unir dos listas por `cell_id` no es una fórmula agronómica: los
 * valores llegan calculados y aquí solo se emparejan.
 */

import type { CellOverview, CellSummary } from "@/lib/types/api";

export interface TerrainCell extends CellOverview {
  /** Metros sobre el nivel del mar. Viene de `CellSummary`. */
  elevation_m: number;
  /** Grados. Se muestra en la etiqueta de hover; no interviene en la geometría. */
  slope_deg: number;
}

/**
 * Empareja estado y métricas por identificador de celda.
 *
 * Se descartan las celdas para las que falte cualquiera de las dos mitades: una
 * celda sin métricas no se puede colorear, y una sin elevación no se puede
 * colocar. Mejor no dibujarla que dibujarla mintiendo.
 */
export function joinTerrainCells(
  state: CellSummary[],
  metrics: CellOverview[],
): TerrainCell[] {
  const byId = new Map(state.map((cell) => [cell.id, cell]));

  const joined: TerrainCell[] = [];
  for (const metric of metrics) {
    const cell = byId.get(metric.cell_id);
    if (!cell) continue;
    joined.push({ ...metric, elevation_m: cell.elevation_m, slope_deg: cell.slope_deg });
  }
  return joined;
}
