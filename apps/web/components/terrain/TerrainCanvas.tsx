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

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useMemo, useRef, useState, type RefObject } from "react";
import { PCFShadowMap, Vector3 } from "three";

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
import { gridToWorld, plotExtent, type PlotGrid } from "@/lib/terrain/coords";
import type { ElevationField } from "@/lib/terrain/elevation";
import type { TerrainCell } from "@/lib/terrain/types";
import { MAX_FRAME_STEPS, dollyToFrame } from "@/lib/terrain/framing";
import { layerReading, type AvailableLayer } from "@/lib/terrain/layers";

export interface TerrainCanvasProps {
  /** Rama geométrica: lo único que decide la forma del terreno. */
  field: ElevationField;
  cells: TerrainCell[];
  plot: PlotGrid;
  /** Capa activa. Solo decide qué se ve encima; nunca la forma del terreno. */
  layer: AvailableLayer;
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
  plot,
  layer,
  selectedCellId,
  onSelect,
}: TerrainCanvasProps) {
  const hoverLabel = useRef<HoverLabelHandle>(null);
  const compass = useRef<CompassHandle>(null);
  const camera = useRef<CameraHandle>(null);
  const surface = useRef<TerrainSurfaceHandle>(null);
  const overlay = useRef<OverlayHandle>(null);
  const reducedMotion = usePrefersReducedMotion();

  const extent = plotExtent(plot);

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
    const [wx, wz] = gridToWorld(selectedCell.x, selectedCell.y, plot);
    return [wx, field.heightAt(selectedCell.x, selectedCell.y), wz];
  }, [selectedCell, field, plot]);

  // Imperativo a propósito: mover el ratón no debe repintar nada de React.
  const handleHover = useCallback(
    (cell: TerrainCell | null, clientX: number, clientY: number) => {
      if (cell) {
        // El valor de la capa activa, salvo cuando ya sale en la línea de
        // siempre. Es lo que impide que el dato pintado dependa solo del color.
        // La regla vive en `layers.ts`: las tres vistas que la necesitan tienen
        // que decir lo mismo, y cuando estaba copiada aquí ya se desincronizó
        // una vez.
        hoverLabel.current?.show(cell, layerReading(layer, cell), clientX, clientY);
      } else hoverLabel.current?.hide();
    },
    [layer],
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
          plot={plot}
          layer={layer}
          onHover={handleHover}
          onSelect={onSelect}
        />

        {selectedCell && anchor && (
          <SelectionMarker anchor={anchor} />
        )}

        {/* Proyecta la celda seleccionada y la escala a píxeles. Dentro del
            canvas porque necesita la cámara; escribe fuera, en el DOM. */}
        <FocusOnEntry anchor={anchor} camera={camera} />

        <ProjectionBridge
          handle={overlay}
          field={field}
          plot={plot}
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
        layer={layer}
        gridWidth={plot.width}
        gridHeight={plot.height}
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
          mapa.

          En `lg` sube hasta rozar la franja superior: la columna oeste la
          comparte con el panel de reparto, que crece hacia arriba —histograma,
          posición de la celda, coincidencia y su advertencia— y en pantallas de
          800 px de alto llegaba a tocarlo. Cada rem que se le gana aquí es un
          rem que el panel puede usar. */}
      {/* COLISIÓN ARREGLADA, y al lado y no debajo.

          Estaba en `lg:top-[6rem]`: las mismas coordenadas que el selector de
          lote (`left-6 top-[5.75rem]`), al que tapaba cortándole los nombres.
          No se veía porque el selector se retira cuando solo hay un lote, y la
          finca de demo tiene uno: los cuatro de La Cuadrícula lo destaparon.

          Bajarlo no servía: la columna oeste ya está ocupada de arriba abajo
          —selector, panel de reparto, barra de escala, relieve/planta— y en una
          pantalla de 720 px el hueco entre el selector y el panel es de 36 px
          para un control de 128. Así que va A LA DERECHA del selector, que
          mide 9,5rem desde `left-6`, sobre terreno vacío y sin tocar el
          inspector, que empieza pasada la mitad de la pantalla. */}
      <div className="pointer-events-auto absolute bottom-[calc(45dvh+5rem)] right-6 z-30 lg:bottom-auto lg:left-[12rem] lg:right-auto lg:top-[5.75rem]">
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

/** Vector de trabajo: encuadrar no debe reservar memoria por fotograma. */
const puntoDeTrabajo = new Vector3();

/**
 * Lleva la celda seleccionada al encuadre UNA vez, al entrar en relieve.
 *
 * El objetivo se captura en el montaje —`useRef(anchor)` guarda el valor de la
 * primera renderización—, y `TerrainCanvas` se monta justo al pasar de Planta a
 * Relieve. Eso hace que "una sola vez, en la transición" sea una propiedad de la
 * estructura y no una bandera que haya que acordarse de bajar:
 *
 *   · cambiar de capa no remonta el lienzo → no vuelve a encuadrar;
 *   · orbitar y hacer zoom ocurren después → no vuelve a encuadrar;
 *   · seleccionar una celda YA en relieve no encuadra, y es lo correcto: si el
 *     usuario acaba de pincharla, es que la estaba viendo.
 *
 * Si la celda ya cabe en el cuadro, el factor es 1 y no se toca la cámara.
 */
function FocusOnEntry({
  anchor,
  camera: cameraHandle,
}: {
  anchor: [number, number, number] | null;
  camera: RefObject<CameraHandle | null>;
}) {
  const camera = useThree((state) => state.camera);
  // Solo el de la ENTRADA. Una selección posterior no reencuadra.
  const objetivo = useRef(anchor);
  const pasos = useRef(0);
  const hecho = useRef(false);

  useFrame(() => {
    if (hecho.current) return;

    const punto = objetivo.current;
    if (!punto) {
      hecho.current = true;
      return;
    }

    puntoDeTrabajo.set(punto[0], punto[1], punto[2]).project(camera);
    const factor = dollyToFrame(puntoDeTrabajo);

    // `1` es "ya se ve": se deja la cámara donde estaba. El tope de pasos es lo
    // que impide un bucle si la aproximación no converge.
    if (factor === 1 || pasos.current >= MAX_FRAME_STEPS) {
      hecho.current = true;
      return;
    }

    pasos.current += 1;
    cameraHandle.current?.zoom(factor);
  });

  return null;
}
