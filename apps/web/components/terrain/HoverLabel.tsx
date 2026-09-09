"use client";

/**
 * Etiqueta que sigue al cursor sobre el terreno.
 *
 * Se actualiza de forma IMPERATIVA, a través de un manejador, y no con estado
 * de React. Es deliberado: mover el ratón sobre la malla dispara decenas de
 * eventos por segundo, y hacer que cada uno provoque un render del árbol es
 * justo lo que hunde la fluidez de una escena 3D.
 *
 * Solo se escriben dos cosas por movimiento: el texto de tres nodos y una
 * `transform`. Nada que obligue al navegador a recalcular la maquetación.
 *
 * No lleva rol ARIA ni región viva: es un adorno del ratón. Quien navega con
 * teclado o lector de pantalla obtiene lo mismo —y mejor— del Cell Inspector y
 * de la capa accesible de la malla.
 */

import { useImperativeHandle, useRef, type RefObject } from "react";

import { formatKg, formatPercent } from "@/lib/presentation/format";
import { RISK_COLORS } from "@/lib/presentation/risk";
import type { TerrainCell } from "@/lib/terrain/types";

export interface HoverLabelHandle {
  /**
   * `reading` es el valor de la CAPA ACTIVA ya formateado, o `null` cuando la
   * capa es rendimiento o pérdida y ya sale en la línea de siempre.
   *
   * Sin esto, con Suelo o Sanidad activas el valor pintado solo existía en el
   * color: quien no distinga los tonos no tenía ninguna forma de leerlo.
   */
  show: (cell: TerrainCell, reading: string | null, clientX: number, clientY: number) => void;
  hide: () => void;
}

export function HoverLabel({ handle }: { handle: RefObject<HoverLabelHandle | null> }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLSpanElement>(null);
  const metricRef = useRef<HTMLSpanElement>(null);
  const layerRef = useRef<HTMLSpanElement>(null);
  const levelRef = useRef<HTMLSpanElement>(null);

  useImperativeHandle(handle, () => ({
    show(cell, reading, clientX, clientY) {
      const root = rootRef.current;
      if (!root) return;

      if (codeRef.current) codeRef.current.textContent = cell.cell_code;
      if (layerRef.current) {
        layerRef.current.textContent = reading ?? "";
        layerRef.current.hidden = reading === null;
      }
      if (metricRef.current) {
        metricRef.current.textContent = `${formatKg(cell.projected_yield_kg)} · ${formatPercent(
          cell.estimated_loss_percentage,
        )}`;
      }
      if (levelRef.current) {
        levelRef.current.textContent = RISK_COLORS[cell.risk_level].label;
        levelRef.current.style.color = RISK_COLORS[cell.risk_level].fill;
      }

      // Solo transform y opacity: propiedades de composición, sin reflow.
      root.style.transform = `translate3d(${clientX + 16}px, ${clientY + 16}px, 0)`;
      root.style.opacity = "1";
    },
    hide() {
      const root = rootRef.current;
      if (root) root.style.opacity = "0";
    },
  }));

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className="floating pointer-events-none fixed left-0 top-0 z-30 rounded-xl px-3 py-2 opacity-0 transition-opacity duration-100"
    >
      <span ref={codeRef} className="tabular block text-xs text-ink" />
      <span ref={layerRef} className="tabular block text-[11px] text-ink-soft" hidden />
      <span ref={metricRef} className="tabular block text-[11px] text-muted" />
      <span ref={levelRef} className="eyebrow block" />
    </div>
  );
}
