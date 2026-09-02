"use client";

/**
 * El puente entre el espacio 3D y el cromo 2D.
 *
 * Dos cosas necesitan saber DONDE cae en pantalla un punto del terreno:
 *
 *   LA LEADER LINE  une la celda seleccionada con su ficha. Tiene que salir de
 *                   la posición real de la celda sobre el relieve, no de una
 *                   aproximación: si la cámara orbita o se acerca, la línea debe
 *                   seguir clavada en el mismo metro cuadrado.
 *
 *   LA BARRA DE ESCALA  dice cuántos píxeles mide una distancia real. No es un
 *                   adorno con un número escrito al lado: se proyectan dos
 *                   puntos separados por metros conocidos y se mide la
 *                   separación resultante.
 *
 * Las dos se resuelven proyectando puntos con la cámara y escribiendo el
 * resultado en el DOM de forma IMPERATIVA. Orbitar cambia esos valores en cada
 * fotograma; hacerlos pasar por el estado de React repintaría el árbol entero
 * sesenta veces por segundo para mover una línea.
 */

import { useFrame, useThree } from "@react-three/fiber";
import { useImperativeHandle, useMemo, useRef, type RefObject } from "react";
import { Vector3 } from "three";

import { formatScaleLabel, scaleBar } from "@/lib/presentation/scale";
import { gridToWorld } from "@/lib/terrain/coords";
import type { ElevationField } from "@/lib/terrain/elevation";

/** Distancia que se proyecta para medir la escala, en metros de terreno. Es el
 *  patron de medida, no lo que se dibuja: de su longitud en pixeles sale cuanto
 *  ocupa un metro, y con eso se elige el peldano que se rotula. */
const SCALE_METERS = 5;

/** Ancho maximo de la barra. Por encima de esto invade el lienzo. */
const SCALE_MAX_PX = 200;

export interface OverlayHandle {
  /** Punto de la celda seleccionada en píxeles del lienzo. `null` la oculta. */
  setAnchor: (x: number, y: number, visible: boolean) => void;
  /** Cuántos píxeles ocupa `SCALE_METERS` en el centro de la vista. */
  setScale: (pixels: number) => void;
}

// Vectores de trabajo en ámbito de módulo: proyectar en cada fotograma no debe
// reservar memoria.
const scratchA = new Vector3();
const scratchB = new Vector3();

interface ProjectionBridgeProps {
  handle: RefObject<OverlayHandle | null>;
  field: ElevationField;
  gridWidth: number;
  gridHeight: number;
  /** Celda seleccionada en coordenadas de malla, o `null`. */
  selected: { x: number; y: number } | null;
}

export function ProjectionBridge({
  handle,
  field,
  gridWidth,
  gridHeight,
  selected,
}: ProjectionBridgeProps) {
  const { camera, size } = useThree();

  /** Los dos extremos del segmento de referencia, en el centro del lote. */
  const scaleEnds = useMemo(() => {
    const cx = (gridWidth - 1) / 2;
    const cy = (gridHeight - 1) / 2;
    const half = SCALE_METERS / 2;
    const a: [number, number] = [cx - half, cy];
    const b: [number, number] = [cx + half, cy];
    return [a, b] as const;
  }, [gridWidth, gridHeight]);

  useFrame(() => {
    const target = handle.current;
    if (!target) return;

    // --- Escala: dos puntos separados por metros conocidos ------------------
    const [a, b] = scaleEnds;
    const [ax, az] = gridToWorld(a[0], a[1], gridWidth, gridHeight);
    const [bx, bz] = gridToWorld(b[0], b[1], gridWidth, gridHeight);

    scratchA.set(ax, field.heightAt(a[0], a[1]), az).project(camera);
    scratchB.set(bx, field.heightAt(b[0], b[1]), bz).project(camera);

    const px = ((scratchB.x - scratchA.x) * size.width) / 2;
    const py = ((scratchB.y - scratchA.y) * size.height) / 2;
    target.setScale(Math.hypot(px, py));

    // --- Ancla: la celda seleccionada ---------------------------------------
    if (!selected) {
      target.setAnchor(0, 0, false);
      return;
    }

    const [wx, wz] = gridToWorld(selected.x, selected.y, gridWidth, gridHeight);
    scratchA.set(wx, field.heightAt(selected.x, selected.y), wz).project(camera);

    const cellX = ((scratchA.x + 1) / 2) * size.width;
    const cellY = ((1 - scratchA.y) / 2) * size.height;

    // Se anota lo que se ve. Detras de la camara es `z > 1`, pero tambien cuenta
    // salirse del lienzo: seleccionando en planta una celda que en relieve queda
    // fuera del encuadre, la linea arrancaba desde fuera de la pantalla y
    // cruzaba la escena entera para senalar algo que no estaba ahi.
    const visible =
      scratchA.z <= 1 &&
      cellX >= 0 &&
      cellX <= size.width &&
      cellY >= 0 &&
      cellY <= size.height;

    target.setAnchor(cellX, cellY, visible);
  });

  return null;
}

/**
 * La línea que une la celda con su ficha, y la barra de escala.
 *
 * Vive fuera del canvas —es DOM, no geometría— y se actualiza por referencia. El
 * extremo derecho se calcula leyendo la caja del inspector: así la línea apunta
 * al panel de verdad y no a una coordenada escrita a mano que se rompe al
 * cambiar el ancho.
 */
export function SceneOverlay({
  handle,
  hasSelection,
}: {
  handle: RefObject<OverlayHandle | null>;
  hasSelection: boolean;
}) {
  const rootRef = useRef<SVGSVGElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const barLabelRef = useRef<HTMLSpanElement>(null);

  useImperativeHandle(
    handle,
    () => ({
      setAnchor(x, y, visible) {
        const line = lineRef.current;
        const dot = dotRef.current;
        const root = rootRef.current;
        if (!line || !dot || !root) return;

        // Por debajo de `lg` la anotacion no se dibuja: sin panel al este no hay
        // nada a lo que apuntar. Se comprueba aqui, y no solo con CSS, para no
        // buscar el panel y medirlo en cada fotograma mientras se orbita.
        //
        // `getClientRects()` y no `offsetParent`: `offsetParent` es de
        // `HTMLElement`, no existe en SVG, y devolvia siempre nulo — apagaba la
        // linea tambien donde si debia verse. Una lista vacia significa que el
        // elemento no genera caja, que es exactamente `display: none`.
        if (root.getClientRects().length === 0) return;

        if (!visible || !hasSelection) {
          root.style.opacity = "0";
          return;
        }

        // El destino es el borde del inspector REAL, leído del DOM: escrito a
        // mano se rompería en cuanto el panel cambiara de ancho.
        const panel = document.querySelector("aside.panel");
        const box = panel?.getBoundingClientRect();
        const canvasBox = root.getBoundingClientRect();
        if (!box) return;

        const tx = box.left - canvasBox.left - 10;
        const ty = box.top - canvasBox.top + 44;

        // Codo en angulo recto y no una diagonal: una linea quebrada se lee como
        // anotacion tecnica; una diagonal, como una flecha de presentacion.
        //
        // Pero el codo solo cabe si la celda esta a la izquierda del panel. Al
        // orbitar, la celda puede acabar a la altura del panel o detras de el, y
        // entonces el tramo horizontal se pasaba del destino y volvia: la linea
        // se doblaba sobre si misma. Sin sitio para el codo, se va recta.
        const elbow = tx - 40;
        line.setAttribute(
          "d",
          x < elbow - 24
            ? `M ${x} ${y} L ${elbow} ${y} L ${tx} ${ty}`
            : `M ${x} ${y} L ${tx} ${ty}`,
        );
        dot.setAttribute("cx", String(x));
        dot.setAttribute("cy", String(y));
        root.style.opacity = "1";
      },
      setScale(pixels) {
        const bar = barRef.current;
        const label = barLabelRef.current;
        if (!bar || !label) return;

        // El mayor peldano que cabe. Al acercarse, la barra no se recorta: pasa
        // a rotular una distancia menor, y lo que se dibuja sigue siendo
        // exactamente lo que mide esa distancia sobre el terreno.
        const barra = scaleBar(pixels / SCALE_METERS, SCALE_MAX_PX);
        if (!barra) {
          bar.style.width = "0px";
          label.textContent = "";
          return;
        }

        bar.style.width = `${barra.pixels}px`;
        label.textContent = formatScaleLabel(barra.meters);
      },
    }),
    [hasSelection],
  );

  return (
    <>
      {/* La leader line solo existe donde hay a donde apuntar.
          Por debajo de `lg` el inspector es una hoja a todo el ancho: la linea
          salia de la celda, cruzaba por detras de los dos conmutadores y moria
          en el borde izquierdo de un panel que ocupa la pantalla entera. Eso no
          anota nada; solo cruza la escena. El jalon sobre la celda y el codigo
          en la cabecera de la ficha ya sostienen la relacion. */}
      <svg
        ref={rootRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-20 hidden h-full w-full opacity-0 transition-opacity duration-150 lg:block"
      >
        <path
          ref={lineRef}
          fill="none"
          stroke="var(--color-ink)"
          strokeWidth="1"
          strokeDasharray="3 3"
          opacity="0.75"
        />
        <circle ref={dotRef} r="3.5" fill="none" stroke="var(--color-ink)" strokeWidth="1.5" />
      </svg>

      {/* Barra de escala. Abajo a la izquierda, donde la busca cualquiera que
          haya leído un mapa. */}
      {/* Se mantiene en TODOS los anchos: en una vista de terreno la escala no
          es cromo opcional. Por debajo de `lg` sube para librar la hoja
          inferior y los controles de cámara. */}
      <div className="pointer-events-none absolute bottom-[calc(45dvh+8.5rem)] left-6 z-20 lg:bottom-[12.5rem]">
        <div className="floating rounded-lg px-3 py-2">
          <div className="flex items-end gap-2">
            <div className="pb-[3px]">
              <div
                ref={barRef}
                className="h-2 border-x border-b border-ink"
                style={{ width: 0 }}
              />
            </div>
            {/* Vacio hasta el primer fotograma: el rotulo lo escribe la medida,
                no la plantilla. */}
            <span ref={barLabelRef} className="tabular text-[11px] leading-none text-ink" />
          </div>
          <p className="eyebrow mt-1.5">Escala · centro del lote</p>
        </div>
      </div>
    </>
  );
}
