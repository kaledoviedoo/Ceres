/**
 * QUE TENDRIA QUE TRAER UNA FUENTE DE ELEVACION REAL.
 *
 * Aquí no hay ninguna implementación, y es deliberado: no existe todavía un
 * GeoTIFF ni una nube de puntos contra la que validar un lector, y escribir uno
 * a ciegas produciría código que parece funcionar porque nadie lo ha ejecutado
 * con un fichero de verdad. Lo que sí se puede fijar hoy es el CONTRATO: qué
 * información necesita declarar una fuente para que el resto de CERES pueda
 * usarla sin cambiar nada más.
 *
 * EL PUNTO DE SUSTITUCION YA EXISTE
 * ─────────────────────────────────
 * Es `ElevationSource`, en `elevation.ts`. Todo lo que construye forma —malla,
 * normales, sombreado, curvas de nivel, altura del jalón, proyección del
 * anclaje— entra por `ElevationField`, y `ElevationField` no sabe hacer otra
 * cosa que envolver una `ElevationSource`. Cambiar de fuente es construir otra
 * implementación de esa interfaz:
 *
 *     gridElevationSource(cells, w, h)   ← la única que existe hoy
 *     demElevationSource(raster, ref)    ← futura
 *     pointCloudElevationSource(...)     ← futura
 *
 * Ninguna capa analítica puede notarlo, porque `paint(cells, gw, gh)` no recibe
 * un campo de elevación. Esa es la garantía, y está en la firma.
 *
 * LO QUE FALTA NO ES CODIGO, ES METADATO
 * ──────────────────────────────────────
 * La fuente actual se apoya en un supuesto cómodo: la malla de elevación y la
 * malla agrícola son la MISMA, celda a celda. Un ráster real no cumple eso casi
 * nunca —tendrá su propio origen, su propio paso y su propio sistema de
 * coordenadas—, así que hay que saber convertir una celda del lote en una
 * coordenada de la fuente. Eso es lo que describen los tipos de abajo.
 */

import type { ElevationProvenance } from "@/lib/terrain/elevation";

/**
 * Sistema de referencia, en la notación que usa cualquier herramienta SIG.
 *
 * Se guarda como texto y no como enumeración a propósito: un ráster puede venir
 * en cualquier UTM y enumerarlos aquí sería inventar un catálogo. Lo que importa
 * es que el dato DECLARE el suyo en vez de que el código lo dé por supuesto.
 *
 *   "EPSG:4326"   grados de latitud y longitud (lo que sirve la API hoy)
 *   "EPSG:32618"  UTM 18N en metros (lo típico de un DEM colombiano)
 */
export type CrsCode = `EPSG:${number}`;

/**
 * Referencia vertical.
 *
 * NO es un detalle académico: un mismo punto puede diferir decenas de metros
 * entre el elipsoide y el geoide. Mezclar dos fuentes con datums distintos
 * produce un terreno que parece correcto y está desplazado en bloque.
 */
export type VerticalDatum = "ellipsoidal" | "orthometric" | "unknown";

/** Extensión espacial de un ráster, en las unidades de su propio CRS. */
export interface GeoExtent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Cómo se lee un valor entre muestras.
 *
 * Importa declararlo porque cambia lo que significa el número: `nearest`
 * devuelve una medición real de la celda más próxima; `bilinear` y `cubic`
 * devuelven una estimación que NO se midió en ningún sitio. Hoy
 * `ElevationField` interpola para dibujar la superficie, y por eso ningún valor
 * interpolado sale nunca por la interfaz —el inspector lee la celda—. Esa regla
 * tiene que sobrevivir a la llegada del DEM.
 */
export type SamplingMethod = "nearest" | "bilinear" | "cubic";

/**
 * HACIA DONDE CORREN LAS FILAS DEL RASTER.
 *
 * El único error de esta lista que produce un terreno PERFECTAMENTE VALIDO y
 * completamente equivocado. Los demás dan algo raro que se ve: un hueco, una
 * fosa de diez kilómetros, un lote a media escala. Este da un terreno bien
 * formado, con su relieve y su sombreado, **espejado en el eje norte-sur**. La
 * colina queda donde está el valle y no falla nada.
 *
 * Pasa porque hay tres convenios en juego a la vez:
 *
 *     malla de CERES       y = 0 al SUR      heredado del dominio agrícola
 *     textura de análisis  fila 0 al NORTE   `hillshadeGrid` ya la invierte
 *     GeoTIFF típico       fila 0 al NORTE   afín con `pixelHeight` negativo
 *
 * Dos de los tres ya están escritos en el código. El tercero es el que traería
 * el fichero de fuera, y es el que faltaba por declarar.
 */
export type RowOrder = "north_up" | "south_up";

/**
 * Transformación afín del ráster: seis coeficientes, como en cualquier GeoTIFF.
 *
 *     X = originX + col * pixelWidth + fila * rotationX
 *     Y = originY + col * rotationY  + fila * pixelHeight
 *
 * Hace falta entera y no solo la resolución: un ráster puede estar rotado o
 * desplazado respecto al norte, y con solo el tamaño de píxel el lote acabaría
 * muestreado unos metros al lado sin que nada lo delate.
 *
 * `pixelHeight` es NEGATIVO en los rásteres north-up, y esa es justamente la
 * pista que `rowOrder` declara aparte: los dos tienen que contar lo mismo.
 */
export interface AffineTransform {
  /** Coordenada X de la esquina del píxel (0, 0), en unidades del CRS. */
  originX: number;
  /** Coordenada Y de esa misma esquina. */
  originY: number;
  /** Cuánto avanza X por columna. */
  pixelWidth: number;
  /** Cuánto avanza Y por fila. Negativo si las filas bajan hacia el sur. */
  pixelHeight: number;
  /** Rotación. Cero en un ráster alineado con los ejes, que es lo normal. */
  rotationX: number;
  rotationY: number;
}

/**
 * Qué hacer cuando el píxel es MAS FINO que la celda agrícola.
 *
 * `sampling` resuelve el caso contrario —leer entre muestras—. Este resuelve el
 * de sobra: si un DEM de 0,25 m entra en un lote de celdas de 1 m, cada celda
 * cubre dieciséis píxeles y quedarse con el del centro tira quince mediciones.
 *
 *   sample  el píxel del centro. Es un valor REAL medido justo ahí.
 *   mean    el promedio de la celda. Representa mejor la superficie y ya no es
 *           ninguna medición concreta.
 *   min     el más bajo. Lo que interesa en un estudio de encharcamiento.
 *   max     el más alto.
 *
 * Se declara porque cambia lo que el número SIGNIFICA, no solo su valor.
 */
export type AggregationMethod = "sample" | "mean" | "min" | "max";

/**
 * Qué hacer con un hueco del ráster.
 *
 *   reject       no se acepta la fuente. Lo correcto cuando el hueco cae dentro
 *                del lote y no hay forma honesta de rellenarlo.
 *   hole         la celda se queda sin elevación y se dibuja como ausente.
 *   interpolate  se estima desde los vecinos. Deja de ser una medición, así que
 *                esa celda tendría que declararse `derived` y no `measured`.
 *
 * Es una decisión de producto y no del lector: por eso está en el contrato.
 */
export type NoDataPolicy = "reject" | "hole" | "interpolate";

/** A qué esquina se refiere un origen. El lote ya declara la suya en la API. */
export type OriginCorner = "southwest" | "northwest" | "southeast" | "northeast";

/**
 * Lo que una fuente de elevación real tiene que declarar de sí misma.
 *
 * Es la ficha del ráster, no sus píxeles. Con esto y con el georreferenciado del
 * lote se puede decidir, antes de dibujar nada, si la fuente cubre la parcela y
 * con cuánto detalle.
 */
export interface RasterElevationSpec {
  /** En qué sistema están las coordenadas del ráster. */
  crs: CrsCode;
  /** Respecto a qué se miden las alturas. */
  verticalDatum: VerticalDatum;
  /** Qué cubre, en unidades de `crs`. */
  extent: GeoExtent;
  /** Tamaño del píxel, en METROS de terreno. Uno por eje: rara vez son iguales. */
  resolutionM: { x: number; y: number };
  /** Hacia dónde corren las filas. Sin esto el terreno sale espejado sin error. */
  rowOrder: RowOrder;
  /** La afín completa. La resolución sola no cubre un ráster rotado o desplazado. */
  transform: AffineTransform;
  /** A qué esquina se refiere `transform.originX/Y`. */
  originCorner: OriginCorner;
  /** Rejilla de muestras. */
  size: { width: number; height: number };
  /**
   * Valor que significa "aquí no hay medición".
   *
   * Un DEM real viene con huecos: sombras de radar, agua, bordes del vuelo. Sin
   * este campo, el −9999 típico entra en la malla como una fosa de diez
   * kilómetros. `null` significa que la fuente afirma no tener huecos.
   */
  noData: number | null;
  /** Unidad de los valores almacenados. Un DEM en pies existe y arruina la escala. */
  units: "m" | "ft";
  /** Extremos reales del recorte que cubre el lote, ya en metros. */
  minMeters: number;
  maxMeters: number;
  /** Cómo se leerá entre muestras, y qué implica eso. */
  sampling: SamplingMethod;
  /** Cómo se resumen varios píxeles dentro de una celda. */
  aggregation: AggregationMethod;
  /** Qué hacer con los huecos. Decisión de producto, no del lector. */
  noDataPolicy: NoDataPolicy;
  /** De dónde salió y con qué precisión efectiva. Viaja hasta la interfaz. */
  provenance: ElevationProvenance;
}

/**
 * El puente entre la malla del lote y las coordenadas de la fuente.
 *
 * Es LA pieza que hoy no existe, porque hoy no hace falta: la malla de elevación
 * y la agrícola coinciden. Con un ráster real hay que resolver, para la celda
 * (x, y) del lote, en qué punto del ráster cae.
 *
 * CERES YA TIENE POR DONDE EMPEZAR, aunque no por donde se dijo antes. Este
 * comentario afirmaba que cada celda llega con `centroid_latitude` y
 * `centroid_longitude`: es FALSO para el endpoint que usa el terreno.
 * `GET /plots/{id}/cells` no devuelve centroides —solo los trae
 * `GET /cells/{id}`, que se pide de una en una—.
 *
 * El anclaje que sí está disponible es el del LOTE: `origin_latitude`,
 * `origin_longitude`, `origin_corner` y `cell_size_m`, los cuatro en
 * `GET /plots/{id}`. Con la esquina declarada y el paso de la malla, el
 * centroide de cualquier celda se deriva sin pedir nada más.
 *
 * La cadena completa quedaría:
 *
 *     celda (x, y)
 *       → (lat, lon)                    origen del lote + esquina + paso
 *       → (X, Y) en el CRS del ráster   proyección
 *       → (col, fila) del ráster        transformación afín, con `rowOrder`
 *       → metros                        muestreo o agregación
 */
export interface PlotGeoReference {
  /** CRS en el que están las coordenadas del lote. Hoy siempre grados. */
  crs: CrsCode;
  /** Esquina suroeste del lote: el origen desde el que el backend deriva todo. */
  origin: { latitude: number; longitude: number };
  /** Lado de la celda agrícola, en metros. */
  cellSizeM: number;
  size: { width: number; height: number };
}

/**
 * Lo que hay que comprobar ANTES de aceptar un ráster, no después de dibujarlo.
 *
 * Se declara aquí para que la lista exista aunque el lector todavía no: son los
 * cuatro modos en que un DEM real estropea un terreno sin dar ningún error.
 */
export interface ElevationSourceCheck {
  /** ¿La extensión del ráster cubre el lote entero? Si no, hay borde sin dato. */
  covers: boolean;
  /** ¿Cuántas muestras del ráster caen dentro del lote? Menos de una por celda
   *  significa que la resolución efectiva es peor que la malla agrícola. */
  samplesPerCell: number;
  /** ¿Hay `noData` dentro del recorte? Cuántos. */
  holes: number;
  /** ¿Coinciden los datums verticales, o hay un desplazamiento en bloque? */
  datumMatches: boolean;
}

// --- Validación del contrato -------------------------------------------------

/**
 * Un problema encontrado en la ficha de una fuente, antes de dibujar nada.
 *
 * `fatal` separa lo que impide usar el ráster de lo que solo hay que saber. Un
 * datum desconocido es un aviso —el terreno sale bien, la altitud absoluta no es
 * comparable con otra fuente—; unas filas al revés no lo son.
 */
export interface SpecProblem {
  field: string;
  message: string;
  fatal: boolean;
}

/**
 * LO QUE HAY QUE COMPROBAR ANTES DE ACEPTAR UN RASTER.
 *
 * Todo lo de aquí produce un terreno que se dibuja sin error. Esa es la razón de
 * que exista: un fallo que se ve no necesita validador, se ve. Lo que necesita
 * validador es un terreno bien formado que describe otro sitio.
 *
 * Es una función pura sobre la FICHA, no sobre los píxeles: se puede ejecutar en
 * cuanto se lee la cabecera del fichero, antes de cargar nada.
 */
export function validateRasterSpec(spec: RasterElevationSpec): SpecProblem[] {
  const problemas: SpecProblem[] = [];

  const anota = (field: string, message: string, fatal = true) =>
    problemas.push({ field, message, fatal });

  // --- Orientación --------------------------------------------------------
  // La afín ya dice hacia dónde van las filas, en el signo de `pixelHeight`. Si
  // el declarado y el signo se contradicen, uno de los dos está mal y no hay
  // forma de saber cuál: aceptar cualquiera es jugarse el terreno a cara o cruz.
  const bajaHaciaElSur = spec.transform.pixelHeight < 0;
  if (bajaHaciaElSur !== (spec.rowOrder === "north_up")) {
    anota(
      "rowOrder",
      `declara ${spec.rowOrder} y la afín dice lo contrario ` +
        `(pixelHeight = ${spec.transform.pixelHeight}). El terreno saldría espejado.`,
    );
  }
  if (spec.transform.pixelHeight === 0 || spec.transform.pixelWidth === 0) {
    anota("transform", "un píxel de lado cero colapsa la malla entera");
  }

  // --- Unidades -----------------------------------------------------------
  // Un DEM en pies existe. Nadie lo nota: el terreno sale con un relieve 3,28
  // veces mayor y sigue pareciendo un terreno.
  if (spec.units !== "m") {
    anota("units", `la elevación viene en ${spec.units} y CERES trabaja en metros`);
  }

  // --- Extensión ----------------------------------------------------------
  if (spec.extent.maxX <= spec.extent.minX || spec.extent.maxY <= spec.extent.minY) {
    anota("extent", "la extensión está vacía o invertida");
  }

  // --- Recorrido ----------------------------------------------------------
  if (spec.maxMeters < spec.minMeters) {
    anota("minMeters", "el mínimo es mayor que el máximo");
  }
  // El valor de nodata dentro del recorrido válido es indistinguible de un dato:
  // el -9999 típico entra en la malla como una fosa de diez kilómetros.
  if (
    spec.noData !== null &&
    spec.noData >= spec.minMeters &&
    spec.noData <= spec.maxMeters
  ) {
    anota("noData", `${spec.noData} cae dentro del rango de alturas válidas`);
  }

  // --- Muestreo -----------------------------------------------------------
  // Interpolar produce un valor que no se midió en ningún sitio. Es legítimo
  // para dibujar la superficie y NO lo es para llamarse medición.
  if (spec.sampling !== "nearest" && spec.provenance.kind === "measured") {
    anota(
      "sampling",
      `se declara medido y se lee con ${spec.sampling}: lo que salga de ahí ` +
        "es una estimación, no una medición",
      false,
    );
  }
  if (spec.aggregation !== "sample" && spec.provenance.kind === "measured") {
    anota(
      "aggregation",
      `se declara medido y se agrega con ${spec.aggregation}: el valor de la ` +
        "celda deja de ser una medición concreta",
      false,
    );
  }

  // --- Lo que solo hay que saber -----------------------------------------
  if (spec.verticalDatum === "unknown") {
    anota(
      "verticalDatum",
      "sin datum vertical la altitud no es comparable con otra fuente",
      false,
    );
  }

  return problemas;
}

/** ¿Se puede usar esta fuente? Ningún problema fatal. */
export function isUsableSpec(spec: RasterElevationSpec): boolean {
  return validateRasterSpec(spec).every((p) => !p.fatal);
}
