"use client";

/**
 * CERES — inspección espacial de una finca.
 *
 * Esta página es la única que pide datos. Los componentes reciben lo que
 * necesitan por props y no saben que existe una API; el store solo guarda qué
 * está seleccionado.
 *
 * El terreno ocupa la ventana entera y el resto flota encima. No es una
 * decisión estética: el objeto de análisis de CERES es la parcela, y meterla en
 * una tarjeta dentro de una rejilla de paneles la convierte en un widget más.
 *
 * Flujo:
 *
 *   farms → farm(plots) → cropCycles → cells + overview → click → cell
 *                                                           │
 *                                                           └→ POST /predictions
 */

import { useCallback, useEffect, useMemo } from "react";

import { CellInspector } from "@/components/cell-inspector/CellInspector";
import { PlotSelector } from "@/components/dashboard/PlotSelector";
import { TopStrip } from "@/components/dashboard/TopStrip";
import { RiskLegend } from "@/components/terrain/RiskLegend";
import { TerrainModeSwitch } from "@/components/terrain/TerrainModeSwitch";
import { TerrainView } from "@/components/terrain/TerrainView";
import { ViewModeSwitch } from "@/components/terrain/ViewModeSwitch";
import { ErrorState } from "@/components/ui/ErrorState";
import { Spinner } from "@/components/ui/Spinner";
import { ceresApi } from "@/lib/api/endpoints";
import { useApiResource } from "@/lib/api/useApiResource";
import { joinTerrainCells } from "@/lib/terrain/types";
import { useCeresStore } from "@/stores/useCeresStore";

export default function CeresPage() {
  // Selectores individuales: la página no se suscribe al store completo.
  const selectedFarmId = useCeresStore((state) => state.selectedFarmId);
  const selectedPlotId = useCeresStore((state) => state.selectedPlotId);
  const selectedCropCycleId = useCeresStore((state) => state.selectedCropCycleId);
  const selectedCellId = useCeresStore((state) => state.selectedCellId);
  const viewMode = useCeresStore((state) => state.viewMode);
  const terrainMode = useCeresStore((state) => state.terrainMode);

  const selectFarm = useCeresStore((state) => state.selectFarm);
  const selectPlot = useCeresStore((state) => state.selectPlot);
  const selectCropCycle = useCeresStore((state) => state.selectCropCycle);
  const clearSelection = useCeresStore((state) => state.clearSelection);
  const setViewMode = useCeresStore((state) => state.setViewMode);
  const setTerrainMode = useCeresStore((state) => state.setTerrainMode);

  const health = useApiResource((signal) => ceresApi.health(signal), []);
  const farms = useApiResource((signal) => ceresApi.listFarms(signal), []);

  const farm = useApiResource(
    selectedFarmId ? (signal) => ceresApi.getFarm(selectedFarmId, signal) : null,
    [selectedFarmId],
  );

  const cropCycles = useApiResource(
    selectedPlotId ? (signal) => ceresApi.listCropCycles(selectedPlotId, signal) : null,
    [selectedPlotId],
  );

  // Estado del terreno: da la geometría (altura de cada celda).
  const terrain = useApiResource(
    selectedPlotId ? (signal) => ceresApi.listCells(selectedPlotId, signal) : null,
    [selectedPlotId],
  );

  // Métricas del motor: dan el color. Dos peticiones porque son dos cosas
  // distintas — cómo ES la parcela y qué predice el motor sobre ella—.
  const overview = useApiResource(
    selectedPlotId && selectedCropCycleId
      ? (signal) => ceresApi.getPlotOverview(selectedPlotId, selectedCropCycleId, signal)
      : null,
    [selectedPlotId, selectedCropCycleId],
  );

  const cell = useApiResource(
    selectedCellId ? (signal) => ceresApi.getCell(selectedCellId, signal) : null,
    [selectedCellId],
  );

  // --- Selecciones por defecto ------------------------------------------------
  // El MVP tiene una sola finca y un solo ciclo: obligar a elegirlos a mano
  // sería fricción sin ninguna decisión detrás.

  useEffect(() => {
    if (!selectedFarmId && farms.data && farms.data.length > 0) {
      selectFarm(farms.data[0]!.id);
    }
  }, [farms.data, selectedFarmId, selectFarm]);

  useEffect(() => {
    if (!selectedPlotId && farm.data && farm.data.plots.length > 0) {
      selectPlot(farm.data.plots[0]!.id);
    }
  }, [farm.data, selectedPlotId, selectPlot]);

  useEffect(() => {
    if (!selectedCropCycleId && cropCycles.data && cropCycles.data.length > 0) {
      selectCropCycle(cropCycles.data[0]!.id);
    }
  }, [cropCycles.data, selectedCropCycleId, selectCropCycle]);

  // Unión de estado y métricas por cell_id. Emparejar dos listas no es una
  // fórmula: los valores llegan ya calculados del motor.
  const terrainCells = useMemo(() => {
    if (!terrain.data || !overview.data) return [];
    return joinTerrainCells(terrain.data.cells, overview.data.cells);
  }, [terrain.data, overview.data]);

  const selectedOverview = useMemo(
    () => overview.data?.cells.find((item) => item.cell_id === selectedCellId) ?? null,
    [overview.data, selectedCellId],
  );

  const plot = farm.data?.plots.find((item) => item.id === selectedPlotId) ?? null;
  const isLoadingTerrain = terrain.isLoading || overview.isLoading;
  const terrainError = terrain.error ?? overview.error;

  const reloadTerrain = useCallback(() => {
    terrain.reload();
    overview.reload();
  }, [terrain, overview]);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-soil-900">
      {/* El terreno ocupa la ventana; todo lo demás flota encima. */}
      <div className="absolute inset-0">
        {isLoadingTerrain && (
          <div className="grid h-full place-items-center">
            <Spinner label="Ejecutando el motor sobre el lote" />
          </div>
        )}

        {terrainError && !isLoadingTerrain && (
          <div className="grid h-full place-items-center px-6">
            <div className="max-w-md">
              <ErrorState message={terrainError} onRetry={reloadTerrain} />
            </div>
          </div>
        )}

        {!isLoadingTerrain && !terrainError && terrainCells.length > 0 && overview.data && (
          <TerrainView
            cells={terrainCells}
            gridWidth={overview.data.grid_width}
            gridHeight={overview.data.grid_height}
          />
        )}
      </div>

      <TopStrip
        health={health.data}
        healthError={health.error}
        farms={farms.data ?? []}
        farm={farm.data}
        plot={plot}
        cropCycles={cropCycles.data ?? []}
        selectedFarmId={selectedFarmId}
        selectedCropCycleId={selectedCropCycleId}
        onSelectFarm={selectFarm}
        onSelectCropCycle={selectCropCycle}
      />

      {/* Lotes, en el borde del terreno. */}
      <div className="absolute left-5 top-1/2 z-20 -translate-y-1/2">
        <PlotSelector
          plots={farm.data?.plots ?? []}
          selectedPlotId={selectedPlotId}
          onSelect={selectPlot}
        />
      </div>

      {/* Leyenda: abajo a la izquierda, fuera del camino del terreno. */}
      <div className="absolute bottom-5 left-5 z-20">
        <RiskLegend cells={overview.data?.cells ?? []} viewMode={viewMode} />
      </div>

      {/* Modos: centrados abajo, la acción más repetida después de seleccionar. */}
      <div className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2">
        <ViewModeSwitch value={viewMode} onChange={setViewMode} />
        <TerrainModeSwitch value={terrainMode} onChange={setTerrainMode} />
      </div>

      {/* Inspector. */}
      <aside className="floating absolute right-5 top-24 z-20 max-h-[calc(100dvh-8rem)] w-[22rem] overflow-y-auto rounded-xl p-4">
        <CellInspector
          cell={cell.data}
          overview={selectedOverview}
          cells={overview.data?.cells ?? []}
          plot={plot}
          cropCycleId={selectedCropCycleId}
          isLoading={cell.isLoading}
          error={cell.error}
          onRetry={cell.reload}
          onClear={clearSelection}
        />
      </aside>

      {/* Lo que cambia por selección, anunciado a quien no lo ve. */}
      <p aria-live="polite" className="sr-only">
        {cell.data
          ? `Celda ${cell.data.cell_code} seleccionada.${
              selectedOverview
                ? ` Riesgo ${selectedOverview.risk_level}, ${selectedOverview.projected_yield_kg} kilogramos proyectados.`
                : ""
            }`
          : "Ninguna celda seleccionada."}
      </p>
    </div>
  );
}
