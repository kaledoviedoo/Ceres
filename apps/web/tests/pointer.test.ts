/**
 * El umbral entre un clic y un giro de cámara.
 *
 * Estaba dentro de `TerrainSurface`, donde probarlo obligaba a levantar un
 * contexto WebGL para comprobar una hipotenusa. Sacarlo no cambia el
 * comportamiento; lo pone donde se puede fijar.
 *
 * El defecto que evita: soltar el botón después de girar la vista disparaba un
 * `click` sobre la celda que quedara bajo el cursor, así que orbitar cambiaba la
 * celda abierta.
 */

import { describe, expect, it } from "vitest";

import { DRAG_SLOP_PX, isClick } from "@/lib/terrain/pointer";

const origen = { x: 400, y: 300 };

describe("¿clic o arrastre?", () => {
  it("sin moverse es un clic", () => {
    expect(isClick(origen, { ...origen })).toBe(true);
  });

  it("el temblor de la mano sigue siendo un clic", () => {
    // Es la razón de que haya umbral y no igualdad: al pulsar con intención de
    // no mover, el ratón se desplaza uno o dos píxeles.
    expect(isClick(origen, { x: 402, y: 301 })).toBe(true);
  });

  it("un giro de cámara no selecciona", () => {
    expect(isClick(origen, { x: 460, y: 340 })).toBe(false);
  });

  it("el borde del umbral cuenta como clic, y un píxel más no", () => {
    expect(isClick(origen, { x: origen.x + DRAG_SLOP_PX, y: origen.y })).toBe(true);
    expect(isClick(origen, { x: origen.x + DRAG_SLOP_PX + 1, y: origen.y })).toBe(false);
  });

  it("mide la distancia recta, no cada eje por su lado", () => {
    // 3-4-5: cada eje cabe en el umbral, pero el recorrido real no. Comparando
    // ejes por separado, este arrastre se habría colado como clic.
    expect(isClick(origen, { x: origen.x + 3, y: origen.y + 4 })).toBe(true);
    expect(isClick(origen, { x: origen.x + 4, y: origen.y + 4 })).toBe(false);
  });

  it("da igual en qué dirección se arrastre", () => {
    for (const [dx, dy] of [[20, 0], [-20, 0], [0, 20], [0, -20], [-14, -14]]) {
      expect(isClick(origen, { x: origen.x + dx!, y: origen.y + dy! })).toBe(false);
    }
  });

  it("sin pulsación medida, se acepta", () => {
    // El `pointerdown` puede no haberse visto: la pulsación empezó fuera del
    // lienzo, o el clic lo sintetizó el teclado. Negarlo dejaría la malla sin
    // responder a un gesto perfectamente legítimo.
    expect(isClick(null, origen)).toBe(true);
  });

  it("el umbral es configurable sin tocar la función", () => {
    expect(isClick(origen, { x: origen.x + 12, y: origen.y }, 20)).toBe(true);
  });
});
