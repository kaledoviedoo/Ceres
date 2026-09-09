/**
 * La rama analítica: métricas → color y fronteras.
 *
 * Los percentiles se fueron a `statistics.test.ts` con el resto de la
 * estadística descriptiva: aquí se prueba la traducción a imagen.
 *
 * El invariante que protege este archivo es el espejo del de la geometría:
 * ninguna de estas funciones sabe qué es una elevación, y ninguna decide dónde
 * está nada en el espacio. Solo traducen lo que el motor calculó.
 *
 * También fija que el mapeo valor → color sigue saliendo de
 * `lib/presentation/risk.ts`. Si alguien decidiera aquí que "alto" es naranja,
 * el mapa y la leyenda dejarían de decir lo mismo.
 */

import { describe, expect, it } from "vitest";

import { cellsRgb, parseColor, zoneBorders, zoneContour } from "@/lib/terrain/analysis";
import type { CellOverview, RiskLevel } from "@/lib/types/api";

function base(overrides: Partial<CellOverview>): CellOverview {
  return {
    cell_id: "a",
    cell_code: "A-1",
    x: 0,
    y: 0,
    projected_yield_kg: 5,
    projected_boxes: 1,
    estimated_loss_percentage: 10,
    risk_score: 0.5,
    risk_level: "medium",
    ...overrides,
  };
}

function niveles(size: number, level: (x: number, y: number) => RiskLevel) {
  const cells = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) cells.push({ x, y, risk_level: level(x, y) });
  }
  return cells;
}

describe("color del dato", () => {
  const cells = [
    base({ cell_id: "a", x: 0, y: 0, risk_level: "high", risk_score: 0.9 }),
    base({ cell_id: "b", x: 1, y: 0, risk_level: "low", risk_score: 0.1 }),
  ];

  it("coloca el color que le den, sin decidir ninguno", () => {
    // El módulo no sabe qué métrica se pinta: recibe una función de color y la
    // coloca en la rejilla. Es lo que permite añadir una capa sin tocarlo.
    const colorOf = (cell: { risk_level: string }) =>
      cell.risk_level === "high" ? "#ef4444" : "rgb(34, 197, 94)";
    const rgb = cellsRgb(cells, 2, 1, colorOf);
    expect([rgb[0], rgb[1], rgb[2]]).toEqual(parseColor(colorOf(cells[0]!)));
    expect([rgb[3], rgb[4], rgb[5]]).toEqual(parseColor(colorOf(cells[1]!)));
  });

  it("entiende las dos formas de escribir un color", () => {
    // Niveles discretos en hex, rampa continua en rgb().
    expect(parseColor("#22c55e")).toEqual([34, 197, 94]);
    expect(parseColor("rgb(239, 68, 68)")).toEqual([239, 68, 68]);
  });

  it("coloca una entrada por celda de la malla", () => {
    expect(cellsRgb(cells, 2, 1, () => "#ffffff")).toHaveLength(2 * 1 * 3);
  });
});

describe("frontera de la zona en riesgo alto", () => {
  it("una celda aislada queda contorneada por sus cuatro lados", () => {
    const cells = niveles(5, (x, y) => (x === 2 && y === 2 ? "high" : "low"));
    expect(zoneBorders(cells).get("2,2")).toEqual({
      north: true,
      south: true,
      east: true,
      west: true,
    });
  });

  it("un bloque compacto solo se contornea por fuera", () => {
    // Si el contorno se dibujara entre celdas del mismo nivel, la zona se vería
    // como cuatro cuadrados y no como una región.
    const cells = niveles(6, (x, y) => (x >= 2 && x <= 3 && y >= 2 && y <= 3 ? "high" : "low"));
    const borders = zoneBorders(cells);

    expect(borders.size).toBe(4);
    const lados = [...borders.values()].reduce(
      (t, b) => t + Number(b.north) + Number(b.south) + Number(b.east) + Number(b.west),
      0,
    );
    expect(lados).toBe(8);
  });

  it("se cierra contra el borde del lote", () => {
    // La zona crítica del dataset nace pegada al oeste: si el límite de la
    // parcela no contara, el contorno quedaría abierto.
    const cells = niveles(4, (x, y) => (x === 0 && y === 0 ? "high" : "low"));
    expect(zoneBorders(cells).get("0,0")?.west).toBe(true);
  });

  it("no contornea `medium`, que es la mayoría de las celdas", () => {
    expect(zoneBorders(niveles(6, () => "medium")).size).toBe(0);
  });
});

describe("contorno en coordenadas de malla", () => {
  it("una malla sin riesgo alto no dibuja nada", () => {
    expect(zoneContour(niveles(6, () => "medium"), 6, 6, "high")).toHaveLength(0);
  });

  it("rodea la región y emite pares de vértices", () => {
    const cells = niveles(9, (x, y) => (x >= 3 && x <= 5 && y >= 3 && y <= 5 ? "high" : "low"));
    const puntos = zoneContour(cells, 9, 9, "high");

    expect(puntos.length).toBeGreaterThan(0);
    expect(puntos.length % 2).toBe(0);
    for (const [gx, gy] of puntos) {
      expect(gx).toBeGreaterThan(1);
      expect(gx).toBeLessThan(7);
      expect(gy).toBeGreaterThan(1);
      expect(gy).toBeLessThan(7);
    }
  });

  it("sigue una curva, no los bordes de las celdas", () => {
    // Si todos los vértices cayeran en múltiplos de media celda, el contorno
    // sería el perímetro de la cuadrícula otra vez.
    const cells = niveles(11, (x, y) => (Math.hypot(x - 5, y - 5) < 2.6 ? "high" : "low"));
    const alineado = (v: number) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-6;
    const fuera = zoneContour(cells, 11, 11, "high").filter(
      ([gx, gy]) => !alineado(gx) || !alineado(gy),
    );

    expect(fuera.length).toBeGreaterThan(0);
  });

  it("no devuelve alturas: la rama analítica no sabe de elevación", () => {
    const cells = niveles(5, (x, y) => (x === 2 && y === 2 ? "high" : "low"));
    for (const punto of zoneContour(cells, 5, 5, "high")) {
      expect(punto).toHaveLength(2);
    }
  });
});
