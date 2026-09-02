"use client";

/**
 * Franja de contexto, sobre el terreno.
 *
 * Una sola línea con todo lo que sitúa lo que estás mirando: finca, lote, ciclo,
 * versión del modelo y estado del backend.
 *
 * Aquí solo va el CONTEXTO: dónde estás. El estado del sistema —versión del
 * modelo, base de datos, aviso de datos sintéticos— vive en la franja del pie,
 * junto al resto de metainformación. Mezclar "qué lote miro" con "está el
 * backend vivo" en el mismo sitio obliga a leer dos cosas para encontrar una.
 */

import type { CropCycle, Farm, Plot } from "@/lib/types/api";

interface TopStripProps {
  farms: Farm[];
  plot: Plot | null;
  cropCycles: CropCycle[];
  selectedFarmId: string | null;
  selectedCropCycleId: string | null;
  onSelectFarm: (id: string) => void;
  onSelectCropCycle: (id: string) => void;
}

const SELECT_CLASS =
  "cursor-pointer appearance-none rounded bg-transparent py-0.5 pr-4 text-sm text-ink outline-none transition-colors hover:text-ink disabled:cursor-not-allowed disabled:text-muted";

export function TopStrip({
  farms,
  plot,
  cropCycles,
  selectedFarmId,
  selectedCropCycleId,
  onSelectFarm,
  onSelectCropCycle,
}: TopStripProps) {
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start gap-4 px-6 py-4">
      <div className="floating pointer-events-auto flex items-center gap-3 rounded-lg py-2 pl-4 pr-3">
        <span className="font-mono text-sm font-medium tracking-[0.18em] text-ink">
          CERES
        </span>

        <span aria-hidden="true" className="h-4 w-px bg-line" />

        <label className="flex items-center gap-1.5">
          <span className="sr-only">Finca</span>
          <select
            className={SELECT_CLASS}
            value={selectedFarmId ?? ""}
            onChange={(event) => onSelectFarm(event.target.value)}
            disabled={farms.length === 0}
          >
            {farms.map((item) => (
              <option key={item.id} value={item.id} className="bg-surface-2 text-ink">
                {item.name}
              </option>
            ))}
          </select>
        </label>

        {/* El lote se retira por debajo de `md`: ya aparece completo en el
            selector que hay justo debajo, y ahí cada píxel de la fila cuenta
            para que el conmutador de la derecha no monte sobre el ciclo. */}
        {plot && (
          <span className="hidden items-center gap-3 md:flex">
            <span aria-hidden="true" className="text-muted">
              ›
            </span>
            <span className="text-sm text-ink-soft">{plot.name}</span>
          </span>
        )}

        <span aria-hidden="true" className="text-muted">
          ›
        </span>

        <label className="flex items-center gap-1.5">
          <span className="sr-only">Ciclo de cultivo</span>
          <select
            className={SELECT_CLASS}
            value={selectedCropCycleId ?? ""}
            onChange={(event) => onSelectCropCycle(event.target.value)}
            disabled={cropCycles.length === 0}
          >
            {cropCycles.length === 0 && (
              <option value="" className="bg-surface-2">
                Sin ciclos
              </option>
            )}
            {cropCycles.map((cycle) => (
              <option key={cycle.id} value={cycle.id} className="bg-surface-2 text-ink">
                {cycle.name}
              </option>
            ))}
          </select>
        </label>
      </div>

    </header>
  );
}
