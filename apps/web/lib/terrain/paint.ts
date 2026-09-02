/**
 * Las texturas del terreno.
 *
 * Aquí se COMPONEN las dos ramas, y es el único sitio donde se tocan. La regla,
 * tomada de la cartografía clásica:
 *
 *     la elevación pone la LUMINOSIDAD  (sombreado de relieve)
 *     el análisis pone el TONO          (rampa de riesgo / rendimiento)
 *
 * Ninguna de las dos puede alterar a la otra. El sombreado llega ya calculado
 * desde `ElevationField` y no sabe nada de riesgo; los colores llegan de
 * `analysis.ts` y no saben nada de pendientes.
 *
 * VISTA CAMPO — césped uniforme con surcos. El color no codifica ningún dato; el
 * relieve lo revela la luz de la escena sobre la malla real.
 *
 * VISTA ANALISIS — mapa de calor continuo CON sombreado de relieve encima. Sin
 * ese sombreado, un color saturado y plano tapa cualquier iluminación del
 * material y el terreno se ve como una mancha: es exactamente el fallo de que
 * "el heatmap domine la geometría".
 */

/** Lado del lienzo del terreno. 1024 sobre 20 m da ~51 px por metro. */
export const PAINT_SIZE = 1024;

/**
 * Resolución del sombreado.
 *
 * La mitad del lienzo y no un cuarto: a 256 px la ampliación a 1024 era de 4x y
 * la interpolación reintroducía escalones justo donde el dither los acababa de
 * repartir. A 512 el salto es de 2x y el degradado sobrevive.
 */
export const SHADE_SIZE = 512;

/** Hileras por metro. Un surco cada 40 cm, como un cultivo en línea. */
const ROWS_PER_METER = 2.5;

/**
 * Ruido de valor con interpolación suave.
 *
 * Es el mismo tipo de ruido que usa el generador sintético del backend, por la
 * misma razón: el azar puro se ve como televisión sin señal, no como un campo.
 */
function valueNoise(seed: number) {
  const hash = (x: number, y: number) => {
    const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const fade = (t: number) => t * t * (3 - 2 * t);

  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = fade(x - xi);
    const yf = fade(y - yi);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf;
  };
}

const patches = valueNoise(11);
const grain = valueNoise(29);
const wobble = valueNoise(53);

/**
 * Perfil del surco en un punto, de 0 (fondo) a 1 (lomo).
 *
 * Las hileras se ondulan: unas líneas perfectamente rectas leen como un patrón
 * CSS, y un surco real sigue el terreno. El exponente hace el surco marcado y el
 * lomo ancho, que es la forma de un caballón y no una sinusoide simétrica.
 */
function furrow(mx: number, my: number): number {
  const drift = (wobble(mx * 0.5, my * 0.5) - 0.5) * 0.35;
  const phase = (my + drift) * ROWS_PER_METER * Math.PI * 2;
  return Math.pow(Math.abs(Math.cos(phase)), 0.55);
}

/**
 * Césped de la vista Campo.
 *
 * Verde uniforme: el color NO codifica ningún dato. Lo que varía es el brillo, y
 * solo por tres razones físicas —manchas de vigor, los surcos, y el grano de la
 * hierba—, que es lo que distingue una foto de dron de un rectángulo verde.
 */
export function createGrassCanvas(meters: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = PAINT_SIZE;
  canvas.height = PAINT_SIZE;
  const ctx = canvas.getContext("2d")!;

  const image = ctx.createImageData(PAINT_SIZE, PAINT_SIZE);
  const data = image.data;
  const pxPerMeter = PAINT_SIZE / meters;

  // Verde de cultivo sano: apagado y algo amarillento, no el verde saturado de
  // un campo de futbol.
  const BASE = [86, 122, 52] as const;
  const SUELO = [96, 78, 48] as const;

  for (let py = 0; py < PAINT_SIZE; py += 1) {
    for (let px = 0; px < PAINT_SIZE; px += 1) {
      const mx = px / pxPerMeter;
      const my = py / pxPerMeter;

      const patch = patches(mx * 0.28, my * 0.28);
      const row = furrow(mx, my);
      const soil = grain(mx * 9, my * 9) * 0.5 + grain(mx * 26, my * 26) * 0.5;

      // En el fondo del surco asoma la tierra; en el lomo, la planta.
      const tierra = Math.max(0, 0.42 - row) * 1.6;
      const brillo = (0.78 + patch * 0.3) * (0.72 + row * 0.4) * (0.92 + soil * 0.16);

      const offset = (py * PAINT_SIZE + px) * 4;
      for (let c = 0; c < 3; c += 1) {
        const verde = BASE[c]! * brillo;
        const marron = SUELO[c]! * brillo;
        data[offset + c] = Math.max(
          0,
          Math.min(255, Math.round(verde * (1 - tierra) + marron * tierra)),
        );
      }
      data[offset + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Mapa de normales de los surcos.
 *
 * Es lo que hace que los surcos EXISTAN para la luz. Sin él, las hileras son un
 * dibujo sobre una superficie lisa y desaparecen en cuanto la cámara gira.
 */
export function createNormalCanvas(meters: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = PAINT_SIZE;
  canvas.height = PAINT_SIZE;
  const ctx = canvas.getContext("2d")!;

  const image = ctx.createImageData(PAINT_SIZE, PAINT_SIZE);
  const data = image.data;
  const pxPerMeter = PAINT_SIZE / meters;
  const h = 1 / pxPerMeter;
  const AMPLITUD = 0.07;

  for (let py = 0; py < PAINT_SIZE; py += 1) {
    for (let px = 0; px < PAINT_SIZE; px += 1) {
      const mx = px / pxPerMeter;
      const my = py / pxPerMeter;

      const dx = (furrow(mx + h, my) - furrow(mx - h, my)) * AMPLITUD;
      const dy = (furrow(mx, my + h) - furrow(mx, my - h)) * AMPLITUD;

      let nx = -dx;
      let ny = -dy;
      let nz = 2 * h;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;

      const offset = (py * PAINT_SIZE + px) * 4;
      data[offset] = Math.round((nx * 0.5 + 0.5) * 255);
      data[offset + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[offset + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[offset + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Lienzo de sombreado a partir de la rejilla que da `ElevationField`.
 *
 * Se construye una vez por lote: la elevación no cambia al cambiar de métrica.
 */
export function createShadeCanvas(shade: Float32Array, size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(size, size);

  /*
   * CONTRASTE DEL SOMBREADO.
   *
   * El sombreado crudo de un terreno tan suave se agrupa alrededor del gris
   * medio, y en modo `overlay` el gris medio no hace NADA: deja el color tal
   * cual. Sin separar los valores del centro, la composición no cambiaba nada y
   * el mapa de calor seguía tapando la forma.
   *
   * Se estira la señal alrededor de 0,5, que es el punto neutro del `overlay`.
   */
  const CONTRAST = 1.9;

  /*
   * DITHER, y no es un detalle.
   *
   * Un lienzo solo guarda 8 bits por canal. Sobre un sombreado tan suave, valores
   * contiguos caen en el mismo entero y forman mesetas; el estirado de contraste
   * multiplica el salto entre mesetas por 1,9 y las vuelve visibles. En pantalla
   * aparecían BANDAS PARALELAS A LAS CURVAS DE NIVEL —que es exactamente lo que
   * son: líneas de igual luminancia— y se leían como estructura del terreno
   * cuando no existían en el dato.
   *
   * Sumar medio escalón de ruido antes de redondear reparte ese error entre
   * píxeles vecinos: el ojo integra y ve el degradado continuo. Es la misma razón
   * por la que se aplica dither al reducir la profundidad de color de una imagen.
   *
   * Media unidad, ni más: con más, el sombreado empieza a verse granuloso.
   */
  const DITHER = 0.5 / 255;

  for (let i = 0; i < size * size; i += 1) {
    const raw = Math.min(1, Math.max(0, shade[i] ?? 0.5));
    const stretched = 0.5 + (raw - 0.5) * CONTRAST + (Math.random() - 0.5) * 2 * DITHER;
    const v = Math.round(Math.min(1, Math.max(0, stretched)) * 255);
    image.data[i * 4] = v;
    image.data[i * 4 + 1] = v;
    image.data[i * 4 + 2] = v;
    image.data[i * 4 + 3] = 255;
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Vista de análisis: mapa de calor continuo con el relieve tallado encima.
 *
 * Tres pasos, y el orden importa:
 *
 *  1. El dato. Las 400 muestras se escalan en dos tramos —a 128 px y de ahí al
 *     tamaño final— porque llevar 20 px a 1024 de una vez produce bloques
 *     incluso con el suavizado activado.
 *
 *  2. EL RELIEVE, en modo `overlay`. Oscurece por debajo del gris medio y aclara
 *     por encima, así que talla la forma SIN mover el tono: una celda roja sigue
 *     siendo roja, pero ahora tiene ladera. Es el paso que separa "mapa de calor
 *     sobre un plano" de "terreno con datos encima".
 *
 *  3. Un velo mínimo para que las vaguadas no se cierren a negro.
 *
 * La fila 0 del dato es el SUR y la fila 0 de una textura es el norte, así que
 * las muestras se vuelcan invertidas. El sombreado ya viene en orden de textura.
 */
export function paintAnalysis(
  target: HTMLCanvasElement,
  rgb: Uint8ClampedArray,
  gridWidth: number,
  gridHeight: number,
  shade: HTMLCanvasElement | null,
): void {
  const ctx = target.getContext("2d")!;

  const cells = document.createElement("canvas");
  cells.width = gridWidth;
  cells.height = gridHeight;
  const cellsCtx = cells.getContext("2d")!;
  const image = cellsCtx.createImageData(gridWidth, gridHeight);

  for (let y = 0; y < gridHeight; y += 1) {
    for (let x = 0; x < gridWidth; x += 1) {
      const source = ((gridHeight - 1 - y) * gridWidth + x) * 3;
      const dest = (y * gridWidth + x) * 4;
      image.data[dest] = rgb[source] ?? 0;
      image.data[dest + 1] = rgb[source + 1] ?? 0;
      image.data[dest + 2] = rgb[source + 2] ?? 0;
      image.data[dest + 3] = 255;
    }
  }
  cellsCtx.putImageData(image, 0, 0);

  const mid = document.createElement("canvas");
  mid.width = 128;
  mid.height = 128;
  const midCtx = mid.getContext("2d")!;
  midCtx.imageSmoothingEnabled = true;
  midCtx.imageSmoothingQuality = "high";
  midCtx.drawImage(cells, 0, 0, 128, 128);

  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.filter = "blur(7px)";
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(mid, 0, 0, PAINT_SIZE, PAINT_SIZE);
  ctx.filter = "none";

  if (shade) {
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = 0.9;
    ctx.drawImage(shade, 0, 0, PAINT_SIZE, PAINT_SIZE);
    ctx.globalAlpha = 1;
  }

  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = "rgb(16, 14, 10)";
  ctx.fillRect(0, 0, PAINT_SIZE, PAINT_SIZE);
  ctx.globalCompositeOperation = "source-over";
}
