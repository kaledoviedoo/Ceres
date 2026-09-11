/**
 * TerrainGeometry: de campo de elevación a malla de Three.js.
 *
 *     ElevationSource → ElevationField → [TerrainGeometry] → Three.js / R3F
 *
 * LA FIRMA ES LA GARANTIA. Estas funciones reciben un `ElevationField` y nada
 * más. No hay ningún parámetro por el que pueda entrar un `risk_level`, un
 * rendimiento ni una celda, así que es imposible —no por disciplina, sino por
 * construcción— que una métrica agrícola acabe deformando el terreno.
 *
 * Lo que el análisis puede hacer sobre esta malla es pintarla. Nunca moverla.
 */

import { BufferAttribute, BufferGeometry, PlaneGeometry } from "three";

import { gridToWorld, worldToGrid, type PlotGrid } from "@/lib/terrain/coords";
import type { ElevationField } from "@/lib/terrain/elevation";

/**
 * Subdivisiones por celda.
 *
 * Cuatro, y el número sale de una medición: con ocho, la malla tenía 51.200
 * triángulos y el raycast del hover —que los recorre en lineal— costaba 2,26 ms
 * por movimiento, el 13,5 % del presupuesto de un fotograma. Cuatro deja 12.800.
 *
 * No se pierde relieve al bajar: el campo tiene una resolución efectiva de unos
 * 5 m, así que subdividir por debajo del metro ya solo interpola una curva que
 * era suave. Subdividir más añade triángulos, no información.
 */
export const SEGMENTS_PER_CELL = 4;

/**
 * Grosor del canto de tierra bajo el terreno, en METROS.
 *
 * Fino a propósito. Un zócalo profundo lee como un bloque extraído del suelo, y
 * lo que interesa es una superficie de campo ligeramente levantada, con el canto
 * justo para que el borde no parezca una lámina de papel.
 *
 * Es una profundidad física y no una fracción del lote: 32 cm de tierra bajo el
 * campo son 32 cm midan lo que midan las celdas. En un lote pequeño el canto se
 * ve proporcionalmente más alto, que es lo que pasaría de verdad.
 */
export const SKIRT_DEPTH = 0.32;

/**
 * La malla del terreno.
 *
 * Un plano subdividido cuyos vértices se desplazan en Y según el campo. Se
 * recalculan las normales: sin eso, la iluminación seguiría creyendo que es un
 * plano liso y el relieve no se vería en absoluto.
 */
export function buildTerrainMesh(field: ElevationField, plot: PlotGrid): BufferGeometry {
  // El TAMAÑO del plano es físico; su SUBDIVISION es por celda. Son dos cosas
  // distintas y conviene que se lean como tales: subdividir sigue el dato, no
  // los metros, porque entre dos centros de celda no hay medición que resolver.
  const worldWidth = plot.width * plot.cellSizeM;
  const worldHeight = plot.height * plot.cellSizeM;

  const geo = new PlaneGeometry(
    worldWidth,
    worldHeight,
    plot.width * SEGMENTS_PER_CELL,
    plot.height * SEGMENTS_PER_CELL,
  );
  // El plano nace en XY; el terreno vive en XZ con la altura en +Y.
  geo.rotateX(-Math.PI / 2);

  const position = geo.attributes.position!;
  for (let i = 0; i < position.count; i += 1) {
    const [gx, gy] = worldToGrid(position.getX(i), position.getZ(i), plot);
    position.setY(i, field.heightAt(gx, gy));
  }
  position.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * El canto de tierra bajo el campo.
 *
 * UN SOLO RECORRIDO DEL PERIMETRO. Construir los cuatro lados por separado, cada
 * uno con su sentido de giro, hacía que `computeVertexNormals` dedujera unas
 * caras hacia fuera y otras hacia dentro: en pantalla se veía tierra en un lado
 * y negro en los otros tres. Recorriendo el borde como un anillo cerrado, todas
 * heredan la misma orientación.
 */
export function buildSkirt(field: ElevationField, plot: PlotGrid): BufferGeometry {
  const perTramo = Math.max(plot.width, plot.height) * 2;
  const base = -SKIRT_DEPTH;

  const esquinas: [number, number][] = [
    [-0.5, -0.5],
    [plot.width - 0.5, -0.5],
    [plot.width - 0.5, plot.height - 0.5],
    [-0.5, plot.height - 0.5],
  ];

  const anillo: [number, number][] = [];
  for (let lado = 0; lado < 4; lado += 1) {
    const a = esquinas[lado]!;
    const b = esquinas[(lado + 1) % 4]!;
    for (let s = 0; s < perTramo; s += 1) {
      const t = s / perTramo;
      anillo.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }

  const positions: number[] = [];
  for (let i = 0; i < anillo.length; i += 1) {
    const a = anillo[i]!;
    const b = anillo[(i + 1) % anillo.length]!;

    const [ax, az] = gridToWorld(a[0], a[1], plot);
    const [bx, bz] = gridToWorld(b[0], b[1], plot);
    const ay = field.heightAt(a[0], a[1]);
    const by = field.heightAt(b[0], b[1]);

    positions.push(ax, ay, az, bx, by, bz, bx, base, bz);
    positions.push(ax, ay, az, bx, base, bz, ax, base, az);
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Proyecta una polilínea de coordenadas de malla sobre la superficie.
 *
 * Lo usan tanto las curvas de nivel —que son elevación— como el contorno de la
 * zona de riesgo —que es análisis—. La proyección es geometría pura: coloca a la
 * altura del terreno lo que le den, sin preguntar de dónde viene.
 */
export function drapeOnTerrain(
  points: [number, number][],
  field: ElevationField,
  plot: PlotGrid,
  offset: number,
): [number, number, number][] {
  return points.map(([gx, gy]) => {
    const [wx, wz] = gridToWorld(gx, gy, plot);
    return [wx, field.heightAt(gx, gy) + offset, wz] as [number, number, number];
  });
}
