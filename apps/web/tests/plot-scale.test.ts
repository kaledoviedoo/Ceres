/**
 * LA ESCALA FISICA DEL LOTE VIENE DEL DATO, NO DE UNA CONSTANTE.
 *
 * `coords.ts` tenía `CELL_SIZE = 1`, y esa línea hacía dos afirmaciones a la
 * vez: «una unidad de mundo es un metro» —cierta, y el invariante que sostiene
 * la barra de escala, la exageración vertical y el sombreado— y «una celda mide
 * un metro», que era una suposición sobre el dato disfrazada de conversión de
 * unidades. La API declara `cell_size_m` en tres respuestas y no lo leía nadie.
 *
 * Estos tests fijan las dos mitades por separado: la primera se conserva, la
 * segunda desaparece.
 *
 * Y son la red que impide que vuelva. Cualquier reintroducción de un tamaño de
 * celda fijo se cae aquí, porque la mitad de las comprobaciones usan celdas que
 * NO miden un metro.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  agreeOnPlotGrid,
  cellBounds,
  gridCenter,
  gridToWorld,
  plotExtent,
  worldToGrid,
} from "@/lib/terrain/coords";
import { ElevationField, VERTICAL_EXAGGERATION, gridElevationSource } from "@/lib/terrain/elevation";
import { buildSkirt, buildTerrainMesh } from "@/lib/terrain/geometry";
import { malla } from "./fixtures";

/** Los tres casos del enunciado, sobre la misma malla de 20 × 20 celdas. */
const CASOS = [
  { cellSizeM: 0.5, ladoM: 10 },
  { cellSizeM: 1, ladoM: 20 },
  { cellSizeM: 2, ladoM: 40 },
] as const;

describe("extensión física del lote", () => {
  it("20 × 20 celdas miden 10, 20 o 40 m según lo que diga la API", () => {
    for (const { cellSizeM, ladoM } of CASOS) {
      expect(plotExtent(malla(20, 20, cellSizeM)), `${cellSizeM} m`).toBe(ladoM);
    }
  });

  it("una celda ocupa en el mundo exactamente lo que mide", () => {
    for (const { cellSizeM } of CASOS) {
      const plot = malla(20, 20, cellSizeM);
      const b = cellBounds(10, 10, plot);
      expect(b.east - b.west).toBeCloseTo(cellSizeM, 10);
      expect(b.south - b.north).toBeCloseTo(cellSizeM, 10);
    }
  });

  it("la distancia entre dos celdas vecinas es el lado de la celda", () => {
    for (const { cellSizeM } of CASOS) {
      const plot = malla(20, 20, cellSizeM);
      const [x0] = gridToWorld(0, 0, plot);
      const [x1] = gridToWorld(1, 0, plot);
      expect(x1 - x0).toBeCloseTo(cellSizeM, 10);
    }
  });

  it("la malla de Three.js se construye a la medida física, no al recuento", () => {
    // Es el sitio donde el error habría sido invisible: la geometría salía
    // siempre de 20 unidades y la barra de escala la rotulaba como 20 m.
    const alturas = [];
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) alturas.push({ x, y, elevation_m: 1200 + x * 0.1 });
    }

    for (const { cellSizeM } of CASOS) {
      const plot = malla(4, 4, cellSizeM);
      const field = new ElevationField(gridElevationSource(alturas, plot), cellSizeM);
      const geo = buildTerrainMesh(field, plot);
      const pos = geo.attributes.position!;

      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < pos.count; i += 1) {
        min = Math.min(min, pos.getX(i));
        max = Math.max(max, pos.getX(i));
      }
      expect(max - min, `${cellSizeM} m`).toBeCloseTo(4 * cellSizeM, 6);
    }
  });

  it("el faldón sigue al terreno a cualquier escala", () => {
    const alturas = [{ x: 0, y: 0, elevation_m: 1200 }, { x: 1, y: 0, elevation_m: 1201 }];
    for (const { cellSizeM } of CASOS) {
      const plot = malla(2, 1, cellSizeM);
      const geo = buildSkirt(new ElevationField(gridElevationSource(alturas, plot), cellSizeM), plot);
      expect(geo.attributes.position!.count).toBeGreaterThan(0);
    }
  });
});

describe("ida y vuelta", () => {
  it("gridToWorld y worldToGrid siguen siendo inversas a cualquier escala", () => {
    for (const { cellSizeM } of CASOS) {
      const plot = malla(20, 20, cellSizeM);
      for (const [gx, gy] of [[0, 0], [19, 19], [7.5, 3.25], [10, 10], [0, 19]]) {
        const [wx, wz] = gridToWorld(gx!, gy!, plot);
        const [bx, by] = worldToGrid(wx, wz, plot);
        expect(bx, `${cellSizeM} m`).toBeCloseTo(gx!, 10);
        expect(by, `${cellSizeM} m`).toBeCloseTo(gy!, 10);
      }
    }
  });

  it("seleccionar un punto devuelve la MISMA celda mida lo que mida", () => {
    /*
     * Es la garantía que protege al usuario: `cellAt` redondea la coordenada de
     * malla al índice más cercano. Si el mundo estuviera en celdas y no en
     * metros, el mismo punto de la pantalla caería en otra celda al cambiar la
     * escala. Aquí se comprueba desde el otro lado: partiendo del centro exacto
     * de una celda conocida, en metros, se recupera esa celda.
     */
    for (const { cellSizeM } of CASOS) {
      const plot = malla(20, 20, cellSizeM);
      for (const [gx, gy] of [[0, 0], [3, 17], [10, 10], [19, 19]]) {
        const [wx, wz] = gridToWorld(gx!, gy!, plot);
        const [rx, ry] = worldToGrid(wx, wz, plot);
        expect(Math.round(rx)).toBe(gx);
        expect(Math.round(ry)).toBe(gy);
      }
    }
  });

  it("un punto dentro de una celda sigue cayendo en ella, no en la vecina", () => {
    for (const { cellSizeM } of CASOS) {
      const plot = malla(20, 20, cellSizeM);
      const [wx, wz] = gridToWorld(6, 6, plot);
      // Casi en el borde, pero dentro: 49 % del lado hacia el este.
      const [rx, ry] = worldToGrid(wx + cellSizeM * 0.49, wz, plot);
      expect(Math.round(rx)).toBe(6);
      expect(Math.round(ry)).toBe(6);
    }
  });

  it("el centro sigue siendo el centro", () => {
    for (const { cellSizeM } of CASOS) {
      const plot = malla(20, 20, cellSizeM);
      const [cx, cy] = gridCenter(plot);
      // El centro se expresa en CELDAS y no depende de cuánto midan: es el
      // punto medio de la malla, y ahí es donde orbita la cámara.
      expect(cx).toBe(9.5);
      expect(cy).toBe(9.5);

      const [wx, wz] = gridToWorld(cx, cy, plot);
      expect(wx).toBeCloseTo(0, 10);
      expect(wz).toBeCloseTo(0, 10);
    }
  });
});

describe("qué escala con la celda y qué no", () => {
  const rampa = [
    { x: 0, y: 0, elevation_m: 1200 },
    { x: 1, y: 0, elevation_m: 1201 },
    { x: 2, y: 0, elevation_m: 1202 },
    { x: 0, y: 1, elevation_m: 1200 },
    { x: 1, y: 1, elevation_m: 1201 },
    { x: 2, y: 1, elevation_m: 1202 },
  ];

  it("la ALTURA no escala: los metros de desnivel son los mismos", () => {
    /*
     * La exageración vertical multiplica metros reales y no se toca. Una celda
     * más ancha no levanta el terreno: lo estira en horizontal.
     */
    for (const { cellSizeM } of CASOS) {
      const plot = malla(3, 2, cellSizeM);
      const field = new ElevationField(gridElevationSource(rampa, plot), cellSizeM);
      expect(field.heightAt(2, 0), `${cellSizeM} m`).toBeCloseTo(2 * VERTICAL_EXAGGERATION, 6);
      expect(field.metersAt(1, 0)).toBeCloseTo(1201, 6);
    }
  });

  it("la PENDIENTE sí escala: subir un metro en dos es la mitad de empinado", () => {
    // El sombreado se deriva de esto. Con la constante de 1 m, un lote de celdas
    // de 2 m se habría sombreado al doble de inclinación de la que tiene.
    const claro = (cellSizeM: number) => {
      const plot = malla(3, 2, cellSizeM);
      const field = new ElevationField(gridElevationSource(rampa, plot), cellSizeM);
      return field.hillshadeAt(1, 0.5);
    };
    // Misma rampa, tres pendientes reales distintas: el sombreado no puede
    // coincidir en las tres.
    expect(claro(0.5)).not.toBeCloseTo(claro(1), 3);
    expect(claro(2)).not.toBeCloseTo(claro(1), 3);
  });

  it("la resolución nominal de la fuente es su espaciado, no un uno fijo", () => {
    /*
     * La nominal es geometría del propio dato —dónde están las muestras— y se
     * sostiene aunque nadie declare la procedencia. La efectiva no: es una
     * medición, y sin declaración vale `null`. Mezclarlas sería exactamente lo
     * que este par de aserciones existe para impedir.
     */
    for (const { cellSizeM } of CASOS) {
      const source = gridElevationSource(rampa, malla(3, 2, cellSizeM));
      expect(source.provenance.nominalResolutionM).toBe(cellSizeM);
      expect(source.provenance.effectiveResolutionM).toBeNull();
    }
  });
});

describe("la constante no puede volver", () => {
  it("`coords.ts` no exporta ningún tamaño de celda", async () => {
    const coords = await import("@/lib/terrain/coords");
    expect(Object.keys(coords)).not.toContain("CELL_SIZE");
  });

  it("la rama geométrica no declara ninguna constante de tamaño de celda", () => {
    /*
     * Guardia de código fuente, y hace falta además de los tests de
     * comportamiento: una constante reintroducida podría quedarse dormida en un
     * módulo que estos tests no ejerciten todavía, y reaparecer cuando alguien
     * la use. Buscarla en el texto la caza antes.
     *
     * Se permite nombrarla en prosa —los comentarios explican por qué se fue—;
     * lo que no se permite es declararla.
     */
    const modulos = [
      "lib/terrain/coords.ts",
      "lib/terrain/geometry.ts",
      "lib/terrain/elevation.ts",
    ];
    const declaracion = /^\s*(export\s+)?const\s+CELL_SIZE\b/m;

    for (const modulo of modulos) {
      const fuente = readFileSync(resolve(process.cwd(), modulo), "utf8");
      expect(declaracion.test(fuente), modulo).toBe(false);
    }
  });
});

describe("las respuestas no pueden discrepar sobre la malla", () => {
  const cells = { source: "/cells", width: 20, height: 20, cellSizeM: 1 };

  it("cuando coinciden, hay malla", () => {
    const r = agreeOnPlotGrid([cells, { ...cells, source: "/overview" }]);
    expect(r).toEqual({ agreed: { width: 20, height: 20, cellSizeM: 1 } });
  });

  it("un `cell_size_m` distinto es un conflicto, no un empate", () => {
    /*
     * El fallo que esto impide es silencioso: el cliente hace `as T` sin validar
     * nada, tomaría la primera cifra que leyera y pintaría el lote al doble de
     * su tamaño. Un lote de 20 m dibujado como 40 se ve perfectamente bien.
     */
    const r = agreeOnPlotGrid([cells, { ...cells, source: "/overview", cellSizeM: 2 }]);

    expect("conflict" in r).toBe(true);
    expect("agreed" in r).toBe(false);
  });

  it("el conflicto nombra las dos respuestas y el campo", () => {
    // Sin eso, el mensaje diría "algo no cuadra" y habría que ir a buscarlo.
    const r = agreeOnPlotGrid([cells, { ...cells, source: "/overview", cellSizeM: 2 }]);

    expect("conflict" in r && r.conflict).toContain("/cells");
    expect("conflict" in r && r.conflict).toContain("/overview");
    expect("conflict" in r && r.conflict).toContain("cellSizeM");
  });

  it("las dimensiones también: media malla desplazada tampoco da error", () => {
    for (const campo of ["width", "height"] as const) {
      const r = agreeOnPlotGrid([cells, { ...cells, source: "/overview", [campo]: 19 }]);
      expect("conflict" in r, campo).toBe(true);
    }
  });

  it("no elige una: discrepar no se resuelve con una preferencia", () => {
    // Adivinar cuál es la buena sería exactamente el fallo silencioso que este
    // acuerdo existe para impedir.
    const r = agreeOnPlotGrid([cells, { ...cells, source: "/overview", cellSizeM: 0.5 }]);
    expect(r).not.toHaveProperty("agreed");
  });

  it("sin ninguna respuesta tampoco se inventa una malla", () => {
    expect(agreeOnPlotGrid([])).toHaveProperty("conflict");
  });
});
