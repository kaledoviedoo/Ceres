"use client";

/**
 * El terreno 3D. Sustituye a `CellGrid` sin cambiar nada a su alrededor.
 *
 * Cumple el mismo contrato estrecho: recibe celdas ya calculadas y emite
 * `cell_id` al seleccionar. No pide datos, no calcula agricultura y no conoce
 * el store ni el cliente de API. Por eso `page.tsx`, el inspector y `ceresApi`
 * no se enteran de cuál de las dos vistas está montada.
 *
 * BUCLE DE RENDER
 * `frameloop="demand"` es la decisión que sostiene todo lo demás: la escena
 * solo se dibuja cuando algo cambia —cámara, hover, selección, datos—. Sin eso,
 * un canvas de WebGL consume una GPU entera para no mostrar nada nuevo.
 *
 * ESTADO EFÍMERO
 * El hover vive en referencias, no en React ni en el store. La celda bajo el
 * cursor cambia decenas de veces por segundo y no le interesa a nadie fuera de
 * esta escena.
 */

import { Canvas } from "@react-three/fiber";
import { useCallback, useMemo, useRef, useState } from "react";
import { PCFShadowMap } from "three";

import { CameraRig, type CameraHandle } from "@/components/terrain/CameraRig";
import { CompassRose, type CompassHandle } from "@/components/terrain/CompassRose";
import { HoverLabel, type HoverLabelHandle } from "@/components/terrain/HoverLabel";
import { SelectionMarker } from "@/components/terrain/SelectionMarker";
import { TerrainLighting } from "@/components/terrain/TerrainLighting";
import { TerrainMesh } from "@/components/terrain/TerrainMesh";
import { AccessibleCellLayer } from "@/components/terrain/AccessibleCellLayer";
import { metricRange, type ViewMode } from "@/lib/presentation/risk";
import { elevationRange, plotExtent } from "@/lib/terrain/geometry";
import type { TerrainCell } from "@/lib/terrain/types";

export interface TerrainCanvasProps {
  cells: TerrainCell[];
  gridWidth: number;
  gridHeight: number;
  viewMode: ViewMode;
  selectedCellId: string | null;
  onSelect: (cellId: string) => void;
}

function usePrefersReducedMotion(): boolean {
  const [reduced] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  return reduced;
}

export function TerrainCanvas({
  cells,
  gridWidth,
  gridHeight,
  viewMode,
  selectedCellId,
  onSelect,
}: TerrainCanvasProps) {
  const hoverLabel = useRef<HoverLabelHandle>(null);
  const compass = useRef<CompassHandle>(null);
  const camera = useRef<CameraHandle>(null);
  const reducedMotion = usePrefersReducedMotion();

  const extent = plotExtent(gridWidth, gridHeight);
  const range = useMemo(() => metricRange(cells, viewMode), [cells, viewMode]);
  const elevation = useMemo(() => elevationRange(cells), [cells]);

  const selectedCell = useMemo(
    () => cells.find((cell) => cell.cell_id === selectedCellId) ?? null,
    [cells, selectedCellId],
  );

  // Imperativo a propósito: mover el ratón no debe repintar nada de React.
  const handleHover = useCallback(
    (cell: TerrainCell | null, clientX: number, clientY: number) => {
      if (cell) hoverLabel.current?.show(cell, clientX, clientY);
      else hoverLabel.current?.hide();
    },
    [],
  );

  // Igual con el compás: orbitar cambia el ángulo de forma continua.
  const handleCameraMove = useCallback(() => {
    compass.current?.setAzimuth(camera.current?.azimuth() ?? 0);
  }, []);

  const handleFocusCell = useCallback((cell: TerrainCell | null) => {
    if (cell) hoverLabel.current?.hide();
  }, []);

  return (
    <div className="relative h-full w-full">
      <Canvas
        // Solo se dibuja cuando algo cambia: cámara, hover, selección o datos.
        // Una escena parada no consume nada.
        frameloop="demand"
        // `percentage` y no el valor por defecto: PCFSoftShadowMap está
        // deprecado en esta versión de Three y avisa por consola en cada carga.
        shadows={{ type: PCFShadowMap }}
        dpr={[1, 2]}
        camera={{ position: [extent * 0.8, extent * 1.05, extent * 1.15], fov: 36 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        // Los datos viven en la capa accesible: un canvas no es recorrible.
        aria-hidden="true"
        className="h-full w-full"
      >
        <color attach="background" args={["#0b0d0c"]} />
        {/* Niebla lejana: separa el lote del fondo y da sensación de escala. */}
        <fog attach="fog" args={["#0b0d0c", extent * 2.2, extent * 4.2]} />

        <TerrainLighting extent={extent} />

        <TerrainMesh
          cells={cells}
          gridWidth={gridWidth}
          gridHeight={gridHeight}
          viewMode={viewMode}
          range={range}
          selectedCellId={selectedCellId}
          onHover={handleHover}
          onSelect={onSelect}
        />

        {selectedCell && (
          <SelectionMarker
            cell={selectedCell}
            gridWidth={gridWidth}
            gridHeight={gridHeight}
            elevation={elevation}
          />
        )}

        <CameraRig
          extent={extent}
          handle={camera}
          onMove={handleCameraMove}
          reducedMotion={reducedMotion}
        />
      </Canvas>

      <AccessibleCellLayer
        cells={cells}
        gridWidth={gridWidth}
        gridHeight={gridHeight}
        selectedCellId={selectedCellId}
        onSelect={onSelect}
        onFocusCell={handleFocusCell}
      />

      <HoverLabel handle={hoverLabel} />

      <div className="pointer-events-auto absolute bottom-4 right-4 z-20">
        <CompassRose
          handle={compass}
          onZoomIn={() => camera.current?.zoom(0.8)}
          onZoomOut={() => camera.current?.zoom(1.25)}
          onReset={() => camera.current?.reset()}
        />
      </div>
    </div>
  );
}
