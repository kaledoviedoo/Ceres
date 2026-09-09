/**
 * EL CATALOGO DE CAPAS.
 *
 *                          CERES
 *                            │
 *                    ┌───────┴───────┐
 *                    ↓               ↓
 *                ELEVACION        ANALISIS
 *                    │               │
 *                    ↓               ↓
 *             TerrainGeometry    AnalysisLayers
 *                    └───────┬───────┘
 *                            ↓
 *                      Visualizacion
 *
 * Una capa decide QUE SE VE ENCIMA del terreno. Nunca qué forma tiene el
 * terreno.
 *
 * LA GARANTIA ESTA EN LA FIRMA, no en la disciplina
 * ────────────────────────────────────────────────
 * `paint` recibe celdas y las dimensiones de la malla:
 *
 *     paint(cells, gridWidth, gridHeight): LayerPaint
 *
 * No recibe un `ElevationField`, que es el único objeto capaz de producir
 * geometría, y devuelve colores y polilíneas en coordenadas de malla —sin
 * altura—. No existe ninguna vía por la que activar una capa pueda mover un
 * vértice, cambiar una normal o alterar la escala física del terreno. Igual que
 * en `elevation.ts` la geometría solo acepta elevación, aquí el análisis solo
 * produce representación.
 *
 * Que la capa de terreno lea `elevation_m` de la celda no rompe la regla: lee un
 * número para elegir un color, no un campo capaz de construir una malla. La
 * forma del relieve sigue saliendo únicamente de `ElevationField`.
 *
 * LAS CAPAS SIN FUENTE NO PUEDEN INVENTAR NADA
 * ────────────────────────────────────────────
 * Una capa pendiente no tiene un `paint` que devuelva ceros ni ruido: NO TIENE
 * `paint`. El tipo se lo impide, así que la única forma de darle datos es
 * conectarle una fuente real. Declara qué le falta, y eso es todo lo que dice.
 */

import {
  formatIndex,
  formatKg,
  formatMeters,
  formatPercent,
  formatScore,
} from "@/lib/presentation/format";
import { rampColor, type RampDirection } from "@/lib/presentation/risk";
import { RISK_COLORS } from "@/lib/presentation/risk";
import { cellsRgb, zoneContour } from "@/lib/terrain/analysis";
import {
  histogram,
  overlap,
  summarize,
  type Bin,
  type Overlap,
  type Summary,
} from "@/lib/terrain/statistics";
import type { TerrainCell } from "@/lib/terrain/types";
import type { RiskLevel } from "@/lib/types/api";

// --- Lo que una capa produce -------------------------------------------------

export interface LayerPaint {
  /**
   * Un RGB por celda, en orden de fila y con la fila 0 al SUR. Es lo que tiñe la
   * superficie en relieve y el cuadro en planta.
   */
  rgb: Uint8ClampedArray;
  /**
   * Fronteras que la capa quiere anotar, en coordenadas CONTINUAS DE MALLA.
   * Sin altura: proyectarlas sobre el relieve es trabajo de quien dibuja.
   */
  zones: [number, number][];
}

/**
 * Cómo se resuelve la superficie en la vista de relieve.
 *
 *   terrain  la superficie muestra su propio material —césped, surcos— y el
 *            relieve se lee por la luz de la escena. El `rgb` de la capa se usa
 *            solo en planta, donde no hay luz que revele nada.
 *   overlay  el tinte del dato se compone sobre el sombreado de relieve.
 */
export type SurfaceKind = "terrain" | "overlay";

export type LayerId = "terrain" | "risk" | "yield" | "loss" | "slope" | "soil" | "health";

interface LayerCommon {
  id: LayerId;
  label: string;
  hint: string;
}

export interface AvailableLayer extends LayerCommon {
  available: true;
  /** De qué dato real sale. Se muestra al usuario, no es documentación interna. */
  source: string;

  /*
   * LA FICHA DE LA CAPA.
   *
   * Seis preguntas que cualquiera debería poder contestar antes de tomar una
   * decisión mirando un mapa de colores: qué pregunta responde, de dónde sale
   * el número, en qué unidad está, qué significa cada extremo, contra qué se
   * compara y qué NO se puede concluir de él.
   *
   * Están en el catálogo y no en un documento aparte porque un documento se
   * queda viejo en silencio: aquí, añadir una capa obliga a contestarlas —el
   * tipo no compila si falta una— y la interfaz puede leerlas.
   */

  /** Qué pregunta del usuario responde. En sus palabras, no en las del modelo. */
  question: string;
  /** Unidad del valor. Vacío cuando es un índice sin dimensión. */
  unit: string;
  /** Qué significa cada extremo de la escala. */
  reads: { low: string; high: string };
  /**
   * Contra qué se compara el COLOR.
   *
   *   plot    la rampa recorre el mínimo y el máximo de este lote. Dos lotes
   *           distintos con el mismo color no tienen el mismo valor.
   *   engine  el color sale de una clasificación del motor, igual en todos los
   *           lotes.
   */
  scale: "plot" | "engine";
  /**
   * De dónde sale el número.
   *
   *   stored  llega tal cual en la ficha de la celda: es una ENTRADA del modelo.
   *   engine  lo calcula el motor a partir de esas entradas: es DERIVADO.
   */
  origin: "stored" | "engine";
  /**
   * Qué no se puede concluir de esta capa. `null` si no hay trampa.
   *
   * Existe por una razón concreta y comprobada en el backend: el motor calcula
   * el riesgo a partir de la sanidad, el suelo y la pendiente
   * —`app/core/prediction/risk.py`, pesos 0,45 / 0,30 / 0,25—, y la pérdida y el
   * rendimiento salen de esos mismos tres campos. Así que la coincidencia entre
   * CUALQUIERA de estas capas y la zona de riesgo alto no es un hallazgo: es la
   * fórmula, vista desde el mapa.
   *
   * Los pesos no se escriben en el texto a propósito. Cambiarlos en el backend
   * dejaría mintiendo a una cifra copiada aquí; lo que sí se mantiene cierto
   * mientras la fórmula use esos campos es la relación, y eso es lo que se dice.
   */
  caution: string | null;

  surface: SurfaceKind;
  /**
   * Color de una celda dentro del recorrido REAL del lote.
   *
   * Una sola función para las dos proyecciones: el relieve la usa para componer
   * la textura y la planta para pintar cada cuadro. Antes cada vista llegaba al
   * color por su lado y había que enseñarle a las dos qué campo pinta una capa
   * nueva.
   *
   * `span` son el mínimo y el máximo de `valueOf` sobre las 400 celdas. La
   * escala sale del propio lote: no hay ningún umbral agronómico.
   */
  colorOf(cell: TerrainCell, span: Span): string;
  /**
   * Si además de color lleva TRAMA.
   *
   * Solo los niveles discretos del riesgo. Verde, ámbar y rojo son justo los
   * tonos que confunde un daltonismo rojo-verde, así que el nivel no puede
   * comunicarse solo con el tono. Una rampa continua no se trama: la trama
   * marcaría escalones donde el dato no los tiene.
   */
  patterned: boolean;
  /** Orientación de la rampa, o `null` si la capa no usa una. Para leyendas. */
  ramp: RampDirection | null;
  /**
   * Nivel cuya REGION anota la capa, o `null` si no anota ninguna.
   *
   * Lo declara la capa y no cada vista: en relieve la frontera es una polilínea
   * y en planta son bordes por celda, pero es la MISMA frontera. Cuando esto
   * vivía suelto en cada vista, la planta seguía perfilando la zona de riesgo
   * con la capa de terreno activa y el relieve no.
   */
  zone: RiskLevel | null;

  /**
   * El valor de esta capa para una celda. Es lo que la hace MEDIBLE.
   *
   * Con esto, la distribución, el percentil y la comparación funcionan para
   * cualquier capa sin conocerla: añadir una capa nueva no obliga a tocar el
   * panel de distribución ni el inspector.
   */
  valueOf(cell: TerrainCell): number;
  /** Cómo se escribe ese valor, con su unidad. */
  format(value: number): string;
  /**
   * Qué extremo de la métrica es el notable, o `null` si ninguno lo es.
   *
   * En rendimiento interesa el que menos rinde; en pérdida, el que más pierde.
   * La elevación no tiene un extremo "malo": alto no es peor que bajo.
   */
  extremeTail: "low" | "high" | null;
  /**
   * Si compararla con la región de riesgo dice algo.
   *
   * `false` en la propia capa de riesgo: contrastar el riesgo contra la región
   * que define el riesgo es circular y no informa de nada.
   */
  comparable: boolean;

  paint(cells: TerrainCell[], gridWidth: number, gridHeight: number): LayerPaint;
}

export interface PendingLayer extends LayerCommon {
  available: false;
  /**
   * Por qué todavía no es una capa. Comprobado contra la API, no supuesto.
   *
   * No siempre es que falte el dato: `soil_quality` y `health_factor` llegan
   * completos en las 400 celdas. Lo que falta ahí es decidir su escala y
   * llevarlos al join del terreno. Decir "sin fuente de datos" de un campo que
   * la API devuelve sería falso.
   */
  missing: string;
}

export type AnalysisLayer = AvailableLayer | PendingLayer;

// --- Tinte del terreno -------------------------------------------------------

/**
 * Rampa acromática para la elevación.
 *
 * Deliberadamente sin tono: verde, ámbar y rojo son el vocabulario del análisis
 * en esta interfaz, y una elevación pintada con esos colores se leería como un
 * nivel de riesgo. Del pardo oscuro al hueso, que es como se sombrea una carta.
 */
const TERRAIN_LOW = [42, 39, 34] as const;
const TERRAIN_HIGH = [212, 206, 194] as const;

/** La rampa de elevación en CSS, para dibujar la leyenda sin repetir los tonos. */
export const TERRAIN_RAMP_CSS =
  `linear-gradient(to right, rgb(${TERRAIN_LOW.join(", ")}), rgb(${TERRAIN_HIGH.join(", ")}))`;

/** Recorrido de una métrica en el lote. Normaliza cualquier rampa. */
export interface Span {
  min: number;
  max: number;
}

function spanOf(cells: TerrainCell[], valueOf: (cell: TerrainCell) => number): Span {
  if (cells.length === 0) return { min: 0, max: 1 };
  let min = Infinity;
  let max = -Infinity;
  for (const cell of cells) {
    const v = valueOf(cell);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/** Recorrido de la capa activa sobre el lote. Lo usa la vista en planta. */
export function valueSpan(layer: AvailableLayer, cells: TerrainCell[]): Span {
  return spanOf(cells, (cell) => layer.valueOf(cell));
}

/** Color de una altura dentro del recorrido del lote, en CSS. */
export function elevationTint(meters: number, span: Span): string {
  const range = span.max - span.min;
  // Un lote perfectamente plano no tiene gradiente que mostrar: tono medio.
  const t = range === 0 ? 0.5 : Math.min(1, Math.max(0, (meters - span.min) / range));
  const channel = (i: number) =>
    Math.round(TERRAIN_LOW[i]! + (TERRAIN_HIGH[i]! - TERRAIN_LOW[i]!) * t);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

// --- El catálogo -------------------------------------------------------------

interface MetricConfig {
  id: LayerId;
  label: string;
  hint: string;
  source: string;
  question: string;
  unit: string;
  reads: { low: string; high: string };
  origin: "stored" | "engine";
  caution: string | null;
  valueOf: (cell: TerrainCell) => number;
  format: (value: number) => string;
  /** Hacia dónde es mejor. Decide la orientación de la rampa. */
  ramp: RampDirection;
  extremeTail: "low" | "high";
  zone: RiskLevel | null;
  comparable?: boolean;
}

/**
 * Una capa continua sobre una métrica del lote.
 *
 * La escala se normaliza con el mínimo y el máximo REALES de las 400 celdas, así
 * que ninguna capa introduce un umbral: solo dice dónde cae cada celda entre la
 * peor y la mejor de su propio lote. El motor ya decidió los valores; esto solo
 * elige el color con el que se dibujan.
 */
function metricLayer(config: MetricConfig): AvailableLayer {
  const { valueOf, ramp } = config;

  const colorOf = (cell: TerrainCell, span: Span): string => {
    const range = span.max - span.min;
    // Un lote sin variación no tiene rampa que recorrer: tono central. Estirarlo
    // pintaría diferencias donde el dato no tiene ninguna.
    const t = range === 0 ? 0.5 : (valueOf(cell) - span.min) / range;
    return rampColor(Math.min(1, Math.max(0, t)), ramp);
  };

  return {
    id: config.id,
    label: config.label,
    hint: config.hint,
    source: config.source,
    question: config.question,
    unit: config.unit,
    reads: config.reads,
    // Toda capa continua normaliza con el recorrido del propio lote: por
    // construcción, su color es relativo. La única que no pasa por aquí es el
    // riesgo, y es justamente la única clasificada por el motor.
    scale: "plot",
    origin: config.origin,
    caution: config.caution,
    available: true,
    surface: "overlay",
    zone: config.zone,
    valueOf,
    format: config.format,
    extremeTail: config.extremeTail,
    comparable: config.comparable ?? true,
    colorOf,
    patterned: false,
    ramp,
    paint: (cells, gridWidth, gridHeight) => {
      // El recorrido se calcula UNA vez por pintada, no una por celda.
      const span = spanOf(cells, valueOf);
      return {
        rgb: cellsRgb(cells, gridWidth, gridHeight, (cell) => colorOf(cell, span)),
        zones: config.zone ? zoneContour(cells, gridWidth, gridHeight, config.zone) : [],
      };
    },
  };
}

export const LAYERS: readonly AnalysisLayer[] = [
  {
    id: "terrain",
    label: "Terreno",
    hint: "La forma del campo, sin análisis encima",
    available: true,
    source: "elevation_m de /plots/{id}/cells",
    question: "¿Qué forma tiene el campo y por dónde corre el agua?",
    unit: "m sobre el nivel del mar",
    reads: { low: "parte baja del lote", high: "parte alta del lote" },
    scale: "plot",
    origin: "stored",
    // Ni alto ni bajo es "mejor": es una condición del sitio. La trampa aquí es
    // otra —creerla medida— y de eso avisa la procedencia, no esta línea.
    caution:
      "La pendiente que entra en el riesgo se deriva de esta elevación, que hoy " +
      "es sintética.",
    surface: "terrain",
    zone: null,
    valueOf: (cell) => cell.elevation_m,
    format: formatMeters,
    extremeTail: null,
    comparable: true,
    colorOf: (cell, span) => elevationTint(cell.elevation_m, span),
    patterned: false,
    ramp: null,
    paint: (cells, gridWidth, gridHeight) => {
      const span = spanOf(cells, (cell) => cell.elevation_m);
      return {
        rgb: cellsRgb(cells, gridWidth, gridHeight, (cell) =>
          elevationTint(cell.elevation_m, span),
        ),
        zones: [],
      };
    },
  },
  {
    // El riesgo NO es una rampa: son tres niveles que decide el motor. Difuminarlo
    // escondería justo la frontera que el agrónomo busca, así que va aparte de la
    // fábrica y es la única capa con trama.
    id: "risk",
    label: "Riesgo",
    hint: "Nivel de riesgo que estima el motor para cada celda",
    available: true,
    source: "risk_level y risk_score del motor",
    question: "¿Dónde estima el motor que hay más riesgo?",
    unit: "índice 0–1",
    reads: { low: "riesgo bajo", high: "riesgo alto" },
    // El único color de la interfaz que NO es relativo al lote: los tres niveles
    // los fija el motor y significan lo mismo en cualquier parcela.
    scale: "engine",
    origin: "engine",
    caution:
      "Estimación del modelo a partir de sanidad, suelo y pendiente. No es una " +
      "observación de campo.",
    surface: "overlay",
    zone: "high",
    valueOf: (cell) => cell.risk_score,
    format: formatScore,
    extremeTail: "high",
    // Contrastar el riesgo con la región que define el riesgo es circular.
    comparable: false,
    colorOf: (cell) => RISK_COLORS[cell.risk_level].fill,
    patterned: true,
    ramp: null,
    paint: (cells, gridWidth, gridHeight) => ({
      rgb: cellsRgb(cells, gridWidth, gridHeight, (cell) => RISK_COLORS[cell.risk_level].fill),
      zones: zoneContour(cells, gridWidth, gridHeight, "high"),
    }),
  },
  metricLayer({
    id: "yield",
    label: "Rendimiento",
    hint: "Kilogramos proyectados por celda",
    source: "projected_yield_kg del motor",
    question: "¿Cuánto se espera cosechar en cada metro cuadrado?",
    unit: "kg por celda",
    reads: { low: "lo que menos rinde del lote", high: "lo que más rinde del lote" },
    origin: "engine",
    caution:
      "Sale de las mismas entradas que el riesgo: coincidir con su zona es parte " +
      "del cálculo.",
    valueOf: (cell) => cell.projected_yield_kg,
    format: formatKg,
    ramp: "up",
    extremeTail: "low",
    // Perfila la zona en riesgo alto aunque el color sea otro: es lo que permite
    // ver de un vistazo si lo que menos rinde cae dentro de ella. El color sigue
    // siendo UNA variable; la región es una anotación.
    zone: "high",
  }),
  metricLayer({
    id: "loss",
    label: "Pérdida",
    hint: "Porcentaje de pérdida estimada",
    source: "estimated_loss_percentage del motor",
    question: "¿Qué parte de la cosecha se estima perder, y dónde?",
    unit: "% de pérdida",
    reads: { low: "se pierde poco", high: "se pierde mucho" },
    origin: "engine",
    caution:
      "Comparte con el riesgo los términos de los que se calcula: dicen casi lo " +
      "mismo con otra escala.",
    valueOf: (cell) => cell.estimated_loss_percentage,
    format: formatPercent,
    ramp: "down",
    extremeTail: "high",
    zone: "high",
  }),
  metricLayer({
    id: "soil",
    label: "Suelo",
    hint: "Calidad de suelo por celda",
    source: "soil_quality de /plots/{id}/cells · 400/400 comprobado",
    question: "¿Dónde está el suelo más pobre del lote?",
    unit: "índice 0–1",
    reads: { low: "el peor suelo del lote", high: "el mejor suelo del lote" },
    origin: "stored",
    caution:
      "El motor usa el suelo para calcular el riesgo: la coincidencia es la " +
      "fórmula, no un hallazgo.",
    valueOf: (cell) => cell.soil_quality,
    format: formatIndex,
    ramp: "up",
    extremeTail: "low",
    zone: "high",
  }),
  metricLayer({
    id: "health",
    label: "Sanidad",
    hint: "Estado sanitario del cultivo por celda",
    source: "health_factor de /plots/{id}/cells · 400/400 comprobado",
    question: "¿Dónde está el cultivo más castigado?",
    unit: "índice 0–1",
    reads: { low: "la peor sanidad del lote", high: "la mejor sanidad del lote" },
    origin: "stored",
    caution:
      "Es la entrada de mayor peso del riesgo: la coincidencia es la fórmula, no " +
      "un hallazgo.",
    valueOf: (cell) => cell.health_factor,
    format: formatIndex,
    ramp: "up",
    extremeTail: "low",
    zone: "high",
  }),

  /*
   * ── Todavía no es una capa ───────────────────────────────────────────────
   *
   * No tiene `paint`. Mientras no exista la función, no hay forma de que rellene
   * la pantalla con nada.
   *
   * TENER EL CAMPO NO ES TENER LA MEDICION. Cobertura comprobada contra la API
   * el 2026-09-02, lote Plot A: `slope_deg` llega 400/400, entre 1,09° y 21,14°.
   * El dato está completo y aun así no debe pintarse como análisis topográfico,
   * por tres razones encadenadas:
   *
   *   1. NO SE MIDIO, SE DERIVO. El backend la obtiene con `np.gradient` sobre
   *      la elevación —`app/core/synthetic/field.py`—, no de un levantamiento.
   *      Es la derivada de otro dato, y hereda todo lo que le pase a ese dato.
   *
   *   2. LA DERIVADA AMPLIFICA EL ERROR DE LA FUENTE. La elevación tiene 1 m de
   *      resolución nominal y unos 5 m de resolución efectiva: entre dos celdas
   *      vecinas no hay variación independiente que medir. Una diferencia finita
   *      a 1 m sobre un campo que solo varía cada 5 m no describe el terreno,
   *      describe el interpolador.
   *
   *   3. EL RANGO ES ARTEFACTO. Los 21° del extremo alto salen del borde de la
   *      hondonada sintética —0,6 m de caída en un núcleo de dos celdas—, que
   *      existe para que el dataset produzca celdas de riesgo alto. Pintarlo
   *      dibujaría un talud que nadie ha visto.
   *
   * Con un DEM real las tres desaparecen a la vez, y la capa se activa
   * rellenando esta entrada con `metricLayer`. Eso es todo lo que hace falta:
   * la ficha está pensada, el valor y la unidad son evidentes y la fábrica ya
   * sabe pintar cualquier métrica continua.
   *
   * ── Lo que NO va a ser capa, y por qué ───────────────────────────────────
   *
   * `plant_density` y `base_yield_factor` también llegan 400/400. No están aquí,
   * y la ausencia es una decisión, no un olvido:
   *
   *   plant_density      es una decisión de siembra, no un estado del campo.
   *                      Un mapa de plantas por metro cuadrado sobre una siembra
   *                      casi uniforme —2,5 ± 10 %— dibujaría ruido con aspecto
   *                      de patrón. La pregunta que respondería, "¿sembré
   *                      parejo?", no es una pregunta que se conteste mirando el
   *                      terreno cuando el cultivo ya está en pie.
   *
   *   base_yield_factor  es explícitamente el residuo del modelo: la variación
   *                      que el motor NO explica. Pintarlo invitaría a buscarle
   *                      sentido espacial a lo que por definición no lo tiene.
   *
   * Los dos siguen visibles en el inspector, que es su sitio: allí son la ficha
   * de una celda concreta y nadie los lee como un patrón del lote. Una capa se
   * añade porque responde una pregunta, no porque el campo exista.
   */
  {
    id: "slope",
    label: "Pendiente",
    available: false,
    hint: "Inclinación del terreno por celda",
    missing:
      "slope_deg llega completo en las 400 celdas, pero no se midió: el backend la " +
      "deriva de la elevación, que hoy es sintética y solo varía cada 5 m. Una " +
      "derivada calculada a 1 m sobre eso describe el interpolador, no el terreno. " +
      "Con un DEM real deja de ser un problema.",
  },
];

/** Capa por defecto: se entra a CERES por la pregunta que trae al usuario. */
export const DEFAULT_LAYER_ID: LayerId = "risk";

export function getLayer(id: LayerId): AnalysisLayer {
  return LAYERS.find((layer) => layer.id === id) ?? LAYERS[1]!;
}

/** La capa activa, garantizada disponible. Una pendiente nunca puede activarse. */
export function getAvailableLayer(id: LayerId): AvailableLayer {
  const layer = getLayer(id);
  if (layer.available) return layer;
  return LAYERS.find((l): l is AvailableLayer => l.available)!;
}

export function availableLayers(): AvailableLayer[] {
  return LAYERS.filter((layer): layer is AvailableLayer => layer.available);
}

export function pendingLayers(): PendingLayer[] {
  return LAYERS.filter((layer): layer is PendingLayer => !layer.available);
}

// --- Medir una capa sobre el lote --------------------------------------------

/**
 * La región contra la que se comparan las demás capas.
 *
 * Es una decisión del MOTOR (`risk_level`), no un umbral elegido aquí. Por eso
 * se puede contrastar cualquier métrica contra ella sin introducir criterio
 * agronómico nuevo.
 */
export const REFERENCE_LEVEL: RiskLevel = "high";

export interface LayerStats {
  /** El valor de la capa en cada celda, en el orden en que llegaron. */
  values: number[];
  summary: Summary;
  bins: Bin[];
  /**
   * Coincidencia espacial con la región de referencia, o `null` cuando no
   * procede: en la capa de riesgo sería circular, y sin región no hay nada que
   * contrastar.
   */
  overlap: Overlap | null;
}

/**
 * Mide una capa sobre el lote. Función pura: números entran, números salen.
 *
 * Se calcula UNA vez por (lote, capa) y se reparte. No debe llamarse por celda
 * ni por movimiento del ratón: son 400 valores ordenados varias veces.
 */
export function measureLayer(
  layer: AvailableLayer,
  cells: TerrainCell[],
  bins = 16,
): LayerStats | null {
  if (cells.length === 0) return null;

  const values = cells.map((cell) => layer.valueOf(cell));
  const summary = summarize(values);
  if (!summary) return null;

  const inRegion = cells.map((cell) => cell.risk_level === REFERENCE_LEVEL);

  return {
    values,
    summary,
    bins: histogram(values, bins),
    overlap: layer.comparable
      ? overlap(values, inRegion, layer.extremeTail ?? "low")
      : null,
  };
}

/**
 * LO QUE LA CAPA ACTIVA DICE DE UNA CELDA, EN PALABRAS.
 *
 * Existe porque el color no puede ser el único portador del dato. Con Suelo o
 * Sanidad activas, el valor pintado no aparecía en ningún texto: quien no
 * distinga los tonos —o no vea la pantalla— tenía delante un mapa mudo.
 *
 * `null` cuando la lectura ya está en el nombre por otra vía: el rendimiento, la
 * pérdida y el riesgo se enuncian siempre en toda celda, y repetirlos alargaría
 * cada lectura sin añadir nada —el riesgo llegaba a decir su cifra dos veces
 * seguidas—.
 *
 * Es una función y no una plantilla copiada en cada vista porque las tres que la
 * necesitan —la malla en planta, la etiqueta de hover y la capa accesible del
 * relieve— tienen que decir exactamente lo mismo. Cuando la regla vivía suelta,
 * la del relieve se quedó sin ella y nadie lo notó.
 */
export function layerReading(layer: AvailableLayer, cell: TerrainCell): string | null {
  if (layer.id === "yield" || layer.id === "loss" || layer.id === "risk") return null;
  return `${layer.label} ${layer.format(layer.valueOf(cell))}`;
}

/** Color de una celda bajo la capa activa, para la vista en planta. */
export function layerCellColor(
  layer: AvailableLayer,
  cell: TerrainCell,
  span: Span,
): string {
  return layer.colorOf(cell, span);
}
