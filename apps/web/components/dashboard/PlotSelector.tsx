"use client";

/**
 * Selector de lote, anclado al borde oeste del terreno.
 *
 * Píldoras y no un desplegable: los lotes son pocos, se comparan entre sí y
 * cambiar de uno a otro es la acción más frecuente después de seleccionar una
 * celda. Tenerlos siempre visibles cuesta unos píxeles y ahorra dos clics cada
 * vez.
 *
 * Llevan etiqueta y medidas, no solo la letra. Dos círculos con una "A" y una
 * "B" flotando en el aire no dicen qué son ni qué pasa al pulsarlos: parecen un
 * resto de la maqueta. El rótulo cuesta una línea y convierte el control en algo
 * que se entiende sin pasar el ratón por encima.
 */

import type { Plot } from "@/lib/types/api";

interface PlotSelectorProps {
  plots: Plot[];
  selectedPlotId: string | null;
  onSelect: (plotId: string) => void;
}

export function PlotSelector({ plots, selectedPlotId, onSelect }: PlotSelectorProps) {
  if (plots.length <= 1) return null;

  return (
    // El tope evita que una finca con muchos lotes empuje la lista hasta el
    // panel de reparto, que ocupa esta misma columna más abajo. 14rem deja los
    // cuatro de La Cuadrícula —que miden 12— sin barra de desplazamiento: con
    // el tope justo en 12 aparecía una barra que no hacía falta.
    <div className="floating max-h-[14rem] w-[9.5rem] overflow-y-auto rounded-lg p-1.5">
      <p className="eyebrow px-1.5 pb-1.5 pt-0.5">Lote</p>
      <div role="group" aria-label="Lote" className="space-y-0.5">
        {plots.map((plot) => {
          const active = plot.id === selectedPlotId;
          return (
            <button
              key={plot.id}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(plot.id)}
              className={`flex w-full items-center gap-2.5 rounded px-1.5 py-1.5 text-left transition-colors ${
                active
                  ? "bg-ink text-canvas"
                  : "text-ink-soft hover:bg-line-soft hover:text-ink"
              }`}
            >
              <span
                className={`tabular grid h-6 w-6 shrink-0 place-items-center rounded text-xs font-medium ${
                  active ? "bg-canvas/20 text-canvas" : "bg-line-soft text-ink"
                }`}
              >
                {plot.code}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs leading-tight">{plot.name}</span>
                <span
                  className={`tabular block text-[10px] leading-tight ${
                    active ? "text-canvas/70" : "text-muted"
                  }`}
                >
                  {plot.grid_width} × {plot.grid_height}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
