"use client";

/**
 * Ficha analítica de un metro cuadrado.
 *
 * NO ES UNA LISTA DE PROPIEDADES. La versión anterior volcaba quince filas
 * `etiqueta: número` y obligaba a saberse el lote de memoria para saber si
 * "suelo 18,1 %" era bueno o malo. Aquí cada cifra llega con su contexto: dónde
 * cae dentro del reparto de la parcela, y de dónde sale.
 *
 * SEIS BLOQUES, de lo espacial a lo predictivo, que es el orden en que se hacen
 * las preguntas al abrir una celda:
 *
 *   1. QUE celda es          código, riesgo
 *   2. DONDE está            coordenadas, elevación, pendiente, procedencia
 *   3. CUANTO da             rendimiento y su perfil en la hilera
 *   4. COMO está el suelo    suelo, sanidad, densidad, con percentil
 *   5. CUANTO se pierde      pérdida y score
 *   6. QUE ha pasado antes   histórico, o su ausencia declarada
 *
 * DOS ORIGENES, Y SE DICE CUAL ES CUAL. Lo MEDIDO —pendiente, suelo, densidad,
 * sanidad— está guardado en la base. Lo ESTIMADO —rendimiento, pérdida, riesgo—
 * lo calcula el motor en cada consulta y no está guardado hasta que alguien pulsa
 * "Guardar predicción". Confundirlos sería el error más caro de esta pantalla: el
 * valor de un Digital Twin está en poder distinguir lo que se midió de lo que se
 * estimó.
 *
 * Y UN TERCER ORIGEN, el más fácil de olvidar: la elevación es SINTETICA. El
 * bloque de ubicación lo dice, porque una coordenada con seis decimales invita a
 * creer que hay un DEM detrás.
 */

import { useMemo } from "react";

import { PredictionPanel } from "@/components/cell-inspector/PredictionPanel";
import { LineChart, MetricBar, ScoreDial, Stat, type SeriesPoint } from "@/components/ui/DataViz";
import { RiskBadge } from "@/components/ui/Badge";
import { ErrorState } from "@/components/ui/ErrorState";
import { Spinner } from "@/components/ui/Spinner";
import { ceresApi } from "@/lib/api/endpoints";
import { useApiResource } from "@/lib/api/useApiResource";
import {
  formatDegrees,
  formatDensity,
  formatIndex,
  formatInteger,
  formatKg,
  formatPercent,
  formatScore,
  persistenceLabel,
} from "@/lib/presentation/format";
import { RISK_COLORS, riskDistribution } from "@/lib/presentation/risk";
import { percentileLabel, percentileOf } from "@/lib/terrain/statistics";
import { PROVENANCE_LABEL, type ElevationField } from "@/lib/terrain/elevation";
import type { CellDetail, CellOverview, Plot, RiskLevel } from "@/lib/types/api";

interface CellInspectorProps {
  cell: CellDetail | null;
  overview: CellOverview | null;
  cells: CellOverview[];
  /**
   * Si las métricas de `overview` están guardadas.
   *
   * Lo declara la API y hoy es siempre `false`: son cálculos al vuelo. Se pasa
   * en vez de escribirlo a mano para que el día que cambie, cambie el rótulo.
   */
  overviewPersisted: boolean;
  /** Solo para leer la procedencia. El inspector no construye geometría. */
  field: ElevationField | null;
  plot: Plot | null;
  cropCycleId: string | null;
  /** El instante que se está pintando; viaja al guardar una predicción. */
  asOf: string | null;
  isLoading: boolean;
  error: string | null;
  onRetry?: () => void;
  onClear: () => void;
}

/** Latitud y longitud con hemisferio, como en cualquier ficha de campo. */
function formatLatitude(value: number): string {
  return `${Math.abs(value).toFixed(6)}° ${value >= 0 ? "N" : "S"}`;
}

function formatLongitude(value: number): string {
  return `${Math.abs(value).toFixed(6)}° ${value >= 0 ? "E" : "O"}`;
}

export function CellInspector({
  cell,
  overview,
  cells,
  overviewPersisted,
  field,
  plot,
  cropCycleId,
  asOf,
  isLoading,
  error,
  onRetry,
  onClear,
}: CellInspectorProps) {
  // El histórico se pide siempre que haya celda: es lo que decide si el gráfico
  // tiene serie o estado vacío, y no se puede saber sin preguntar.
  const history = useApiResource(
    cell ? (signal) => ceresApi.listPredictions(cell.id, signal) : null,
    [cell?.id],
  );

  const yields = useMemo(() => cells.map((c) => c.projected_yield_kg), [cells]);
  /** Fracción del lote que rinde MENOS que esta celda. Un solo cálculo para
   *  la barra y para la frase que la explica: si divergieran, el texto
   *  contaría algo distinto de lo que se ve. */
  const rendimientoPct = overview
    ? percentileOf(yields, overview.projected_yield_kg)
    : 0;

  const row = useMemo(() => {
    if (!cell) return [];
    return cells.filter((c) => c.y === cell.y).sort((a, b) => a.x - b.x);
  }, [cells, cell]);

  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (isLoading) return <Spinner label="Cargando la celda" />;
  if (!cell) return <PlotSummary plot={plot} cells={cells} field={field} />;

  const level: RiskLevel = overview?.risk_level ?? "medium";
  const tone = RISK_COLORS[level].fill;

  const transect: SeriesPoint[] = row.map((c) => ({
    label: `x ${c.x}`,
    value: c.projected_yield_kg,
  }));
  const activeIndex = row.findIndex((c) => c.x === cell.x);

  const predicciones: SeriesPoint[] = (history.data?.predictions ?? []).map((p) => ({
    label: p.created_at,
    value: p.projected_yield_kg,
  }));

  return (
    // `key` por celda: reinicia la animación de entrada, que es lo que avisa de
    // que las cifras de abajo son ya otras.
    <div key={cell.id} className="rise space-y-6">
      {/* ── 1 · Qué celda ───────────────────────────────────────────────── */}
      <header>
        <div className="flex items-start justify-between gap-3">
          <p className="eyebrow">Celda</p>
          <button
            type="button"
            onClick={onClear}
            aria-label="Cerrar la celda y volver al resumen del lote"
            className="-mr-1 -mt-1 grid h-6 w-6 place-items-center rounded text-muted transition-colors hover:bg-line-soft hover:text-ink"
          >
            <span aria-hidden="true" className="text-sm leading-none">
              ✕
            </span>
          </button>
        </div>

        <div className="mt-1 flex items-end justify-between gap-3">
          <h2 className="tabular text-2xl font-medium leading-none text-ink">{cell.cell_code}</h2>
          {overview && <RiskBadge level={overview.risk_level} />}
        </div>
      </header>

      {/* ── 2 · Dónde está ──────────────────────────────────────────────── */}
      <Block title="Ubicación" note={`x ${cell.x} · y ${cell.y}`}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Stat label="Latitud" value={formatLatitude(cell.centroid_latitude)} />
          <Stat label="Longitud" value={formatLongitude(cell.centroid_longitude)} />
          <Stat label="Elevación" value={`${cell.elevation_m.toFixed(2)} m`} hint="sobre el nivel del mar" />
          {/* El `hint` no es adorno: la pendiente está junto a unas coordenadas
              con seis decimales y una altitud con dos, y en esa compañía se lee
              como una medición. Se deriva de la elevación de al lado, que la
              nota de abajo declara sintética. */}
          <Stat
            label="Pendiente"
            value={formatDegrees(cell.slope_deg)}
            hint="derivada de la elevación"
          />
        </div>

        {field && <ProvenanceNote field={field} />}
      </Block>

      {/* ── 3 · Cuánto da ───────────────────────────────────────────────── */}
      {overview && (
        <Block title="Rendimiento estimado" note={persistenceLabel(overviewPersisted)}>
          <p className="display">{formatKg(overview.projected_yield_kg)}</p>
          <p className="tabular mt-1.5 text-[11px] text-muted">
            {formatInteger(overview.projected_boxes)} cajas proyectadas
          </p>

          <div className="mt-4">
            <LineChart
              points={transect}
              format={formatKg}
              highlight={activeIndex}
              caption={`Fila ${cell.y + 1} · oeste → este`}
              emptyTitle="Sin hilera que comparar"
              emptyHint="Hace falta más de una celda en la fila."
              ariaLabel={`Rendimiento a lo largo de la fila ${cell.y + 1}.`}
            />
          </div>
        </Block>
      )}

      {/* ── 4 · Cómo está el terreno ────────────────────────────────────── */}
      {/* "Entrada del modelo" y no "Medido", que es lo que decía antes y era
          falso: ninguno de estos cuatro valores se levantó en campo. Llegan en
          la ficha de la celda y alimentan el motor —sanidad y suelo son dos de
          los tres términos del score de riesgo—. Lo que sí es cierto de todos
          ellos, venga el dataset de donde venga, es que son ENTRADAS: nada aquí
          es un resultado, y por eso ninguna barra lleva percentil. */}
      <Block title="Condición del terreno" note="Entrada del modelo">
        <MetricBar
          label="Calidad de suelo"
          value={formatIndex(cell.soil_quality)}
          fill={cell.soil_quality}
        />
        <MetricBar
          label="Sanidad"
          value={formatIndex(cell.health_factor)}
          fill={cell.health_factor}
        />
        <MetricBar
          label="Densidad de siembra"
          value={formatDensity(cell.plant_density)}
          fill={Math.min(1, cell.plant_density / 4)}
        />
        <MetricBar
          label="Factor residual"
          value={formatScore(cell.base_yield_factor)}
          fill={Math.min(1, cell.base_yield_factor / 1.5)}
        />
      </Block>

      {/* ── 5 · Cuánto se pierde ────────────────────────────────────────── */}
      {overview && (
        <Block title="Riesgo" note="Estimado">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="tabular text-2xl font-medium leading-none" style={{ color: tone }}>
                {formatPercent(overview.estimated_loss_percentage)}
              </p>
              <p className="eyebrow mt-1.5">Pérdida estimada</p>
            </div>
            <div className="text-right">
              <ScoreDial value={overview.risk_score} tone={tone} />
              <p className="tabular text-[11px] text-ink">{formatScore(overview.risk_score)}</p>
              <p className="eyebrow">Risk score</p>
            </div>
          </div>

          {/* El percentil, en palabras. "p69" a secas no dice de qué población
              sale ni hacia dónde es mejor: hay que leer la cifra Y saberse el
              lote. La frase lo cierra sin añadir ningún cálculo nuevo: es el
              mismo valor que pinta la barra. */}
          <div className="mt-3">
            <MetricBar
              label="Posición en el lote"
              value={formatKg(overview.projected_yield_kg)}
              fill={rendimientoPct}
              percentile={rendimientoPct}
              tone={tone}
            />
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              Rinde más que el {percentileLabel(rendimientoPct)} % de las{" "}
              {yields.length} celdas del lote.
            </p>
          </div>
        </Block>
      )}

      {/* ── 6 · Qué ha pasado antes ─────────────────────────────────────── */}
      <Block title="Histórico" note={`${predicciones.length} registros`}>
        <LineChart
          points={predicciones}
          format={formatKg}
          caption="Predicciones guardadas"
          emptyTitle="Sin registros históricos"
          emptyHint="Las predicciones son inmutables y se acumulan: en cuanto guardes dos, aquí aparecerá la tendencia."
          ariaLabel="Historial de predicciones guardadas para esta celda."
        />

        <div className="mt-4">
          <PredictionPanel cellId={cell.id} cropCycleId={cropCycleId} asOf={asOf} />
        </div>
      </Block>
    </div>
  );
}

/**
 * La nota de procedencia.
 *
 * Va justo debajo de unas coordenadas con seis decimales, y ahí está su razón de
 * ser: esa precisión invita a creer que detrás hay un modelo digital del terreno.
 * No lo hay. Mientras la elevación sea generada, la interfaz tiene que decirlo
 * donde se lee la elevación, no en una nota al pie que nadie abre.
 */
function ProvenanceNote({ field }: { field: ElevationField }) {
  const p = field.provenance;

  return (
    <p className="mt-3 flex items-start gap-2 border-t border-line-soft pt-3 text-[10px] leading-relaxed text-muted">
      <span
        aria-hidden="true"
        className={`mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full ${
          p.measured ? "bg-risk-low" : "bg-risk-medium"
        }`}
      />
      <span>
        <span className="text-ink-soft">Elevación {PROVENANCE_LABEL[p.kind]}</span>
        {" · "}
        {p.measured ? "medición" : "dato no medido"}
        {" · resolución "}
        {p.nominalResolutionM} m nominal
        {/* La efectiva solo aparece si alguien la ha medido. Cuando la API no la
            declara llega `null`, y escribir ahí un número —o repetir la nominal—
            afirmaría una precisión que nadie ha comprobado. */}
        {p.effectiveResolutionM === null
          ? " · resolución efectiva sin medir"
          : p.effectiveResolutionM !== p.nominalResolutionM &&
            ` (${p.effectiveResolutionM} m efectiva)`}
      </span>
    </p>
  );
}

function Block({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-line pb-1.5">
        <h3 className="group-title">{title}</h3>
        {note && <span className="eyebrow shrink-0">{note}</span>}
      </div>
      {children}
    </section>
  );
}

const LEVELS: RiskLevel[] = ["low", "medium", "high"];

/** Cuántos metros ocupan `celdas` en este lote. Sale del dato, no de suponer 1 m. */
function ladoEnMetros(celdas: number, plot: Plot): string {
  return (celdas * plot.cell_size_m).toLocaleString("es", { maximumFractionDigits: 1 });
}

/**
 * Lo que se ve cuando no hay ninguna celda abierta.
 *
 * Corto a propósito: es una invitación a hacer clic, no un segundo panel de
 * métricas. La proporción por nivel ya está en la franja del pie.
 */
function PlotSummary({
  plot,
  cells,
  field,
}: {
  plot: Plot | null;
  cells: CellOverview[];
  field: ElevationField | null;
}) {
  if (!plot) {
    return (
      <p className="text-sm text-muted">
        Selecciona un lote y un ciclo de cultivo para inspeccionar el terreno.
      </p>
    );
  }

  const counts = riskDistribution(cells);

  return (
    <div className="space-y-5">
      <header>
        <p className="eyebrow">Lote</p>
        <h2 className="mt-1 text-xl font-medium leading-tight text-ink">{plot.name}</h2>
        <p className="tabular mt-1.5 text-[11px] text-muted">
          {plot.grid_width} × {plot.grid_height} · {formatInteger(plot.area_m2)} m²
        </p>
      </header>

      {field && field.reliefM > 0 && (
        <Block title="Relieve" note="Elevación">
          <div className="grid grid-cols-2 gap-x-4">
            <Stat label="Mínima" value={`${field.source.minMeters.toFixed(2)} m`} />
            <Stat label="Máxima" value={`${field.source.maxMeters.toFixed(2)} m`} />
          </div>
          {/* Los metros del lote salen de multiplicar celdas por `cell_size_m`,
              no de suponer que una celda mide un metro. Antes esta frase decía
              "en 20 × 20 m" leyendo el RECUENTO de celdas: con celdas de medio
              metro habría afirmado el doble del lote real. */}
          <p className="tabular mt-2 text-[11px] text-muted">
            Desnivel {field.reliefM.toFixed(2)} m en {ladoEnMetros(plot.grid_width, plot)} ×{" "}
            {ladoEnMetros(plot.grid_height, plot)} m
          </p>
          <ProvenanceNote field={field} />
        </Block>
      )}

      {cells.length > 0 && (
        <Block title="Reparto del riesgo" note={`${formatInteger(cells.length)} celdas`}>
          {LEVELS.map((level) => (
            <MetricBar
              key={level}
              label={`Riesgo ${RISK_COLORS[level].label.toLowerCase()}`}
              value={formatInteger(counts[level])}
              fill={counts[level] / cells.length}
              tone={RISK_COLORS[level].fill}
            />
          ))}
        </Block>
      )}

      <p className="text-xs leading-relaxed text-muted">
        Haz clic en una celda del terreno para inspeccionarla. Con el teclado, tabula hasta la
        malla y recórrela con las flechas.
      </p>
    </div>
  );
}
