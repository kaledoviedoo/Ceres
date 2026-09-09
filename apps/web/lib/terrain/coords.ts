/**
 * Conversión entre coordenadas de malla y coordenadas de mundo.
 *
 * Es el único módulo que las dos ramas de la arquitectura comparten, y es
 * deliberadamente tonto: no sabe qué es una elevación ni qué es un riesgo. Solo
 * traduce posiciones.
 *
 *     ElevationSource → ElevationField → TerrainGeometry ──┐
 *                                                          ├→ coords
 *     AgriculturalData → AnalysisLayer ────────────────────┘
 *
 * CONVENIO DE EJES, heredado del dominio:
 *
 *     x del dato  → +X del mundo   (0 = oeste)
 *     y del dato  → −Z del mundo   (0 = sur, así que el norte queda hacia −Z)
 *     elevación   → +Y del mundo
 *
 * La inversión de Z existe porque en Three.js la cámara mira por defecto hacia
 * −Z: con este convenio, la vista inicial deja el norte al fondo y el oeste a la
 * izquierda, igual que en la malla 2D y que en un mapa.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UNA UNIDAD DE MUNDO ES UN METRO. SIEMPRE.
 *
 * Es el invariante que sostiene todo lo demás: la barra de escala mide píxeles
 * por metro proyectando dos puntos del mundo, la exageración vertical multiplica
 * metros reales de desnivel, el sombreado deriva la pendiente en metros y la
 * textura de hierba se genera a tantos motivos por metro. Si el eje horizontal
 * dejara de estar en metros, las cuatro cosas mentirían a la vez y ninguna daría
 * error.
 *
 * Lo que NO es un metro es una celda. Una celda mide `cellSizeM` metros, y ese
 * número lo declara la API (`cell_size_m`), no este módulo. Antes aquí vivía una
 * constante `CELL_SIZE = 1` que hacía las dos afirmaciones a la vez —«un metro
 * es una unidad» y «una celda es un metro»— y la segunda era una suposición
 * sobre el dato disfrazada de conversión de unidades.
 *
 * Por eso no queda ninguna constante de tamaño: la única forma de obtener una
 * coordenada de mundo es pasar un `PlotGrid`, y un `PlotGrid` no se puede
 * construir sin decir cuánto mide su celda.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * La malla física de un lote.
 *
 * Las tres cosas que hacen falta para situar una celda en el espacio, juntas
 * porque separarlas es justo lo que permitía olvidar la tercera. Sale de
 * `GET /plots/{id}/cells`, que declara `grid_width`, `grid_height` y
 * `cell_size_m` en la misma respuesta.
 */
export interface PlotGrid {
  /** Celdas de oeste a este. */
  width: number;
  /** Celdas de sur a norte. */
  height: number;
  /**
   * Lado de una celda, en METROS.
   *
   * NO es la resolución de la fuente de elevación. Son dos números distintos que
   * hoy coinciden: `cellSizeM` es el tamaño de la unidad agrícola, y la
   * resolución efectiva describe a qué escala varía de verdad el relieve —5 m
   * medidos sobre un lote de celdas de 1 m—. Mezclarlos haría que subdividir el
   * lote pareciera ganar detalle topográfico.
   */
  cellSizeM: number;
}

/** Centro del lote en coordenadas de malla, para orbitar alrededor de él. */
export function gridCenter(plot: PlotGrid): [number, number] {
  return [(plot.width - 1) / 2, (plot.height - 1) / 2];
}

/**
 * Lado mayor del lote, en metros. Fija los límites de zoom de la cámara.
 *
 * Es una longitud FISICA: una malla de 20 × 20 con celdas de 0,5 m mide 10 m, no
 * 20. Cuando esto devolvía el número de celdas, la cámara encuadraba «veinte de
 * algo» y daba igual que ese algo fuera medio metro o dos.
 */
export function plotExtent(plot: PlotGrid): number {
  return Math.max(plot.width, plot.height) * plot.cellSizeM;
}

export function worldToGrid(
  worldX: number,
  worldZ: number,
  plot: PlotGrid,
): [number, number] {
  const [centerX, centerY] = gridCenter(plot);
  return [
    worldX / plot.cellSizeM + centerX,
    centerY - worldZ / plot.cellSizeM,
  ];
}

export function gridToWorld(gx: number, gy: number, plot: PlotGrid): [number, number] {
  const [centerX, centerY] = gridCenter(plot);
  return [(gx - centerX) * plot.cellSizeM, -(gy - centerY) * plot.cellSizeM];
}

/** Los cuatro bordes de una celda en coordenadas de mundo. */
export function cellBounds(gx: number, gy: number, plot: PlotGrid) {
  const [worldX, worldZ] = gridToWorld(gx, gy, plot);
  const half = plot.cellSizeM / 2;
  return {
    west: worldX - half,
    east: worldX + half,
    north: worldZ - half,
    south: worldZ + half,
  };
}

// --- Acuerdo entre las respuestas que declaran la malla ----------------------

/** Una respuesta de la API que declara la malla del lote. */
export interface DeclaredGrid {
  /** Qué endpoint lo dijo. Solo para poder nombrarlo si discrepan. */
  source: string;
  width: number;
  height: number;
  cellSizeM: number;
}

export type GridAgreement =
  | { readonly agreed: PlotGrid }
  | { readonly conflict: string };

/**
 * LA MALLA, CUANDO TODAS LAS RESPUESTAS DICEN LO MISMO.
 *
 * Tres endpoints declaran `grid_width`, `grid_height` y `cell_size_m`:
 * `/plots/{id}`, `/plots/{id}/cells` y `/plots/{id}/overview`. Las tres cifras
 * salen de la misma fila de `plots`, así que hoy no pueden discrepar —el
 * servidor lo comprueba en su propio test de contrato—.
 *
 * Aquí se comprueba de todas formas, y por una razón concreta: el cliente no
 * valida nada en runtime, hace `as T`. Si el backend cambiara y una de las tres
 * empezara a decir otra cosa, el frontend tomaría la primera que leyera y
 * pintaría el lote a otra escala **sin dar ningún error**. Un lote de 20 m
 * dibujado como si midiera 40 se ve perfectamente bien.
 *
 * NO ELIGE UNA. Discrepar no es un empate que se resuelva con una preferencia:
 * es que el contrato está roto, y adivinar cuál es la buena sería exactamente el
 * fallo silencioso que esto existe para impedir. Devuelve el conflicto y quien
 * llama decide —hoy, mostrarlo como error de carga—.
 *
 * Vive en `coords.ts` y no en tres componentes porque la malla es una sola cosa
 * y solo se construye en un sitio.
 */
export function agreeOnPlotGrid(declared: readonly DeclaredGrid[]): GridAgreement {
  if (declared.length === 0) return { conflict: "Ninguna respuesta declara la malla." };

  const [primera, ...resto] = declared as [DeclaredGrid, ...DeclaredGrid[]];

  for (const otra of resto) {
    for (const campo of ["width", "height", "cellSizeM"] as const) {
      if (otra[campo] !== primera[campo]) {
        return {
          conflict:
            `La malla del lote no coincide entre respuestas: ${primera.source} dice ` +
            `${campo} = ${primera[campo]} y ${otra.source} dice ${otra[campo]}.`,
        };
      }
    }
  }

  return {
    agreed: {
      width: primera.width,
      height: primera.height,
      cellSizeM: primera.cellSizeM,
    },
  };
}

// --- Presencia de los campos críticos ---------------------------------------

/**
 * Los cinco campos sin los que CERES no puede situar nada.
 *
 * `grid_width` y `grid_height` dicen cuántas celdas hay; `cell_size_m`, cuánto
 * mide cada una; `origin_latitude` y `origin_longitude`, dónde está el lote en
 * el mundo. Los tres primeros gobiernan toda distancia física; los dos últimos
 * son el ancla geográfica que necesitará un DEM.
 */
export const CRITICAL_GEOMETRY_FIELDS = [
  "grid_width",
  "grid_height",
  "cell_size_m",
  "origin_latitude",
  "origin_longitude",
] as const;

/**
 * ¿ESTA EL CAMPO, Y ES UN NUMERO DE VERDAD?
 *
 * El cliente no valida nada en runtime: hace `as T`. Un campo que desapareciera
 * de la respuesta entraría como `undefined`, TypeScript no se enteraría y
 * `plotExtent` devolvería `NaN`. Todos los vértices saldrían `NaN` y **el
 * terreno desaparecería sin un solo error en consola** — indistinguible de un
 * problema de red.
 *
 * `agreeOnPlotGrid` no lo cubría: comprueba que las respuestas COINCIDAN, y dos
 * respuestas a las que les falta el mismo campo coinciden perfectamente en
 * `undefined`. Este es el agujero que dejaba abierto.
 *
 * Se comprueba finitud y no solo presencia: `null`, `"20"` y `NaN` pasarían un
 * `!== undefined` y romperían igual. Y `cell_size_m = 0` colapsaría la malla a
 * un punto, así que los tamaños tienen que ser positivos.
 */
export function missingGeometryFields(
  // `unknown` y no `Record<string, unknown>`: lo que llega es una respuesta que
  // el cliente ya declaró tipada con `as T`, y el objetivo de esta función es
  // precisamente no fiarse de esa declaración.
  source: unknown,
  fields: readonly string[] = CRITICAL_GEOMETRY_FIELDS,
): string[] {
  const objeto = source as Record<string, unknown> | null | undefined;
  if (!objeto || typeof objeto !== "object") return [...fields];

  const faltan: string[] = [];
  for (const field of fields) {
    const valor = objeto[field];
    if (typeof valor !== "number" || !Number.isFinite(valor)) {
      faltan.push(field);
      continue;
    }
    // Las magnitudes tienen que ser positivas; las coordenadas pueden ser
    // negativas —el lote está a 73° oeste— así que solo se les exige finitud.
    if (field !== "origin_latitude" && field !== "origin_longitude" && valor <= 0) {
      faltan.push(field);
    }
  }
  return faltan;
}

/** El mensaje que se le enseña a alguien cuando falta algo. */
export function describeMissingGeometry(missing: readonly string[]): string {
  return (
    `La API no declara ${missing.join(", ")}. Sin ${missing.length === 1 ? "ese dato" : "esos datos"} ` +
    "no se puede situar el lote en el espacio, y dibujarlo igualmente produciría " +
    "un terreno a una escala inventada."
  );
}
