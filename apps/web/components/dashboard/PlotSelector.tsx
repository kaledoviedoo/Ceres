"use client";

/** Selector finca → lote → ciclo de cultivo. */

import type { CropCycle, FarmDetail, Farm } from "@/lib/types/api";

interface PlotSelectorProps {
  farms: Farm[];
  farm: FarmDetail | null;
  cropCycles: CropCycle[];
  selectedFarmId: string | null;
  selectedPlotId: string | null;
  selectedCropCycleId: string | null;
  onSelectFarm: (id: string) => void;
  onSelectPlot: (id: string) => void;
  onSelectCropCycle: (id: string) => void;
}

const SELECT_CLASS =
  "w-full rounded border border-ceres-border-strong bg-ceres-elevated px-2 py-1.5 text-sm text-ceres-text disabled:cursor-not-allowed disabled:opacity-40";

export function PlotSelector({
  farms,
  farm,
  cropCycles,
  selectedFarmId,
  selectedPlotId,
  selectedCropCycleId,
  onSelectFarm,
  onSelectPlot,
  onSelectCropCycle,
}: PlotSelectorProps) {
  return (
    <div className="grid gap-3">
      <label className="grid gap-1">
        <span className="text-[10px] uppercase tracking-widest text-ceres-dim">Finca</span>
        <select
          className={SELECT_CLASS}
          value={selectedFarmId ?? ""}
          onChange={(event) => onSelectFarm(event.target.value)}
          disabled={farms.length === 0}
        >
          {farms.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1">
        <span className="text-[10px] uppercase tracking-widest text-ceres-dim">Lote</span>
        <select
          className={SELECT_CLASS}
          value={selectedPlotId ?? ""}
          onChange={(event) => onSelectPlot(event.target.value)}
          disabled={!farm || farm.plots.length === 0}
        >
          {(farm?.plots ?? []).map((plot) => (
            <option key={plot.id} value={plot.id}>
              {plot.name} — {plot.grid_width}×{plot.grid_height} ({plot.cell_count} celdas)
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1">
        <span className="text-[10px] uppercase tracking-widest text-ceres-dim">
          Ciclo de cultivo
        </span>
        <select
          className={SELECT_CLASS}
          value={selectedCropCycleId ?? ""}
          onChange={(event) => onSelectCropCycle(event.target.value)}
          disabled={cropCycles.length === 0}
        >
          {cropCycles.length === 0 && <option value="">Sin ciclos</option>}
          {cropCycles.map((cycle) => (
            <option key={cycle.id} value={cycle.id}>
              {cycle.name} — {cycle.crop.name}
            </option>
          ))}
        </select>
        {cropCycles.length === 0 && (
          <span className="text-[11px] text-ceres-dim">
            Este lote no tiene ciclos: no se puede estimar rendimiento sobre él.
          </span>
        )}
      </label>
    </div>
  );
}
