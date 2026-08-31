"use client";

/**
 * El terreno: un bloque de tierra de 20 × 20 m con la capa de análisis encima.
 *
 * Son dos mallas instanciadas, no cuatrocientos objetos:
 *
 *   blocks   → el volumen de suelo. Color tierra, altura según la elevación.
 *   surface  → una losa fina sobre cada bloque, pintada con la métrica activa.
 *
 * Separar las dos es lo que hace que el terreno se lea como una parcela física
 * con una capa analítica encima, en lugar de como un gráfico de barras. Y son
 * dos llamadas de dibujo en total, no cuatrocientas.
 *
 * RENDIMIENTO
 * - Geometrías y materiales se crean una vez y no se recrean nunca.
 * - Los objetos de trabajo (matriz, color) están en el ámbito del módulo: cero
 *   reservas de memoria por evento o por fotograma.
 * - El hover NO pasa por React. Escribe dos colores de instancia y pide un
 *   fotograma. Mover el ratón no provoca ningún render del árbol.
 * - La escena se dibuja bajo demanda (`frameloop="demand"`), así que cuando
 *   nadie toca nada no se consume nada.
 */

import { useThree, type ThreeEvent } from "@react-three/fiber";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  Color,
  type InstancedMesh,
  MeshStandardMaterial,
  Object3D,
} from "three";

import type { MetricRange, ViewMode } from "@/lib/presentation/risk";
import {
  BASE_THICKNESS,
  CELL_SIZE,
  cellHeight,
  cellPosition,
  elevationRange,
} from "@/lib/terrain/geometry";
import { SOIL_SIDE, surfaceColor } from "@/lib/terrain/palette";
import type { TerrainCell } from "@/lib/terrain/types";

/** Grosor de la losa analítica. Fina: es una capa sobre el suelo, no un cubo. */
const SURFACE_THICKNESS = 0.14;

/** Cuánto se aclara la celda bajo el cursor y cuánto la seleccionada. */
const HOVER_LIFT = 0.35;
const SELECTED_LIFT = 0.75;

/** Hacia donde se aclara una celda resaltada. Hueso: nunca se lee como nivel. */
const SELECTION_TINT = new Color("#edeae3");

// Objetos de trabajo. Viven aquí y no dentro de los efectos para que recorrer
// las 400 celdas no reserve 400 objetos.
const scratchObject = new Object3D();
const scratchColor = new Color();
const scratchBase = new Color();

export interface TerrainMeshProps {
  cells: TerrainCell[];
  gridWidth: number;
  gridHeight: number;
  viewMode: ViewMode;
  range: MetricRange;
  selectedCellId: string | null;
  /** Se dispara al entrar o salir de una celda. Nunca en cada fotograma. */
  onHover: (cell: TerrainCell | null, clientX: number, clientY: number) => void;
  onSelect: (cellId: string) => void;
}

export function TerrainMesh({
  cells,
  gridWidth,
  gridHeight,
  viewMode,
  range,
  selectedCellId,
  onHover,
  onSelect,
}: TerrainMeshProps) {
  const blocksRef = useRef<InstancedMesh>(null);
  const surfaceRef = useRef<InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);

  // Índice de la instancia bajo el cursor. En una referencia y no en estado:
  // cambia con cada movimiento del ratón y no debe repintar nada de React.
  const hoveredIndex = useRef(-1);

  const geometry = useMemo(() => new BoxGeometry(CELL_SIZE, 1, CELL_SIZE), []);

  const soilMaterial = useMemo(
    () =>
      new MeshStandardMaterial({
        color: SOIL_SIDE,
        roughness: 0.95,
        metalness: 0,
      }),
    [],
  );

  const surfaceMaterial = useMemo(
    () => new MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 }),
    [],
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      soilMaterial.dispose();
      surfaceMaterial.dispose();
    };
  }, [geometry, soilMaterial, surfaceMaterial]);

  const heights = useMemo(() => {
    const range = elevationRange(cells);
    return cells.map((cell) => cellHeight(cell.elevation_m, range));
  }, [cells]);

  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    cells.forEach((cell, index) => map.set(cell.cell_id, index));
    return map;
  }, [cells]);

  // --- Posiciones: solo cambian si cambian las celdas o la malla ------------
  useLayoutEffect(() => {
    const blocks = blocksRef.current;
    const surface = surfaceRef.current;
    if (!blocks || !surface) return;

    cells.forEach((cell, index) => {
      const height = heights[index] ?? BASE_THICKNESS;
      const [x, y, z] = cellPosition(cell.x, cell.y, height, gridWidth, gridHeight);

      scratchObject.position.set(x, y, z);
      scratchObject.scale.set(1, height, 1);
      scratchObject.updateMatrix();
      blocks.setMatrixAt(index, scratchObject.matrix);

      // La losa se apoya sobre la cara superior del bloque.
      scratchObject.position.set(x, height + SURFACE_THICKNESS / 2, z);
      scratchObject.scale.set(1, SURFACE_THICKNESS, 1);
      scratchObject.updateMatrix();
      surface.setMatrixAt(index, scratchObject.matrix);
    });

    blocks.instanceMatrix.needsUpdate = true;
    surface.instanceMatrix.needsUpdate = true;
    blocks.count = cells.length;
    surface.count = cells.length;
    blocks.computeBoundingSphere();
    surface.computeBoundingSphere();
    invalidate();
  }, [cells, heights, gridWidth, gridHeight, invalidate]);

  // --- Colores: cambian con el modo de vista, el hover y la selección -------
  const paint = useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const selectedIndex = selectedCellId ? (indexById.get(selectedCellId) ?? -1) : -1;

    cells.forEach((cell, index) => {
      surfaceColor(cell, viewMode, range, scratchBase);

      if (index === selectedIndex) {
        scratchColor.copy(scratchBase).lerp(SELECTION_TINT, SELECTED_LIFT);
      } else if (index === hoveredIndex.current) {
        scratchColor.copy(scratchBase).lerp(SELECTION_TINT, HOVER_LIFT);
      } else {
        scratchColor.copy(scratchBase);
      }

      surface.setColorAt(index, scratchColor);
    });

    if (surface.instanceColor) surface.instanceColor.needsUpdate = true;
    invalidate();
  }, [cells, viewMode, range, selectedCellId, indexById, invalidate]);

  useLayoutEffect(() => {
    paint();
  }, [paint]);

  // --- Interacción ----------------------------------------------------------
  // Repintar solo las dos instancias afectadas, no las 400: entrar y salir de
  // una celda cuesta dos escrituras de color.
  const repaintCell = useCallback(
    (index: number, lift: number) => {
      const surface = surfaceRef.current;
      const cell = cells[index];
      if (!surface || !cell) return;

      surfaceColor(cell, viewMode, range, scratchBase);
      if (lift > 0) scratchColor.copy(scratchBase).lerp(SELECTION_TINT, lift);
      else scratchColor.copy(scratchBase);

      surface.setColorAt(index, scratchColor);
      if (surface.instanceColor) surface.instanceColor.needsUpdate = true;
    },
    [cells, viewMode, range],
  );

  const handlePointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const index = event.instanceId;
      if (index === undefined || index === hoveredIndex.current) return;

      event.stopPropagation();

      const previous = hoveredIndex.current;
      const selectedIndex = selectedCellId ? (indexById.get(selectedCellId) ?? -1) : -1;

      if (previous >= 0 && previous !== selectedIndex) repaintCell(previous, 0);
      hoveredIndex.current = index;
      if (index !== selectedIndex) repaintCell(index, HOVER_LIFT);

      const cell = cells[index];
      if (cell) onHover(cell, event.clientX, event.clientY);
      invalidate();
    },
    [cells, indexById, selectedCellId, repaintCell, onHover, invalidate],
  );

  const handlePointerOut = useCallback(() => {
    const previous = hoveredIndex.current;
    if (previous < 0) return;

    const selectedIndex = selectedCellId ? (indexById.get(selectedCellId) ?? -1) : -1;
    if (previous !== selectedIndex) repaintCell(previous, 0);
    hoveredIndex.current = -1;
    onHover(null, 0, 0);
    invalidate();
  }, [selectedCellId, indexById, repaintCell, onHover, invalidate]);

  const handleClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      const index = event.instanceId;
      if (index === undefined) return;
      event.stopPropagation();

      const cell = cells[index];
      if (cell) onSelect(cell.cell_id);
    },
    [cells, onSelect],
  );

  return (
    <group>
      <instancedMesh
        ref={blocksRef}
        args={[geometry, soilMaterial, cells.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={surfaceRef}
        args={[geometry, surfaceMaterial, cells.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
      />
    </group>
  );
}