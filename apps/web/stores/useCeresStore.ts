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

import { DEFAULT_LAYER_ID, type LayerId } from "@/lib/terrain/layers";

/** Cómo se PROYECTA el terreno. Relieve (3D) o planta (2D). */
export type TerrainMode = "3d" | "2d";

interface CeresUiState {
  selectedFarmId: string | null;
  selectedPlotId: string | null;
  selectedCropCycleId: string | null;
  /**
   * Celda abierta en el panel lateral.
   *
   * Vive FUERA de la capa activa y del modo de proyección a propósito: la celda
   * A-00133 es la misma celda se mire con la capa que se mire. Cambiar de capa
   * cambia lo que se ve encima del terreno, nunca qué celda se está leyendo.
   */
  selectedCellId: string | null;
  /**
   * DE QUÉ MOMENTO se está mirando el lote, en ISO-8601.
   *
   * Es lo único que hace falta guardar del eje temporal: baja como `as_of` a
   * `GET /plots/{id}/overview` y todo lo que depende del tiempo —mapa, riesgo
   * por celda, resumen del pie, panel de reparto, inspector— cuelga de esa
   * respuesta. No hay una segunda copia del estado temporal en ninguna parte.
   *
   * `null` significa estado BASE, sin observaciones. Es lo que se sirve cuando
   * el lote no tiene ningún momento del que hablar.
   *
   * Guarda el VALOR y no un índice: los instantes son distintos en cada lote
   * —t0 de papa es el 14 de abril y el de maíz el 10 de mayo—, así que un
   * índice heredado apuntaría a otra fecha sin avisar.
   */
  selectedAsOf: string | null;
  /** Qué capa analítica se proyecta sobre el terreno. */
  activeLayerId: LayerId;
  /** Proyección del terreno: relieve 3D o malla plana. */
  terrainMode: TerrainMode;

  selectFarm: (farmId: string | null) => void;
  selectPlot: (plotId: string | null) => void;
  selectCropCycle: (cropCycleId: string | null) => void;
  selectCell: (cellId: string | null) => void;
  selectAsOf: (asOf: string | null) => void;
  setActiveLayer: (id: LayerId) => void;
  setTerrainMode: (mode: TerrainMode) => void;
  clearSelection: () => void;
}

export const useCeresStore = create<CeresUiState>((set) => ({
  selectedFarmId: null,
  selectedPlotId: null,
  selectedCropCycleId: null,
  selectedCellId: null,
  selectedAsOf: null,
  activeLayerId: DEFAULT_LAYER_ID,
  terrainMode: "3d",

  // Cambiar de finca invalida todo lo que colgaba de ella. Si no se limpiara,
  // el panel seguiría mostrando una celda de la finca anterior.
  //
  // `selectedAsOf` se limpia con lo demás, y no por simetría: los instantes son
  // propios de cada ciclo. Arrastrar el 13 de agosto de la papa al maíz —cuyo
  // t2 es el 8 de septiembre— pediría un mapa de una fecha que ese lote no
  // tiene, y saldría un estado real pero que no corresponde a ningún momento
  // del escenario. La página vuelve a elegir el momento del lote nuevo.
  selectFarm: (farmId) =>
    set({
      selectedFarmId: farmId,
      selectedPlotId: null,
      selectedCropCycleId: null,
      selectedCellId: null,
      selectedAsOf: null,
    }),

  selectPlot: (plotId) =>
    set({
      selectedPlotId: plotId,
      selectedCropCycleId: null,
      selectedCellId: null,
      selectedAsOf: null,
    }),

  // El ciclo también: dos ciclos del mismo lote son dos temporadas distintas y
  // no comparten instantes.
  selectCropCycle: (cropCycleId) =>
    set({ selectedCropCycleId: cropCycleId, selectedAsOf: null }),

  selectCell: (cellId) => set({ selectedCellId: cellId }),

  // Mover el tiempo NO cierra la celda abierta: es la misma celda vista en otro
  // momento, y cerrarla obligaría a volver a buscarla para comparar, que es
  // justo lo que el control existe para permitir.
  selectAsOf: (asOf) => set({ selectedAsOf: asOf }),

  // Cambiar de capa NO toca `selectedCellId`. Es la garantía de que la celda
  // abierta sobrevive a cualquier cambio de representación.
  setActiveLayer: (activeLayerId) => set({ activeLayerId }),

  setTerrainMode: (terrainMode) => set({ terrainMode }),

  clearSelection: () => set({ selectedCellId: null }),
}));
