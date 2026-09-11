/**
 * ESTADISTICA DESCRIPTIVA DEL LOTE.
 *
 * Aritmética sobre números que el motor ya calculó. Nada de esto modela nada:
 * ordenar, contar y partir por cuantiles no introduce ningún umbral agronómico
 * nuevo. Los umbrales del dominio siguen viviendo en `app/domain/units.py`, y
 * las regiones que se comparan salen de `risk_level`, que decide el motor.
 *
 * LO QUE ESTE MODULO NO SABE
 * No conoce React, ni Three, ni Zustand, ni el DOM. Recibe arrays de números y
 * devuelve números. Por eso se puede testear entero sin montar nada, y por eso
 * puede calcularse una vez por lote y reutilizarse en cualquier vista.
 *
 * COINCIDENCIA NO ES CAUSA
 * `overlap` mide cuántas celdas caen a la vez en una región y en un extremo, y
 * cuánto se separan las medianas de dentro y de fuera. Eso es una coincidencia
 * espacial, y es todo lo que se puede afirmar: decir que una variable causa la
 * otra necesitaría un modelo que aquí no existe.
 */

// --- Resumen -----------------------------------------------------------------

export interface Summary {
  n: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  /** Cuartiles. Describen el grueso del lote sin que un extremo los arrastre. */
  p25: number;
  p75: number;
}

/** Cuantil sobre un array YA ordenado, con interpolación lineal. */
export function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0]!;

  const pos = Math.min(1, Math.max(0, q)) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Describe un conjunto de valores. `null` cuando no hay nada que describir. */
export function summarize(values: number[]): Summary | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  let sum = 0;
  for (const v of sorted) sum += v;

  return {
    n: sorted.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    mean: sum / sorted.length,
    median: quantileSorted(sorted, 0.5),
    p25: quantileSorted(sorted, 0.25),
    p75: quantileSorted(sorted, 0.75),
  };
}

// --- Posición de un valor dentro del reparto ---------------------------------

/**
 * Fracción del lote que queda ESTRICTAMENTE por debajo de un valor, de 0 a 1.
 *
 * Estricto y no "menor o igual" a propósito: con muchos empates —y en un lote
 * los hay— "menor o igual" daría percentil 100 a un valor repetido que no es el
 * mayor. Así, un valor que empata con todos da percentil 0, que es lo honesto:
 * no supera a nadie.
 */
export function percentileOf(values: number[], value: number): number {
  if (values.length === 0) return 0;
  let below = 0;
  for (const v of values) if (v < value) below += 1;
  return below / values.length;
}

/**
 * El percentil como entero para rotularlo, truncando hacia abajo.
 *
 * Truncado y no redondeado, y no es cosmética. La celda que más rinde supera a
 * 399 de 400: el 99,75 %. Redondeando sale "percentil 100", que afirma que
 * rinde más que TODAS las celdas del lote, incluida ella misma. Truncando sale
 * 99, que es cierto: supera al menos al 99 %.
 *
 * La regla es no exagerar nunca hacia arriba. Un percentil rotulado es una
 * afirmación sobre cuántas celdas quedan por debajo, y esa afirmación debe
 * poder sostenerse contando.
 */
export function percentileLabel(fraction: number): number {
  return Math.floor(Math.min(1, Math.max(0, fraction)) * 100);
}

/**
 * Puesto de un valor, siendo 1 el mayor.
 *
 * Los empates comparten puesto: dos celdas con el mismo rendimiento no pueden
 * ser "la 3.ª" y "la 4.ª" sin inventar un desempate.
 */
export function rankOf(values: number[], value: number): number {
  let above = 0;
  for (const v of values) if (v > value) above += 1;
  return above + 1;
}

// --- Distribución ------------------------------------------------------------

export interface Bin {
  from: number;
  to: number;
  count: number;
}

/**
 * Reparto en intervalos de igual anchura.
 *
 * Igual anchura y no igual frecuencia: la pregunta es "¿cómo se agrupan los
 * valores?", y unos intervalos de frecuencia constante la responderían al revés
 * —aplanarían justo la forma que se quiere ver—.
 *
 * Si todos los valores son iguales no hay reparto que enseñar: un solo intervalo
 * con todo dentro. Dibujar diez barras de las que nueve están vacías sugeriría
 * una dispersión que el dato no tiene.
 */
export function histogram(values: number[], bins: number): Bin[] {
  if (values.length === 0 || bins < 1) return [];

  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }

  if (min === max) return [{ from: min, to: max, count: values.length }];

  const width = (max - min) / bins;
  const out: Bin[] = [];
  for (let i = 0; i < bins; i += 1) {
    out.push({ from: min + width * i, to: min + width * (i + 1), count: 0 });
  }

  for (const v of values) {
    // El máximo cae en el último intervalo, no en uno inexistente `bins`.
    const i = Math.min(bins - 1, Math.floor((v - min) / width));
    out[i]!.count += 1;
  }
  return out;
}

// --- Coincidencia espacial ---------------------------------------------------

export interface Overlap {
  /** Celdas dentro de la región de referencia. */
  region: number;
  /** Celdas en el extremo de la métrica. */
  extreme: number;
  /** Celdas que están en las dos cosas a la vez. */
  both: number;
  /** Qué fracción de la región cae además en el extremo, de 0 a 1. */
  shareOfRegion: number;
  /** Qué fracción del extremo cae dentro de la región, de 0 a 1. */
  shareOfExtreme: number;
  /** Umbral que separa el extremo. Sale del propio lote, no de un criterio. */
  threshold: number;
  medianInside: number;
  medianOutside: number;
}

/**
 * Cuánto coinciden en el espacio una región y el extremo de una métrica.
 *
 * La región la marca `inRegion`, que viene de una decisión del motor —por
 * ejemplo `risk_level === "high"`—. El extremo lo marca un cuantil del PROPIO
 * lote: la quinta parte que menos rinde, o la que más pierde. Ninguno de los dos
 * es un umbral inventado aquí.
 *
 * Devuelve `null` si no hay región, o si no hay nada fuera de ella: sin los dos
 * lados no hay comparación, solo una descripción del total.
 */
export function overlap(
  values: number[],
  inRegion: boolean[],
  tail: "low" | "high",
  fraction = 0.2,
): Overlap | null {
  const n = Math.min(values.length, inRegion.length);
  if (n === 0) return null;

  const dentro: number[] = [];
  const fuera: number[] = [];
  for (let i = 0; i < n; i += 1) {
    (inRegion[i] ? dentro : fuera).push(values[i]!);
  }
  if (dentro.length === 0 || fuera.length === 0) return null;

  const sorted = [...values.slice(0, n)].sort((a, b) => a - b);
  const threshold = quantileSorted(sorted, tail === "low" ? fraction : 1 - fraction);
  const esExtremo = (v: number) => (tail === "low" ? v <= threshold : v >= threshold);

  let extreme = 0;
  let both = 0;
  for (let i = 0; i < n; i += 1) {
    if (!esExtremo(values[i]!)) continue;
    extreme += 1;
    if (inRegion[i]) both += 1;
  }

  return {
    region: dentro.length,
    extreme,
    both,
    shareOfRegion: both / dentro.length,
    shareOfExtreme: extreme === 0 ? 0 : both / extreme,
    threshold,
    medianInside: quantileSorted([...dentro].sort((a, b) => a - b), 0.5),
    medianOutside: quantileSorted([...fuera].sort((a, b) => a - b), 0.5),
  };
}
