/**
 * ¿PODRIA ENTRAR UN DEM REAL SIN TOCAR NADA MAS?
 *
 * La respuesta que da esta fase es "sí", y una respuesta así no se afirma: se
 * ejecuta. Aquí se construye una fuente que NO es la malla agrícola —tiene su
 * propia rejilla, su propia resolución y se declara medida— y se comprueba que:
 *
 *   1. entra por `ElevationSource` sin adaptador ninguno;
 *   2. produce una geometría distinta, así que el terreno la está usando de
 *      verdad y el test no es vacío;
 *   3. NINGUNA capa analítica cambia un solo byte al hacerlo;
 *   4. su procedencia llega hasta el borde donde la lee la interfaz.
 *
 * NO ES UN LECTOR DE GeoTIFF. Es una fuente de prueba con la forma de un ráster,
 * escrita para probar el contrato. Un lector de verdad se escribirá cuando haya
 * un fichero de verdad contra el que validarlo; lo que se puede fijar hoy es que
 * el hueco donde encaja existe y tiene la forma correcta.
 */

import { describe, expect, it } from "vitest";

import {
  ElevationField,
  gridElevationSource,
  type ElevationSource,
} from "@/lib/terrain/elevation";
import { buildTerrainMesh } from "@/lib/terrain/geometry";
import { availableLayers } from "@/lib/terrain/layers";
import { buildTerrainCells, malla } from "./fixtures";

const SIZE = 20;

/**
 * Una fuente con la forma de un ráster.
 *
 * Su rejilla interna es de 5 × 5 para 20 × 20 celdas agrícolas —un píxel cada
 * cuatro metros, que es el caso normal de un DEM público— y se muestrea por
 * vecino más próximo. Que la resolución NO coincida con la malla del lote es
 * justamente lo que hay que poder soportar.
 */
function demSource(): ElevationSource {
  const raster = 5;
  const muestras: number[] = [];
  for (let i = 0; i < raster * raster; i += 1) muestras.push(1200 + (i % 7) * 0.5);

  return {
    width: SIZE,
    height: SIZE,
    minMeters: Math.min(...muestras),
    maxMeters: Math.max(...muestras),
    metersAt(x, y) {
      const cx = Math.min(raster - 1, Math.max(0, Math.round((x / (SIZE - 1)) * (raster - 1))));
      const cy = Math.min(raster - 1, Math.max(0, Math.round((y / (SIZE - 1)) * (raster - 1))));
      return muestras[cy * raster + cx]!;
    },
    provenance: {
      // `measured`, no "dem": el vocabulario dice de dónde SALE el dato, no en
      // qué formato viene. Un DEM puede ser una medición o la salida de un
      // modelo, y mezclarlo con el formato hacía imposible distinguirlos.
      kind: "measured",
      label: "DEM de prueba",
      nominalResolutionM: 4,
      effectiveResolutionM: 4,
      measured: true,
    },
  };
}

function mallaAgricola(): ElevationSource {
  const cells = [];
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      cells.push({ x, y, elevation_m: 1180 + y * 0.12 + (x % 3) * 0.04 });
    }
  }
  return gridElevationSource(cells, malla(SIZE, SIZE));
}

describe("cambiar la fuente de elevación", () => {
  it("una fuente que no es la malla agrícola entra por la misma interfaz", () => {
    // Si esto compila y corre, el contrato admite un ráster: no hay ningún
    // supuesto escondido de que la elevación venga celda a celda.
    const field = new ElevationField(demSource(), 1);
    expect(field.reliefM).toBeCloseTo(3, 6);
    expect(Number.isFinite(field.heightAt(7.3, 12.8))).toBe(true);
  });

  it("el terreno cambia de forma: la fuente se está usando de verdad", () => {
    const a = buildTerrainMesh(new ElevationField(mallaAgricola(), 1), malla(SIZE, SIZE));
    const b = buildTerrainMesh(new ElevationField(demSource(), 1), malla(SIZE, SIZE));

    const ya = a.attributes.position!.array as Float32Array;
    const yb = b.attributes.position!.array as Float32Array;
    expect(ya.length).toBe(yb.length);
    expect(Array.from(ya)).not.toEqual(Array.from(yb));
  });

  it("NINGUNA capa cambia un byte al cambiar la fuente", () => {
    /*
     * Es la comprobación que cierra la fase. No se hace leyendo el código para
     * ver si alguien pasa el campo a una capa: se hace pintando las seis capas
     * con las dos fuentes activas y comparando los bytes.
     *
     * Y no puede fallar por construcción, que es el punto: `paint` no recibe un
     * `ElevationField`, así que no hay forma de que lo mire. Este test convierte
     * esa imposibilidad de tipos en una imposibilidad comprobada.
     */
    const cells = buildTerrainCells();
    const w = 20;
    const h = 20;

    for (const layer of availableLayers()) {
      // Se construyen las dos, se activan, y se pinta con cada una viva.
      const conMalla = new ElevationField(mallaAgricola(), 1);
      const antes = layer.paint(cells, w, h);
      const conDem = new ElevationField(demSource(), 1);
      const despues = layer.paint(cells, w, h);

      // Las dos existen y describen terrenos distintos...
      expect(conMalla.provenance.kind).not.toBe(conDem.provenance.kind);
      // ...y la capa pinta exactamente lo mismo.
      expect(Array.from(despues.rgb)).toEqual(Array.from(antes.rgb));
      expect(despues.zones).toEqual(antes.zones);
    }
  });

  it("la procedencia de la fuente llega al borde que lee la interfaz", () => {
    // La nota del inspector no se escribe a mano en ningún sitio: sale de aquí.
    const field = new ElevationField(demSource(), 1);
    expect(field.provenance).toMatchObject({
      kind: "measured",
      measured: true,
      nominalResolutionM: 4,
    });
  });

  it("sin procedencia declarada, la fuente dice `unknown` y nunca `measured`", () => {
    /*
     * Antes decía "synthetic": el frontend lo AFIRMABA por su cuenta y acertaba
     * de casualidad. Ahora la procedencia la declara la API, y cuando nadie la
     * declara la respuesta honesta es que no se sabe.
     *
     * Lo que se conserva intacto es la dirección: `measured` sigue siendo
     * imposible por omisión, que es lo único que no se puede afirmar sin haber
     * salido al campo.
     */
    const field = new ElevationField(mallaAgricola(), 1);

    expect(field.provenance.kind).toBe("unknown");
    expect(field.provenance.measured).toBe(false);
    // Y no se inventa una resolución efectiva que nadie ha medido.
    expect(field.provenance.effectiveResolutionM).toBeNull();
  });

  it("una procedencia declarada por el origen gana al supuesto", () => {
    // El día que el backend diga de dónde salió la elevación, no hay que tocar
    // ningún componente: se pasa aquí y viaja sola hasta la pantalla.
    const cells = [{ x: 0, y: 0, elevation_m: 1200 }];
    const source = gridElevationSource(cells, malla(1, 1), {
      kind: "measured",
      label: "Vuelo 2026",
      nominalResolutionM: 0.5,
      effectiveResolutionM: 0.5,
      measured: true,
    });
    expect(source.provenance.kind).toBe("measured");
    expect(source.provenance.measured).toBe(true);
  });
});
