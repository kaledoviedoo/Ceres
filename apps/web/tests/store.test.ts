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

  it("arranca sin nada seleccionado y en modo riesgo", () => {
    const state = useCeresStore.getState();

    expect(state.selectedFarmId).toBeNull();
    expect(state.selectedCellId).toBeNull();
    expect(state.viewMode).toBe("risk");
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

  it("separa hover de selección", () => {
    // El hover cambia con cada píxel; la selección solo con un click. Si
    // compartieran estado, mover el ratón repintaría el panel lateral entero.
    useCeresStore.getState().selectCell("celda-1");
    useCeresStore.getState().hoverCell("celda-2");

    const state = useCeresStore.getState();
    expect(state.selectedCellId).toBe("celda-1");
    expect(state.hoveredCellId).toBe("celda-2");
  });

  it("no guarda datos de la API, solo identificadores", () => {
    // Meter las 400 celdas en el store lo convertiría en una caché que nadie
    // invalida. Los datos bajan por props desde la página.
    const state = useCeresStore.getState() as unknown as Record<string, unknown>;
    const keys = Object.keys(state).filter((key) => typeof state[key] !== "function");

    expect(keys.sort()).toEqual([
      "hoveredCellId",
      "selectedCellId",
      "selectedCropCycleId",
      "selectedFarmId",
      "selectedPlotId",
      "viewMode",
    ]);
  });
});
