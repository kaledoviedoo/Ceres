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
 * Tampoco vive aquí el HOVER. En 2D costaba 0,01 ms porque el `memo` de
 * `CellSquare` lo absorbía, pero en 3D `pointermove` dispara decenas de veces
 * por segundo: pasarlo por el store provocaría un render de React y una
 * reconciliación de la escena por evento. Cada vista lo gestiona por dentro
 * —`CellGrid` con estado local, `TerrainCanvas` con referencias— porque a nadie
 * fuera de la vista le interesa qué celda toca el cursor.
 *
 * Esa separación es lo que permitió sustituir el grid 2D por React Three Fiber
 * sin tocar nada de aquí: la escena 3D lee y escribe el mismo `selectedCellId`
 * que leía y escribía el grid.
 */

import { create } from "zustand";

import type { ViewMode } from "@/lib/presentation/risk";

/** Cómo se representa el terreno. El 3D es la vista principal. */
export type TerrainMode = "3d" | "2d";

/**
 * Como se pinta la superficie del terreno.
 *
 *   lindo  cesped uniforme con surcos. El color NO codifica nada: sirve para
 *          entender la forma del campo y para enseñarselo a quien no es agronomo.
 *   pro    una celda, un color plano, borde duro. Sirve para trabajar.
 *
 * Son dos preguntas distintas —"como es el campo" y "que dice el motor"— y por
 * eso son un conmutador y no dos entradas de la misma lista.
 */
export type SurfaceStyle = "lindo" | "pro";

interface CeresUiState {
  selectedFarmId: string | null;
  selectedPlotId: string | null;
  selectedCropCycleId: string | null;
  /** Celda abierta en el panel lateral. */
  selectedCellId: string | null;
  /** Qué métrica colorea el terreno. */
  viewMode: ViewMode;
  /** Representación del terreno: relieve 3D o malla plana. */
  terrainMode: TerrainMode;
  surfaceStyle: SurfaceStyle;

  selectFarm: (farmId: string | null) => void;
  selectPlot: (plotId: string | null) => void;
  selectCropCycle: (cropCycleId: string | null) => void;
  selectCell: (cellId: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setTerrainMode: (mode: TerrainMode) => void;
  setSurfaceStyle: (style: SurfaceStyle) => void;
  clearSelection: () => void;
}

export const useCeresStore = create<CeresUiState>((set) => ({
  selectedFarmId: null,
  selectedPlotId: null,
  selectedCropCycleId: null,
  selectedCellId: null,
  viewMode: "risk",
  terrainMode: "3d",
  // Se entra por la vista de trabajo: CERES es una herramienta de analisis.
  surfaceStyle: "pro",

  // Cambiar de finca invalida todo lo que colgaba de ella. Si no se limpiara,
  // el panel seguiría mostrando una celda de la finca anterior.
  selectFarm: (farmId) =>
    set({
      selectedFarmId: farmId,
      selectedPlotId: null,
      selectedCropCycleId: null,
      selectedCellId: null,
    }),

  selectPlot: (plotId) =>
    set({
      selectedPlotId: plotId,
      selectedCropCycleId: null,
      selectedCellId: null,
    }),

  selectCropCycle: (cropCycleId) => set({ selectedCropCycleId: cropCycleId }),

  selectCell: (cellId) => set({ selectedCellId: cellId }),

  setViewMode: (viewMode) => set({ viewMode }),

  setTerrainMode: (terrainMode) => set({ terrainMode }),

  setSurfaceStyle: (surfaceStyle) => set({ surfaceStyle }),

  clearSelection: () => set({ selectedCellId: null }),
}));
