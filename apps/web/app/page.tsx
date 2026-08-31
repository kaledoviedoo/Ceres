"use client";

/**
 * Dashboard de CERES.
 *
 * Esta página es la única que pide datos. Los componentes reciben lo que
 * necesitan por props y no saben que existe una API; el store solo guarda qué
 * está seleccionado. Esa separación es lo que permitirá sustituir `CellGrid`
 * por un `TerrainCanvas` de React Three Fiber en la fase 7 sin tocar nada de
 * lo demás.
 *
 * Flujo:
 *
 *   farms → farm(plots) → cropCycles → overview(400 celdas) → click → cell
 *                                                                │
 *                                                                └→ POST /predictions
 */

import { useEffect, useMemo } from "react";

import { CellInspector } from "@/components/cell-inspector/CellInspector";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { PlotSelector } from "@/components/dashboard/PlotSelector";
import { StatusBar } from "@/components/dashboard/StatusBar";
import { CellGrid } from "@/components/terrain/CellGrid";
import { RiskLegend } from "@/components/terrain/RiskLegend";
import { ViewModeSwitch } from "@/components/terrain/ViewModeSwitch";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Panel } from "@/components/ui/Panel";
import { Spinner } from "@/components/ui/Spinner";
import { ceresApi } from "@/lib/api/endpoints";
import { useApiResource } from "@/lib/api/useApiResource";
import { formatInteger } from "@/lib/presentation/format";
import { useCeresStore } from "@/stores/useCeresStore";

export default function DashboardPage() {
  const {
    selectedFarmId,
    selectedPlotId,
    selectedCropCycleId,
    selectedCellId,
    hoveredCellId,
    viewMode,
    selectFarm,
    selectPlot,
    selectCropCycle,
    selectCell,
    hoverCell,
    setViewMode,
  } = useCeresStore();

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

  // Métricas de la celda seleccionada, sacadas del overview ya cargado: pedir
  // otra vez al servidor lo que ya está en memoria sería un viaje de más.
  const selectedOverview = useMemo(
    () => overview.data?.cells.find((item) => item.cell_id === selectedCellId) ?? null,
    [overview.data, selectedCellId],
  );

  const plot = farm.data?.plots.find((item) => item.id === selectedPlotId) ?? null;

  return (
    <DashboardShell
      statusBar={<StatusBar health={health.data} error={health.error} />}
      sidebar={
        <>
          <Panel title="Selección">
            {farms.isLoading && <Spinner label="Cargando fincas" />}
            {farms.error && <ErrorState message={farms.error} onRetry={farms.reload} />}
            {farms.data && (
              <PlotSelector
                farms={farms.data}
                farm={farm.data}
                cropCycles={cropCycles.data ?? []}
                selectedFarmId={selectedFarmId}
                selectedPlotId={selectedPlotId}
                selectedCropCycleId={selectedCropCycleId}
                onSelectFarm={selectFarm}
                onSelectPlot={selectPlot}
                onSelectCropCycle={selectCropCycle}
              />
            )}
          </Panel>

          {plot && (
            <Panel title="Lote">
              <dl className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <dt className="text-ceres-muted">Malla</dt>
                  <dd className="tabular text-ceres-text">
                    {plot.grid_width} × {plot.grid_height}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ceres-muted">Celdas</dt>
                  <dd className="tabular text-ceres-text">{formatInteger(plot.cell_count)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ceres-muted">Área</dt>
                  <dd className="tabular text-ceres-text">{formatInteger(plot.area_m2)} m²</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ceres-muted">Lado de celda</dt>
                  <dd className="tabular text-ceres-text">{plot.cell_size_m} m</dd>
                </div>
              </dl>
            </Panel>
          )}
        </>
      }
      canvas={
        <Panel
          title="Terreno"
          subtitle={
            overview.data
              ? `${formatInteger(overview.data.cells.length)} celdas · estimación al vuelo, sin guardar`
              : undefined
          }
          actions={<ViewModeSwitch value={viewMode} onChange={setViewMode} />}
        >
          {overview.isLoading && <Spinner label="Ejecutando el motor sobre el lote" />}
          {overview.error && <ErrorState message={overview.error} onRetry={overview.reload} />}

          {!overview.isLoading && !overview.error && !overview.data && (
            <EmptyState
              title="Selecciona un lote y un ciclo de cultivo"
              hint="La malla se colorea con las métricas que devuelve la API."
            />
          )}

          {overview.data && (
            <div className="space-y-4">
              <CellGrid
                cells={overview.data.cells}
                gridWidth={overview.data.grid_width}
                gridHeight={overview.data.grid_height}
                viewMode={viewMode}
                selectedCellId={selectedCellId}
                hoveredCellId={hoveredCellId}
                onSelect={selectCell}
                onHover={hoverCell}
              />
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ceres-border pt-3">
                <RiskLegend cells={overview.data.cells} viewMode={viewMode} />
                <span className="tabular text-[11px] text-ceres-dim">
                  {overview.data.model_version}
                </span>
              </div>
            </div>
          )}
        </Panel>
      }
      inspector={
        <Panel title="Cell Inspector">
          <CellInspector
            cell={cell.data}
            overview={selectedOverview}
            cropCycleId={selectedCropCycleId}
            isLoading={cell.isLoading}
            error={cell.error}
            onRetry={cell.reload}
          />
        </Panel>
      }
    />
  );
}
