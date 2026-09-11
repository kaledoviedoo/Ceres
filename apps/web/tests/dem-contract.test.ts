/**
 * LOS ERRORES QUE PRODUCEN UN TERRENO PERFECTO Y EQUIVOCADO.
 *
 * Un ráster con un hueco se ve: hay una fosa. Uno con la extensión mal se ve: el
 * lote queda sin dato en un borde. Esos no necesitan validador.
 *
 * Los que sí lo necesitan son los que dibujan un terreno bien formado, con su
 * relieve, su sombreado y sus curvas de nivel, que describe otro sitio. El más
 * peligroso de todos es la orientación de las filas: el resultado es el mismo
 * terreno espejado, y nada —ni un test de geometría, ni un vistazo— lo delata.
 *
 * Solo contrato: aquí no se lee ningún GeoTIFF. Se valida la FICHA, que es lo
 * que se puede hacer en cuanto se abre la cabecera y antes de cargar un píxel.
 */

import { describe, expect, it } from "vitest";

import {
  isUsableSpec,
  validateRasterSpec,
  type RasterElevationSpec,
} from "@/lib/terrain/dem";

/** Un DEM north-up de 1 m, correcto: el punto de partida de cada caso. */
function spec(overrides: Partial<RasterElevationSpec> = {}): RasterElevationSpec {
  return {
    crs: "EPSG:32618",
    verticalDatum: "orthometric",
    extent: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    resolutionM: { x: 1, y: 1 },
    // north-up: las filas bajan hacia el sur, así que `pixelHeight` es negativo.
    rowOrder: "north_up",
    transform: {
      originX: 0,
      originY: 20,
      pixelWidth: 1,
      pixelHeight: -1,
      rotationX: 0,
      rotationY: 0,
    },
    originCorner: "northwest",
    size: { width: 20, height: 20 },
    noData: -9999,
    units: "m",
    minMeters: 1179,
    maxMeters: 1183,
    sampling: "nearest",
    aggregation: "sample",
    noDataPolicy: "reject",
    provenance: {
      kind: "measured",
      label: "DEM municipal",
      nominalResolutionM: 1,
      effectiveResolutionM: 1,
      measured: true,
    },
    ...overrides,
  };
}

const problema = (s: RasterElevationSpec, campo: string) =>
  validateRasterSpec(s).find((p) => p.field === campo);

describe("una ficha correcta pasa", () => {
  it("no encuentra nada fatal", () => {
    expect(isUsableSpec(spec())).toBe(true);
  });
});

describe("orientación de las filas", () => {
  it("declarar north_up con una afín south_up se rechaza", () => {
    /*
     * EL CASO QUE JUSTIFICA TODO EL VALIDADOR.
     *
     * La afín dice que las filas suben hacia el norte y la ficha dice lo
     * contrario. Cargándolo sin más, el terreno sale con el relieve completo,
     * el sombreado coherente y las curvas de nivel cerradas: perfecto, y
     * espejado. La colina estaría donde está el valle.
     */
    const roto = spec({ transform: { ...spec().transform, pixelHeight: 1 } });

    expect(problema(roto, "rowOrder")?.fatal).toBe(true);
    expect(isUsableSpec(roto)).toBe(false);
  });

  it("declarar south_up con una afín north_up también", () => {
    // La contradicción se rechaza en las dos direcciones: no se sabe cuál de
    // los dos está mal, y elegir sería jugarse el terreno a cara o cruz.
    const roto = spec({ rowOrder: "south_up" });

    expect(problema(roto, "rowOrder")?.fatal).toBe(true);
  });

  it("un ráster south_up coherente es válido", () => {
    // No es que north-up sea lo correcto: es que lo declarado y la afín tienen
    // que decir lo mismo.
    const valido = spec({
      rowOrder: "south_up",
      transform: { ...spec().transform, originY: 0, pixelHeight: 1 },
      originCorner: "southwest",
    });

    expect(problema(valido, "rowOrder")).toBeUndefined();
    expect(isUsableSpec(valido)).toBe(true);
  });

  it("el mensaje dice qué se declaró y qué dice la afín", () => {
    const roto = spec({ transform: { ...spec().transform, pixelHeight: 1 } });
    const p = problema(roto, "rowOrder")!;

    expect(p.message).toContain("north_up");
    expect(p.message).toContain("espejado");
  });
});

describe("unidades y escala", () => {
  it("un DEM en pies se rechaza", () => {
    // Nadie lo nota mirando: el terreno sale con 3,28 veces más relieve y sigue
    // pareciendo un terreno.
    expect(problema(spec({ units: "ft" }), "units")?.fatal).toBe(true);
  });

  it("un píxel de lado cero colapsa la malla", () => {
    const roto = spec({ transform: { ...spec().transform, pixelWidth: 0 } });
    expect(problema(roto, "transform")?.fatal).toBe(true);
  });
});

describe("nodata", () => {
  it("un centinela dentro del rango válido es indistinguible de un dato", () => {
    // Si −9999 fuera una altura posible, no habría forma de saber si es un hueco
    // o una fosa real. Aquí el rango incluye el centinela a propósito.
    const roto = spec({ minMeters: -10000, maxMeters: 1183 });
    expect(problema(roto, "noData")?.fatal).toBe(true);
  });

  it("el centinela típico fuera del rango es correcto", () => {
    expect(problema(spec(), "noData")).toBeUndefined();
  });

  it("una fuente que declara no tener huecos es válida", () => {
    expect(problema(spec({ noData: null }), "noData")).toBeUndefined();
  });
});

describe("extensión y recorrido", () => {
  it("una extensión invertida se rechaza", () => {
    const roto = spec({ extent: { minX: 20, minY: 0, maxX: 0, maxY: 20 } });
    expect(problema(roto, "extent")?.fatal).toBe(true);
  });

  it("un mínimo mayor que el máximo se rechaza", () => {
    expect(problema(spec({ minMeters: 2000 }), "minMeters")?.fatal).toBe(true);
  });
});

describe("qué puede seguir llamándose medición", () => {
  it("interpolar y declararse medido se avisa, no se rechaza", () => {
    /*
     * Leer con `bilinear` produce un valor que no se midió en ningún punto. Es
     * legítimo para dibujar la superficie —CERES ya lo hace— y NO lo es para
     * llamarse medición. Avisa en vez de rechazar porque el ráster sigue siendo
     * utilizable: lo que hay que corregir es la etiqueta, no el fichero.
     */
    const p = problema(spec({ sampling: "bilinear" }), "sampling")!;

    expect(p.fatal).toBe(false);
    expect(isUsableSpec(spec({ sampling: "bilinear" }))).toBe(true);
  });

  it("promediar píxeles y declararse medido, igual", () => {
    const p = problema(spec({ aggregation: "mean" }), "aggregation")!;
    expect(p.fatal).toBe(false);
  });

  it("una fuente sintética puede interpolar sin que nadie proteste", () => {
    // La contradicción no está en interpolar: está en interpolar y llamarlo
    // medición.
    const sintetico = spec({
      sampling: "bilinear",
      aggregation: "mean",
      provenance: {
        kind: "synthetic",
        label: "Generado",
        nominalResolutionM: 1,
        effectiveResolutionM: 5,
        measured: false,
      },
    });

    expect(problema(sintetico, "sampling")).toBeUndefined();
    expect(problema(sintetico, "aggregation")).toBeUndefined();
  });

  it("sin datum vertical se avisa: la altitud no es comparable", () => {
    const p = problema(spec({ verticalDatum: "unknown" }), "verticalDatum")!;
    expect(p.fatal).toBe(false);
  });
});
