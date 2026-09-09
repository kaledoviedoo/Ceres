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
  /**
   * A qué esquina se refiere el origen. Lo declara la API.
   *
   * Suponer el centro en vez de la esquina desplaza el lote medio lote sin dar
   * ningún error: los números siguen siendo grados válidos.
   */
  origin_corner?: string;
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

/**
 * Vocabulario CERRADO de procedencia. El mismo que declara la API.
 *
 * `unknown` es el valor por defecto en las dos puntas: callar produce "no lo
 * sé", nunca "lo medí".
 */
export type ProvenanceKind =
  | "measured"
  | "derived"
  | "estimated"
  | "synthetic"
  | "unknown";

/** De dónde salen los campos de una celda. Va por lote: es propiedad de la fuente. */
export interface CellProvenance {
  dataset: {
    kind: ProvenanceKind;
    /** Módulo que generó los datos, si los generó alguno. */
    generator: string | null;
    note: string;
    /**
     * Qué representa la malla, en una frase citable.
     *
     * Existe porque 40.000 celdas de 1 m² se leen solas como «tenemos
     * información de cada metro cuadrado», y no es cierto: la resolución
     * nominal es de 1 m y la efectiva, de decenas. Las dos cifras ya viajaban
     * en `elevation`; esto dice en voz alta lo que su diferencia significa.
     */
    representation: string;
  };
  elevation: {
    kind: ProvenanceKind;
    field_name: string;
    units: string;
    /** Separación entre muestras almacenadas. */
    nominal_resolution_m: number;
    /** A qué escala varía el campo de verdad. `null` si nadie lo ha medido. */
    effective_resolution_m: number | null;
    vertical_datum: string;
    method: string | null;
  };
  slope: {
    kind: ProvenanceKind;
    field_name: string;
    units: string;
    derived_from: string[];
    method: string | null;
  };
  agronomic: {
    kind: ProvenanceKind;
    field_names: string[];
    method: string | null;
  };
}

export interface CellCollection {
  plot_id: string;
  grid_width: number;
  grid_height: number;
  cell_size_m: number;
  /**
   * Opcional en el TIPO, obligatorio en el contrato.
   *
   * La API la sirve siempre. Se declara opcional porque el cliente no valida en
   * runtime: un backend antiguo devolvería la respuesta sin el bloque y el
   * `as T` la aceptaría igual. Marcarla opcional obliga a decidir qué hacer con
   * su ausencia en vez de leer `undefined` y pintarlo.
   */
  provenance?: CellProvenance;
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

/** Un instante del que CERES ya ha hablado sobre un lote. */
export interface TimelineMoment {
  /** ISO-8601 con zona. Es el valor que se le pasa a `overview`. */
  as_of: string;
  prediction_count: number;
}

/**
 * Respuesta de `GET /plots/{id}/timeline`.
 *
 * `moments` NO es una lista de fechas escrita en el frontend: son los `as_of`
 * distintos que existen en `predictions`. Es la única fuente correcta, porque
 * los instantes del escenario no se pueden deducir del ciclo — para el lote de
 * papa t0 es siembra + 30 días y t2 es cosecha − 7, así que ni `planted_at` ni
 * `expected_harvest_at` sirven como momento.
 *
 * Vacío cuando el lote no tiene predicciones, y entonces no hay eje temporal
 * que ofrecer. Es el caso de la finca demo.
 */
export interface PlotTimeline {
  plot_id: string;
  crop_cycle_id: string;
  /** Del ciclo, para situar cada momento. Nunca se usan COMO momento. */
  planted_at: string | null;
  expected_harvest_at: string | null;
  moments: TimelineMoment[];
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
  /**
   * De qué momento habla la predicción que se guarda.
   *
   * Se manda el mismo instante que está pintando el mapa. Sin él la API usa
   * "ahora", y entonces lo guardado no corresponde a lo que el usuario tenía
   * delante al pulsar: vería 3,84 kg en el inspector y quedaría escrita otra
   * cifra, calculada sobre el estado de hoy.
   */
  as_of?: string;
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
  /**
   * Las entradas exactas con las que se ejecutó el motor.
   *
   * Es lo que hace legible una serie: dos predicciones de la misma celda pueden
   * diferir porque cambió el modelo o porque cambió el terreno, y `factors` sola
   * no distingue los dos casos —son multiplicadores ya aplicados—.
   *
   * Diccionario abierto a propósito: describe la entrada de UNA versión del
   * motor, y esa forma cambia cuando cambia el modelo.
   */
  inputs: Record<string, number | string>;
  /**
   * De qué momento del estado agronómico habla.
   *
   * NO es `created_at`, que dice cuándo se ejecutó. Dos predicciones lanzadas
   * hoy sobre el estado de marzo y el de mayo tienen el mismo `created_at` y
   * `as_of` distintos; ordenar una serie por `created_at` mezclaría el orden de
   * ejecución con el orden de los hechos.
   */
  as_of: string | null;
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
  /** Quién la registró. Distingue un dato levantado en campo de uno cargado. */
  created_by: string | null;
  /**
   * De dónde sale la observación.
   *
   * Solo `measured` modifica el estado derivado de una celda. Las 24 del dataset
   * son `synthetic`: su severidad es `health_factor` recodificado, así que
   * aplicarlas sería usar la sanidad como prueba de que la sanidad bajó.
   */
  source_kind: ProvenanceKind;
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
  /** Quién registró la cosecha. Mismo motivo que en las observaciones. */
  created_by: string | null;
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
