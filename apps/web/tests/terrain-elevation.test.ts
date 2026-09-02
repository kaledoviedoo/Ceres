/**
 * La rama geométrica: elevación → campo → malla.
 *
 * Lo que estos tests protegen, por orden de importancia:
 *
 *  1. QUE LA GEOMETRIA NO PUEDA VER EL ANALISIS. Es el invariante de toda la
 *     fase. Si alguien añade un parámetro `cells` a `buildTerrainMesh`, el test
 *     de la firma se cae.
 *  2. Que la exageración vertical sea una exageración de verdad y no una
 *     compresión disfrazada —que es lo que era—.
 *  3. Que en el centro de una celda el campo devuelva SU medida, no una
 *     interpolada. Es la condición que hace honesta a toda la superficie.
 *  4. Que la procedencia viaje con el dato y declare que es sintético.
 */

import { describe, expect, it } from "vitest";

import { CELL_SIZE, gridToWorld, plotExtent, worldToGrid } from "@/lib/terrain/coords";
import {
  ElevationField,
  VERTICAL_EXAGGERATION,
  gridElevationSource,
} from "@/lib/terrain/elevation";
import { metricRgb } from "@/lib/terrain/analysis";
import { buildSkirt, buildTerrainMesh, drapeOnTerrain } from "@/lib/terrain/geometry";

function terreno(size: number, metros: (x: number, y: number) => number) {
  const cells = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) cells.push({ x, y, elevation_m: metros(x, y) });
  }
  return cells;
}

const plano = (size: number, valor = 1200) => terreno(size, () => valor);

describe("separación entre geometría y análisis", () => {
  it("la malla se construye solo con el campo de elevación", () => {
    // No es un test de comportamiento: es un test de FIRMA. `buildTerrainMesh`
    // acepta (field, width, height) y nada más, así que no existe ninguna vía
    // por la que un `risk_level` pueda llegar a mover un vértice.
    expect(buildTerrainMesh.length).toBe(3);
    expect(buildSkirt.length).toBe(3);
  });

  it("misma geometría + distintas métricas → distinta visualización", () => {
    // La otra mitad del invariante. La primera dice que el análisis no puede
    // tocar la forma; esta dice que el análisis SI tiene que cambiar la imagen.
    // Sin ella, "separar" podría degenerar en "el color tampoco hace nada".
    const cells = [
      {
        cell_id: "a",
        cell_code: "A-1",
        x: 0,
        y: 0,
        // Riesgo alto pero rendimiento intermedio: es justo el caso que
        // distingue las dos escalas. Con un valor en un extremo del rango, las
        // dos rampas coincidirían y el test pasaría sin comprobar nada.
        projected_yield_kg: 5.5,
        projected_boxes: 1,
        estimated_loss_percentage: 40,
        risk_score: 0.9,
        risk_level: "high" as const,
      },
      {
        cell_id: "b",
        cell_code: "A-2",
        x: 1,
        y: 0,
        projected_yield_kg: 9,
        projected_boxes: 2,
        estimated_loss_percentage: 5,
        risk_score: 0.1,
        risk_level: "low" as const,
      },
    ];

    const riesgo = metricRgb(cells, 2, 1, "risk", { min: 0, max: 1 });
    const rendimiento = metricRgb(cells, 2, 1, "yield", { min: 2, max: 9 });

    expect(Array.from(riesgo)).not.toEqual(Array.from(rendimiento));
  });

  it("dos lotes con las mismas alturas dan la misma malla, tengan el riesgo que tengan", () => {
    const alturas = terreno(6, (x, y) => 1200 + x * 0.1 + y * 0.2);
    const a = new ElevationField(gridElevationSource(alturas, 6, 6));
    const b = new ElevationField(gridElevationSource(alturas, 6, 6));

    const ma = buildTerrainMesh(a, 6, 6).attributes.position!.array;
    const mb = buildTerrainMesh(b, 6, 6).attributes.position!.array;

    expect(Array.from(ma)).toEqual(Array.from(mb));
  });
});

describe("fuente de elevación", () => {
  it("declara su procedencia y no se hace pasar por medición", () => {
    const source = gridElevationSource(plano(4), 4, 4);

    expect(source.provenance.kind).toBe("synthetic");
    expect(source.provenance.measured).toBe(false);
    // La resolución efectiva es MAYOR que la nominal: el campo sintético solo
    // varía a la escala de su retícula de ruido. Ocultarlo sería fingir
    // precisión.
    expect(source.provenance.effectiveResolutionM).toBeGreaterThan(
      source.provenance.nominalResolutionM,
    );
  });

  it("guarda los metros tal cual, sin normalizar", () => {
    const source = gridElevationSource(
      [
        { x: 0, y: 0, elevation_m: 1179.809 },
        { x: 1, y: 0, elevation_m: 1182.821 },
      ],
      2,
      1,
    );

    expect(source.metersAt(0, 0)).toBeCloseTo(1179.809, 6);
    expect(source.minMeters).toBeCloseTo(1179.809, 6);
    expect(source.maxMeters).toBeCloseTo(1182.821, 6);
  });
});

describe("campo continuo", () => {
  it("en el centro de una celda devuelve SU medida, no una interpolada", () => {
    const cells = terreno(6, (x, y) => 1200 + x * 0.7 + y * 0.3);
    const field = new ElevationField(gridElevationSource(cells, 6, 6));

    for (const cell of cells) {
      // Seis decimales, que es una micra. La fuente guarda desniveles en
      // `Float32Array` —siete digitos significativos sobre un rango de 3 m—, asi
      // que pedir mas seria comprobar el formato de almacenamiento y no la
      // propiedad que importa: que el centro de la celda NO se interpola.
      expect(field.metersAt(cell.x, cell.y)).toBeCloseTo(cell.elevation_m, 6);
    }
  });

  it("no da saltos: es eso lo que disuelve la cuadrícula", () => {
    const cells = terreno(8, (x, y) => 1200 + (x % 3) * 0.9 + (y % 4) * 0.5);
    const field = new ElevationField(gridElevationSource(cells, 8, 8));

    let mayor = 0;
    for (let gx = 0; gx <= 7 - 0.01; gx += 0.01) {
      mayor = Math.max(mayor, Math.abs(field.metersAt(gx + 0.01, 3.5) - field.metersAt(gx, 3.5)));
    }
    expect(mayor).toBeLessThan(0.05);
  });

  it("un lote plano no divide por cero", () => {
    const field = new ElevationField(gridElevationSource(plano(4), 4, 4));
    expect(field.reliefM).toBe(0);
    expect(field.heightAt(1.5, 2.5)).toBe(0);
  });
});

describe("exageración vertical", () => {
  it("exagera de verdad: el relieve mide MAS que a escala real", () => {
    // La versión anterior normalizaba a [0,1] y multiplicaba por 1,35, con lo
    // que 3,01 m de desnivel acababan midiendo 1,35 unidades: una compresión a
    // 0,45x. El terreno se veía plano porque estaba aplastado.
    const cells = [
      { x: 0, y: 0, elevation_m: 1179.809 },
      { x: 1, y: 0, elevation_m: 1182.821 },
    ];
    const field = new ElevationField(gridElevationSource(cells, 2, 1));
    const desnivelReal = 1182.821 - 1179.809;

    expect(VERTICAL_EXAGGERATION).toBeGreaterThan(1);
    expect(field.heightAt(1, 0)).toBeCloseTo(desnivelReal * VERTICAL_EXAGGERATION, 6);
    expect(field.heightAt(1, 0)).toBeGreaterThan(desnivelReal);
  });

  it("no toca los metros: la exageración es solo para la imagen", () => {
    const cells = [
      { x: 0, y: 0, elevation_m: 1180 },
      { x: 1, y: 0, elevation_m: 1183 },
    ];
    const field = new ElevationField(gridElevationSource(cells, 2, 1));

    // Lo que el inspector muestra sale de aquí, y son los metros del backend.
    expect(field.metersAt(1, 0)).toBe(1183);
  });
});

describe("sombreado de relieve", () => {
  it("un terreno plano se ilumina uniformemente", () => {
    const field = new ElevationField(gridElevationSource(plano(6), 6, 6));
    const shade = field.hillshadeGrid(16);
    const primero = shade[0]!;

    for (const v of shade) expect(v).toBeCloseTo(primero, 6);
  });

  it("una ladera se sombrea distinto según su orientación", () => {
    // Es lo que hace visible la forma bajo un color plano: si las dos caras de
    // una loma recibieran la misma luz, el sombreado no aportaría nada.
    const loma = terreno(9, (x) => 1200 + Math.abs(4 - x) * -0.4);
    const field = new ElevationField(gridElevationSource(loma, 9, 9));

    const oeste = field.hillshadeAt(2, 4);
    const este = field.hillshadeAt(6, 4);
    expect(Math.abs(oeste - este)).toBeGreaterThan(0.05);
  });

  it("siempre devuelve un valor iluminable", () => {
    const field = new ElevationField(gridElevationSource(terreno(8, (x, y) => 1200 + x * y * 0.05), 8, 8));
    for (const v of field.hillshadeGrid(24)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("curvas de nivel", () => {
  it("un terreno plano no tiene curvas", () => {
    const field = new ElevationField(gridElevationSource(plano(6), 6, 6));
    expect(field.contours(0.5)).toHaveLength(0);
  });

  it("una rampa produce una curva por cada intervalo cruzado", () => {
    // De 1180 a 1183 con equidistancia 1 m: se cruzan 1181, 1182 y 1183 no
    // porque el máximo no se incluye. Quedan dos.
    const rampa = terreno(10, (x) => 1180 + (x / 9) * 3);
    const field = new ElevationField(gridElevationSource(rampa, 10, 10));
    const curvas = field.contours(1);

    expect(curvas.map((c) => c.level)).toEqual([1181, 1182]);
    for (const c of curvas) expect(c.points.length).toBeGreaterThan(0);
  });

  it("cada curva une puntos de la misma altura", () => {
    const rampa = terreno(10, (x, y) => 1180 + x * 0.2 + y * 0.1);
    const field = new ElevationField(gridElevationSource(rampa, 10, 10));

    for (const curva of field.contours(0.5)) {
      for (const [gx, gy] of curva.points) {
        expect(field.metersAt(gx, gy)).toBeCloseTo(curva.level, 1);
      }
    }
  });
});

describe("proyección sobre el terreno", () => {
  it("coloca cualquier polilínea a la altura de la superficie", () => {
    const cells = terreno(5, (x, y) => 1200 + x * 0.5 + y * 0.25);
    const field = new ElevationField(gridElevationSource(cells, 5, 5));
    const puntos = drapeOnTerrain([[1, 1], [3, 2]], field, 5, 5, 0.1);

    expect(puntos[0]![1]).toBeCloseTo(field.heightAt(1, 1) + 0.1, 6);
    expect(puntos[1]![1]).toBeCloseTo(field.heightAt(3, 2) + 0.1, 6);
  });
});

describe("convenio de ejes", () => {
  it("x crece hacia el este y el norte queda hacia −Z", () => {
    expect(gridToWorld(19, 5, 20, 20)[0]).toBeGreaterThan(gridToWorld(0, 5, 20, 20)[0]);
    expect(gridToWorld(5, 19, 20, 20)[1]).toBeLessThan(gridToWorld(5, 0, 20, 20)[1]);
  });

  it("mundo y malla son la misma cosa vista al revés", () => {
    for (const [gx, gy] of [[0, 0], [7, 13], [19, 19], [4.5, 11.25]] as const) {
      const [wx, wz] = gridToWorld(gx, gy, 20, 20);
      const [bx, by] = worldToGrid(wx, wz, 20, 20);
      expect(bx).toBeCloseTo(gx, 9);
      expect(by).toBeCloseTo(gy, 9);
    }
  });

  it("la extensión del lote crece con la malla", () => {
    expect(plotExtent(40, 40)).toBeGreaterThan(plotExtent(20, 20));
    expect(plotExtent(20, 20)).toBe(20 * CELL_SIZE);
  });
});
