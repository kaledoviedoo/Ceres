"use client";

/**
 * Franja de contexto, sobre el terreno.
 *
 * Una sola línea con todo lo que sitúa lo que estás mirando: finca, lote,
 * ciclo, versión del modelo y estado del backend. Sustituye a la barra de
 * estado y al panel "Selección" de la versión anterior, que ocupaban una
 * columna entera para tres desplegables.
 *
 * El aviso de datos sintéticos no está escrito aquí: lo devuelve
 * `GET /api/v1/health`. Si cambia la política sobre cómo se describe el modelo,
 * cambia en un sitio y esta franja se entera sola.
 */

import type { CropCycle, FarmDetail, Farm, HealthStatus, Plot } from "@/lib/types/api";

interface TopStripProps {
  health: HealthStatus | null;
  healthError: string | null;
  farms: Farm[];
  farm: FarmDetail | null;
  plot: Plot | null;
  cropCycles: CropCycle[];
  selectedFarmId: string | null;
  selectedCropCycleId: string | null;
  onSelectFarm: (id: string) => void;
  onSelectCropCycle: (id: string) => void;
}

const SELECT_CLASS =
  "cursor-pointer appearance-none rounded bg-transparent py-0.5 pr-4 text-sm text-bone-100 outline-none transition-colors hover:text-white disabled:cursor-not-allowed disabled:text-bone-600";

export function TopStrip({
  health,
  healthError,
  farms,
  farm,
  plot,
  cropCycles,
  selectedFarmId,
  selectedCropCycleId,
  onSelectFarm,
  onSelectCropCycle,
}: TopStripProps) {
  const online = Boolean(health) && !healthError;

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
      <div className="floating pointer-events-auto flex items-center gap-3 rounded-full py-1.5 pl-4 pr-3">
        <span className="font-mono text-sm font-medium tracking-[0.18em] text-bone-100">
          CERES
        </span>

        <span aria-hidden="true" className="h-4 w-px bg-soil-600" />

        <label className="flex items-center gap-1.5">
          <span className="sr-only">Finca</span>
          <select
            className={SELECT_CLASS}
            value={selectedFarmId ?? ""}
            onChange={(event) => onSelectFarm(event.target.value)}
            disabled={farms.length === 0}
          >
            {farms.map((item) => (
              <option key={item.id} value={item.id} className="bg-soil-800 text-bone-100">
                {item.name}
              </option>
            ))}
          </select>
        </label>

        {plot && (
          <>
            <span aria-hidden="true" className="text-bone-600">
              ›
            </span>
            <span className="text-sm text-bone-300">{plot.name}</span>
          </>
        )}

        <span aria-hidden="true" className="text-bone-600">
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
              <option value="" className="bg-soil-800">
                Sin ciclos
              </option>
            )}
            {cropCycles.map((cycle) => (
              <option key={cycle.id} value={cycle.id} className="bg-soil-800 text-bone-100">
                {cycle.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="floating pointer-events-auto ml-auto flex items-center gap-3 rounded-full px-3.5 py-1.5">
        {farm?.region && <span className="eyebrow">{farm.region}</span>}
        {health && (
          <span className="tabular text-[11px] text-bone-400">{health.model_version}</span>
        )}
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: online ? "#22c55e" : "#ef4444" }}
          />
          <span className="sr-only">Estado del backend:</span>
          <span className="eyebrow">{online ? `BD ${health?.database}` : "Sin conexión"}</span>
        </span>
      </div>

      <p className="pointer-events-none w-full text-[10px] leading-tight text-bone-600">
        {health?.disclaimer ??
          "DEMO / SYNTHETIC DATA. Modelo experimental y demostrativo sobre datos sintéticos."}
      </p>
    </header>
  );
}
