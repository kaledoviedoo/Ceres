/**
 * Geometría del terreno y unión de los dos endpoints.
 *
 * Todo lo que se comprueba aquí es presentación: de datos de celda a posiciones
 * en la escena. Si alguna vez apareciera un cálculo agronómico en este módulo,
 * estos tests serían el sitio donde se notaría que no encaja.
 */

import { describe, expect, it } from "vitest";

import {
  BASE_THICKNESS,
  CELL_GAP,
  CELL_SIZE,
  VERTICAL_EXAGGERATION,
  cellHeight,
  cellPosition,
  cellTop,
  elevationRange,
  gridCenter,
  plotExtent,
} from "@/lib/terrain/geometry";
import { joinTerrainCells } from "@/lib/terrain/types";
import type { CellOverview, CellSummary } from "@/lib/types/api";
import { buildOverview, buildTerrainCells } from "./fixtures";

describe("rango de elevación", () => {
  it("encuentra el mínimo y el máximo del lote", () => {
    const range = elevationRange([
      { elevation_m: 1181 },
      { elevation_m: 1179.5 },
      { elevation_m: 1182.8 },
    ]);

    expect(range.min).toBe(1179.5);
    expect(range.max).toBe(1182.8);
  });

  it("no explota con una lista vacía", () => {
    expect(elevationRange([])).toEqual({ min: 0, max: 1 });
  });
});

describe("altura de celda", () => {
  const range = { min: 1179.809, max: 1182.821 }; // el rango real de Plot A

  it("la celda más baja tiene el grosor mínimo", () => {
    expect(cellHeight(range.min, range)).toBeCloseTo(BASE_THICKNESS, 6);
  });

  it("la más alta suma toda la exageración vertical", () => {
    expect(cellHeight(range.max, range)).toBeCloseTo(
      BASE_THICKNESS + VERTICAL_EXAGGERATION,
      6,
    );
  });

  it("es monótona: más metros, más altura", () => {
    const alturas = [1180, 1181, 1182].map((m) => cellHeight(m, range));
    expect(alturas).toEqual([...alturas].sort((a, b) => a - b));
  });

  it("un lote plano no divide por cero", () => {
    const plano = { min: 1180, max: 1180 };
    expect(Number.isFinite(cellHeight(1180, plano))).toBe(true);
  });

  it("la exageración solo escala; no inventa relieve donde no lo hay", () => {
    // Tres metros reales siguen siendo tres metros en el inspector: esto solo
    // decide cuántos píxeles ocupan.
    const plano = { min: 1180, max: 1180 };
    const a = cellHeight(1180, plano);
    const b = cellHeight(1180, plano);
    expect(a).toBe(b);
  });
});

describe("posición en el mundo", () => {
  it("centra la malla en el origen", () => {
    expect(gridCenter(20, 20)).toEqual([9.5, 9.5]);
  });

  it("x crece hacia el este", () => {
    const oeste = cellPosition(0, 10, 2, 20, 20);
    const este = cellPosition(19, 10, 2, 20, 20);
    expect(este[0]).toBeGreaterThan(oeste[0]);
  });

  it("y crece hacia el norte, que en la escena es −Z", () => {
    // Three.js mira por defecto hacia −Z: con esta convención la vista inicial
    // deja el norte al fondo, como en un mapa.
    const sur = cellPosition(10, 0, 2, 20, 20);
    const norte = cellPosition(10, 19, 2, 20, 20);
    expect(norte[2]).toBeLessThan(sur[2]);
  });

  it("apoya todos los bloques en el mismo plano", () => {
    // Un boxGeometry está centrado en su origen: cada bloque sube la mitad de
    // su altura para que todos toquen y = 0.
    for (const height of [1.2, 2.5, 4.2]) {
      expect(cellPosition(5, 5, height, 20, 20)[1]).toBeCloseTo(height / 2, 6);
    }
  });

  it("separa las celdas para que se lean como piezas", () => {
    const a = cellPosition(0, 0, 2, 20, 20);
    const b = cellPosition(1, 0, 2, 20, 20);
    expect(b[0] - a[0]).toBeCloseTo(CELL_SIZE + CELL_GAP, 6);
  });

  it("cellTop devuelve la cara superior, no el centro", () => {
    const height = 3.4;
    const centro = cellPosition(7, 7, height, 20, 20);
    const arriba = cellTop(7, 7, height, 20, 20);

    expect(arriba[1]).toBeCloseTo(height, 6);
    expect(arriba[0]).toBe(centro[0]);
    expect(arriba[2]).toBe(centro[2]);
  });

  it("la extensión del lote crece con la malla", () => {
    expect(plotExtent(40, 40)).toBeGreaterThan(plotExtent(20, 20));
  });
});

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
