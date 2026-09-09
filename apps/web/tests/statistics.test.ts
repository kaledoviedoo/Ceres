/**
 * Estadística descriptiva del lote.
 *
 * Todo lo que se prueba aquí son números entrando y números saliendo: sin React,
 * sin Three, sin store. Esa es justo la razón de que estas funciones vivan en su
 * propio módulo.
 *
 * Los casos que más importan no son los normales, son los degenerados: un lote
 * vacío, un lote donde todas las celdas valen lo mismo, y una región que se come
 * el lote entero. Son los tres que producen divisiones por cero, percentiles
 * absurdos o gráficos que sugieren una dispersión inexistente.
 */

import { describe, expect, it } from "vitest";

import {
  histogram,
  overlap,
  percentileLabel,
  percentileOf,
  quantileSorted,
  rankOf,
  summarize,
} from "@/lib/terrain/statistics";

describe("resumen", () => {
  it("describe un conjunto con sus cuartiles", () => {
    const s = summarize([1, 2, 3, 4, 5])!;
    expect(s).toMatchObject({ n: 5, min: 1, max: 5, mean: 3, median: 3, p25: 2, p75: 4 });
  });

  it("no depende del orden de entrada", () => {
    expect(summarize([5, 1, 4, 2, 3])).toEqual(summarize([1, 2, 3, 4, 5]));
  });

  it("un lote vacío no se describe: devuelve null, no ceros", () => {
    // Devolver {min: 0, max: 0} sería mentir: no es que el lote valga cero, es
    // que no hay lote.
    expect(summarize([])).toBeNull();
  });

  it("un solo valor es su propio mínimo, máximo y mediana", () => {
    expect(summarize([7])).toMatchObject({ n: 1, min: 7, max: 7, median: 7, mean: 7 });
  });

  it("todas las celdas iguales: dispersión cero, sin dividir por cero", () => {
    const s = summarize([3, 3, 3, 3])!;
    expect(s.min).toBe(3);
    expect(s.max).toBe(3);
    expect(s.p25).toBe(3);
    expect(s.p75).toBe(3);
  });
});

describe("cuantiles", () => {
  it("interpola entre dos posiciones", () => {
    expect(quantileSorted([0, 10], 0.5)).toBe(5);
    expect(quantileSorted([0, 100], 0.25)).toBe(25);
  });

  it("los extremos son el mínimo y el máximo", () => {
    const s = [1, 2, 3, 4];
    expect(quantileSorted(s, 0)).toBe(1);
    expect(quantileSorted(s, 1)).toBe(4);
  });

  it("acota fuera de rango en vez de devolver basura", () => {
    expect(quantileSorted([1, 2, 3], -1)).toBe(1);
    expect(quantileSorted([1, 2, 3], 5)).toBe(3);
  });
});

describe("percentil", () => {
  it("sitúa un valor dentro del reparto", () => {
    expect(percentileOf([1, 2, 3, 4], 3)).toBe(0.5);
  });

  it("el menor no supera a nadie; el mayor supera a todos menos a sí mismo", () => {
    const v = [1, 2, 3, 4];
    expect(percentileOf(v, 1)).toBe(0);
    expect(percentileOf(v, 4)).toBe(0.75);
  });

  it("con todos empatados nadie supera a nadie", () => {
    // Con "menor o igual" esto daría percentil 100 a un valor que no destaca en
    // nada. Estricto es lo honesto.
    expect(percentileOf([5, 5, 5, 5], 5)).toBe(0);
  });

  it("un lote vacío no coloca a nadie", () => {
    expect(percentileOf([], 3)).toBe(0);
  });

  it("es un recuento, no un umbral nuevo", () => {
    const v = [10, 20, 30];
    expect(percentileOf(v, 25)).toBeCloseTo(2 / 3, 10);
  });
});

describe("rótulo del percentil", () => {
  it("nunca afirma más de lo que se puede contar", () => {
    // El caso real que lo motiva: la celda que más rinde de un lote de 400
    // supera a 399, o sea el 99,75 %. Redondeando saldría "percentil 100", que
    // dice que supera a todas incluida ella misma. Truncar dice 99, y 99 es
    // cierto.
    expect(percentileLabel(399 / 400)).toBe(99);
    expect(percentileLabel(0.999)).toBe(99);
    expect(percentileLabel(0.5)).toBe(50);
  });

  it("los extremos reales sí llegan a 0 y a 100", () => {
    expect(percentileLabel(0)).toBe(0);
    expect(percentileLabel(1)).toBe(100);
  });

  it("acota entradas imposibles en vez de propagarlas", () => {
    expect(percentileLabel(-0.3)).toBe(0);
    expect(percentileLabel(4)).toBe(100);
  });
});

describe("puesto", () => {
  it("el mayor es el primero", () => {
    expect(rankOf([5, 9, 1], 9)).toBe(1);
    expect(rankOf([5, 9, 1], 1)).toBe(3);
  });

  it("los empates comparten puesto", () => {
    // Dos celdas iguales no pueden ser la 1.ª y la 2.ª sin inventar un
    // desempate que el dato no tiene.
    expect(rankOf([7, 7, 3], 7)).toBe(1);
    expect(rankOf([7, 7, 3], 3)).toBe(3);
  });

  it("en un lote vacío el puesto es el primero por vacuidad", () => {
    expect(rankOf([], 1)).toBe(1);
  });
});

describe("histograma", () => {
  it("reparte en intervalos de igual anchura y no pierde ninguna celda", () => {
    const bins = histogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
    expect(bins).toHaveLength(5);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(11);
  });

  it("el máximo cae dentro del último intervalo, no fuera", () => {
    // Es el error clásico: `floor((max - min) / width)` da `bins` y se escapa.
    const bins = histogram([0, 10], 4);
    expect(bins[bins.length - 1]!.count).toBe(1);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(2);
  });

  it("todos los valores iguales dan UN intervalo, no diez vacíos", () => {
    // Diez barras con nueve vacías sugerirían una dispersión que no existe.
    const bins = histogram([4, 4, 4], 10);
    expect(bins).toHaveLength(1);
    expect(bins[0]).toMatchObject({ from: 4, to: 4, count: 3 });
  });

  it("un lote vacío no dibuja nada", () => {
    expect(histogram([], 10)).toEqual([]);
    expect(histogram([1, 2], 0)).toEqual([]);
  });

  it("los intervalos son contiguos y cubren el recorrido", () => {
    const bins = histogram([2, 8], 3);
    expect(bins[0]!.from).toBe(2);
    expect(bins[bins.length - 1]!.to).toBeCloseTo(8, 10);
    for (let i = 1; i < bins.length; i += 1) {
      expect(bins[i]!.from).toBeCloseTo(bins[i - 1]!.to, 10);
    }
  });
});

describe("coincidencia espacial", () => {
  // Diez celdas: las tres primeras son la región, y son justo las que menos
  // rinden. Coincidencia perfecta, que es el caso que hay que saber medir.
  const valores = [1, 2, 3, 10, 11, 12, 13, 14, 15, 16];
  const region = [true, true, true, false, false, false, false, false, false, false];

  it("mide cuánto se solapan región y extremo", () => {
    const o = overlap(valores, region, "low", 0.3)!;
    expect(o.region).toBe(3);
    expect(o.both).toBe(3);
    expect(o.shareOfRegion).toBe(1);
    expect(o.shareOfExtreme).toBe(1);
  });

  it("separa las medianas de dentro y de fuera", () => {
    const o = overlap(valores, region, "low", 0.2)!;
    expect(o.medianInside).toBe(2);
    expect(o.medianOutside).toBe(13);
  });

  it("sin coincidencia, lo dice: cero comunes", () => {
    // La región es ahora la que MAS rinde; buscar el extremo bajo no encuentra
    // nada suyo.
    const alta = [false, false, false, false, false, false, false, true, true, true];
    const o = overlap(valores, alta, "low", 0.3)!;
    expect(o.both).toBe(0);
    expect(o.shareOfRegion).toBe(0);
    expect(o.medianInside).toBeGreaterThan(o.medianOutside);
  });

  it("el extremo alto también se mide", () => {
    const alta = [false, false, false, false, false, false, false, true, true, true];
    const o = overlap(valores, alta, "high", 0.3)!;
    expect(o.both).toBe(3);
    expect(o.shareOfRegion).toBe(1);
  });

  it("sin región, o con la región ocupando el lote entero, no hay comparación", () => {
    // Sin los dos lados solo hay una descripción del total, y presentarla como
    // comparación sería engañoso.
    expect(overlap(valores, valores.map(() => false), "low")).toBeNull();
    expect(overlap(valores, valores.map(() => true), "low")).toBeNull();
    expect(overlap([], [], "low")).toBeNull();
  });

  it("el umbral sale del propio lote", () => {
    const o = overlap(valores, region, "low", 0.2)!;
    expect(o.threshold).toBeGreaterThanOrEqual(Math.min(...valores));
    expect(o.threshold).toBeLessThanOrEqual(Math.max(...valores));
  });

  it("con todo el lote empatado no se rompe", () => {
    const iguales = [5, 5, 5, 5];
    const o = overlap(iguales, [true, true, false, false], "low", 0.25)!;
    expect(o.medianInside).toBe(5);
    expect(o.medianOutside).toBe(5);
    // Con todos empatados, todos son "extremo": el dato no distingue nada, y la
    // función lo refleja en vez de inventar una separación.
    expect(o.extreme).toBe(4);
  });
});
