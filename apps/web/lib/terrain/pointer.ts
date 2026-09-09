/**
 * ¿ESTO FUE UN CLIC O FUE UN GIRO DE CAMARA?
 *
 * Orbitar y seleccionar entran por el mismo gesto: pulsar, mover, soltar. El
 * navegador emite un `click` al soltar aunque el ratón haya recorrido media
 * pantalla, así que girar la vista cambiaba la celda abierta —se seleccionaba
 * la que quedara debajo del cursor al terminar el giro—.
 *
 * NO SIRVE COMPARAR POSICIONES EXACTAS. Al pulsar sin intención de mover, el
 * ratón se desplaza uno o dos píxeles: exigir igualdad haría que muchos clics
 * legítimos no seleccionaran nada. Hace falta una tolerancia.
 *
 * Vive aparte de la escena porque es aritmética de interacción, no geometría:
 * probarla no debería obligar a levantar un contexto WebGL.
 */

/**
 * Cuánto puede moverse el puntero sin dejar de ser un clic, en píxeles de
 * pantalla.
 *
 * Cinco es el orden del temblor de una mano sobre un ratón y muy por debajo del
 * recorrido de un giro deliberado, que son decenas. Se mide en píxeles de
 * cliente y no en unidades de mundo a propósito: lo que se está midiendo es la
 * firmeza del gesto, que no depende de cuánto zoom haya.
 */
export const DRAG_SLOP_PX = 5;

export interface PointerPos {
  x: number;
  y: number;
}

/**
 * ¿Cuenta como selección?
 *
 * `start` es donde se pulsó. `null` significa que no se vio el `pointerdown`
 * —la pulsación empezó fuera del lienzo, o el navegador sintetizó el clic desde
 * el teclado—: en ese caso se acepta, porque negar un clic que no se pudo medir
 * dejaría la malla sin responder.
 */
export function isClick(
  start: PointerPos | null,
  end: PointerPos,
  slop = DRAG_SLOP_PX,
): boolean {
  if (!start) return true;
  return Math.hypot(end.x - start.x, end.y - start.y) <= slop;
}
