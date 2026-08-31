/**
 * Tipos del contrato de la API de CERES.
 *
 * Derivados uno a uno de los schemas Pydantic de `apps/api/app/schemas/`. La
 * fuente de verdad es el backend: si un campo cambia alli, cambia aqui.
 *
 * IMPORTANTE: aqui no hay ni una formula agricola. El frontend recibe
 * `projected_yield_kg` y `risk_level` ya calculados y solo los representa. Si
 * alguna vez aparece un `const yield = ...` en TypeScript, algo se hizo mal.
 */

/** Nivel de riesgo cualitativo. Los umbrales viven en `app/domain/units.py`. */
export type RiskLevel = "low" | "medium" | "high";

/** Tipos de observacion de campo. CHECK constraint en `observations.type`. */
export type ObservationType =
  | "pest"
  | "disease"
  | "water_stress"
  | "physical_damage"
  | "other";

export type CropCycleStatus = "planned" | "active" | "harvested" | "closed";

// --- Finca y lote ------------------------------------------------------------

export interface Farm {
  id: string;
  organization_id: string;
  name: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  region: string | null;
  latitude: number;
  longitude: number;
  created_at: string;
}

export interface Plot {
  id: string;
  farm_id: string;
  name: string;
  /** Prefijo del cell_code: "A" -> "A-00001". */
  code: string;
  grid_width: number;
  grid_height: number;
  /** Lado de la celda en metros. 1.0 en el MVP. */
  cell_size_m: number;
  origin_latitude: number;
  origin_longitude: number;
  created_at: string;
  cell_count: number;
  area_m2: number;
}

export interface FarmDetail extends Farm {
  plots: Plot[];
}

// --- Cultivo y ciclo ---------------------------------------------------------

export interface Crop {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  variety: string | null;
  box_capacity_kg: number;
  base_yield_kg_per_m2: number;
  optimal_plant_density_per_m2: number;
  cycle_days: number | null;
  created_at: string;
}

export interface CropCycle {
  id: string;
  plot_id: string;
  crop_id: string;
  name: string;
  slug: string;
  status: CropCycleStatus;
  planted_at: string | null;
  expected_harvest_at: string | null;
  created_at: string;
  crop: Crop;
}

// --- Celdas ------------------------------------------------------------------

/**
 * Carga ligera de una celda: es lo que se multiplica por 400.
 *
 * Solo trae el ESTADO del terreno. El riesgo y el rendimiento no estan aqui
 * porque no son estado, son resultado del motor: llegan por `PlotOverview`.
 */
export interface CellSummary {
  id: string;
  cell_code: string;
  /** 0 = oeste. */
  x: number;
  /** 0 = sur. */
  y: number;
  elevation_m: number;
  slope_deg: number;
  /** 0 pobre .. 1 optimo. */
  soil_quality: number;
  /** Plantas por m2. */
  plant_density: number;
  /** 0 muerto .. 1 sano. */
  health_factor: number;
  base_yield_factor: number;
}

export interface CellDetail extends CellSummary {
  plot_id: string;
  centroid_latitude: number;
  centroid_longitude: number;
  created_at: string;
}

export interface CellCollection {
  plot_id: string;
  grid_width: number;
  grid_height: number;
  cell_size_m: number;
  cells: CellSummary[];
}

// --- Vista general del lote --------------------------------------------------

/**
 * Metricas de una celda para pintarla.
 *
 * NO es una prediccion guardada: no tiene `id` ni `created_at` porque no existe
 * en la tabla `predictions`. Es el resultado de ejecutar el motor al vuelo.
 */
export interface CellOverview {
  cell_id: string;
  cell_code: string;
  x: number;
  y: number;
  projected_yield_kg: number;
  projected_boxes: number;
  estimated_loss_percentage: number;
  risk_score: number;
  risk_level: RiskLevel;
}

export interface PlotOverview {
  plot_id: string;
  crop_cycle_id: string;
  grid_width: number;
  grid_height: number;
  cell_size_m: number;
  model_version: string;
  /** Siempre false: estos numeros no estan guardados en la base de datos. */
  persisted: boolean;
  cells: CellOverview[];
}

// --- Predicciones ------------------------------------------------------------

/**
 * Los cinco multiplicadores que explican el resultado. 1.0 = neutro.
 *
 * `density_factor` y `health_factor` pueden ser 0 (celda sin sembrar, cultivo
 * muerto); los otros tres son estructuralmente positivos.
 */
export interface PredictionFactors {
  density_factor: number;
  soil_factor: number;
  health_factor: number;
  terrain_factor: number;
  base_yield_factor: number;
}

/**
 * Cuerpo de `POST /predictions`.
 *
 * Solo identificadores. El servidor lee la celda y el ciclo de la base de datos
 * y ejecuta el motor: el schema declara `extra="forbid"`, asi que enviar
 * `soil_quality` o `projected_yield_kg` devuelve 422.
 */
export interface PredictionRequest {
  cell_id: string;
  crop_cycle_id: string;
}

/** Prediccion persistida. Inmutable: no existe PUT ni DELETE. */
export interface Prediction {
  id: string;
  cell_id: string;
  crop_cycle_id: string;
  model_version: string;
  projected_yield_kg: number;
  projected_yield_tons: number;
  projected_boxes: number;
  estimated_loss_percentage: number;
  risk_score: number;
  risk_level: RiskLevel;
  factors: PredictionFactors;
  created_at: string;
}

export interface PredictionList {
  cell_id: string;
  predictions: Prediction[];
}

// --- Observaciones y cosechas ------------------------------------------------

export interface Observation {
  id: string;
  cell_id: string;
  crop_cycle_id: string | null;
  type: ObservationType;
  /** 0 irrelevante .. 1 critico. */
  severity: number;
  description: string | null;
  observed_at: string;
  created_at: string;
}

export interface Harvest {
  id: string;
  cell_id: string;
  crop_cycle_id: string;
  actual_yield_kg: number;
  actual_yield_tons: number;
  actual_boxes: number;
  harvested_at: string;
  notes: string | null;
  created_at: string;
}

// --- Salud del servicio ------------------------------------------------------

export interface HealthStatus {
  status: string;
  version: string;
  model_version: string;
  database: string;
  disclaimer: string;
}
