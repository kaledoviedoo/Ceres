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

import type { MetricRange, ViewMode } from "@/lib/presentation/risk";
import { metricRgb, zoneContour } from "@/lib/terrain/analysis";
import { CELL_SIZE, cellBounds, gridToWorld, worldToGrid } from "@/lib/terrain/coords";
import type { ElevationField } from "@/lib/terrain/elevation";
import { buildSkirt, buildTerrainMesh, drapeOnTerrain } from "@/lib/terrain/geometry";
import {
  PAINT_SIZE,
  SHADE_SIZE,
  createGrassCanvas,
  createNormalCanvas,
  createShadeCanvas,
  paintAnalysis,
} from "@/lib/terrain/paint";
import type { TerrainCell } from "@/lib/terrain/types";
import type { SurfaceStyle } from "@/stores/useCeresStore";

/** Hueso: cursor y borde del lote. Acromático: nunca se lee como un nivel. */
const SIGNAL = "#f2efe8";

/** Segmentos por lado del cursor: bastantes para que abrace el relieve. */
const CURSOR_SEGMENTS = 6;

/** Cuanto puede moverse el puntero entre pulsar y soltar y seguir siendo un
 *  clic. Por encima de eso el gesto fue un giro de camara. */
const DRAG_SLOP_PX = 5;

/**
 * Separación entre curvas de nivel, en metros.
 *
 * Medio metro sobre un desnivel de 3 m da cinco o seis curvas: suficientes para
 * leer la forma, pocas para no convertirse en textura. Es la misma decisión que
 * toma un cartógrafo al elegir la equidistancia de una hoja.
 */
const CONTOUR_INTERVAL_M = 0.5;

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
  gridWidth: number;
  gridHeight: number;
  viewMode: ViewMode;
  range: MetricRange;
  surfaceStyle: SurfaceStyle;
  onHover: (cell: TerrainCell | null, clientX: number, clientY: number) => void;
  onSelect: (cellId: string) => void;
  handle?: RefObject<TerrainSurfaceHandle | null>;
}

export function TerrainSurface({
  field,
  cells,
  gridWidth,
  gridHeight,
  viewMode,
  range,
  surfaceStyle,
  onHover,
  onSelect,
  handle,
}: TerrainSurfaceProps) {
  const invalidate = useThree((state) => state.invalidate);
  const domElement = useThree((state) => state.gl.domElement);
  const cursorRef = useRef<CursorHandle>(null);
  const hovered = useRef<string | null>(null);

  const worldWidth = gridWidth * CELL_SIZE;

  // ═══ RAMA GEOMETRICA ═══════════════════════════════════════════════════════
  // Estas tres líneas solo ven `field`. Ni una celda entra aquí.

  const geometry = useMemo(
    () => buildTerrainMesh(field, gridWidth, gridHeight),
    [field, gridWidth, gridHeight],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  const skirt = useMemo(
    () => buildSkirt(field, gridWidth, gridHeight),
    [field, gridWidth, gridHeight],
  );
  useEffect(() => () => skirt.dispose(), [skirt]);

  /** Curvas de nivel: dato de elevación, no adorno. Une puntos de igual altura. */
  const contours = useMemo(
    () =>
      field
        .contours(CONTOUR_INTERVAL_M)
        .map((c) => drapeOnTerrain(c.points, field, gridWidth, gridHeight, 0.03)),
    [field, gridWidth, gridHeight],
  );

  /** Sombreado de relieve. Sale de la elevación y no cambia con la métrica. */
  const shadeCanvas = useMemo(
    () => createShadeCanvas(field.hillshadeGrid(SHADE_SIZE), SHADE_SIZE),
    [field],
  );

  const border = useMemo(() => {
    const puntos: [number, number][] = [];
    const pasos = Math.max(gridWidth, gridHeight) * 2;
    const esquinas: [number, number][] = [
      [-0.5, -0.5],
      [gridWidth - 0.5, -0.5],
      [gridWidth - 0.5, gridHeight - 0.5],
      [-0.5, gridHeight - 0.5],
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
    return drapeOnTerrain(puntos, field, gridWidth, gridHeight, 0.02);
  }, [field, gridWidth, gridHeight]);

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

  // Composición: el tono lo pone el dato, la luminosidad el terreno.
  useEffect(() => {
    const rgb = metricRgb(cells, gridWidth, gridHeight, viewMode, range);
    paintAnalysis(proCanvas, rgb, gridWidth, gridHeight, shadeCanvas);
    markDirty(proTexture);
    invalidate();
  }, [cells, gridWidth, gridHeight, viewMode, range, proCanvas, proTexture, shadeCanvas, invalidate]);

  /** Contorno de la zona en riesgo alto, proyectado sobre el relieve. */
  const zone = useMemo(() => {
    if (surfaceStyle === "lindo") return [];
    return drapeOnTerrain(
      zoneContour(cells, gridWidth, gridHeight, "high"),
      field,
      gridWidth,
      gridHeight,
      0.05,
    );
  }, [surfaceStyle, cells, field, gridWidth, gridHeight]);

  // ═══ MATERIALES ════════════════════════════════════════════════════════════
  // Perezosas: construir las texturas de césped cuesta ~300 ms de bucle sobre
  // dos millones de píxeles, y quien no entra en esa vista no debe pagarlo.
  const pretty = useMemo(() => {
    if (surfaceStyle !== "lindo") return null;

    const grass = new CanvasTexture(createGrassCanvas(worldWidth));
    grass.colorSpace = SRGBColorSpace;
    grass.minFilter = LinearFilter;
    grass.magFilter = LinearFilter;
    grass.anisotropy = 8;

    const normal = new CanvasTexture(createNormalCanvas(worldWidth));
    normal.minFilter = LinearFilter;
    normal.magFilter = LinearFilter;
    normal.wrapS = RepeatWrapping;
    normal.wrapT = RepeatWrapping;
    normal.anisotropy = 8;

    return { grass, normal };
  }, [surfaceStyle, worldWidth]);

  useEffect(() => {
    if (!pretty) return;
    return () => {
      pretty.grass.dispose();
      pretty.normal.dispose();
    };
  }, [pretty]);

  const material = useMemo(() => {
    if (pretty) {
      return new MeshStandardMaterial({
        map: pretty.grass,
        normalMap: pretty.normal,
        roughness: 0.95,
        metalness: 0,
      });
    }
    // Casi mate: un brillo especular sobre una celda roja la aclara y la hace
    // parecer de otro nivel. El relieve ya lo aporta el sombreado de la textura.
    return new MeshStandardMaterial({ map: proTexture, roughness: 0.97, metalness: 0 });
  }, [pretty, proTexture]);

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
      const [gx, gy] = worldToGrid(worldX, worldZ, gridWidth, gridHeight);
      const x = Math.round(gx);
      const y = Math.round(gy);
      if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) return null;
      return byPosition.get(`${x},${y}`) ?? null;
    },
    [byPosition, gridWidth, gridHeight],
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
      // Umbral, no igualdad: al pulsar sin querer mover, el raton se desplaza
      // uno o dos pixeles y eso sigue siendo un clic.
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > DRAG_SLOP_PX) {
        return;
      }

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
          opacity={surfaceStyle === "lindo" ? 0.2 : 0.38}
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
        gridWidth={gridWidth}
        gridHeight={gridHeight}
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
  gridWidth,
  gridHeight,
}: {
  handle: RefObject<CursorHandle | null>;
  field: ElevationField;
  gridWidth: number;
  gridHeight: number;
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
        const [wx, wz] = gridToWorld(gx, gy, gridWidth, gridHeight);
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
