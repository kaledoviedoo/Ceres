/**
 * ¿ESTA LA CELDA SELECCIONADA DENTRO DEL ENCUADRE?
 *
 * Al pasar de Planta a Relieve, la celda abierta puede quedar fuera de cámara:
 * el encuadre por defecto deja que el lote sangre por los cuatro bordes, así que
 * una celda de esquina no se ve. El usuario tenía la celda seleccionada y en
 * relieve no aparecía ni jalón ni anotación.
 *
 * ESTO ES UNA TRANSICION, NO UN COMPORTAMIENTO DE CAMARA
 * Se mira una vez, al entrar en relieve. Si la celda ya se ve, la cámara NO se
 * toca. Cambiar de capa, orbitar o hacer zoom no vuelven a mirarlo: quien mueve
 * la cámara manda sobre ella.
 *
 * SE ALEJA, NO SE GIRA
 * Con el objetivo fijo en el centro del lote y el desplazamiento lateral
 * desactivado, girar el acimut cambia qué esquina queda cerca pero no garantiza
 * que ninguna entre. Alejarse sí es monótono: a partir de cierta distancia entra
 * todo. Es predecible y no desorienta.
 *
 * LA POSICION SALE DE LA GEOMETRIA
 * El punto que se comprueba es la posición real de la celda sobre el
 * `ElevationField`, proyectada con la cámara. Nunca el color de la capa: dónde
 * está una celda no depende de qué se esté pintando encima.
 */

/** Un punto ya proyectado: coordenadas normalizadas de dispositivo. */
export interface Ndc {
  /** −1 izquierda, +1 derecha. */
  x: number;
  /** −1 abajo, +1 arriba. */
  y: number;
  /** > 1 significa detrás de la cámara. */
  z: number;
}

/**
 * Margen por defecto, en fracción de media pantalla.
 *
 * Una celda pegada al borde está técnicamente dentro pero es inútil: la tapan el
 * cromo flotante y el propio borde del lienzo. Un 8 % la separa lo justo.
 */
export const FRAME_MARGIN = 0.08;

/** ¿Cae el punto dentro del encuadre, con margen? */
export function isFramed(point: Ndc, margin = FRAME_MARGIN): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  // Detrás de la cámara no está "dentro" por mucho que x e y caigan en rango:
  // la proyección de un punto a la espalda vuelve a caer en el cuadro.
  if (point.z > 1) return false;
  const limite = 1 - margin;
  return Math.abs(point.x) <= limite && Math.abs(point.y) <= limite;
}

/**
 * Cuánto hay que ALEJAR la cámara para meter el punto en el encuadre.
 *
 * `1` significa que ya está dentro y no hay que mover nada. Es el valor que hace
 * que "si la celda ya es visible, no muevas la cámara" sea la rama por defecto y
 * no una comprobación aparte que alguien pueda olvidar.
 *
 * El factor es aproximado —la relación entre distancia y tamaño en pantalla no
 * es exactamente lineal en perspectiva—, así que quien lo use debe volver a
 * proyectar y, si hace falta, dar otro paso. Con un tope de intentos: preferimos
 * quedarnos cortos a entrar en un bucle de recentrado.
 */
export function dollyToFrame(point: Ndc, margin = FRAME_MARGIN): number {
  if (isFramed(point, margin)) return 1;

  // Detrás de la cámara el NDC no significa nada útil: se da un paso generoso y
  // se vuelve a mirar en el siguiente fotograma.
  if (point.z > 1 || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return MAX_DOLLY;
  }

  const fuera = Math.max(Math.abs(point.x), Math.abs(point.y));
  const factor = fuera / (1 - margin);
  return Math.min(MAX_DOLLY, Math.max(1, factor));
}

/**
 * Tope por paso.
 *
 * Sin tope, una celda muy fuera pediría un salto enorme y el lote acabaría en el
 * vacío negro. Varios pasos pequeños convergen igual y nunca pasan de largo.
 */
const MAX_DOLLY = 1.8;

/** Cuántos pasos como mucho. Es lo que impide un bucle de recentrado. */
export const MAX_FRAME_STEPS = 4;
