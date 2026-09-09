/**
 * Encuadre de la celda seleccionada al pasar de Planta a Relieve.
 *
 * La regla que estos tests protegen es la que evita el defecto más molesto de
 * una cámara automática: que se mueva cuando no hacía falta. Si la celda ya se
 * ve, el factor es exactamente 1 y no hay nada que aplicar.
 *
 * La otra es el tope: sin él, una celda muy fuera de cuadro pediría un salto
 * enorme, o peor, varios pasos que se pasan de largo y vuelven — un bucle de
 * recentrado.
 */

import { describe, expect, it } from "vitest";

import {
  FRAME_MARGIN,
  MAX_FRAME_STEPS,
  dollyToFrame,
  isFramed,
} from "@/lib/terrain/framing";

const centro = { x: 0, y: 0, z: 0.5 };

describe("¿está en el encuadre?", () => {
  it("el centro de la pantalla lo está", () => {
    expect(isFramed(centro)).toBe(true);
  });

  it("dentro del margen sí, justo fuera no", () => {
    const limite = 1 - FRAME_MARGIN;
    expect(isFramed({ x: limite - 0.001, y: 0, z: 0.5 })).toBe(true);
    expect(isFramed({ x: limite + 0.001, y: 0, z: 0.5 })).toBe(false);
    expect(isFramed({ x: 0, y: -(limite + 0.001), z: 0.5 })).toBe(false);
  });

  it("detrás de la cámara NO está dentro, aunque x e y caigan en rango", () => {
    // Es el error clásico: la proyección de un punto a la espalda vuelve a caer
    // dentro del cuadro, y sin mirar la z la cámara se daría por satisfecha
    // mientras la celda queda detrás.
    expect(isFramed({ x: 0, y: 0, z: 1.4 })).toBe(false);
  });

  it("un punto sin coordenadas válidas no cuenta como dentro", () => {
    expect(isFramed({ x: Number.NaN, y: 0, z: 0 })).toBe(false);
  });
});

describe("cuánto alejar", () => {
  it("si ya se ve, NO se mueve la cámara: exactamente 1", () => {
    // La comprobación más importante de todo el módulo. El requisito «si la
    // celda ya es visible, no muevas la cámara» es aquí la rama por defecto, no
    // un `if` aparte que alguien pueda olvidar en la llamada.
    expect(dollyToFrame(centro)).toBe(1);
    expect(dollyToFrame({ x: 0.5, y: -0.4, z: 0.9 })).toBe(1);
  });

  it("cuanto más fuera, más se aleja", () => {
    const poco = dollyToFrame({ x: 1.1, y: 0, z: 0.5 });
    const mucho = dollyToFrame({ x: 1.5, y: 0, z: 0.5 });
    expect(poco).toBeGreaterThan(1);
    expect(mucho).toBeGreaterThan(poco);
  });

  it("nunca pide un salto sin límite", () => {
    // Sin tope, el lote acabaría en el vacío negro de un solo paso.
    const enorme = dollyToFrame({ x: 40, y: 40, z: 0.5 });
    expect(enorme).toBeLessThanOrEqual(1.8);
  });

  it("detrás de la cámara da un paso generoso, no uno absurdo", () => {
    const atras = dollyToFrame({ x: 0, y: 0, z: 2 });
    expect(atras).toBeGreaterThan(1);
    expect(atras).toBeLessThanOrEqual(1.8);
  });

  it("el eje que más se sale es el que manda", () => {
    expect(dollyToFrame({ x: 0, y: 1.4, z: 0.5 })).toBe(
      dollyToFrame({ x: 1.4, y: 0, z: 0.5 }),
    );
  });

  it("converge: aplicar el factor mete el punto dentro en pocos pasos", () => {
    // Se simula la relación distancia → tamaño en pantalla como inversamente
    // proporcional, que es la aproximación que usa el componente.
    let p = { x: 2.6, y: -1.9, z: 0.5 };
    let pasos = 0;
    while (!isFramed(p) && pasos < MAX_FRAME_STEPS) {
      const f = dollyToFrame(p);
      p = { x: p.x / f, y: p.y / f, z: p.z };
      pasos += 1;
    }
    expect(isFramed(p)).toBe(true);
    expect(pasos).toBeLessThanOrEqual(MAX_FRAME_STEPS);
  });

  it("no oscila: un punto ya dentro nunca vuelve a moverse", () => {
    // Si el factor pudiera bajar de 1, la cámara se acercaría y podría sacar la
    // celda otra vez: ese es el bucle de recentrado que hay que impedir.
    for (const x of [0, 0.3, 0.6, 0.9, 0.91, 0.92]) {
      expect(dollyToFrame({ x, y: 0, z: 0.5 })).toBeGreaterThanOrEqual(1);
    }
  });
});
