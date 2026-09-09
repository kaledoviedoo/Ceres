/**
 * LA RAMA DE LA GEOMETRIA.
 *
 *     ElevationSource → ElevationField → TerrainGeometry → Three.js
 *
 * Este módulo no sabe qué es el riesgo, ni el rendimiento, ni una predicción.
 * Solo sabe de metros sobre el nivel del mar. Esa ignorancia es el punto: hace
 * estructuralmente imposible que una métrica agrícola acabe deformando el
 * terreno, porque el código que construye la forma no tiene acceso a ella.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUE HAY DE VERDAD EN ESTOS DATOS, MEDIDO Y NO SUPUESTO
 *
 * El lote trae 400 valores de `elevation_m`, uno por celda de 1 m². Parecen 400
 * mediciones independientes. No lo son. Descomponiendo el campo en componentes
 * principales:
 *
 *     1 componente  → 90,02 % del campo
 *     3 componentes → 98,78 %
 *     4 componentes → 99,99 %
 *
 * Un terreno con 400 medidas independientes necesitaría del orden de 20
 * componentes para llegar al 99 %. Este necesita CUATRO, porque el generador
 * sintético lo construye como: constante + rampa sur-norte + ruido de una
 * retícula de 4×4 interpolado + una gaussiana. Unos 19 parámetros en total.
 *
 * Consecuencia práctica: la resolución NOMINAL es 1 m, pero la resolución
 * EFECTIVA es de unos 5 m. Subdividir más la malla añade triángulos, no
 * información. Por eso `provenance` viaja con el campo y llega hasta la
 * interfaz: quien mire este terreno tiene derecho a saber que no es topografía
 * medida.
 * ─────────────────────────────────────────────────────────────────────────────
 */



import type { PlotGrid } from "@/lib/terrain/coords";

/**
 * El vocabulario CERRADO de procedencia, el mismo que declara la API.
 *
 * Antes esto era `"synthetic" | "dem" | "lidar"`, que mezclaba dos preguntas:
 * de dónde sale el dato y en qué formato viene. Un DEM puede ser una medición o
 * el resultado de un modelo, y "lidar" es un instrumento, no una procedencia.
 *
 * `unknown` es el valor por defecto en toda la cadena. Nunca `measured`: callar
 * tiene que producir "no lo sé", no "lo medí".
 */
export type ProvenanceKind =
  | "measured"
  | "derived"
  | "estimated"
  | "synthetic"
  | "unknown";

/**
 * De dónde salió la elevación. Viaja con el campo hasta la pantalla.
 *
 * YA NO SE SUPONE: la sirve `GET /plots/{id}/cells` en su bloque `provenance`.
 * Hasta esta fase el frontend la afirmaba por su cuenta, y acertaba de
 * casualidad —nadie se la había dicho—.
 */
export interface ElevationProvenance {
  kind: ProvenanceKind;
  /** Texto corto para la interfaz. */
  label: string;
  /** Resolución NOMINAL: separación entre muestras almacenadas. */
  nominalResolutionM: number;
  /**
   * Resolución EFECTIVA: a qué escala hay variación real. Es OTRO número, no se
   * deduce de la nominal, y `null` cuando nadie la ha medido: fingir que se
   * conoce es exactamente lo que este campo existe para impedir.
   */
  effectiveResolutionM: number | null;
  /**
   * Si describe una medición de campo.
   *
   * Derivado de `kind`, no declarado aparte: dos campos que pueden contradecirse
   * acaban contradiciéndose.
   */
  readonly measured: boolean;
}

/** ¿Es una medición? Una sola definición para toda la interfaz. */
export function isMeasured(kind: ProvenanceKind): boolean {
  return kind === "measured";
}

/** Cómo se nombra cada procedencia en la interfaz. */
export const PROVENANCE_LABEL: Record<ProvenanceKind, string> = {
  measured: "medida",
  derived: "derivada",
  estimated: "estimada",
  synthetic: "sintética",
  unknown: "de origen no declarado",
};

/**
 * Fuente de elevación intercambiable.
 *
 * Un GeoTIFF, un DTM o una nube LiDAR implementan esta misma interfaz y el resto
 * del sistema no se entera. Es el punto de sustitución de toda la rama
 * geométrica.
 */
export interface ElevationSource {
  readonly width: number;
  readonly height: number;
  readonly provenance: ElevationProvenance;
  /** Metros sobre el nivel del mar en el CENTRO de la celda (x, y). */
  metersAt(x: number, y: number): number;
  /** Extremos del lote, en metros. */
  readonly minMeters: number;
  readonly maxMeters: number;
}

interface ElevationSample {
  x: number;
  y: number;
  elevation_m: number;
}

/**
 * Fuente construida sobre la malla de celdas que sirve el backend.
 *
 * Es la única implementación que existe hoy. Declara su procedencia honestamente
 * en vez de presentarse como un DEM.
 */
/**
 * PROCEDENCIA DESCONOCIDA — el único valor por defecto admisible.
 *
 * Sustituye a `assumedProvenance`, que devolvía "sintética" por su cuenta. Aquel
 * supuesto era correcto y aun así estaba mal: nadie se lo había dicho al
 * frontend, y el día que el dato hubiera cambiado la interfaz habría seguido
 * afirmando lo mismo con la misma seguridad.
 *
 * Ahora la procedencia la declara `GET /plots/{id}/cells`. Cuando NO llega
 * —backend antiguo, respuesta incompleta— se usa esta, que no afirma nada. Es la
 * dirección segura: `unknown` hace que la interfaz diga "origen no declarado",
 * mientras que cualquier otro valor por omisión pondría en pantalla una
 * afirmación que nadie ha hecho.
 */
export function unknownProvenance(sampleSpacingM: number): ElevationProvenance {
  return {
    kind: "unknown",
    label: "Elevación de origen no declarado",
    // Lo único que sigue siendo cierto sin que nadie lo declare: las muestras
    // están donde están las celdas. Es geometría del propio dato, no una
    // afirmación sobre su origen.
    nominalResolutionM: sampleSpacingM,
    // Nadie la ha medido. `null` y no un número prudente: un número aquí se lee
    // como una medición.
    effectiveResolutionM: null,
    measured: false,
  };
}

export function gridElevationSource(
  cells: ElevationSample[],
  plot: PlotGrid,
  /**
   * Procedencia DECLARADA por el origen del dato.
   *
   * Sin ella no se inventa ninguna: se usa `unknownProvenance`, que dice que no
   * se sabe. Es el único valor por defecto que no pone una afirmación ajena en
   * boca del sistema.
   */
  provenance: ElevationProvenance = unknownProvenance(plot.cellSizeM),
): ElevationSource {
  const { width, height } = plot;
  let min = Infinity;
  let max = -Infinity;
  for (const cell of cells) {
    if (cell.elevation_m < min) min = cell.elevation_m;
    if (cell.elevation_m > max) max = cell.elevation_m;
  }
  if (!Number.isFinite(min)) {
    min = 0;
    max = 0;
  }

  /*
   * SE GUARDA EL DESNIVEL, NO LA ALTITUD.
   *
   * Las elevaciones del lote rondan los 1180 m y el relieve util son 3 m. Un
   * `Float32Array` tiene unos siete digitos significativos, asi que almacenar
   * 1179.809 gasta casi todos en la parte constante y deja un error de 4·10⁻⁵ m
   * en lo unico que interesa. Guardando la diferencia contra el minimo del lote,
   * los mismos 32 bits describen un rango de 3 m con precision de micras.
   *
   * `min` se conserva aparte en doble precision y se vuelve a sumar al leer, asi
   * que `metersAt` devuelve la altitud real y exacta. Es el mismo truco que usa
   * cualquier formato de terreno: un datum mas offsets.
   */
  const offsets = new Float32Array(width * height);
  for (const cell of cells) {
    if (cell.x < 0 || cell.x >= width || cell.y < 0 || cell.y >= height) continue;
    offsets[cell.y * width + cell.x] = cell.elevation_m - min;
  }

  return {
    width,
    height,
    minMeters: min,
    maxMeters: max,
    metersAt(x, y) {
      const cx = Math.min(width - 1, Math.max(0, x));
      const cy = Math.min(height - 1, Math.max(0, y));
      return min + (offsets[cy * width + cx] ?? 0);
    },
    provenance,
  };
}

/**
 * EXAGERACION VERTICAL — transformación puramente visual.
 *
 * Unidades de mundo por metro real de desnivel. `1` sería escala 1:1.
 *
 * El lote varía 3,01 m sobre 20 × 20 m. A escala real, ese relieve ocupa el 15 %
 * del ancho de la parcela y, con la cámara abarcándola entera, apenas se
 * distingue de un plano.
 *
 * OJO CON EL VALOR ANTERIOR: la versión previa normalizaba la elevación a [0,1]
 * y la multiplicaba por 1,35, con lo que los 3,01 m acababan midiendo 1,35
 * unidades. Eso no es exagerar: es COMPRIMIR el terreno a 0,45× de su escala
 * real. El relieve se veía plano porque estaba aplastado, no porque el dato
 * fuera pobre.
 *
 * Aquí el factor es explícito y multiplica metros reales. NO altera ningún dato:
 * la elevación en metros sigue siendo la que devuelve el backend, y es la que se
 * muestra en el inspector.
 *
 * El valor sale de mirar el resultado: 2,6 dejaba el relieve en el 39 % del ancho
 * de la parcela y se leía como una colina, no como un campo. 2,2 lo deja en el
 * 33 %: la forma se percibe y la escala sigue siendo agrícola.
 */
export const VERTICAL_EXAGGERATION = 2.2;

/**
 * Desenfoque de caja separable, dos pasadas.
 *
 * Dos cajas seguidas aproximan una gaussiana y cuestan una fracción de lo que
 * costaría calcularla, que para una rejilla que se construye una vez por lote es
 * más que suficiente.
 */
function boxBlur(src: Float32Array, size: number, radius: number): Float32Array {
  if (radius < 1) return src;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0;
      let n = 0;
      for (let d = -radius; d <= radius; d += 1) {
        const nx = x + d;
        if (nx < 0 || nx >= size) continue;
        sum += src[y * size + nx]!;
        n += 1;
      }
      tmp[y * size + x] = sum / n;
    }
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0;
      let n = 0;
      for (let d = -radius; d <= radius; d += 1) {
        const ny = y + d;
        if (ny < 0 || ny >= size) continue;
        sum += tmp[ny * size + x]!;
        n += 1;
      }
      out[y * size + x] = sum / n;
    }
  }
  return out;
}

/**
 * Curva de Hermite de quinto grado, C².
 *
 * NO es la de tercer grado —`3t² − 2t³`— y la diferencia se ve en pantalla. La
 * cúbica anula su primera derivada en los extremos, así que la superficie no
 * tiene aristas; pero su SEGUNDA derivada salta al cruzar cada borde de celda, y
 * el sombreado depende de cómo VARIA la normal, no de la normal misma. El
 * resultado eran bandas paralelas sobre las laderas, una por fila de celdas,
 * que no existen en el dato.
 *
 * Esta anula también la segunda derivada en los extremos. Las normales varían de
 * forma continua al cruzar de celda y las bandas desaparecen en el origen, tanto
 * en la iluminación de la malla como en el sombreado de la textura.
 *
 * Coste: dos multiplicaciones más por muestra. Se paga una vez al construir la
 * malla.
 */
function smoothstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * El campo continuo de elevación, listo para construir geometría.
 *
 * Envuelve una fuente y añade lo que la geometría necesita: muestreo en
 * coordenadas continuas, pendiente y sombreado de relieve.
 *
 * LA INTERPOLACION ES SOLO PARA LA SUPERFICIE. Entre dos centros de celda no hay
 * medición, y lo que se dibuja ahí es una estimación visual. Ningún número
 * interpolado sale nunca por la interfaz: el inspector lee la celda, no el
 * píxel.
 */
export class ElevationField {
  /**
   * @param source  de dónde salen los metros.
   * @param cellSizeM  cuántos METROS hay entre dos coordenadas de malla
   *   consecutivas. Hace falta aquí y no en la fuente: la fuente se indexa por
   *   celda del lote, así que el paso entre índices es siempre el lado de la
   *   celda, venga la elevación de donde venga. Es lo que convierte una
   *   diferencia de alturas en una PENDIENTE, y sin él el sombreado de un lote
   *   de celdas de 0,5 m saldría a la mitad de su inclinación real.
   */
  constructor(
    readonly source: ElevationSource,
    readonly cellSizeM: number,
  ) {}

  get provenance(): ElevationProvenance {
    return this.source.provenance;
  }

  /** Desnivel del lote, en metros reales. */
  get reliefM(): number {
    return this.source.maxMeters - this.source.minMeters;
  }

  /**
   * Metros sobre el nivel del mar en una coordenada continua de malla.
   *
   * Bilineal con suavizado de Hermite: una bilineal a secas deja pliegues
   * visibles en las líneas que unen centros de celda, y el ojo los lee como la
   * cuadrícula que precisamente se quiere disolver.
   */
  metersAt(gx: number, gy: number): number {
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = smoothstep(Math.min(1, Math.max(0, gx - x0)));
    const ty = smoothstep(Math.min(1, Math.max(0, gy - y0)));

    const a = this.source.metersAt(x0, y0);
    const b = this.source.metersAt(x0 + 1, y0);
    const c = this.source.metersAt(x0, y0 + 1);
    const d = this.source.metersAt(x0 + 1, y0 + 1);

    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  /** Altura en unidades de mundo, con la exageración aplicada. */
  heightAt(gx: number, gy: number): number {
    return (this.metersAt(gx, gy) - this.source.minMeters) * VERTICAL_EXAGGERATION;
  }

  /**
   * Sombreado de relieve en [0, 1].
   *
   * ESTO ES LO QUE HACE VISIBLE LA FORMA BAJO EL COLOR DEL DATO. Es la técnica
   * clásica de la cartografía: el TONO lo pone el análisis y la LUMINOSIDAD la
   * pone el terreno. Sin ella, un mapa de calor sobre una superficie ondulada se
   * ve como una mancha plana, porque el color saturado tapa cualquier
   * sombreado del material.
   *
   * Se calcula desde la pendiente real del campo, en METROS y no en unidades
   * exageradas: el sombreado describe el terreno, no su representación. La
   * exageración se aplica aparte, para que sea perceptible.
   */
  hillshadeAt(gx: number, gy: number, sunAzimuthRad = Math.PI * 1.25, sunAltitudeRad = 0.62): number {
    /*
     * El estencil abarca una celda completa a cada lado, y no media.
     *
     * La interpolación de Hermite da una superficie continua, pero su DERIVADA
     * solo es continua a trozos: cambia de golpe al cruzar el borde de una
     * celda. El sombreado se calcula precisamente de esa derivada, así que
     * amplifica esas juntas y el terreno salía con bandas paralelas —una por
     * fila de celdas— que no existen en el dato.
     *
     * Midiendo la pendiente sobre una celda entera, la medida promedia el salto
     * en vez de tropezar con él, y las bandas desaparecen sin perder relieve:
     * la variación real del campo ocurre a unos 5 m.
     *
     * `h` está en CELDAS y el denominador en METROS. Son unidades distintas a
     * propósito: el estencil se elige sobre la rejilla del dato y la pendiente
     * es una magnitud física.
     */
    const h = 1;
    const paso = 2 * h * this.cellSizeM;
    const dzdx = (this.metersAt(gx + h, gy) - this.metersAt(gx - h, gy)) / paso;
    const dzdy = (this.metersAt(gx, gy + h) - this.metersAt(gx, gy - h)) / paso;

    // Se exagera la pendiente igual que la altura: si no, con 3 m de desnivel el
    // sombreado sería tan tenue que no aportaría nada.
    const ex = dzdx * VERTICAL_EXAGGERATION;
    const ey = dzdy * VERTICAL_EXAGGERATION;

    const slope = Math.atan(Math.hypot(ex, ey));
    const aspect = Math.atan2(ey, -ex);

    const zenith = Math.PI / 2 - sunAltitudeRad;
    const shade =
      Math.cos(zenith) * Math.cos(slope) +
      Math.sin(zenith) * Math.sin(slope) * Math.cos(sunAzimuthRad - aspect);

    return Math.min(1, Math.max(0, shade));
  }

  /**
   * Rejilla de sombreado, para multiplicarla en la textura de análisis.
   *
   * Se devuelve en orden de textura —fila 0 = norte— porque su destino es un
   * lienzo, no la malla de datos.
   */
  hillshadeGrid(size: number, smoothRadius = 3): Float32Array {
    const raw = new Float32Array(size * size);
    const { width, height } = this.source;

    for (let py = 0; py < size; py += 1) {
      for (let px = 0; px < size; px += 1) {
        const gx = (px / (size - 1)) * (width - 1);
        // Fila 0 de la textura es el norte, y el norte es y máximo.
        const gy = (1 - py / (size - 1)) * (height - 1);
        raw[py * size + px] = this.hillshadeAt(gx, gy);
      }
    }

    /*
     * SUAVIZADO DEL SOMBREADO, y hace falta.
     *
     * La interpolación de Hermite es continua pero su derivada cambia de tramo
     * al cruzar cada borde de celda. El sombreado se calcula de esa derivada, y
     * al recorrer la rejilla esos cambios aparecen a intervalos regulares: el
     * terreno salía con ondas paralelas, una por fila de celdas, que no existen
     * en el dato.
     *
     * Ampliar el estencil del gradiente no lo arregla —desplaza la periodicidad
     * en vez de quitarla—. Lo que la quita es promediar la señal ya calculada.
     * Es legítimo porque el sombreado NO es dato: es una ayuda visual para leer
     * la forma, y suavizarla no cambia ninguna cifra.
     */
    return boxBlur(boxBlur(raw, size, smoothRadius), size, smoothRadius);
  }

  /**
   * Curvas de nivel reales, a intervalos fijos de elevación.
   *
   * Son DATO, no adorno: cada línea une puntos de la misma altura. Es lo que
   * convierte una superficie coloreada en una carta topográfica, y lo que
   * permite leer la forma incluso cuando el mapa de calor es plano.
   *
   * Marching squares sobre el campo interpolado. Devuelve pares de puntos en
   * coordenadas continuas de malla.
   */
  contours(intervalM: number): { level: number; points: [number, number][] }[] {
    const { width, height } = this.source;
    const start = Math.ceil(this.source.minMeters / intervalM) * intervalM;
    const result: { level: number; points: [number, number][] }[] = [];

    for (let level = start; level < this.source.maxMeters; level += intervalM) {
      const points: [number, number][] = [];

      for (let y = 0; y < height - 1; y += 1) {
        for (let x = 0; x < width - 1; x += 1) {
          const v = [
            this.source.metersAt(x, y),
            this.source.metersAt(x + 1, y),
            this.source.metersAt(x + 1, y + 1),
            this.source.metersAt(x, y + 1),
          ];

          let code = 0;
          if (v[0]! >= level) code |= 1;
          if (v[1]! >= level) code |= 2;
          if (v[2]! >= level) code |= 4;
          if (v[3]! >= level) code |= 8;
          if (code === 0 || code === 15) continue;

          const cross = (
            ax: number, ay: number, av: number,
            bx: number, by: number, bv: number,
          ): [number, number] => {
            const d = bv - av;
            const t = d === 0 ? 0.5 : Math.min(1, Math.max(0, (level - av) / d));
            return [ax + (bx - ax) * t, ay + (by - ay) * t];
          };

          const bottom = () => cross(x, y, v[0]!, x + 1, y, v[1]!);
          const right = () => cross(x + 1, y, v[1]!, x + 1, y + 1, v[2]!);
          const top = () => cross(x, y + 1, v[3]!, x + 1, y + 1, v[2]!);
          const left = () => cross(x, y, v[0]!, x, y + 1, v[3]!);

          const edges: Record<number, [() => [number, number], () => [number, number]][]> = {
            1: [[left, bottom]],
            2: [[bottom, right]],
            3: [[left, right]],
            4: [[right, top]],
            5: [[left, top], [bottom, right]],
            6: [[bottom, top]],
            7: [[left, top]],
            8: [[top, left]],
            9: [[top, bottom]],
            10: [[top, left], [right, bottom]],
            11: [[top, right]],
            12: [[right, left]],
            13: [[right, bottom]],
            14: [[bottom, left]],
          };

          for (const [a, b] of edges[code] ?? []) points.push(a(), b());
        }
      }

      if (points.length > 0) result.push({ level, points });
    }

    return result;
  }
}
