/**
 * Qué distancia rotula la barra de escala.
 *
 * Una barra de escala tiene una sola obligación: que lo dibujado mida lo que
 * dice el rótulo. Cuando la cámara se acerca, la tentación es recortar la barra
 * para que siga cabiendo; entonces el rótulo deja de corresponder con el largo y
 * la barra pasa a ser un adorno que además engaña.
 *
 * La solución es la de cualquier carta impresa: la barra no se estira ni se
 * recorta, cambia lo que dice. Se toma la mayor distancia rotulable que quepa en
 * el ancho disponible y se dibuja exactamente lo que mide.
 */

/** Distancias rotulables, de menor a mayor. */
export const SCALE_STEPS_M = [0.2, 0.5, 1, 2, 5, 10, 20, 50, 100] as const;

export interface ScaleBar {
  /** Distancia rotulada, en metros de terreno. */
  meters: number;
  /** Largo que le corresponde en pantalla. Siempre `meters * pixelsPerMeter`. */
  pixels: number;
}

/**
 * Elige el peldaño para una escala dada.
 *
 * Devuelve `null` cuando no hay una escala que medir —cámara sin situar, lote de
 * ancho cero—, porque dibujar una barra sin medida es peor que no dibujarla.
 *
 * Si ni el peldaño más pequeño cabe en `maxPx`, se devuelve igualmente con su
 * largo real: preferimos una barra que se sale a una barra que miente.
 */
export function scaleBar(pixelsPerMeter: number, maxPx: number): ScaleBar | null {
  if (!Number.isFinite(pixelsPerMeter) || pixelsPerMeter <= 0) return null;

  let meters: number = SCALE_STEPS_M[0];
  for (const step of SCALE_STEPS_M) {
    if (step * pixelsPerMeter <= maxPx) meters = step;
  }

  return { meters, pixels: meters * pixelsPerMeter };
}

/** El rótulo, en la convención local: coma decimal y sufijo de unidad. */
export function formatScaleLabel(meters: number): string {
  return `${meters.toLocaleString("es", { maximumFractionDigits: 1 })} m`;
}
