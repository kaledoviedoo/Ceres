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
import { DistributionPanel } from "@/components/terrain/DistributionPanel";
import { LayerSwitch } from "@/components/terrain/LayerSwitch";
import { TerrainModeSwitch } from "@/components/terrain/TerrainModeSwitch";
import { TerrainView } from "@/components/terrain/TerrainView";
import { ErrorState } from "@/components/ui/ErrorState";
import { Spinner } from "@/components/ui/Spinner";
import { ceresApi } from "@/lib/api/endpoints";
import { useApiResource } from "@/lib/api/useApiResource";
import {
  agreeOnPlotGrid,
  describeMissingGeometry,
  missingGeometryFields,
} from "@/lib/terrain/coords";
import { ElevationField, gridElevationSource } from "@/lib/terrain/elevation";
import { elevationProvenanceFrom } from "@/lib/terrain/provenance";
import { joinTerrainCells } from "@/lib/terrain/types";
import { getAvailableLayer } from "@/lib/terrain/layers";
import { useCeresStore } from "@/stores/useCeresStore";

export default function CeresPage() {
  // Selectores individuales: la página no se suscribe al store completo.
  const selectedFarmId = useCeresStore((state) => state.selectedFarmId);
  const selectedPlotId = useCeresStore((state) => state.selectedPlotId);
  const selectedCropCycleId = useCeresStore((state) => state.selectedCropCycleId);
  const selectedCellId = useCeresStore((state) => state.selectedCellId);
  const selectedAsOf = useCeresStore((state) => state.selectedAsOf);
  const activeLayerId = useCeresStore((state) => state.activeLayerId);
  const terrainMode = useCeresStore((state) => state.terrainMode);

  const selectFarm = useCeresStore((state) => state.selectFarm);
  const selectPlot = useCeresStore((state) => state.selectPlot);
  const selectCropCycle = useCeresStore((state) => state.selectCropCycle);
  const selectAsOf = useCeresStore((state) => state.selectAsOf);
  const clearSelection = useCeresStore((state) => state.clearSelection);
  const setActiveLayer = useCeresStore((state) => state.setActiveLayer);
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

  // De qué momentos puede el mapa enseñar el estado. Los lee la API de
  // `predictions.as_of`; aquí no se construye ninguna fecha.
  const timeline = useApiResource(
    selectedPlotId && selectedCropCycleId
      ? (signal) => ceresApi.getPlotTimeline(selectedPlotId, selectedCropCycleId, signal)
      : null,
    [selectedPlotId, selectedCropCycleId],
  );

  const moments = useMemo(() => timeline.data?.moments ?? [], [timeline.data]);

  /**
   * El instante que se está pintando.
   *
   * Sale del store si el usuario eligió uno; si no, del PRIMER momento del
   * lote. Se arranca en t0 y no en el último a propósito: es lo que deja ver la
   * historia. Se entra a un campo relativamente sano y una pulsación revela
   * dónde y cuánto lo dañaron los eventos. Arrancando al final, la transición
   * existe pero nadie la descubre.
   *
   * `null` —lote sin momentos, como los de la finca demo— pinta el estado base.
   * Es lo único afirmable sin una fecha con la que derivar.
   *
   * Se VALIDA contra la lista: si el store guardara un instante de otro lote
   * —no debería, `selectPlot` lo limpia— se pediría un mapa de una fecha que
   * este lote no tiene. Se descarta y se cae al primero.
   */
  const overviewAsOf = useMemo(() => {
    if (moments.length === 0) return null;
    const elegido = moments.find((moment) => moment.as_of === selectedAsOf);
    return elegido?.as_of ?? moments[0]!.as_of;
  }, [moments, selectedAsOf]);

  // Métricas del motor: dan el color. Petición aparte de la del terreno porque
  // son dos cosas distintas —cómo ES la parcela y qué predice el motor sobre
  // ella—, y solo esta depende del momento.
  const overview = useApiResource(
    selectedPlotId && selectedCropCycleId
      ? (signal) =>
          ceresApi.getPlotOverview(selectedPlotId, selectedCropCycleId, overviewAsOf, signal)
      : null,
    [selectedPlotId, selectedCropCycleId, overviewAsOf],
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
   * LA MALLA FISICA DEL LOTE, en un solo sitio.
   *
   * Las tres cifras vienen juntas de `/plots/{id}/overview` y aquí se quedan
   * juntas. `cell_size_m` estaba declarado en tres respuestas de la API y no lo
   * leía nadie: la geometría daba por hecho que una celda medía un metro. Al
   * agruparlas, la única forma de situar una celda en el espacio es pasar este
   * objeto, y no se puede construir sin decir cuánto mide su lado.
   */
  /**
   * Los cinco campos sin los que no se puede situar nada.
   *
   * Se comprueba ANTES de acordar la malla porque son preguntas distintas:
   * `agreeOnPlotGrid` verifica que las respuestas coincidan, y dos respuestas a
   * las que les falta el mismo campo coinciden perfectamente en `undefined`.
   *
   * Las tres magnitudes salen de la malla; el ancla geográfica, del lote.
   */
  const missingGeometry = useMemo(() => {
    const faltan = new Set<string>();
    if (terrain.data) {
      for (const f of missingGeometryFields(terrain.data, ["grid_width", "grid_height", "cell_size_m"])) {
        faltan.add(f);
      }
    }
    const lote = farm.data?.plots.find((item) => item.id === selectedPlotId);
    if (lote) {
      for (const f of missingGeometryFields(lote, ["origin_latitude", "origin_longitude"])) {
        faltan.add(f);
      }
    }
    return [...faltan];
  }, [terrain.data, farm.data, selectedPlotId]);

  const gridAgreement = useMemo(() => {
    const declarado = [];
    if (terrain.data) {
      declarado.push({
        source: "/plots/{id}/cells",
        width: terrain.data.grid_width,
        height: terrain.data.grid_height,
        cellSizeM: terrain.data.cell_size_m,
      });
    }
    if (overview.data) {
      declarado.push({
        source: "/plots/{id}/overview",
        width: overview.data.grid_width,
        height: overview.data.grid_height,
        cellSizeM: overview.data.cell_size_m,
      });
    }
    return declarado.length > 0 ? agreeOnPlotGrid(declarado) : null;
  }, [terrain.data, overview.data]);

  const plotGrid = gridAgreement && "agreed" in gridAgreement ? gridAgreement.agreed : null;

  /** Si las respuestas se contradicen sobre la malla, no se dibuja nada. */
  const gridConflict =
    gridAgreement && "conflict" in gridAgreement ? gridAgreement.conflict : null;

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
    if (!plotGrid || terrainCells.length === 0) return null;
    return new ElevationField(
      gridElevationSource(
        terrainCells,
        plotGrid,
        // LA PROCEDENCIA LA DICE LA API, no este componente. Si el bloque no
        // llega, `elevationProvenanceFrom` devuelve `unknown` en vez de
        // rellenarlo con algo plausible.
        elevationProvenanceFrom(terrain.data?.provenance, plotGrid.cellSizeM),
      ),
      // El paso físico entre coordenadas de malla. Es lo que convierte una
      // diferencia de alturas en pendiente, y no tiene nada que ver con la
      // resolución efectiva de la fuente: esa la declara `provenance`.
      plotGrid.cellSizeM,
    );
  }, [terrainCells, plotGrid, terrain.data]);

  const selectedOverview = useMemo(
    () => overview.data?.cells.find((item) => item.cell_id === selectedCellId) ?? null,
    [overview.data, selectedCellId],
  );

  /** La celda abierta, con su elevación: es la que sitúa el panel de reparto. */
  const selectedTerrainCell = useMemo(
    () => terrainCells.find((item) => item.cell_id === selectedCellId) ?? null,
    [terrainCells, selectedCellId],
  );

  const plot = farm.data?.plots.find((item) => item.id === selectedPlotId) ?? null;
  const isLoadingTerrain = terrain.isLoading || overview.isLoading;
  // Un contrato roto se trata como un fallo de carga y no como un caso a
  // resolver adivinando: si dos respuestas no se ponen de acuerdo sobre cuánto
  // mide el lote, dibujarlo con cualquiera de las dos sería inventar la escala.
  // Un contrato incompleto se trata como un fallo de carga, igual que uno
  // contradictorio: dibujar sin saber cuánto mide una celda sería inventar la
  // escala, y el resultado no se distinguiría de un terreno correcto.
  const missingGeometryMessage =
    missingGeometry.length > 0 ? describeMissingGeometry(missingGeometry) : null;
  const terrainError =
    terrain.error ?? overview.error ?? missingGeometryMessage ?? gridConflict;

  const reloadTerrain = useCallback(() => {
    terrain.reload();
    overview.reload();
  }, [terrain, overview]);

  // El panel crece al abrir una celda. Que ocupe menos mientras no hay nada
  // abierto devuelve al terreno los píxeles que el resumen no necesita, y hace
  // que seleccionar se note.
  const layer = getAvailableLayer(activeLayerId);

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

        {!isLoadingTerrain && !terrainError && terrainCells.length > 0 && plotGrid && (
          <TerrainView field={field} cells={terrainCells} plot={plotGrid} />
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
        moments={moments}
        // El que se está pintando de verdad, no el que guarda el store: si el
        // guardado no pertenece a este lote, `overviewAsOf` cae al primero, y
        // el control tiene que marcar lo que se ve.
        selectedAsOf={overviewAsOf}
        plantedAt={timeline.data?.planted_at ?? null}
        onSelectAsOf={selectAsOf}
      />

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
        persisted={overview.data?.persisted ?? false}
        health={health.data}
        healthError={health.error}
        modelVersion={overview.data?.model_version ?? null}
      />

      {/* Cómo se reparte la métrica activa por el lote, dónde cae la celda
          abierta y cuánto coincide con la zona en riesgo alto.

          Para TODAS las capas, también riesgo: el reparto continuo de
          `risk_score` no es lo mismo que el recuento de niveles de la franja del
          pie, y es lo que dice si una celda es rara o corriente.

          Al OESTE, sobre la barra de escala: es la columna del mapa —escala,
          orientación, clave de color— y la del este la ocupa entera el
          inspector. Al este se metía 63 px por debajo de su borde.

          El TOPE DE ALTURA no es decoración: la columna oeste la comparten el
          compás —anclado arriba— y este panel —anclado abajo—, y el panel crece
          hacia arriba con el contenido de la capa. Sin tope, en una pantalla de
          800 px de alto las capas con advertencia lo empujaban hasta debajo del
          compás. Con él, lo que cede en una pantalla corta es el desplazamiento
          del panel y no la legibilidad de otra cosa.

          32rem = 6rem del compás + 8rem que mide + 1rem de aire + 17rem de
          anclaje inferior. */}
      {terrainCells.length > 0 && (
        <div className="absolute bottom-[17rem] left-6 z-20 hidden max-h-[calc(100dvh-32rem)] overflow-y-auto lg:block">
          <DistributionPanel
            cells={terrainCells}
            layer={layer}
            selected={selectedTerrainCell}
          />
        </div>
      )}

      {/* Qué capa se proyecta sobre el terreno. Centrado abajo: es la decisión
          que más se repite después de seleccionar una celda, y ahora es UNA
          decisión —antes había que combinar este control con el de arriba—.

          Por debajo de `md` sube una fila más: chocaba con el conmutador
          Relieve/Planta. Apilados, cada uno conserva su sitio.

          Por debajo de `lg` sube para librar la hoja inferior. Degradar la
          composición en pantallas estrechas es legítimo; dejar un control bajo
          un panel, donde no se puede pulsar, no lo es.

          De `md` en adelante se centra en la BANDA LIBRE, no en el lienzo: a la
          izquierda la columna del mapa —escala y proyección, 15rem— y a la
          derecha lo que ocupe esa orilla: el compás y el zoom entre `md` y `lg`
          (5,5rem), el inspector de `lg` en adelante. Con seis capas el control mide ~420 px y
          centrado sobre todo el ancho se metía bajo una cosa o la otra según el
          tamaño de pantalla. Se descuenta siempre el ancho del inspector
          abierto, aunque no haya celda seleccionada, para que el control no
          salte al seleccionar. */}
      <div className="absolute bottom-[calc(45dvh+5rem)] left-1/2 z-20 -translate-x-1/2 md:bottom-[calc(45dvh+1.5rem)] md:left-[calc((15rem+100%-5.5rem)/2)] lg:bottom-[8.5rem] lg:left-[calc((15rem+100%-21.5rem)/2)] xl:left-[calc((15rem+100%-23.5rem)/2)] 2xl:left-[calc((15rem+100%-25.5rem)/2)]">
        <LayerSwitch value={activeLayerId} onChange={setActiveLayer} />
      </div>

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
          // `?? false` y no `?? true`: sin respuesta no se puede afirmar que
          // algo esté guardado.
          overviewPersisted={overview.data?.persisted ?? false}
          field={field}
          plot={plot}
          cropCycleId={selectedCropCycleId}
          asOf={overviewAsOf}
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
