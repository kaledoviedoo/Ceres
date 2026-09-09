/**
 * LAS CINCO GUARDAS DE PRESENCIA.
 *
 * El fallo que evitan es el único silencioso que quedaba identificado. El
 * cliente hace `as T` y no valida nada en runtime: un campo que desapareciera de
 * la respuesta entraría como `undefined`, TypeScript no se enteraría, y
 * `plotExtent` devolvería `NaN`. Todos los vértices saldrían `NaN` y **el
 * terreno desaparecería sin un solo error en consola**.
 *
 * `agreeOnPlotGrid` no lo cubría: comprueba que las respuestas COINCIDAN, y dos
 * respuestas a las que les falta el mismo campo coinciden perfectamente en
 * `undefined`. Este fichero cierra ese agujero.
 */

import { describe, expect, it } from "vitest";

import {
  CRITICAL_GEOMETRY_FIELDS,
  agreeOnPlotGrid,
  describeMissingGeometry,
  missingGeometryFields,
  plotExtent,
} from "@/lib/terrain/coords";

const completa = {
  grid_width: 20,
  grid_height: 20,
  cell_size_m: 1,
  origin_latitude: 5.6277878,
  origin_longitude: -73.4881402,
};

describe("una respuesta completa pasa", () => {
  it("no falta nada", () => {
    expect(missingGeometryFields(completa)).toEqual([]);
  });

  it("son exactamente cinco campos", () => {
    expect(CRITICAL_GEOMETRY_FIELDS).toHaveLength(5);
  });
});

describe("ausencia", () => {
  it("cada campo que falta se nombra", () => {
    for (const campo of CRITICAL_GEOMETRY_FIELDS) {
      const rota = { ...completa } as Record<string, unknown>;
      delete rota[campo];
      expect(missingGeometryFields(rota), campo).toEqual([campo]);
    }
  });

  it("sin respuesta faltan los cinco", () => {
    expect(missingGeometryFields(undefined)).toEqual([...CRITICAL_GEOMETRY_FIELDS]);
    expect(missingGeometryFields(null)).toEqual([...CRITICAL_GEOMETRY_FIELDS]);
  });
});

describe("presente pero inservible", () => {
  it("`null` no es un número", () => {
    expect(missingGeometryFields({ ...completa, cell_size_m: null })).toEqual([
      "cell_size_m",
    ]);
  });

  it("un número en texto tampoco", () => {
    // `"20"` pasaría un `!== undefined` y rompería igual: `"20" * 2` es 40 pero
    // `"20" / 0.5` también, y en cuanto se concatena en vez de multiplicarse la
    // geometría se va a paseo.
    expect(missingGeometryFields({ ...completa, grid_width: "20" })).toEqual([
      "grid_width",
    ]);
  });

  it("`NaN` e `Infinity` se rechazan", () => {
    expect(missingGeometryFields({ ...completa, cell_size_m: NaN })).toEqual([
      "cell_size_m",
    ]);
    expect(missingGeometryFields({ ...completa, grid_height: Infinity })).toEqual([
      "grid_height",
    ]);
  });

  it("un tamaño de cero colapsa la malla y se rechaza", () => {
    expect(missingGeometryFields({ ...completa, cell_size_m: 0 })).toEqual([
      "cell_size_m",
    ]);
    expect(missingGeometryFields({ ...completa, grid_width: -20 })).toEqual([
      "grid_width",
    ]);
  });

  it("una longitud negativa es perfectamente válida", () => {
    // El lote está a 73° oeste. A las coordenadas solo se les exige finitud.
    expect(missingGeometryFields(completa)).toEqual([]);
    expect(missingGeometryFields({ ...completa, origin_latitude: -33.4 })).toEqual([]);
  });
});

describe("el fallo concreto que esto impide", () => {
  it("sin `cell_size_m`, la extensión del lote sería NaN", () => {
    /*
     * La demostración de por qué hacía falta. Se construye la malla como la
     * construiría el cliente sin guarda y se mira el resultado: no lanza, no
     * avisa, devuelve NaN. Todos los vértices saldrían NaN y el terreno
     * desaparecería como si fuera un problema de red.
     */
    const sinTamano = { width: 20, height: 20, cellSizeM: undefined as unknown as number };
    expect(Number.isNaN(plotExtent(sinTamano))).toBe(true);
  });

  it("dos respuestas a las que les falta lo mismo se ponen de acuerdo", () => {
    // Por eso la guarda de presencia no la cubría el acuerdo: `undefined` es
    // igual a `undefined`, así que el contrato roto pasaba desapercibido.
    const rota = { width: 20, height: 20, cellSizeM: undefined as unknown as number };
    const acuerdo = agreeOnPlotGrid([
      { source: "/cells", ...rota },
      { source: "/overview", ...rota },
    ]);

    expect("agreed" in acuerdo).toBe(true);
  });
});

describe("el mensaje", () => {
  it("nombra los campos que faltan", () => {
    const texto = describeMissingGeometry(["cell_size_m"]);
    expect(texto).toContain("cell_size_m");
    expect(texto).toContain("escala inventada");
  });

  it("concuerda en singular y en plural", () => {
    expect(describeMissingGeometry(["cell_size_m"])).toContain("ese dato");
    expect(describeMissingGeometry(["cell_size_m", "grid_width"])).toContain("esos datos");
  });
});
