"use client";

/**
 * El terreno 3D. Sustituye a `CellGrid` sin cambiar nada a su alrededor.
 *
 * Cumple el mismo contrato estrecho: recibe celdas ya calculadas y emite
 * `cell_id` al seleccionar. No pide datos, no calcula agricultura y no conoce
 * el store ni el cliente de API. Por eso `page.tsx`, el inspector y `ceresApi`
 * no se enteran de cuál de las dos vistas está montada.
 *
 * ENCUADRE
 * El lote LLENA el encuadre y se sale por los bordes. No es solo estética: los
 * paneles de cristal solo existen si tienen algo que refractar debajo. Con el
 * terreno flotando en medio del lienzo, el cromo caía sobre fondo plano y el
 * vidrio se veía como un rectángulo opaco. Con el campo llegando a los cuatro
 * bordes, cada panel tiene color y textura por detrás.
 *
 * El precio es que parte del lote queda fuera de vista. Se recupera con el zoom,
 * que está a un clic, y a cambio la pantalla se lee como una vista de campo y no
 * como un objeto sobre una mesa.
 *
 * BUCLE DE RENDER
 * `frameloop="demand"`: la escena solo se dibuja cuando algo cambia. `FrameGuard`
 * cubre el agujero de esa estrategia —una pestaña oculta no ejecuta rAF, así que
 * el primer fotograma nunca llegaba a dibujarse y el lienzo se quedaba negro—.
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
import { FrameGuard } from "@/components/terrain/FrameGuard";
import { HoverLabel, type HoverLabelHandle } from "@/components/terrain/HoverLabel";
import {
  ProjectionBridge,
  SceneOverlay,
  type OverlayHandle,
} from "@/components/terrain/SceneOverlay";
import { SelectionMarker } from "@/components/terrain/SelectionMarker";
import { TerrainLighting } from "@/components/terrain/TerrainLighting";
import { TerrainSurface, type TerrainSurfaceHandle } from "@/components/terrain/TerrainSurface";
import { AccessibleCellLayer } from "@/components/terrain/AccessibleCellLayer";
import { metricRange, type ViewMode } from "@/lib/presentation/risk";
import { gridToWorld, plotExtent } from "@/lib/terrain/coords";
import type { ElevationField } from "@/lib/terrain/elevation";
import type { TerrainCell } from "@/lib/terrain/types";
import type { SurfaceStyle } from "@/stores/useCeresStore";

export interface TerrainCanvasProps {
  /** Rama geométrica: lo único que decide la forma del terreno. */
  field: ElevationField;
  cells: TerrainCell[];
  gridWidth: number;
  gridHeight: number;
  viewMode: ViewMode;
  surfaceStyle: SurfaceStyle;
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
  field,
  cells,
  gridWidth,
  gridHeight,
  viewMode,
  surfaceStyle,
  selectedCellId,
  onSelect,
}: TerrainCanvasProps) {
  const hoverLabel = useRef<HoverLabelHandle>(null);
  const compass = useRef<CompassHandle>(null);
  const camera = useRef<CameraHandle>(null);
  const surface = useRef<TerrainSurfaceHandle>(null);
  const overlay = useRef<OverlayHandle>(null);
  const reducedMotion = usePrefersReducedMotion();

  const extent = plotExtent(gridWidth, gridHeight);
  const range = useMemo(() => metricRange(cells, viewMode), [cells, viewMode]);

  const selectedCell = useMemo(
    () => cells.find((cell) => cell.cell_id === selectedCellId) ?? null,
    [cells, selectedCellId],
  );

  /**
   * Punto exacto de la superficie donde se clava el jalón.
   *
   * Lo calcula la escena y no el marcador, porque la altura ya no sale de una
   * fórmula por celda sino del muestreo del relieve interpolado: el marcador no
   * tiene por qué saber cómo se construye el terreno.
   */
  const anchor = useMemo<[number, number, number] | null>(() => {
    if (!selectedCell) return null;
    const [wx, wz] = gridToWorld(selectedCell.x, selectedCell.y, gridWidth, gridHeight);
    return [wx, field.heightAt(selectedCell.x, selectedCell.y), wz];
  }, [selectedCell, field, gridWidth, gridHeight]);

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

  /**
   * El teclado recorre la malla desde la capa accesible, que es DOM invisible.
   * Sin esto, quien navega con flechas mueve un foco que no se ve en ninguna
   * parte de la escena: el mismo problema que la capa venía a resolver.
   */
  const handleFocusCell = useCallback((cell: TerrainCell | null) => {
    hoverLabel.current?.hide();
    surface.current?.highlight(cell ? { x: cell.x, y: cell.y } : null);
  }, []);

  return (
    <div className="relative h-full w-full">
      <Canvas
        frameloop="demand"
        // `percentage` y no el valor por defecto: PCFSoftShadowMap está
        // deprecado en esta versión de Three y avisa por consola en cada carga.
        shadows={{ type: PCFShadowMap }}
        dpr={[1, 2]}
        // El encuadre abarca la CAJA del terreno, no solo su huella: con la
        // exageración vertical el lote mide unas 6,6 unidades de alto, y una
        // cámara calculada solo sobre los 20 m de lado se mete dentro de la
        // loma. Encuadrar mal el relieve es la forma más rápida de que un
        // terreno con forma parezca un terreno sin ella.
        camera={{ position: [extent * 0.55, extent * 0.6, extent * 0.78], fov: 42 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        // Los datos viven en la capa accesible: un canvas no es recorrible.
        aria-hidden="true"
        className="h-full w-full"
      >
        <FrameGuard />

        {/* Un punto por debajo del lienzo de la página: el terreno se lee como
            una superficie distinta y no como un agujero recortado. */}
        <color attach="background" args={["#0b0d0c"]} />
        {/* Niebla lejana: separa el lote del fondo y da sensación de escala. */}
        <fog attach="fog" args={["#0b0d0c", extent * 1.6, extent * 3.4]} />

        <TerrainLighting extent={extent} />

        <TerrainSurface
          handle={surface}
          field={field}
          cells={cells}
          gridWidth={gridWidth}
          gridHeight={gridHeight}
          viewMode={viewMode}
          range={range}
          surfaceStyle={surfaceStyle}
          onHover={handleHover}
          onSelect={onSelect}
        />

        {selectedCell && anchor && (
          <SelectionMarker anchor={anchor} />
        )}

        {/* Proyecta la celda seleccionada y la escala a píxeles. Dentro del
            canvas porque necesita la cámara; escribe fuera, en el DOM. */}
        <ProjectionBridge
          handle={overlay}
          field={field}
          gridWidth={gridWidth}
          gridHeight={gridHeight}
          selected={selectedCell ? { x: selectedCell.x, y: selectedCell.y } : null}
        />

        <CameraRig
          extent={extent}
          handle={camera}
          onMove={handleCameraMove}
          reducedMotion={reducedMotion}
        />
      </Canvas>

      {/*
       * Viñeta.
       *
       * Oscurece el terreno hacia los bordes, que es donde vive el cromo, y
       * concentra la atención en el centro del lote.
       *
       * NO es el suelo de legibilidad del cristal: ese lo pone el tinte del
       * propio panel, medido contra el peor fondo posible.
       */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "radial-gradient(ellipse 82% 72% at 50% 46%, transparent 0%, transparent 48%, rgba(11,13,12,0.66) 100%)",
        }}
      />

      <AccessibleCellLayer
        cells={cells}
        gridWidth={gridWidth}
        gridHeight={gridHeight}
        selectedCellId={selectedCellId}
        onSelect={onSelect}
        onFocusCell={handleFocusCell}
      />

      <SceneOverlay handle={overlay} hasSelection={Boolean(selectedCell)} />

      <HoverLabel handle={hoverLabel} />

      {/* Controles de cámara, al oeste y bajo el selector de lote: los dos son
          "desde dónde miras". Por debajo de `lg` se apartan de la hoja inferior. */}
      {/* Por debajo de `lg` pasa al este. Al oeste vive la barra de escala, y en
          esa anchura las dos ocupaban exactamente la misma franja: el compás
          tapaba la escala. Zoom al este es además la convención de cualquier
          mapa. */}
      <div className="pointer-events-auto absolute bottom-[calc(45dvh+5rem)] right-6 z-30 lg:bottom-auto lg:left-6 lg:right-auto lg:top-[16rem]">
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
