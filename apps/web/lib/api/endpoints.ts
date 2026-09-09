/**
 * Los endpoints de CERES, uno por funcion.
 *
 * Que cada ruta aparezca exactamente una vez es lo que permite cambiar la API
 * sin buscar strings por todo el proyecto. Los componentes importan de aqui,
 * nunca construyen rutas.
 */

import { apiClient } from "@/lib/api/client";
import type {
  CellCollection,
  CellDetail,
  CellPerformance,
  CropCycle,
  FarmDetail,
  Farm,
  HealthStatus,
  Harvest,
  Observation,
  Plot,
  PlotOverview,
  PlotTimeline,
  Prediction,
  PredictionList,
  PredictionRequest,
} from "@/lib/types/api";

export const ceresApi = {
  health: (signal?: AbortSignal) => apiClient.get<HealthStatus>("/api/v1/health", undefined, signal),

  listFarms: (signal?: AbortSignal) => apiClient.get<Farm[]>("/api/v1/farms", undefined, signal),

  /** Finca con sus lotes: puebla el selector finca -> lote de una sola vez. */
  getFarm: (farmId: string, signal?: AbortSignal) =>
    apiClient.get<FarmDetail>(`/api/v1/farms/${farmId}`, undefined, signal),

  getPlot: (plotId: string, signal?: AbortSignal) =>
    apiClient.get<Plot>(`/api/v1/plots/${plotId}`, undefined, signal),

  /** Las 400 celdas de una vez. Nunca una petición por celda. */
  listCells: (plotId: string, signal?: AbortSignal) =>
    apiClient.get<CellCollection>(`/api/v1/plots/${plotId}/cells`, undefined, signal),

  /** Ciclos del lote. Hace falta para poder pedir una predicción. */
  listCropCycles: (plotId: string, signal?: AbortSignal) =>
    apiClient.get<CropCycle[]>(`/api/v1/plots/${plotId}/crop-cycles`, undefined, signal),

  /**
   * Riesgo y rendimiento de las 400 celdas, para colorear la malla.
   *
   * No persiste nada: son métricas calculadas al vuelo. Guardar una predicción
   * sigue siendo cosa de `createPrediction`, al hacer click en una celda.
   */
  /**
   * De qué momentos puede el mapa enseñar el estado de este lote.
   *
   * Los devuelve la API leyendo `predictions.as_of`. El frontend no construye
   * ninguna fecha: pasa tal cual el `as_of` que elija el usuario.
   */
  getPlotTimeline: (plotId: string, cropCycleId: string, signal?: AbortSignal) =>
    apiClient.get<PlotTimeline>(
      `/api/v1/plots/${plotId}/timeline`,
      { crop_cycle_id: cropCycleId },
      signal,
    ),

  /**
   * Métricas del motor para colorear la malla.
   *
   * `asOf` decide de qué momento se pinta el mapa. Sin él se usa el estado
   * base, sin observaciones — que es lo que hacía que una finca con miles de
   * observaciones fechadas saliera entera del mismo color.
   */
  getPlotOverview: (
    plotId: string,
    cropCycleId: string,
    asOf?: string | null,
    signal?: AbortSignal,
  ) =>
    apiClient.get<PlotOverview>(
      `/api/v1/plots/${plotId}/overview`,
      asOf ? { crop_cycle_id: cropCycleId, as_of: asOf } : { crop_cycle_id: cropCycleId },
      signal,
    ),

  getCell: (cellId: string, signal?: AbortSignal) =>
    apiClient.get<CellDetail>(`/api/v1/cells/${cellId}`, undefined, signal),

  /**
   * Ejecuta el motor y guarda una predicción NUEVA.
   *
   * Solo se envían identificadores: el servidor es la fuente de verdad de
   * cualquier valor agronómico.
   */
  createPrediction: (payload: PredictionRequest, signal?: AbortSignal) =>
    apiClient.post<Prediction>("/api/v1/predictions", payload, signal),

  /**
   * Predicción vs cosecha real de una celda.
   *
   * `asOf` deja solo la predicción que habla de ese instante. FILTRA, no
   * recalcula: este endpoint cuenta lo que CERES dijo aquel día, y eso es un
   * hecho histórico. Sin `asOf` devuelve el historial completo.
   */
  getCellPerformance: (
    cellId: string,
    cropCycleId: string,
    asOf?: string | null,
    signal?: AbortSignal,
  ) =>
    apiClient.get<CellPerformance>(
      `/api/v1/cells/${cellId}/performance`,
      asOf ? { crop_cycle_id: cropCycleId, as_of: asOf } : { crop_cycle_id: cropCycleId },
      signal,
    ),

  /** Historial completo, más reciente primero. */
  listPredictions: (cellId: string, signal?: AbortSignal) =>
    apiClient.get<PredictionList>(`/api/v1/cells/${cellId}/predictions`, undefined, signal),

  listObservations: (cellId: string, signal?: AbortSignal) =>
    apiClient.get<Observation[]>(`/api/v1/cells/${cellId}/observations`, undefined, signal),

  listHarvests: (cellId: string, signal?: AbortSignal) =>
    apiClient.get<Harvest[]>(`/api/v1/cells/${cellId}/harvests`, undefined, signal),
};
