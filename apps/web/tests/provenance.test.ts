/**
 * LA PROCEDENCIA LA DICE LA API. EL FRONTEND NO OPINA.
 *
 * Durante cuatro fases hubo una constante que afirmaba "elevación sintética"
 * pasara lo que pasara. Era correcta —el dataset lo genera un generador— y aun
 * así estaba mal: nadie se lo había dicho al frontend. La interfaz habría
 * seguido diciendo exactamente lo mismo, con la misma seguridad, sobre un DEM
 * levantado con LiDAR.
 *
 * Estos tests fijan las tres mitades del arreglo:
 *
 *   1. que lo declarado por la API llegue intacto a la interfaz;
 *   2. que la AUSENCIA de declaración produzca `unknown` y nunca `measured`;
 *   3. que nadie pueda reintroducir una procedencia supuesta.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { PROVENANCE_LABEL, isMeasured } from "@/lib/terrain/elevation";
import { elevationProvenanceFrom } from "@/lib/terrain/provenance";
import type { CellProvenance } from "@/lib/types/api";
import { cellProvenance } from "./fixtures";

describe("lo que declara la API llega a la interfaz", () => {
  it("copia la clase, la resolución nominal y la efectiva", () => {
    const p = elevationProvenanceFrom(cellProvenance, 1);

    expect(p.kind).toBe("synthetic");
    expect(p.nominalResolutionM).toBe(1);
    expect(p.effectiveResolutionM).toBe(5);
    expect(p.measured).toBe(false);
  });

  it("una elevación medida se declara medida", () => {
    // El caso que la constante supuesta habría contado mal: aquí la API dice
    // que hubo un instrumento, y la interfaz tiene que repetirlo.
    const medida: CellProvenance = {
      ...cellProvenance,
      elevation: {
        ...cellProvenance.elevation,
        kind: "measured",
        nominal_resolution_m: 0.25,
        effective_resolution_m: 0.5,
      },
    };
    const p = elevationProvenanceFrom(medida, 1);

    expect(p.kind).toBe("measured");
    expect(p.measured).toBe(true);
    expect(p.nominalResolutionM).toBe(0.25);
  });

  it("`measured` es lo único que cuenta como medición", () => {
    // `synthetic`, `derived` y `estimated` son todas cosas que NO se midieron.
    expect(isMeasured("measured")).toBe(true);
    for (const kind of ["derived", "estimated", "synthetic", "unknown"] as const) {
      expect(isMeasured(kind), kind).toBe(false);
    }
  });

  it("cada clase tiene su palabra en la interfaz", () => {
    for (const kind of ["measured", "derived", "estimated", "synthetic", "unknown"] as const) {
      expect(PROVENANCE_LABEL[kind]).toBeTruthy();
    }
  });
});

describe("la ausencia no se rellena", () => {
  it("sin bloque de procedencia, `unknown`", () => {
    /*
     * Es un caso real, no defensivo: el cliente hace `as T` sin validar nada en
     * runtime, así que un backend antiguo devolvería la respuesta sin el bloque
     * y TypeScript no se enteraría.
     */
    const p = elevationProvenanceFrom(undefined, 1);

    expect(p.kind).toBe("unknown");
    expect(p.measured).toBe(false);
  });

  it("sin declaración tampoco se inventa una resolución efectiva", () => {
    // `null` y no la nominal repetida: repetirla afirmaría que el campo varía a
    // la escala de sus muestras, que es justo lo que un dato sintético no hace.
    expect(elevationProvenanceFrom(undefined, 1).effectiveResolutionM).toBeNull();
  });

  it("el espaciado de las muestras sobrevive a la ausencia", () => {
    // Es geometría del propio dato —dónde están las muestras—, no una
    // afirmación sobre su origen, así que se puede sostener sin que nadie la
    // declare.
    expect(elevationProvenanceFrom(undefined, 0.5).nominalResolutionM).toBe(0.5);
  });

  it("una palabra fuera del vocabulario se degrada a `unknown`", () => {
    // Sin validación en runtime, un backend más nuevo con un valor de más
    // entraría como string cualquiera y la etiqueta saldría `undefined` en
    // pantalla.
    const raro = {
      ...cellProvenance,
      elevation: { ...cellProvenance.elevation, kind: "telepathic" as never },
    };

    expect(elevationProvenanceFrom(raro, 1).kind).toBe("unknown");
  });

  it("NUNCA `measured` por omisión", () => {
    // La única dirección que no se puede equivocar: afirmar una medición que no
    // existe es la mentira que un cliente no puede detectar.
    for (const entrada of [undefined, { ...cellProvenance, elevation: undefined as never }]) {
      expect(elevationProvenanceFrom(entrada, 1).measured).toBe(false);
    }
  });
});

describe("la suposición no puede volver", () => {
  it("`ASSUMED_PROVENANCE` y `assumedProvenance` ya no existen", async () => {
    const elevation = await import("@/lib/terrain/elevation");

    expect(Object.keys(elevation)).not.toContain("ASSUMED_PROVENANCE");
    expect(Object.keys(elevation)).not.toContain("assumedProvenance");
  });

  it("ningún módulo de la rama geométrica escribe una procedencia a mano", () => {
    /*
     * Guardia de código fuente, y hace falta además de la de comportamiento:
     * una constante nueva podría quedarse dormida en un módulo que estos tests
     * no ejerciten y despertar cuando alguien la use.
     *
     * Lo que se prohíbe es DECLARAR una clase distinta de `unknown` sin que
     * venga de fuera. Nombrarla en prosa está permitido: los comentarios
     * explican por qué se fue.
     */
    const modulos = ["lib/terrain/elevation.ts", "lib/terrain/provenance.ts"];
    const literal = /kind:\s*"(measured|synthetic|derived|estimated)"/;

    for (const modulo of modulos) {
      const fuente = readFileSync(resolve(process.cwd(), modulo), "utf8");
      expect(literal.test(fuente), `${modulo} fija una procedencia a mano`).toBe(false);
    }
  });

  it("el único valor por defecto del sistema es `unknown`", async () => {
    const { unknownProvenance } = await import("@/lib/terrain/elevation");
    expect(unknownProvenance(1).kind).toBe("unknown");
  });
});
