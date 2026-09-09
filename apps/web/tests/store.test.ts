/**
 * Estado de interfaz.
 *
 * Lo que se comprueba aquí, sobre todo, es que cambiar de finca o de lote
 * limpia lo que colgaba de ellos: sin eso el panel seguiría mostrando una celda
 * que ya no está en pantalla.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { useCeresStore } from "@/stores/useCeresStore";

const initial = useCeresStore.getState();

describe("store de interfaz", () => {
  beforeEach(() => {
    useCeresStore.setState(initial, true);
  });

  it("arranca sin nada seleccionado y con la capa de riesgo activa", () => {
    const state = useCeresStore.getState();

    expect(state.selectedFarmId).toBeNull();
    expect(state.selectedCellId).toBeNull();
    expect(state.activeLayerId).toBe("risk");
    expect(state.terrainMode).toBe("3d");
  });

  it("cambiar de finca invalida lote, ciclo y celda", () => {
    const store = useCeresStore.getState();
    store.selectFarm("finca-1");
    store.selectPlot("lote-1");
    store.selectCropCycle("ciclo-1");
    store.selectCell("celda-1");

    useCeresStore.getState().selectFarm("finca-2");

    const state = useCeresStore.getState();
    expect(state.selectedFarmId).toBe("finca-2");
    expect(state.selectedPlotId).toBeNull();
    expect(state.selectedCropCycleId).toBeNull();
    expect(state.selectedCellId).toBeNull();
  });

  it("cambiar de lote invalida ciclo y celda pero conserva la finca", () => {
    const store = useCeresStore.getState();
    store.selectFarm("finca-1");
    store.selectPlot("lote-1");
    store.selectCell("celda-1");

    useCeresStore.getState().selectPlot("lote-2");

    const state = useCeresStore.getState();
    expect(state.selectedFarmId).toBe("finca-1");
    expect(state.selectedPlotId).toBe("lote-2");
    expect(state.selectedCellId).toBeNull();
  });

  it("no guarda el hover: es efímero y lo resuelve cada vista", () => {
    // En 3D `pointermove` dispara decenas de veces por segundo. Pasarlo por el
    // store provocaría un render de React y una reconciliación de la escena
    // por evento.
    const state = useCeresStore.getState() as unknown as Record<string, unknown>;

    expect(state.hoveredCellId).toBeUndefined();
    expect(state.hoverCell).toBeUndefined();
  });

  it("guarda cómo se representa el terreno", () => {
    expect(useCeresStore.getState().terrainMode).toBe("3d");

    useCeresStore.getState().setTerrainMode("2d");
    expect(useCeresStore.getState().terrainMode).toBe("2d");
  });

  it("cambiar de capa NO cambia la celda seleccionada", () => {
    // La garantía central del sistema de capas: A-00133 es la misma celda se
    // mire con la capa que se mire. Si la selección viviera dentro de la capa,
    // cambiar de representación perdería lo que el usuario estaba leyendo.
    const store = useCeresStore.getState();
    store.selectCell("celda-A-00133");

    for (const id of ["terrain", "risk", "yield", "loss", "terrain"] as const) {
      useCeresStore.getState().setActiveLayer(id);
      expect(useCeresStore.getState().selectedCellId).toBe("celda-A-00133");
      expect(useCeresStore.getState().activeLayerId).toBe(id);
    }
  });

  it("cambiar de capa tampoco cambia la proyección del terreno", () => {
    // Son dos preguntas distintas: qué miro encima y desde dónde lo miro.
    const store = useCeresStore.getState();
    store.setTerrainMode("2d");
    useCeresStore.getState().setActiveLayer("yield");
    expect(useCeresStore.getState().terrainMode).toBe("2d");
  });

  it("cambiar de proyección tampoco pierde la capa ni la celda", () => {
    const store = useCeresStore.getState();
    store.selectCell("celda-A-00133");
    useCeresStore.getState().setActiveLayer("loss");

    useCeresStore.getState().setTerrainMode("2d");
    useCeresStore.getState().setTerrainMode("3d");

    expect(useCeresStore.getState().selectedCellId).toBe("celda-A-00133");
    expect(useCeresStore.getState().activeLayerId).toBe("loss");
  });

  it("no guarda datos de la API, solo identificadores", () => {
    // Meter las 400 celdas en el store lo convertiría en una caché que nadie
    // invalida. Los datos bajan por props desde la página.
    const state = useCeresStore.getState() as unknown as Record<string, unknown>;
    const keys = Object.keys(state).filter((key) => typeof state[key] !== "function");

    expect(keys.sort()).toEqual([
      // Qué capa se proyecta y cómo se proyecta el terreno son preferencias de
      // interfaz, no datos: dicen qué se pinta, no qué vale. Y son DOS ejes, no
      // tres: la capa absorbió lo que antes estaba partido entre el estilo de
      // superficie y la métrica.
      "activeLayerId",
      // `selectedAsOf` es una SELECCIÓN, no un dato: guarda de qué momento se
      // está mirando el lote, igual que `selectedCellId` guarda qué celda está
      // abierta. Lo que ese momento produce —las celdas, el riesgo, el
      // rendimiento— sigue bajando por props desde la página, y no hay ninguna
      // copia del estado temporal fuera de la respuesta de `overview`.
      "selectedAsOf",
      "selectedCellId",
      "selectedCropCycleId",
      "selectedFarmId",
      "selectedPlotId",
      "terrainMode",
    ]);
  });
});

describe("eje temporal en el store", () => {
  beforeEach(() => {
    useCeresStore.setState(initial, true);
  });

  it("arranca sin momento elegido", () => {
    expect(useCeresStore.getState().selectedAsOf).toBeNull();
  });

  it("elegir un momento lo guarda tal cual", () => {
    useCeresStore.getState().selectAsOf("2026-08-13T12:00:00Z");

    expect(useCeresStore.getState().selectedAsOf).toBe("2026-08-13T12:00:00Z");
  });

  it("cambiar de finca limpia el momento", () => {
    // Sin esto se pediría el mapa de una fecha que la finca nueva no tiene.
    useCeresStore.getState().selectFarm("finca-1");
    useCeresStore.getState().selectAsOf("2026-08-13T12:00:00Z");

    useCeresStore.getState().selectFarm("finca-2");

    expect(useCeresStore.getState().selectedAsOf).toBeNull();
  });

  it("cambiar de lote limpia el momento", () => {
    // Los instantes son propios de cada lote: el t0 de papa es el 14 de abril y
    // el de maíz el 10 de mayo. Arrastrar uno pediría un mapa de una fecha que
    // ese lote no tiene, y saldría un estado real que no corresponde a ningún
    // momento del escenario.
    useCeresStore.getState().selectPlot("lote-papa");
    useCeresStore.getState().selectAsOf("2026-08-13T12:00:00Z");

    useCeresStore.getState().selectPlot("lote-maiz");

    expect(useCeresStore.getState().selectedAsOf).toBeNull();
  });

  it("cambiar de ciclo limpia el momento", () => {
    // Dos ciclos del mismo lote son dos temporadas y no comparten instantes.
    useCeresStore.getState().selectCropCycle("ciclo-2026");
    useCeresStore.getState().selectAsOf("2026-08-13T12:00:00Z");

    useCeresStore.getState().selectCropCycle("ciclo-2027");

    expect(useCeresStore.getState().selectedAsOf).toBeNull();
  });

  it("mover el tiempo NO cierra la celda abierta", () => {
    // Es la misma celda vista en otro momento. Cerrarla obligaría a volver a
    // buscarla para comparar, que es justo lo que el control permite hacer.
    useCeresStore.getState().selectCell("celda-1");

    useCeresStore.getState().selectAsOf("2026-08-13T12:00:00Z");

    expect(useCeresStore.getState().selectedCellId).toBe("celda-1");
  });

  it("elegir el mismo momento dos veces no cambia el estado", () => {
    // Lo que evita una petición de más: `useApiResource` keyea por dependencias,
    // así que un valor idéntico no dispara una consulta nueva.
    useCeresStore.getState().selectAsOf("2026-04-14T12:00:00Z");
    const antes = useCeresStore.getState().selectedAsOf;

    useCeresStore.getState().selectAsOf("2026-04-14T12:00:00Z");

    expect(useCeresStore.getState().selectedAsOf).toBe(antes);
  });
});
