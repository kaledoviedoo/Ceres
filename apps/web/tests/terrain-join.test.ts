/**
 * Unión de los dos endpoints que alimentan el terreno.
 *
 * `/plots/{id}/cells` da la GEOMETRIA —elevación— y `/plots/{id}/overview` da el
 * ANALISIS —métricas—. Emparejarlos por `cell_id` no es una fórmula: los valores
 * llegan ya calculados del motor.
 *
 * El convenio de ejes y la huella del lote se comprueban en
 * `terrain-elevation.test.ts`, junto al resto de la rama geométrica.
 */

import { describe, expect, it } from "vitest";

import { joinTerrainCells } from "@/lib/terrain/types";
import type { CellOverview, CellSummary } from "@/lib/types/api";
import { buildOverview, buildTerrainCells } from "./fixtures";

describe("unión de estado y métricas", () => {
  const state: CellSummary[] = [
    {
      id: "cell-1",
      cell_code: "A-00001",
      x: 0,
      y: 0,
      elevation_m: 1180.4,
      slope_deg: 7.3,
      soil_quality: 0.41,
      plant_density: 2.46,
      health_factor: 0.71,
      base_yield_factor: 0.94,
    },
  ];

  const metrics: CellOverview[] = [
    {
      cell_id: "cell-1",
      cell_code: "A-00001",
      x: 0,
      y: 0,
      projected_yield_kg: 8.2,
      projected_boxes: 2,
      estimated_loss_percentage: 18.4,
      risk_score: 0.35,
      risk_level: "medium",
    },
  ];

  it("combina geometría y métricas por cell_id", () => {
    const [cell] = joinTerrainCells(state, metrics);

    expect(cell).toMatchObject({
      cell_id: "cell-1",
      elevation_m: 1180.4,
      slope_deg: 7.3,
      projected_yield_kg: 8.2,
      risk_level: "medium",
    });
  });

  it("descarta una celda a la que le falte la mitad", () => {
    // Sin métricas no se puede colorear; sin elevación no se puede colocar.
    // Mejor no dibujarla que dibujarla mintiendo.
    expect(joinTerrainCells([], metrics)).toHaveLength(0);
    expect(joinTerrainCells(state, [])).toHaveLength(0);
  });

  it("no recalcula ninguna métrica: las copia tal cual", () => {
    const [cell] = joinTerrainCells(state, metrics);

    expect(cell!.projected_yield_kg).toBe(metrics[0]!.projected_yield_kg);
    expect(cell!.risk_score).toBe(metrics[0]!.risk_score);
    expect(cell!.estimated_loss_percentage).toBe(metrics[0]!.estimated_loss_percentage);
  });

  it("mantiene las 400 celdas del lote completo", () => {
    const overview = buildOverview();
    const summaries: CellSummary[] = buildTerrainCells().map((cell) => ({
      id: cell.cell_id,
      cell_code: cell.cell_code,
      x: cell.x,
      y: cell.y,
      elevation_m: cell.elevation_m,
      slope_deg: cell.slope_deg,
      soil_quality: 0.5,
      plant_density: 2.5,
      health_factor: 0.7,
      base_yield_factor: 1,
    }));

    expect(joinTerrainCells(summaries, overview.cells)).toHaveLength(400);
  });
});
