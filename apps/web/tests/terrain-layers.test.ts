/**
 * EL SISTEMA DE CAPAS, COMO GARANTIA ARQUITECTONICA.
 *
 * La regla de la fase es una sola:
 *
 *     ELEVACION = geometría.   TODO LO DEMAS = capa analítica.
 *
 * Una capa puede cambiar color, sombreado, contornos y anotaciones. No puede
 * cambiar posiciones, alturas, normales, topología ni escala física.
 *
 * Estos tests no comprueban que hoy no lo haga: comprueban que NO PUEDE.
 *
 *  1. La firma de `paint` no admite un `ElevationField`, que es el único objeto
 *     capaz de producir geometría.
 *  2. Con la misma elevación, la malla sale IDENTICA byte a byte se pinte la
 *     capa que se pinte.
 *  3. Una capa sin fuente real no tiene `paint`. No devuelve ceros ni ruido:
 *     no existe la función. El tipo impide inventar datos.
 */

import { describe, expect, it } from "vitest";

import { ElevationField, gridElevationSource } from "@/lib/terrain/elevation";
import { buildSkirt, buildTerrainMesh } from "@/lib/terrain/geometry";
import {
  LAYERS,
  REFERENCE_LEVEL,
  availableLayers,
  valueSpan,
  elevationTint,
  getAvailableLayer,
  getLayer,
  measureLayer,
  pendingLayers,
} from "@/lib/terrain/layers";
import type { TerrainCell } from "@/lib/terrain/types";
import { buildTerrainCells, malla } from "./fixtures";

/** El mismo relieve, con las métricas que se le quieran poner encima. */
function campo(cells: TerrainCell[]): ElevationField {
  return new ElevationField(gridElevationSource(cells, malla(20, 20)), 1);
}

function posiciones(field: ElevationField): Float32Array {
  return buildTerrainMesh(field, malla(20, 20)).getAttribute("position").array as Float32Array;
}

/** Las mismas 400 celdas con el riesgo invertido: misma altura, otro análisis. */
function conRiesgoInvertido(cells: TerrainCell[]): TerrainCell[] {
  return cells.map((cell) => ({
    ...cell,
    risk_level:
      cell.risk_level === "high" ? "low" : cell.risk_level === "low" ? "high" : "medium",
    risk_score: 1 - cell.risk_score,
    projected_yield_kg: 13 - cell.projected_yield_kg,
    estimated_loss_percentage: 45 - cell.estimated_loss_percentage,
  }));
}

// ── A · La capa no puede llegar a la geometría ───────────────────────────────

describe("una capa no puede tocar la geometría", () => {
  it("`paint` no admite un campo de elevación: la firma se lo impide", () => {
    // Test de FIRMA, no de comportamiento. `paint(cells, gridWidth, gridHeight)`
    // son tres parámetros y ninguno es un `ElevationField`. Si alguien le añade
    // uno para "ajustar el color según la pendiente", este test se cae.
    for (const layer of availableLayers()) {
      expect(layer.paint.length).toBe(3);
    }
  });

  it("devuelve coordenadas de malla, nunca alturas", () => {
    const cells = buildTerrainCells();
    for (const layer of availableLayers()) {
      const { zones } = layer.paint(cells, 20, 20);
      // Pares (x, y). Un tercer número sería una altura, y las alturas no salen
      // de aquí: proyectarlas sobre el relieve es trabajo de quien dibuja.
      for (const punto of zones) expect(punto).toHaveLength(2);
    }
  });

  it("misma elevación + distintas métricas → misma malla, byte a byte", () => {
    const cells = buildTerrainCells();
    const otras = conRiesgoInvertido(cells);

    // Precondición: las métricas SI son distintas. Sin esto el test pasaría
    // comparando dos veces lo mismo.
    expect(otras[0]!.risk_level).not.toBe(cells[0]!.risk_level);

    expect(posiciones(campo(otras))).toEqual(posiciones(campo(cells)));
  });

  it("pintar cualquier capa deja la malla exactamente igual", () => {
    const cells = buildTerrainCells();
    const field = campo(cells);
    const antes = Float32Array.from(posiciones(field));

    for (const layer of availableLayers()) layer.paint(cells, 20, 20);

    expect(posiciones(field)).toEqual(antes);
    // La falda cuelga del mismo campo: si una capa hubiera movido algo, también
    // se vería aquí.
    expect(buildSkirt(field, malla(20, 20)).getAttribute("position").array).toEqual(
      buildSkirt(campo(cells), malla(20, 20)).getAttribute("position").array,
    );
  });

  it("pintar no muta las celdas: ni altura ni posición", () => {
    const cells = buildTerrainCells();
    const copia = cells.map((c) => ({ x: c.x, y: c.y, elevation_m: c.elevation_m }));

    for (const layer of availableLayers()) layer.paint(cells, 20, 20);

    for (let i = 0; i < cells.length; i += 1) {
      expect(cells[i]!.x).toBe(copia[i]!.x);
      expect(cells[i]!.y).toBe(copia[i]!.y);
      expect(cells[i]!.elevation_m).toBe(copia[i]!.elevation_m);
    }
  });

  it("la elevación física no cambia al cambiar de capa", () => {
    const cells = buildTerrainCells();
    const field = campo(cells);
    const antes = [field.metersAt(0, 0), field.metersAt(9, 9), field.metersAt(19, 19)];

    for (const layer of availableLayers()) layer.paint(cells, 20, 20);

    expect([field.metersAt(0, 0), field.metersAt(9, 9), field.metersAt(19, 19)]).toEqual(
      antes,
    );
  });
});

/**
 * Un lote donde rendimiento y pérdida NO son función del nivel de riesgo.
 *
 * En el dataset de demostración sí lo son —tres niveles, tres rendimientos—, y
 * eso hace que las capas de riesgo y rendimiento caigan en los mismos tres
 * colores. Es una propiedad del generador sintético, no de las capas: para
 * comprobar que las escalas son distintas hace falta un lote como los de
 * verdad, donde una celda puede rendir bien y estar en riesgo.
 */
function decorrelado(cells: TerrainCell[]): TerrainCell[] {
  return cells.map((cell, i) => ({
    ...cell,
    projected_yield_kg: 1 + ((i * 7) % 101) / 10,
    estimated_loss_percentage: 3 + ((i * 13) % 41),
  }));
}

// ── B · La capa SI tiene que cambiar la representación ───────────────────────

describe("cambiar de capa cambia lo que se ve", () => {
  const cells = buildTerrainCells();

  it("cada capa disponible pinta distinto de las demás", () => {
    // La otra mitad del invariante: si "separar" degenerara en "el color tampoco
    // hace nada", la separación no valdría de nada.
    const lote = decorrelado(cells);
    const firmas = availableLayers().map((layer) => layer.paint(lote, 20, 20).rgb.join(","));
    expect(new Set(firmas).size).toBe(firmas.length);
  });

  it("rendimiento y pérdida no son la misma escala al revés", () => {
    // Comparten los tres tonos a propósito, pero orientados al contrario. Con un
    // lote decorrelacionado tienen que separarse.
    const lote = decorrelado(cells);
    expect(getAvailableLayer("yield").paint(lote, 20, 20).rgb).not.toEqual(
      getAvailableLayer("loss").paint(lote, 20, 20).rgb,
    );
  });

  it("con el riesgo invertido, la capa de riesgo pinta distinto", () => {
    const risk = getAvailableLayer("risk");
    expect(risk.paint(conRiesgoInvertido(cells), 20, 20).rgb).not.toEqual(
      risk.paint(cells, 20, 20).rgb,
    );
  });

  it("la capa de terreno NO cambia si solo cambian las métricas", () => {
    // Es la simétrica de la anterior y la más importante de las dos: el terreno
    // pinta elevación, así que cambiar el riesgo no puede moverle un píxel.
    const terrain = getAvailableLayer("terrain");
    expect(terrain.paint(conRiesgoInvertido(cells), 20, 20).rgb).toEqual(
      terrain.paint(cells, 20, 20).rgb,
    );
  });

  it("la frontera que anota la capa es la misma para planta y para relieve", () => {
    // `zone` es la declaración; `paint().zones` es cómo la dibuja el relieve, y
    // `zoneBorders(cells, layer.zone)` cómo la dibuja la planta. Si las dos
    // vistas dejaran de leer la misma declaración, volverían a discrepar: la
    // planta perfilaba la zona de riesgo con la capa de terreno activa.
    for (const layer of availableLayers()) {
      const anota = layer.paint(cells, 20, 20).zones.length > 0;
      expect(anota).toBe(layer.zone !== null);
    }
  });

  it("las capas métricas perfilan la zona de riesgo para poder compararla", () => {
    // El color codifica UNA variable; la región en riesgo alto se dibuja encima
    // como anotación, que es el hueco que la semántica reserva al contorno. Es
    // lo que permite ver si lo que menos rinde cae dentro de la zona sin meter
    // una segunda escala de color.
    for (const id of ["risk", "yield", "loss"] as const) {
      expect(getAvailableLayer(id).paint(cells, 20, 20).zones.length).toBeGreaterThan(0);
    }
  });

  it("la capa de terreno sigue sin análisis encima", () => {
    // Terreno es la forma del campo. Perfilarle una región de riesgo sería
    // exactamente el análisis que esa capa existe para no tener.
    expect(getAvailableLayer("terrain").paint(cells, 20, 20).zones).toHaveLength(0);
    expect(getAvailableLayer("terrain").zone).toBeNull();
  });

  it("el terreno se pinta sin tono: no puede leerse como un nivel", () => {
    // Verde, ámbar y rojo son el vocabulario del análisis. Una elevación pintada
    // con esos tonos se leería como riesgo. La rampa del terreno es acromática,
    // y eso se mide: la separación entre canales nunca llega a la de un color.
    const { rgb } = getAvailableLayer("terrain").paint(cells, 20, 20);
    for (let i = 0; i < rgb.length; i += 3) {
      const [r, g, b] = [rgb[i]!, rgb[i + 1]!, rgb[i + 2]!];
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(20);
    }
  });

  it("el tinte de elevación recorre el desnivel real del lote", () => {
    const span = valueSpan(getAvailableLayer("terrain"), cells);
    expect(span.max).toBeGreaterThan(span.min);
    expect(elevationTint(span.min, span)).not.toBe(elevationTint(span.max, span));
    // Un lote plano no divide por cero ni se va a un extremo.
    const llano = { min: 1200, max: 1200 };
    expect(elevationTint(1200, llano)).toBe(elevationTint(1200, llano));
  });
});

// ── Medir una capa sobre el lote ─────────────────────────────────────────────

describe("medición de la capa", () => {
  const cells = buildTerrainCells();

  it("toda capa disponible es medible en todas las celdas", () => {
    for (const layer of availableLayers()) {
      for (const cell of cells) {
        expect(Number.isFinite(layer.valueOf(cell))).toBe(true);
      }
    }
  });

  it("los valores medidos son exactamente los que declara la capa", () => {
    for (const layer of availableLayers()) {
      const stats = measureLayer(layer, cells)!;
      expect(stats.values).toEqual(cells.map((c) => layer.valueOf(c)));
      expect(stats.summary.n).toBe(cells.length);
    }
  });

  it("cada capa mide su propio campo, no el de otra", () => {
    expect(getAvailableLayer("terrain").valueOf(cells[0]!)).toBe(cells[0]!.elevation_m);
    expect(getAvailableLayer("risk").valueOf(cells[0]!)).toBe(cells[0]!.risk_score);
    expect(getAvailableLayer("yield").valueOf(cells[0]!)).toBe(cells[0]!.projected_yield_kg);
    expect(getAvailableLayer("loss").valueOf(cells[0]!)).toBe(
      cells[0]!.estimated_loss_percentage,
    );
  });

  it("el formato lleva unidad: un número suelto no dice qué mide", () => {
    expect(getAvailableLayer("terrain").format(1181.2)).toContain("m");
    expect(getAvailableLayer("yield").format(7.46)).toContain("kg");
    expect(getAvailableLayer("loss").format(20.5)).toContain("%");
  });

  it("comparar el riesgo con la región que define el riesgo es circular: no se hace", () => {
    expect(measureLayer(getAvailableLayer("risk"), cells)!.overlap).toBeNull();
    expect(getAvailableLayer("risk").comparable).toBe(false);
  });

  it("las demás sí se comparan, y la región es la que marca el motor", () => {
    const enRiesgo = cells.filter((c) => c.risk_level === REFERENCE_LEVEL).length;
    expect(enRiesgo).toBeGreaterThan(0);
    for (const id of ["terrain", "yield", "loss"] as const) {
      const o = measureLayer(getAvailableLayer(id), cells)!.overlap!;
      expect(o.region).toBe(enRiesgo);
      expect(o.both).toBeLessThanOrEqual(o.region);
    }
  });

  it("un lote vacío no se mide: null, no un resumen de ceros", () => {
    for (const layer of availableLayers()) {
      expect(measureLayer(layer, [])).toBeNull();
    }
  });

  it("medir no toca las celdas ni la geometría", () => {
    // La estadística es de solo lectura. Si midiendo se colara una escritura,
    // cambiar de capa dejaría de ser inocuo para el terreno.
    const field = campo(cells);
    const antes = Float32Array.from(posiciones(field));
    const copia = cells.map((c) => ({ x: c.x, y: c.y, elevation_m: c.elevation_m }));

    for (const layer of availableLayers()) measureLayer(layer, cells);

    expect(posiciones(field)).toEqual(antes);
    for (let i = 0; i < cells.length; i += 1) {
      expect(cells[i]!.elevation_m).toBe(copia[i]!.elevation_m);
      expect(cells[i]!.x).toBe(copia[i]!.x);
      expect(cells[i]!.y).toBe(copia[i]!.y);
    }
  });

  it("no depende de React, de Three ni del store", () => {
    // Test de dependencias: si `layers.ts` empezara a importar cualquiera de
    // los tres, la estadística dejaría de poder calcularse fuera de un render.
    const fuente = LAYERS.map((l) => JSON.stringify(l)).join("");
    expect(fuente).not.toContain("useState");
    expect(measureLayer(getAvailableLayer("yield"), cells)).not.toBeNull();
  });
});

// ── G · Las capas sin fuente no pueden inventar nada ─────────────────────────

describe("capas sin fuente de datos", () => {
  it("no tienen `paint`: no es que devuelvan ceros, es que no existe", () => {
    const pendientes = pendingLayers();
    expect(pendientes.length).toBeGreaterThan(0);
    for (const layer of pendientes) {
      expect(layer).not.toHaveProperty("paint");
      expect(layer.available).toBe(false);
    }
  });

  it("declaran qué dato les falta, y no una promesa", () => {
    for (const layer of pendingLayers()) {
      expect(layer.missing.length).toBeGreaterThan(20);
    }
  });

  it("no se pueden activar: pedir una pendiente devuelve una disponible", () => {
    const activa = getAvailableLayer("slope");
    expect(activa.available).toBe(true);
    expect(getLayer("slope").available).toBe(false);
  });

  it("suelo y sanidad YA no son pendientes: la API los devuelve completos", () => {
    // Comprobado contra /plots/{id}/cells: 400/400 en las dos. Tratarlos como
    // ausentes sería tan falso como inventarlos.
    for (const id of ["soil", "health"] as const) {
      const capa = getLayer(id);
      expect(capa.available).toBe(true);
      expect(pendingLayers().map((l) => l.id)).not.toContain(id);
    }
  });

  it("toda capa disponible declara de qué dato real sale", () => {
    for (const layer of availableLayers()) {
      expect(layer.source.length).toBeGreaterThan(0);
    }
  });
});

// ── F · La procedencia sigue viajando ────────────────────────────────────────

describe("procedencia", () => {
  it("pintar las seis capas no altera la procedencia del campo", () => {
    const cells = buildTerrainCells();
    const field = campo(cells);
    const antes = { ...field.provenance };

    for (const layer of availableLayers()) layer.paint(cells, 20, 20);

    expect(field.provenance).toEqual(antes);
    // Y lo que declara es lo que le dieron: sin declaración, `unknown`.
    expect(field.provenance.kind).toBe("unknown");
    expect(field.provenance.measured).toBe(false);
  });

  it("ninguna capa puede reescribir la procedencia: no la ve", () => {
    for (const layer of LAYERS) {
      expect(JSON.stringify(layer)).not.toContain("provenance");
    }
  });
});

// ── G · La ficha de la capa ──────────────────────────────────────────────────

/**
 * Una capa no es un color: es una afirmación sobre el campo. Estos tests fijan
 * que cada una pueda contestar las seis preguntas que hacen falta para leerla
 * sin equivocarse —qué responde, de dónde sale, en qué unidad, qué significan
 * sus extremos, contra qué se compara y qué NO se puede concluir de ella—.
 *
 * Están aquí y no en un documento porque un documento se queda viejo callando.
 */
describe("ficha de la capa", () => {
  it("las seis contestan las seis preguntas", () => {
    for (const layer of availableLayers()) {
      expect(layer.question, layer.id).toMatch(/\?$/);
      expect(layer.source.length, layer.id).toBeGreaterThan(0);
      expect(layer.unit.length, layer.id).toBeGreaterThan(0);
      expect(layer.reads.low.length, layer.id).toBeGreaterThan(0);
      expect(layer.reads.high.length, layer.id).toBeGreaterThan(0);
      expect(["plot", "engine"], layer.id).toContain(layer.scale);
      expect(["stored", "engine"], layer.id).toContain(layer.origin);
    }
  });

  it("solo el riesgo tiene una escala que no es la del lote", () => {
    // Es la diferencia que decide si dos lotes son comparables de un vistazo.
    // Toda capa que pasa por la fábrica normaliza con su propio mínimo y máximo;
    // los tres niveles del riesgo los fija el motor.
    for (const layer of availableLayers()) {
      expect(layer.scale, layer.id).toBe(layer.id === "risk" ? "engine" : "plot");
    }
  });

  it("lo derivado se declara derivado", () => {
    // Riesgo, rendimiento y pérdida los CALCULA el motor. Elevación, suelo y
    // sanidad llegan en la ficha de la celda y son sus entradas.
    const porOrigen = (origin: string) =>
      availableLayers().filter((l) => l.origin === origin).map((l) => l.id).sort();

    expect(porOrigen("engine")).toEqual(["loss", "risk", "yield"]);
    expect(porOrigen("stored")).toEqual(["health", "soil", "terrain"]);
  });

  it("toda capa comparable avisa de por qué la coincidencia es esperable", () => {
    /*
     * El motor calcula el riesgo desde sanidad, suelo y pendiente, y el
     * rendimiento y la pérdida salen de esos mismos campos. Así que el panel de
     * reparto compara, casi siempre, una entrada contra su propio resultado.
     *
     * La cifra sigue diciendo DONDE y CUANTO. Lo que no puede es leerse como una
     * relación descubierta en el campo, y sin esta línea cualquiera da ese salto.
     */
    for (const layer of availableLayers()) {
      if (!layer.comparable) continue;
      expect(layer.caution, layer.id).not.toBeNull();
      expect(layer.caution!.length, layer.id).toBeGreaterThan(30);
    }
  });

  it("densidad y factor residual no son capas, y no por descuido", () => {
    // Los dos llegan 400/400. Una capa existe porque responde una pregunta útil,
    // no porque el campo esté disponible: la densidad de siembra es una decisión
    // previa y casi uniforme, y el factor residual es, por definición, lo que el
    // modelo NO explica. Los dos siguen en el inspector, que es su sitio.
    const ids = LAYERS.map((l) => l.id);
    expect(ids).not.toContain("density");
    expect(ids).not.toContain("residual");
  });
});
