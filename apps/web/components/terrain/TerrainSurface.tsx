"use client";

/**
 * Donde se componen las dos ramas, y el único sitio donde se tocan.
 *
 *     ElevationField ──→ buildTerrainMesh ──→ FORMA
 *            │                                  │
 *            └──→ hillshade ────────┐           │
 *                                   ▼           ▼
 *     cells ──→ metricRgb ──→  paintAnalysis ──→ material
 *            └─→ zoneContour ─→ anotación
 *
 * La geometría se construye llamando a funciones que solo aceptan un
 * `ElevationField`. No hay ninguna vía por la que un `risk_level` pueda llegar a
 * mover un vértice.
 *
 * DOS LECTURAS DEL MISMO TERRENO
 *   CAMPO     césped y surcos. El color no codifica nada; el relieve lo revela
 *             la luz de la escena sobre la malla real.
 *   ANALISIS  mapa de calor CON sombreado de relieve compuesto encima. Sin ese
 *             sombreado, un color saturado y plano tapa la iluminación del
 *             material y el terreno se lee como una mancha.
 *
 * QUE SE PAGA CON EL RELIEVE CONTINUO
 * Lo que se ve ENTRE dos centros de celda está interpolado, no medido. El pago
 * está acotado a la imagen: el hover, el inspector y la capa accesible leen la
 * celda exacta con el valor exacto del motor. Nunca se muestra como dato un
 * número interpolado.
 */

import { Line } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, type RefObject } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  type LineSegments,
  LinearFilter,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";

import { cellBounds, gridToWorld, worldToGrid, type PlotGrid } from "@/lib/terrain/coords";
import type { ElevationField } from "@/lib/terrain/elevation";
import type { AvailableLayer } from "@/lib/terrain/layers";
import { buildSkirt, buildTerrainMesh, drapeOnTerrain } from "@/lib/terrain/geometry";
import { isClick } from "@/lib/terrain/pointer";
import {
  PAINT_SIZE,
  SHADE_SIZE,
  createGrassCanvas,
  createNormalCanvas,
  createShadeCanvas,
  paintAnalysis,
} from "@/lib/terrain/paint";
import type { TerrainCell } from "@/lib/terrain/types";

/** Hueso: cursor y borde del lote. Acromático: nunca se lee como un nivel. */
const SIGNAL = "#f2efe8";

/** Segmentos por lado del cursor: bastantes para que abrace el relieve. */
const CURSOR_SEGMENTS = 6;

/**
 * Separación entre curvas de nivel, en metros.
 *
 * Medio metro sobre un desnivel de 3 m da cinco o seis curvas: suficientes para
 * leer la forma, pocas para no convertirse en textura. Es la misma decisión que
 * toma un cartógrafo al elegir la equidistancia de una hoja.
 */
const CONTOUR_INTERVAL_M = 0.5;

interface GrassTextures {
  /** Ancho del lote en metros con el que se construyeron. */
  width: number;
  grass: CanvasTexture;
  normal: CanvasTexture;
}

/**
 * Caché de texturas de césped, a nivel de módulo y con una sola entrada.
 *
 * No es estado de componente porque no lo es conceptualmente: las texturas son
 * función pura del ancho del lote, y sobreviven a que la capa activa vaya y
 * venga. Guardarlas en `useState` obligaba a construirlas dentro de un efecto
 * —que es justo lo que no hay que hacer con un recurso caro— y guardarlas en un
 * `useMemo` las tiraba en cada cambio de capa.
 *
 * Una sola entrada: cambiar de lote libera la anterior en vez de acumular ocho
 * megas de textura por lote visitado.
 */
let grassCache: GrassTextures | null = null;

function grassTextures(meters: number): GrassTextures {
  if (grassCache?.width === meters) return grassCache;
  grassCache?.grass.dispose();
  grassCache?.normal.dispose();
  grassCache = buildGrassTextures(meters);
  return grassCache;
}

function buildGrassTextures(meters: number): GrassTextures {
  const grass = new CanvasTexture(createGrassCanvas(meters));
  grass.colorSpace = SRGBColorSpace;
  grass.minFilter = LinearFilter;
  grass.magFilter = LinearFilter;
  grass.anisotropy = 8;

  const normal = new CanvasTexture(createNormalCanvas(meters));
  normal.minFilter = LinearFilter;
  normal.magFilter = LinearFilter;
  normal.wrapS = RepeatWrapping;
  normal.wrapT = RepeatWrapping;
  normal.anisotropy = 8;

  return { width: meters, grass, normal };
}

/** Marca una textura como sucia sin escribir sobre un valor que React memoiza. */
function markDirty(texture: CanvasTexture): void {
  texture.needsUpdate = true;
}

export interface TerrainSurfaceHandle {
  /** Resalta la celda en (x, y). `null` apaga el cursor. */
  highlight: (cell: { x: number; y: number } | null) => void;
}

interface TerrainSurfaceProps {
  /** RAMA GEOMETRICA. Lo único que decide la forma del terreno. */
  field: ElevationField;
  /** RAMA ANALITICA. Solo decide el color y las anotaciones. */
  cells: TerrainCell[];
  plot: PlotGrid;
  /**
   * La capa activa. Entra por aquí y no puede salir de aquí: lo único que se le
   * pide es `paint(cells, ...)`, que no ve el campo de elevación.
   */
  layer: AvailableLayer;
  onHover: (cell: TerrainCell | null, clientX: number, clientY: number) => void;
  onSelect: (cellId: string) => void;
  handle?: RefObject<TerrainSurfaceHandle | null>;
}

export function TerrainSurface({
  field,
  cells,
  plot,
  layer,
  onHover,
  onSelect,
  handle,
}: TerrainSurfaceProps) {
  const invalidate = useThree((state) => state.invalidate);
  const domElement = useThree((state) => state.gl.domElement);
  const cursorRef = useRef<CursorHandle>(null);
  const hovered = useRef<string | null>(null);

  // Ancho FISICO del lote: es lo que decide cuántos motivos de hierba caben, y
  // la textura se genera por metro. Con celdas de 2 m, el mismo lote de 20 × 20
  // celdas mide 40 m y necesita el cuádruple de motivos, no los mismos estirados.
  const worldWidth = plot.width * plot.cellSizeM;

  // ═══ RAMA GEOMETRICA ═══════════════════════════════════════════════════════
  // Estas tres líneas solo ven `field`. Ni una celda entra aquí.

  const geometry = useMemo(
    () => buildTerrainMesh(field, plot),
    [field, plot],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  const skirt = useMemo(
    () => buildSkirt(field, plot),
    [field, plot],
  );
  useEffect(() => () => skirt.dispose(), [skirt]);

  /** Curvas de nivel: dato de elevación, no adorno. Une puntos de igual altura. */
  const contours = useMemo(
    () =>
      field
        .contours(CONTOUR_INTERVAL_M)
        .map((c) => drapeOnTerrain(c.points, field, plot, 0.03)),
    [field, plot],
  );

  /** Sombreado de relieve. Sale de la elevación y no cambia con la métrica. */
  const shadeCanvas = useMemo(
    () => createShadeCanvas(field.hillshadeGrid(SHADE_SIZE), SHADE_SIZE),
    [field],
  );

  const border = useMemo(() => {
    const puntos: [number, number][] = [];
    const pasos = Math.max(plot.width, plot.height) * 2;
    const esquinas: [number, number][] = [
      [-0.5, -0.5],
      [plot.width - 0.5, -0.5],
      [plot.width - 0.5, plot.height - 0.5],
      [-0.5, plot.height - 0.5],
    ];
    for (let lado = 0; lado < 4; lado += 1) {
      const a = esquinas[lado]!;
      const b = esquinas[(lado + 1) % 4]!;
      for (let s = 0; s < pasos; s += 1) {
        const t0 = s / pasos;
        const t1 = (s + 1) / pasos;
        puntos.push([a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0]);
        puntos.push([a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1]);
      }
    }
    return drapeOnTerrain(puntos, field, plot, 0.02);
  }, [field, plot]);

  // ═══ RAMA ANALITICA ════════════════════════════════════════════════════════
  // Estas solo ven `cells`. Ninguna toca la elevación.

  const { proCanvas, proTexture } = useMemo(() => {
    const element = document.createElement("canvas");
    element.width = PAINT_SIZE;
    element.height = PAINT_SIZE;
    const tex = new CanvasTexture(element);
    tex.colorSpace = SRGBColorSpace;
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    tex.anisotropy = 8;
    return { proCanvas: element, proTexture: tex };
  }, []);

  useEffect(() => () => proTexture.dispose(), [proTexture]);

  /**
   * Todo lo que la capa tiene que decir, calculado UNA vez.
   *
   * `paint` no recibe `field`: es el punto donde se ve que activar una capa no
   * puede llegar a la geometría.
   */
  const painted = useMemo(
    // La capa recibe RECUENTOS, nunca el `plot`. Es la misma garantía de
    // siempre vista desde el otro lado: si `paint` pudiera leer `cellSizeM`,
    // una capa podría saber cuánto mide el terreno y empezar a opinar sobre él.
    () => layer.paint(cells, plot.width, plot.height),
    [layer, cells, plot],
  );

  // Composición: el tono lo pone el dato, la luminosidad el terreno.
  useEffect(() => {
    paintAnalysis(proCanvas, painted.rgb, plot.width, plot.height, shadeCanvas);
    markDirty(proTexture);
    invalidate();
  }, [painted, plot, proCanvas, proTexture, shadeCanvas, invalidate]);

  /** Fronteras que anota la capa, proyectadas sobre el relieve. */
  const zone = useMemo(() => {
    if (painted.zones.length === 0) return [];
    return drapeOnTerrain(painted.zones, field, plot, 0.05);
  }, [painted, field, plot]);

  // ═══ MATERIALES ════════════════════════════════════════════════════════════

  /**
   * Las texturas de césped: perezosas la primera vez, y luego se quedan.
   *
   * Construirlas cuesta ~300 ms de bucle sobre dos millones de píxeles, así que
   * quien nunca abre la capa Terreno no debe pagarlo. Pero tampoco puede
   * pagarlo CADA vez que vuelve a ella: con capas, alternar Terreno ↔ Riesgo es
   * un gesto normal, y reconstruirlas en cada ida y vuelta congelaba la interfaz
   * un tercio de segundo. Se guardan mientras el lote no cambie.
   *
   * La caché vive a nivel de módulo, no en el componente: ver `grassTextures`.
   */
  const material = useMemo(() => {
    if (layer.surface === "terrain") {
      const grass = grassTextures(worldWidth);
      return new MeshStandardMaterial({
        map: grass.grass,
        normalMap: grass.normal,
        roughness: 0.95,
        metalness: 0,
      });
    }
    // Casi mate: un brillo especular sobre una celda roja la aclara y la hace
    // parecer de otro nivel. El relieve ya lo aporta el sombreado de la textura.
    return new MeshStandardMaterial({ map: proTexture, roughness: 0.97, metalness: 0 });
  }, [layer.surface, worldWidth, proTexture]);

  const soilMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: "#3b3125",
        roughness: 0.98,
        metalness: 0,
        side: DoubleSide,
      }),
    [],
  );

  useEffect(() => {
    return () => {
      material.dispose();
      soilMaterial.dispose();
    };
  }, [material, soilMaterial]);

  // ═══ INTERACCION ═══════════════════════════════════════════════════════════

  const byPosition = useMemo(() => {
    const map = new Map<string, TerrainCell>();
    for (const cell of cells) map.set(`${cell.x},${cell.y}`, cell);
    return map;
  }, [cells]);

  /**
   * Punto del mundo → celda.
   *
   * El raycast devuelve una POSICION, no un dato. Se convierte a coordenada de
   * malla y de ahí a la celda que la contiene. Cuando entre un DEM cuya malla no
   * coincida con la agrícola, esto es lo único que cambia: la posición pasará
   * por latitud y longitud en vez de por índice.
   */
  const cellAt = useCallback(
    (worldX: number, worldZ: number) => {
      const [gx, gy] = worldToGrid(worldX, worldZ, plot);
      const x = Math.round(gx);
      const y = Math.round(gy);
      if (x < 0 || x >= plot.width || y < 0 || y >= plot.height) return null;
      return byPosition.get(`${x},${y}`) ?? null;
    },
    [byPosition, plot],
  );

  const moveCursor = useCallback(
    (cell: { x: number; y: number } | null) => {
      if (cell) cursorRef.current?.show(cell.x, cell.y);
      else cursorRef.current?.hide();
      invalidate();
    },
    [invalidate],
  );

  useImperativeHandle(handle, () => ({ highlight: moveCursor }), [moveCursor]);

  const handlePointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const cell = cellAt(event.point.x, event.point.z);
      const id = cell?.cell_id ?? null;
      if (id === hovered.current) return;

      event.stopPropagation();
      hovered.current = id;
      moveCursor(cell);
      onHover(cell, event.clientX, event.clientY);
    },
    [cellAt, moveCursor, onHover],
  );

  const handlePointerOut = useCallback(() => {
    if (hovered.current === null) return;
    hovered.current = null;
    moveCursor(null);
    onHover(null, 0, 0);
  }, [moveCursor, onHover]);

  /* Orbitar y seleccionar entran por el mismo gesto: soltar el boton despues de
     arrastrar la camara disparaba un `click` sobre la celda que quedara bajo el
     cursor, asi que girar la vista cambiaba la celda abierta. Se anota donde
     empezo la pulsacion y solo cuenta como seleccion si apenas se movio.

     El listener va en el lienzo y no en la malla: un arrastre puede empezar
     sobre el cielo y terminar sobre el terreno, y ese tambien es un giro. */
  const pressAt = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const anotar = (event: PointerEvent) => {
      pressAt.current = { x: event.clientX, y: event.clientY };
    };
    domElement.addEventListener("pointerdown", anotar);
    return () => domElement.removeEventListener("pointerdown", anotar);
  }, [domElement]);

  const handleClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      const start = pressAt.current;
      pressAt.current = null;
      // El umbral vive en `pointer.ts`: es aritmetica de interaccion, y alli se
      // puede probar sin levantar WebGL.
      if (!isClick(start, { x: event.clientX, y: event.clientY })) return;

      const cell = cellAt(event.point.x, event.point.z);
      if (!cell) return;
      event.stopPropagation();
      onSelect(cell.cell_id);
    },
    [cellAt, onSelect],
  );

  return (
    <group>
      <mesh
        geometry={geometry}
        material={material}
        receiveShadow
        castShadow
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
      />

      <mesh geometry={skirt} material={soilMaterial} castShadow receiveShadow />

      {/* Curvas de nivel. Muy tenues: describen la forma sin competir con el
          dato, igual que en una carta topográfica el color va encima. */}
      {contours.map((points, i) => (
        <Line
          key={i}
          points={points}
          segments
          color={SIGNAL}
          lineWidth={1}
          transparent
          opacity={layer.surface === "terrain" ? 0.2 : 0.38}
          toneMapped={false}
        />
      ))}

      <Line
        points={border}
        segments
        color={SIGNAL}
        lineWidth={1.6}
        transparent
        opacity={0.5}
        toneMapped={false}
      />

      {zone.length > 0 && (
        <Line points={zone} segments color="#ffffff" lineWidth={2.8} toneMapped={false} />
      )}

      <Cursor
        handle={cursorRef}
        field={field}
        plot={plot}
      />
    </group>
  );
}

interface CursorHandle {
  show: (x: number, y: number) => void;
  hide: () => void;
}

/**
 * El cursor: el perímetro de la celda bajo el puntero, proyectado sobre el
 * relieve.
 *
 * Es un cuadrado, y es deliberado: el dato ES por celda de 1 m², y el cursor
 * tiene que decir exactamente cuál se está leyendo. En la vista Campo es lo
 * único que revela la cuadrícula, y ahí está su gracia: la malla aparece solo
 * donde la miras.
 *
 * Geometría reservada una vez y reescrita en el sitio: recorrer el terreno con
 * el ratón no reserva memoria.
 */
function Cursor({
  handle,
  field,
  plot,
}: {
  handle: RefObject<CursorHandle | null>;
  field: ElevationField;
  plot: PlotGrid;
}) {
  const meshRef = useRef<LineSegments>(null);

  const { geometry, positions } = useMemo(() => {
    const array = new Float32Array(4 * CURSOR_SEGMENTS * 2 * 3);
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(array, 3));
    return { geometry: geo, positions: array };
  }, []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useImperativeHandle(handle, () => ({
    show(x, y) {
      const mesh = meshRef.current;
      if (!mesh) return;

      const corners: [number, number][] = [
        [x - 0.5, y - 0.5],
        [x + 0.5, y - 0.5],
        [x + 0.5, y + 0.5],
        [x - 0.5, y + 0.5],
      ];

      let p = 0;
      const put = (gx: number, gy: number) => {
        const [wx, wz] = gridToWorld(gx, gy, plot);
        positions[p++] = wx;
        positions[p++] = field.heightAt(gx, gy) + 0.07;
        positions[p++] = wz;
      };

      for (let side = 0; side < 4; side += 1) {
        const a = corners[side]!;
        const b = corners[(side + 1) % 4]!;
        for (let s = 0; s < CURSOR_SEGMENTS; s += 1) {
          const t0 = s / CURSOR_SEGMENTS;
          const t1 = (s + 1) / CURSOR_SEGMENTS;
          put(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0);
          put(a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1);
        }
      }

      geometry.attributes.position!.needsUpdate = true;
      mesh.visible = true;
    },
    hide() {
      if (meshRef.current) meshRef.current.visible = false;
    },
  }));

  return (
    <lineSegments ref={meshRef} geometry={geometry} visible={false} frustumCulled={false}>
      <lineBasicMaterial color={SIGNAL} toneMapped={false} />
    </lineSegments>
  );
}

/** Se re-exporta para que el resto no tenga que importar de `coords`. */
export { cellBounds };
