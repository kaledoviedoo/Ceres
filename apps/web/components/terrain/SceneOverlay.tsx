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
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, type RefObject } from "react";
import { Vector3 } from "three";

import { SCALE_STEPS_M, formatScaleLabel, scaleBar } from "@/lib/presentation/scale";
import { gridCenter, gridToWorld, type PlotGrid } from "@/lib/terrain/coords";
import type { ElevationField } from "@/lib/terrain/elevation";

/** Distancia que se proyecta para medir la escala, en metros de terreno. Es el
 *  patron de medida, no lo que se dibuja: de su longitud en pixeles sale cuanto
 *  ocupa un metro, y con eso se elige el peldano que se rotula. */
const SCALE_METERS = 5;

/**
 * Aire que se le deja a la barra por su derecha, en pixeles.
 *
 * Es el mismo inset que tiene por la izquierda (`left-6`): la barra respira lo
 * mismo por los dos lados en vez de quedarse pegada al panel. No es un tope de
 * longitud —el tope sale de medir el hueco real—, es el margen de esa medida.
 */
const SCALE_GUTTER_PX = 24;

/**
 * Cuanto del ancho del mapa puede llegar a ocupar la barra.
 *
 * El hueco disponible dice donde CABE; esto dice hasta donde conviene. En una
 * pantalla estrecha no hay nada a la derecha de la barra, asi que el hueco es la
 * ventana entera y la barra crecia hasta cruzar dos tercios de la vista: una
 * regla tumbada sobre el terreno en vez de una referencia al margen.
 *
 * Un tercio es una proporcion, no un numero de pixeles: se adapta a cualquier
 * ancho, que es justo lo que el tope fijo de 200 px no hacia.
 */
const SCALE_MAX_FRACTION = 1 / 3;

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
  plot: PlotGrid;
  /** Celda seleccionada en coordenadas de malla, o `null`. */
  selected: { x: number; y: number } | null;
}

export function ProjectionBridge({
  handle,
  field,
  plot,
  selected,
}: ProjectionBridgeProps) {
  const { camera, size } = useThree();

  /** Los dos extremos del segmento de referencia, en el centro del lote. */
  const scaleEnds = useMemo(() => {
    const [cx, cy] = gridCenter(plot);
    // El patrón mide METROS, así que el desplazamiento va en metros convertidos
    // a celdas. Cuando la celda medía un metro las dos cifras coincidían y esta
    // división era invisible; con celdas de 0,5 m, separarlos 2,5 CELDAS habría
    // medido 1,25 m y la barra habría rotulado el doble de lo que dibuja.
    const half = SCALE_METERS / 2 / plot.cellSizeM;
    const a: [number, number] = [cx - half, cy];
    const b: [number, number] = [cx + half, cy];
    return [a, b] as const;
  }, [plot]);

  useFrame(() => {
    const target = handle.current;
    if (!target) return;

    // --- Escala: dos puntos separados por metros conocidos ------------------
    const [a, b] = scaleEnds;
    const [ax, az] = gridToWorld(a[0], a[1], plot);
    const [bx, bz] = gridToWorld(b[0], b[1], plot);

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

    const [wx, wz] = gridToWorld(selected.x, selected.y, plot);
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
/** Lo que hay que medir del DOM, y que solo cambia cuando cambia la ventana. */
interface Layout {
  /** `false` cuando la capa de anotación no genera caja: por debajo de `lg`. */
  dibujable: boolean;
  /** Dónde muere la línea guía, en píxeles del lienzo. `null` si no hay panel. */
  destino: { x: number; y: number } | null;
  /** Cuánto puede medir la barra de escala sin invadir nada, en píxeles. */
  escalaMaxPx: number;
}

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
  const barBoxRef = useRef<HTMLDivElement>(null);
  const barRowRef = useRef<HTMLDivElement>(null);
  const barLabelRef = useRef<HTMLSpanElement>(null);

  /*
   * LA COMPOSICION SE MIDE CUANDO CAMBIA, NO CADA FOTOGRAMA.
   *
   * Las dos piezas de este archivo necesitan saber dónde están otras cajas del
   * DOM: la línea guía apunta al inspector, y la barra de escala necesita saber
   * cuánto hueco tiene. Antes eso se resolvía dentro de `setAnchor`, que corre
   * en cada fotograma: orbitar hacía un `querySelector` y dos
   * `getBoundingClientRect` sesenta veces por segundo para mover una línea de
   * puntos.
   *
   * Y era trabajo tirado, porque nada de eso depende de la cámara. El inspector
   * está donde está mientras no cambie el tamaño de la ventana. Lo que sí cambia
   * cada fotograma —dónde cae la celda en pantalla— llega ya calculado desde la
   * escena.
   *
   * Así que se mide una vez y se vuelve a medir cuando la caja de alguien
   * cambia. Es seguro cachear precisamente porque la invalidación no depende de
   * adivinar: la observa el navegador.
   */
  const layout = useRef<Layout | null>(null);

  const medir = useCallback((): Layout | null => {
    const root = rootRef.current;
    const bar = barRef.current;
    const cajaEl = barBoxRef.current;
    const fila = barRowRef.current;
    const label = barLabelRef.current;
    if (!root || !bar || !cajaEl || !fila || !label) return null;

    const panel = document.querySelector("aside.panel");
    const panelBox = panel?.getBoundingClientRect() ?? null;

    // --- Destino de la línea guía -------------------------------------------
    // `getClientRects()` y no `offsetParent`: `offsetParent` es de `HTMLElement`
    // y en SVG devuelve siempre nulo, lo que apagaba la línea también donde sí
    // debía verse. Una lista vacía significa que el elemento no genera caja, que
    // es exactamente `display: none` —lo que ocurre por debajo de `lg`.
    const dibujable = root.getClientRects().length > 0;
    const lienzo = root.getBoundingClientRect();
    const destino =
      dibujable && panelBox
        ? { x: panelBox.left - lienzo.left - 10, y: panelBox.top - lienzo.top + 44 }
        : null;

    /*
     * --- Hueco real de la barra de escala ----------------------------------
     *
     * Lo que acompaña a la barra en su fila es el hueco y el rótulo, y se MIDE
     * con el rótulo más largo que puede llegar a escribir: midiéndolo con el
     * actual, pasar de "2 m" a "100 m" ensancharía la caja por encima del hueco
     * calculado.
     *
     * SE MIDE EL ROTULO, NO LA FILA. Restar el ancho de la barra al de su fila
     * parece lo mismo y no lo es: la fila es un bloque y se estira hasta el
     * ancho de la caja, que lo fija el pie "Escala · centro del lote" —más
     * ancho que la fila—. Así que esa resta daba «lo que mide la caja menos lo
     * que mide la barra», un número que CRECE cuando la barra encoge. Con eso el
     * hueco disponible se realimentaba a sí mismo: la barra se quedaba clavada
     * en el peldaño mínimo y ya no volvía a subir.
     */
    const previo = label.textContent;
    label.textContent = formatScaleLabel(SCALE_STEPS_M[SCALE_STEPS_M.length - 1]!);
    const rotulo = label.getBoundingClientRect().width;
    label.textContent = previo;
    const hueco = parseFloat(getComputedStyle(fila).columnGap) || 0;
    const sobrecarga = rotulo + hueco;

    // El acolchado se lee del estilo en vez de deducirse de las cajas: deducirlo
    // solo funciona cuando la fila es el elemento más ancho, y aquí no lo es.
    const estiloCaja = getComputedStyle(cajaEl);
    const acolchado =
      parseFloat(estiloCaja.paddingLeft) + parseFloat(estiloCaja.paddingRight);

    const cajaBox = cajaEl.getBoundingClientRect();

    /*
     * EL LIMITE POR LA DERECHA SE MIDE, NO SE ESCRIBE.
     *
     * Antes había un tope de 200 px que no salía de ningún sitio: con la cámara
     * en su posición por defecto obligaba a rotular 2 m cuando cabían 10, y en
     * una ventana estrecha se habría metido igualmente debajo del cromo.
     *
     * Lo que de verdad limita la barra es la primera pieza de interfaz que tenga
     * a su derecha COMPARTIENDO BANDA HORIZONTAL: el inspector a `lg`, el
     * conmutador de capas cuando la banda de este es contigua. Se busca esa
     * pieza en vez de nombrarla, así que mover un control no deja aquí un número
     * desfasado.
     *
     * Se excluye lo que sigue al cursor —posicionado `fixed`, como la etiqueta
     * de hover— porque no es composición: está donde esté el ratón en el
     * instante de medir, y dejarlo entrar encogería la barra por un motivo que
     * desaparece al mover la mano.
     */
    const vecinos = [...document.querySelectorAll<HTMLElement>(".floating, .panel")];
    let limiteDerecho = document.documentElement.clientWidth;
    for (const vecino of vecinos) {
      if (vecino === cajaEl || vecino.contains(cajaEl) || cajaEl.contains(vecino)) continue;
      const estilo = getComputedStyle(vecino);
      if (estilo.position === "fixed" || estilo.display === "none") continue;
      if (parseFloat(estilo.opacity) < 0.05 || estilo.visibility === "hidden") continue;

      const box = vecino.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) continue;
      // A su derecha y en su misma banda.
      if (box.left <= cajaBox.left) continue;
      if (box.bottom <= cajaBox.top || box.top >= cajaBox.bottom) continue;

      limiteDerecho = Math.min(limiteDerecho, box.left);
    }

    return {
      dibujable,
      destino,
      escalaMaxPx: Math.max(
        0,
        Math.min(
          limiteDerecho - cajaBox.left - acolchado - sobrecarga - SCALE_GUTTER_PX,
          document.documentElement.clientWidth * SCALE_MAX_FRACTION,
        ),
      ),
    };
  }, []);

  /**
   * Cuántos píxeles ocupó la última vez la distancia de referencia.
   *
   * Se guarda porque el peldaño rotulado no depende solo de la cámara: depende
   * también del hueco disponible. Al estrechar la ventana el hueco encoge sin
   * que la cámara se mueva, y con `frameloop="demand"` puede no correr ni un
   * fotograma más. Sin esto, la barra se quedaba rotulando una distancia que ya
   * no cabía.
   */
  const ultimaMedida = useRef<number | null>(null);

  const pintarEscala = useCallback(() => {
    const bar = barRef.current;
    const label = barLabelRef.current;
    const pixels = ultimaMedida.current;
    if (!bar || !label || pixels === null) return;

    // Sin medida del hueco no se rotula nada: una barra dibujada contra un
    // máximo inventado podría salirse o quedarse en el peldaño mínimo, y las dos
    // cosas son peores que esperar.
    const caja = (layout.current ??= medir());
    if (!caja) return;

    const barra = scaleBar(pixels / SCALE_METERS, caja.escalaMaxPx);
    if (!barra) {
      bar.style.width = "0px";
      label.textContent = "";
      return;
    }

    // El mayor peldaño que cabe. Al acercarse, la barra no se recorta: pasa a
    // rotular una distancia menor, y lo que se dibuja sigue siendo exactamente
    // lo que mide esa distancia sobre el terreno.
    bar.style.width = `${barra.pixels}px`;
    label.textContent = formatScaleLabel(barra.meters);
  }, [medir]);

  useEffect(() => {
    layout.current = medir();
    pintarEscala();

    // El navegador avisa de los cambios de caja; nadie tiene que adivinarlos.
    // Se vigila la raíz del documento —cambiar el tamaño de la ventana— y el
    // propio inspector, que cambia de ancho al cruzar un breakpoint.
    const observer = new ResizeObserver(() => {
      layout.current = medir();
      pintarEscala();
    });
    observer.observe(document.documentElement);
    const panel = document.querySelector("aside.panel");
    if (panel) observer.observe(panel);
    return () => observer.disconnect();
  }, [medir, pintarEscala]);

  useImperativeHandle(
    handle,
    () => ({
      setAnchor(x, y, visible) {
        const line = lineRef.current;
        const dot = dotRef.current;
        const root = rootRef.current;
        if (!line || !dot || !root) return;

        const caja = (layout.current ??= medir());
        // Sin panel al este no hay nada a lo que apuntar: por debajo de `lg` la
        // línea guía no se dibuja.
        if (!caja || !caja.dibujable || !caja.destino) return;

        if (!visible || !hasSelection) {
          root.style.opacity = "0";
          return;
        }

        const { x: tx, y: ty } = caja.destino;

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
        ultimaMedida.current = pixels;
        pintarEscala();
      },
    }),
    [hasSelection, medir, pintarEscala],
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
          inferior y los controles de cámara.

          10,5rem y no 8,5: el selector de capas ocupa dos filas —los cuatro
          botones y la línea de capas sin fuente— y a 640 de ancho su esquina
          izquierda caía sobre esta barra. */}
      <div className="pointer-events-none absolute bottom-[calc(45dvh+10.5rem)] left-6 z-20 lg:bottom-[12.5rem]">
        <div ref={barBoxRef} className="floating rounded-lg px-3 py-2">
          <div ref={barRowRef} className="flex items-end gap-2">
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
