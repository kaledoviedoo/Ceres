"use client";

/**
 * CERES — inspección espacial de una finca.
 *
 * Esta página es la única que pide datos. Los componentes reciben lo que
 * necesitan por props y no saben que existe una API; el store solo guarda qué
 * está seleccionado.
 *
 * COMPOSICION
 * El terreno ocupa la ventana entera y el cromo flota sobre él, superponiéndose
 * a sus bordes. No es una decisión estética: el objeto de análisis de CERES es
 * la parcela, y meterla en una tarjeta dentro de una rejilla de paneles la
 * convierte en un widget más.
 *
 * Los controles se agrupan por el tipo de decisión que representan, no por
 * dónde caben:
 *
 *   oeste        qué lote miras
 *   sur-oeste    qué significan los colores y cuánta superficie ocupa cada nivel
 *   sur-centro   qué métrica pinta el terreno
 *   sur-este     desde dónde lo miras: orientación, zoom, relieve o planta
 *   este         qué hay dentro de lo que has seleccionado
 *
 * Flujo:
 *
 *   farms → farm(plots) → cropCycles → cells + overview → click → cell
 *                                                           │
 *                                                           └→ POST /predictions
 */

import { useCallback, useEffect, useMemo } from "react";

import { CellInspector } from "@/components/cell-inspector/CellInspector";
import { BottomStrips } from "@/components/dashboard/BottomStrips";
import { PlotSelector } from "@/components/dashboard/PlotSelector";
import { TopStrip } from "@/components/dashboard/TopStrip";
import { RiskLegend } from "@/components/terrain/RiskLegend";
import { SurfaceStyleSwitch } from "@/components/terrain/SurfaceStyleSwitch";
import { TerrainModeSwitch } from "@/components/terrain/TerrainModeSwitch";
import { TerrainView } from "@/components/terrain/TerrainView";
import { ViewModeSwitch } from "@/components/terrain/ViewModeSwitch";
import { ErrorState } from "@/components/ui/ErrorState";
import { Spinner } from "@/components/ui/Spinner";
import { ceresApi } from "@/lib/api/endpoints";
import { useApiResource } from "@/lib/api/useApiResource";
import { ElevationField, gridElevationSource } from "@/lib/terrain/elevation";
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
  const surfaceStyle = useCeresStore((state) => state.surfaceStyle);

  const selectFarm = useCeresStore((state) => state.selectFarm);
  const selectPlot = useCeresStore((state) => state.selectPlot);
  const selectCropCycle = useCeresStore((state) => state.selectCropCycle);
  const clearSelection = useCeresStore((state) => state.clearSelection);
  const setViewMode = useCeresStore((state) => state.setViewMode);
  const setTerrainMode = useCeresStore((state) => state.setTerrainMode);
  const setSurfaceStyle = useCeresStore((state) => state.setSurfaceStyle);

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

  /**
   * LA RAMA GEOMETRICA nace aquí, y solo recibe elevación.
   *
   * Se construye en la página y no dentro del canvas porque hay dos consumidores
   * con necesidades distintas: la escena la usa para la malla y el inspector para
   * declarar la procedencia. Derivarla dos veces sería tener dos verdades sobre
   * el mismo terreno.
   *
   * El día que entre un DEM, esta es la única línea que cambia.
   */
  const field = useMemo(() => {
    if (!overview.data || terrainCells.length === 0) return null;
    return new ElevationField(
      gridElevationSource(terrainCells, overview.data.grid_width, overview.data.grid_height),
    );
  }, [terrainCells, overview.data]);

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

  // El panel crece al abrir una celda. Que ocupe menos mientras no hay nada
  // abierto devuelve al terreno los píxeles que el resumen no necesita, y hace
  // que seleccionar se note.
  // La vista Campo no pinta ningún dato en la superficie: allí el selector de
  // métrica y la leyenda no gobiernan nada. La malla plana siempre pinta dato.
  const showsData = terrainMode === "2d" || surfaceStyle === "pro";

  const inspectorWidth = cell.data
    ? "lg:w-[20rem] xl:w-[22rem] 2xl:w-[24rem]"
    : "lg:w-[17rem] xl:w-[18.5rem]";

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-canvas">
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
            field={field}
            cells={terrainCells}
            gridWidth={overview.data.grid_width}
            gridHeight={overview.data.grid_height}
          />
        )}
      </div>

      <TopStrip
        farms={farms.data ?? []}
        plot={plot}
        cropCycles={cropCycles.data ?? []}
        selectedFarmId={selectedFarmId}
        selectedCropCycleId={selectedCropCycleId}
        onSelectFarm={selectFarm}
        onSelectCropCycle={selectCropCycle}
      />

      {/* Qué le preguntas al terreno. Centrado arriba porque es la decisión de
          mayor nivel: cambia el sentido de todo lo demás que hay en pantalla.
          Solo en relieve; la vista en planta no tiene materiales.

          Centrado SOLO cuando cabe. El breadcrumb llega a 478 px, así que el
          centro no queda libre hasta ~1116 px de ancho: por debajo de `xl` el
          conmutador se alinea al este, en la misma fila. Centrarlo igualmente
          lo dejaba encima del nombre del ciclo. */}
      {terrainMode === "3d" && (
        <div className="pointer-events-auto absolute right-6 top-4 z-40 xl:left-1/2 xl:right-auto xl:-translate-x-1/2">
          <SurfaceStyleSwitch value={surfaceStyle} onChange={setSurfaceStyle} />
        </div>
      )}

      {/* Lote, anclado al oeste. En pantallas estrechas baja bajo la franja,
          donde no compite con el panel inferior. */}
      <div className="absolute left-6 top-[5.75rem] z-20">
        <PlotSelector
          plots={farm.data?.plots ?? []}
          selectedPlotId={selectedPlotId}
          onSelect={selectPlot}
        />
      </div>

      {/* Leyenda. Se retira por debajo de `lg`: ahí el inspector pasa a hoja
          inferior y ocupa justo esta esquina. */}
      {/* Estado del lote: las tres preguntas que se hacen antes de abrir una
          celda. Reemplaza a la leyenda de esquina y al bloque de estado que
          estaba arriba a la derecha. */}
      <BottomStrips
        cells={overview.data?.cells ?? []}
        health={health.data}
        healthError={health.error}
      />

      {/* La rampa continua solo en los modos que la usan: en riesgo, la clave de
          color ya la da la franja del pie, y repetirla sería ruido. En la vista
          Campo no hay color de dato que explicar. */}
      {showsData && viewMode !== "risk" && (
        <div className="absolute bottom-[8.5rem] right-6 z-20 hidden lg:block">
          <RiskLegend cells={overview.data?.cells ?? []} viewMode={viewMode} />
        </div>
      )}

      {/* Qué métrica pinta el terreno. Centrado abajo: es la decisión que más se
          repite después de seleccionar una celda.

          Por debajo de `md` sube una fila más: con tres opciones mide 242 px y
          a 640 de ancho chocaba con el conmutador Relieve/Planta. Apilados, cada
          uno conserva su sitio.

          Por debajo de `lg` sube para librar la hoja inferior. Degradar la
          composición en pantallas estrechas es legítimo; dejar un control bajo
          un panel, donde no se puede pulsar, no lo es. */}
      {showsData && (
        <div className="absolute bottom-[calc(45dvh+5rem)] left-1/2 z-20 -translate-x-1/2 md:bottom-[calc(45dvh+1.5rem)] lg:bottom-[8.5rem]">
          <ViewModeSwitch value={viewMode} onChange={setViewMode} />
        </div>
      )}

      {/* Cómo se mira el terreno. Bajo la rosa de los vientos y el zoom, que
          monta `TerrainCanvas`: los tres son controles de punto de vista. */}
      {/* Relieve o planta. Al oeste, bajo el compás y el zoom: los tres
          responden a "desde dónde miras el terreno". Estaba al este y ahí se
          solapaba con el inspector, que ocupa esa columna entera. */}
      <div className="absolute bottom-[calc(45dvh+1.5rem)] left-6 z-30 lg:bottom-[8.5rem]">
        <TerrainModeSwitch value={terrainMode} onChange={setTerrainMode} />
      </div>

      {/* Inspector. Columna al este en escritorio; hoja inferior por debajo de
          `lg`, donde una columna de 20 rem se comería el terreno entero.

          El alto máximo descuenta la franja superior Y las del pie: sin ese
          descuento, un inspector con histórico crecía por encima del bloque
          del modelo y lo tapaba. */}
      {/* El desplazamiento vive DENTRO, no en el panel. El canto de luz del
          cristal es un pseudoelemento anclado al panel: si el panel fuera el que
          desplaza, el canto superior se iria de la vista al bajar. */}
      {/* El tope de altura va en `calc()` a propósito: ver nota en el CSS
          emitido. `max-h-[45dvh]` a secas no genera regla. */}
      <aside
        className={`panel absolute inset-x-3 bottom-3 z-20 max-h-[calc(45dvh)] overflow-hidden rounded-2xl lg:inset-x-auto lg:bottom-auto lg:right-6 lg:top-[5.75rem] lg:max-h-[calc(100dvh-16rem)] ${inspectorWidth}`}
      >
        <div className="max-h-[calc(45dvh)] overflow-y-auto p-4 lg:max-h-[calc(100dvh-16rem)] lg:p-5">
        <CellInspector
          cell={cell.data}
          overview={selectedOverview}
          cells={overview.data?.cells ?? []}
          field={field}
          plot={plot}
          cropCycleId={selectedCropCycleId}
          isLoading={cell.isLoading}
          error={cell.error}
          onRetry={cell.reload}
          onClear={clearSelection}
        />
        </div>
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
