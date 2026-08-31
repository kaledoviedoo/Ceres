"use client";

/**
 * Selector de lote, en el borde del terreno.
 *
 * Píldoras verticales y no un desplegable: los lotes son pocos, se comparan
 * entre sí y cambiar de uno a otro es la acción más frecuente después de
 * seleccionar una celda. Tenerlos siempre visibles junto al terreno cuesta
 * cuarenta píxeles y ahorra dos clics cada vez.
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
    <div
      role="group"
      aria-label="Lote"
      className="floating flex flex-col gap-0.5 rounded-full p-0.5"
    >
      {plots.map((plot) => {
        const active = plot.id === selectedPlotId;
        return (
          <button
            key={plot.id}
            type="button"
            aria-pressed={active}
            title={`${plot.name} · ${plot.grid_width}×${plot.grid_height}`}
            onClick={() => onSelect(plot.id)}
            className={`grid h-9 w-9 place-items-center rounded-full font-mono text-xs transition-colors ${
              active
                ? "bg-bone-100 text-soil-900"
                : "text-bone-400 hover:bg-soil-700 hover:text-bone-100"
            }`}
          >
            {plot.code}
            <span className="sr-only">{plot.name}</span>
          </button>
        );
      })}
    </div>
  );
}
