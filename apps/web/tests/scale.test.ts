/**
 * La barra de escala mide lo que dice.
 *
 * Estas pruebas fijan la única garantía que hace útil una barra de escala: el
 * largo dibujado es exactamente la distancia rotulada. El defecto que las
 * motiva es real: la barra se recortaba a un ancho máximo conservando el rótulo
 * "5 m", así que al acercar la cámara mostraba un largo que ya no correspondía
 * a cinco metros de terreno.
 */

import { describe, expect, it } from "vitest";

import { SCALE_STEPS_M, formatScaleLabel, scaleBar } from "@/lib/presentation/scale";

const MAX = 200;

describe("scaleBar", () => {
  it("el largo dibujado es siempre la distancia rotulada", () => {
    // Barrido de escalas plausibles, de muy lejos a muy cerca.
    for (let porMetro = 0.5; porMetro < 500; porMetro *= 1.3) {
      const barra = scaleBar(porMetro, MAX);
      expect(barra).not.toBeNull();
      expect(barra!.pixels).toBeCloseTo(barra!.meters * porMetro, 9);
    }
  });

  it("cabe en el ancho disponible siempre que quepa el peldaño más pequeño", () => {
    for (let porMetro = 0.5; porMetro < 500; porMetro *= 1.3) {
      if (SCALE_STEPS_M[0] * porMetro > MAX) continue;
      expect(scaleBar(porMetro, MAX)!.pixels).toBeLessThanOrEqual(MAX);
    }
  });

  it("elige el mayor peldaño que quepa, no uno cualquiera que quepa", () => {
    for (let porMetro = 0.5; porMetro < 500; porMetro *= 1.3) {
      const { meters } = scaleBar(porMetro, MAX)!;
      const siguiente = SCALE_STEPS_M[SCALE_STEPS_M.indexOf(meters as never) + 1];
      if (siguiente !== undefined) expect(siguiente * porMetro).toBeGreaterThan(MAX);
    }
  });

  it("al acercarse rotula distancias menores, nunca mayores", () => {
    let anterior = Infinity;
    for (let porMetro = 1; porMetro < 500; porMetro *= 2) {
      const { meters } = scaleBar(porMetro, MAX)!;
      expect(meters).toBeLessThanOrEqual(anterior);
      anterior = meters;
    }
  });

  it("prefiere salirse antes que mentir cuando ni el peldaño mínimo cabe", () => {
    const porMetro = (MAX / SCALE_STEPS_M[0]) * 2;
    const barra = scaleBar(porMetro, MAX)!;
    expect(barra.meters).toBe(SCALE_STEPS_M[0]);
    expect(barra.pixels).toBeCloseTo(SCALE_STEPS_M[0] * porMetro, 9);
  });

  it("sin escala que medir no devuelve barra", () => {
    expect(scaleBar(0, MAX)).toBeNull();
    expect(scaleBar(-3, MAX)).toBeNull();
    expect(scaleBar(Number.NaN, MAX)).toBeNull();
    expect(scaleBar(Number.POSITIVE_INFINITY, MAX)).toBeNull();
  });
});

describe("formatScaleLabel", () => {
  it("usa coma decimal y sufijo de unidad", () => {
    expect(formatScaleLabel(0.5)).toBe("0,5 m");
    expect(formatScaleLabel(2)).toBe("2 m");
    expect(formatScaleLabel(100)).toBe("100 m");
  });
});
