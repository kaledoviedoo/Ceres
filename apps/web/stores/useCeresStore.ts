/**
 * Estado global de INTERFAZ.
 *
 * Solo lo que describe qué está mirando el usuario: qué finca, qué lote, qué
 * ciclo, qué celda tiene seleccionada y en qué modo de vista está.
 *
 * Lo que NO vive aquí, deliberadamente: las celdas, las predicciones, ninguna
 * respuesta de la API. Meter la base de datos en Zustand la convierte en una
 * caché que nadie invalida. Los datos los pide la página y bajan por props.
 *
 * Esta separación es lo que permitirá sustituir el grid 2D por React Three
 * Fiber en la fase 7 sin tocar nada de aquí: la escena 3D leerá y escribirá el
 * mismo `selectedCellId` que lee y escribe el grid actual.
 */

import { create } from "zustand";

import type { ViewMode } from "@/lib/presentation/risk";

interface CeresUiState {
  selectedFarmId: string | null;
  selectedPlotId: string | null;
  selectedCropCycleId: string | null;
  /** Celda abierta en el panel lateral. */
  selectedCellId: string | null;
  /** Celda bajo el cursor. Se separa de la selección para no repintar el panel. */
  hoveredCellId: string | null;
  viewMode: ViewMode;

  selectFarm: (farmId: string | null) => void;
  selectPlot: (plotId: string | null) => void;
  selectCropCycle: (cropCycleId: string | null) => void;
  selectCell: (cellId: string | null) => void;
  hoverCell: (cellId: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  clearSelection: () => void;
}

export const useCeresStore = create<CeresUiState>((set) => ({
  selectedFarmId: null,
  selectedPlotId: null,
  selectedCropCycleId: null,
  selectedCellId: null,
  hoveredCellId: null,
  viewMode: "risk",

  // Cambiar de finca invalida todo lo que colgaba de ella. Si no se limpiara,
  // el panel seguiría mostrando una celda de la finca anterior.
  selectFarm: (farmId) =>
    set({
      selectedFarmId: farmId,
      selectedPlotId: null,
      selectedCropCycleId: null,
      selectedCellId: null,
      hoveredCellId: null,
    }),

  selectPlot: (plotId) =>
    set({
      selectedPlotId: plotId,
      selectedCropCycleId: null,
      selectedCellId: null,
      hoveredCellId: null,
    }),

  selectCropCycle: (cropCycleId) => set({ selectedCropCycleId: cropCycleId }),

  selectCell: (cellId) => set({ selectedCellId: cellId }),

  hoverCell: (cellId) => set({ hoveredCellId: cellId }),

  setViewMode: (viewMode) => set({ viewMode }),

  clearSelection: () => set({ selectedCellId: null, hoveredCellId: null }),
}));
