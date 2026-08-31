"use client";

/**
 * Marcador de la celda seleccionada: un vástago que sale de su cara superior.
 *
 * No es decorativo. Con la cámara orbitando, un resaltado plano sobre la
 * superficie desaparece en cuanto la celda queda detrás de otra o el ángulo se
 * vuelve rasante. Un elemento vertical sobresale del relieve y sigue diciendo
 * "esta es" desde cualquier posición.
 *
 * Es lo mismo que hacen los jalones de un topógrafo, y por la misma razón.
 */

import { useMemo } from "react";
import { Color } from "three";

import { cellHeight, cellTop, type ElevationRange } from "@/lib/terrain/geometry";
import type { TerrainCell } from "@/lib/terrain/types";

const SIGNAL = new Color("#edeae3");

/** Alto del jalón sobre la celda, en unidades de mundo. */
const STEM_HEIGHT = 2.6;

interface SelectionMarkerProps {
  cell: TerrainCell;
  gridWidth: number;
  gridHeight: number;
  elevation: ElevationRange;
}

export function SelectionMarker({
  cell,
  gridWidth,
  gridHeight,
  elevation,
}: SelectionMarkerProps) {
  const { base, tip } = useMemo(() => {
    const height = cellHeight(cell.elevation_m, elevation);
    const [x, y, z] = cellTop(cell.x, cell.y, height, gridWidth, gridHeight);
    return {
      base: [x, y, z] as [number, number, number],
      tip: [x, y + STEM_HEIGHT, z] as [number, number, number],
    };
  }, [cell, gridWidth, gridHeight, elevation]);

  return (
    <group>
      {/* Vástago. Fino para no tapar la celda que señala. */}
      <mesh position={[base[0], base[1] + STEM_HEIGHT / 2, base[2]]}>
        <cylinderGeometry args={[0.035, 0.035, STEM_HEIGHT, 8]} />
        <meshBasicMaterial color={SIGNAL} toneMapped={false} />
      </mesh>

      {/* Remate. Da un punto de fijación claro a la vista. */}
      <mesh position={tip}>
        <sphereGeometry args={[0.14, 16, 12]} />
        <meshBasicMaterial color={SIGNAL} toneMapped={false} />
      </mesh>

      {/* Anillo apoyado en la superficie: ancla el jalón a su celda cuando la
          cámara está alta y el vástago se ve escorzado. */}
      <mesh position={[base[0], base[1] + 0.09, base[2]]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.42, 0.52, 32]} />
        <meshBasicMaterial color={SIGNAL} toneMapped={false} transparent opacity={0.9} />
      </mesh>
    </group>
  );
}
