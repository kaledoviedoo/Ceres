/**
 * Lógica de presentación: de valores a colores y a texto.
 *
 * Es lo único "calculado" del frontend, y es puramente visual. Estos tests
 * también fijan la frontera: si alguien intentara derivar aquí una métrica
 * agrícola, no tendría dónde ponerla.
 */

import { describe, expect, it } from "vitest";

import { RISK_COLORS, rampColor, riskDistribution } from "@/lib/presentation/risk";
import {
  formatFactorDelta,
  formatIndex,
  formatKg,
  formatPercent,
  formatScore,
} from "@/lib/presentation/format";
import { buildOverview } from "./fixtures";

describe("colores de riesgo", () => {
  it("usa verde, ámbar y rojo para los tres niveles", () => {
    expect(RISK_COLORS.low.fill).toBe("#22c55e");
    expect(RISK_COLORS.medium.fill).toBe("#eab308");
    expect(RISK_COLORS.high.fill).toBe("#ef4444");
  });

  it("la rampa se orienta por DIRECCION, no por nombre de métrica", () => {
    // Verde es siempre "bien" y rojo "mal". Lo que cambia es qué extremo del dato
    // es cuál, y eso lo declara la capa. Este módulo ya no conoce ninguna métrica
    // por su nombre: por eso añadir Suelo y Sanidad no lo tocó.
    expect(rampColor(1, "up")).toBe("rgb(34, 197, 94)");
    expect(rampColor(0, "up")).toBe("rgb(239, 68, 68)");
    expect(rampColor(0, "down")).toBe("rgb(34, 197, 94)");
    expect(rampColor(1, "down")).toBe("rgb(239, 68, 68)");
  });

  it("las dos direcciones son la misma escala del revés", () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(rampColor(t, "up")).toBe(rampColor(1 - t, "down"));
    }
  });

  it("acota fuera de rango en vez de salirse de la paleta", () => {
    expect(rampColor(-2, "up")).toBe(rampColor(0, "up"));
    expect(rampColor(9, "up")).toBe(rampColor(1, "up"));
  });

  it("la rampa no repite color entre valores distintos", () => {
    // Es lo que hace legible un mapa de calor: si la rampa volviera sobre sus
    // pasos, dos valores distintos compartirían color y el mapa mentiría.
    const vistos = new Set<string>();
    for (let i = 0; i <= 20; i += 1) vistos.add(rampColor(i / 20, "up"));
    expect(vistos.size).toBe(21);
  });

  it("un lote sin variación no se estira: tono central, sin dividir por cero", () => {
    // Con mínimo igual a máximo la normalización sería 0/0. Quien llama entrega
    // t = 0,5 y la rampa devuelve el ámbar central en vez de NaN.
    expect(rampColor(0.5, "up")).toBe(rampColor(0.5, "down"));
    expect(() => rampColor(Number.NaN, "up")).not.toThrow();
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
