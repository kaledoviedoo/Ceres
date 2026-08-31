/**
 * Lógica de presentación: de valores a colores y a texto.
 *
 * Es lo único "calculado" del frontend, y es puramente visual. Estos tests
 * también fijan la frontera: si alguien intentara derivar aquí una métrica
 * agrícola, no tendría dónde ponerla.
 */

import { describe, expect, it } from "vitest";

import {
  RISK_COLORS,
  cellColor,
  metricRange,
  riskDistribution,
} from "@/lib/presentation/risk";
import {
  formatFactorDelta,
  formatIndex,
  formatKg,
  formatPercent,
  formatScore,
} from "@/lib/presentation/format";
import type { CellOverview } from "@/lib/types/api";
import { buildOverview, cellOverview } from "./fixtures";

describe("colores de riesgo", () => {
  it("usa verde, ámbar y rojo para los tres niveles", () => {
    expect(RISK_COLORS.low.fill).toBe("#22c55e");
    expect(RISK_COLORS.medium.fill).toBe("#eab308");
    expect(RISK_COLORS.high.fill).toBe("#ef4444");
  });

  it("en modo riesgo colorea por nivel, no por rampa continua", () => {
    // El nivel es una decisión del dominio (umbrales en app/domain/units.py).
    // Difuminarlo escondería justo lo que el agrónomo busca.
    const range = { min: 0, max: 1 };
    const high: CellOverview = { ...cellOverview, risk_level: "high", risk_score: 0.67 };
    const alsoHigh: CellOverview = { ...cellOverview, risk_level: "high", risk_score: 0.99 };

    expect(cellColor(high, "risk", range)).toBe(RISK_COLORS.high.fill);
    expect(cellColor(alsoHigh, "risk", range)).toBe(RISK_COLORS.high.fill);
  });

  it("en modo rendimiento, más kilos es más verde", () => {
    const cells = buildOverview().cells;
    const range = metricRange(cells, "yield");
    const best = cells.find((c) => c.projected_yield_kg === range.max)!;
    const worst = cells.find((c) => c.projected_yield_kg === range.min)!;

    expect(cellColor(best, "yield", range)).toBe("rgb(34, 197, 94)");
    expect(cellColor(worst, "yield", range)).toBe("rgb(239, 68, 68)");
  });

  it("en modo pérdida, más porcentaje es más rojo", () => {
    const cells = buildOverview().cells;
    const range = metricRange(cells, "loss");
    const worst = cells.find((c) => c.estimated_loss_percentage === range.max)!;

    expect(cellColor(worst, "loss", range)).toBe("rgb(239, 68, 68)");
  });

  it("no divide por cero cuando todas las celdas valen igual", () => {
    const flat = [cellOverview, { ...cellOverview, cell_id: "otra" }];
    const range = metricRange(flat, "yield");

    expect(() => cellColor(flat[0]!, "yield", range)).not.toThrow();
  });
});

describe("distribución de riesgo", () => {
  it("cuenta las celdas de cada nivel", () => {
    const counts = riskDistribution(buildOverview().cells);

    expect(counts.low + counts.medium + counts.high).toBe(400);
    expect(counts.high).toBeGreaterThan(0);
    expect(counts.medium).toBeGreaterThan(0);
    expect(counts.low).toBeGreaterThan(0);
  });

  it("devuelve ceros con una lista vacía", () => {
    expect(riskDistribution([])).toEqual({ low: 0, medium: 0, high: 0 });
  });
});

describe("formato", () => {
  it("no altera el valor que manda el backend", () => {
    // Formatear es añadir unidad y separadores, no recalcular.
    expect(formatKg(11.9634)).toContain("11,96");
    expect(formatPercent(9.18)).toContain("9,18");
    expect(formatScore(0.1492)).toContain("0,1492");
  });

  it("muestra los índices 0..1 como porcentaje", () => {
    expect(formatIndex(0.722)).toContain("72,2");
  });

  it("expresa los factores como desviación respecto a 1.00", () => {
    expect(formatFactorDelta(1.061)).toBe("+6,1 %");
    expect(formatFactorDelta(0.929)).toBe("-7,1 %");
    expect(formatFactorDelta(1)).toBe("0,0 %");
  });
});
