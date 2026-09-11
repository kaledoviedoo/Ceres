"use client";

/**
 * Dónde cae esta celda dentro del lote.
 *
 * Sustituye a la leyenda, que solo decía los extremos de la rampa. Un mínimo y
 * un máximo no responden a la pregunta que trae a alguien a mirar un mapa de
 * calor: «¿esto es raro o es lo normal aquí?». El reparto sí.
 *
 * Tres cosas, en este orden:
 *
 *   REPARTO       cómo se agrupan las 400 celdas en esta métrica.
 *   ESTA CELDA    dónde cae la seleccionada dentro de ese reparto.
 *   COINCIDENCIA  cuánto se solapa con la zona en riesgo alto.
 *
 * COINCIDENCIA NO ES CAUSA. Se dice cuántas celdas caen a la vez en las dos
 * cosas y cuánto se separan las medianas. Nada más: afirmar que una variable
 * explica la otra necesitaría un modelo que CERES no tiene.
 *
 * El gráfico está escrito a mano sobre los tokens de CERES, como el resto. Una
 * librería de gráficos traería su sistema de color y su tipografía para dibujar
 * dieciséis rectángulos.
 */

import { useMemo } from "react";

import { formatInteger } from "@/lib/presentation/format";
import { RISK_COLORS } from "@/lib/presentation/risk";
import {
  REFERENCE_LEVEL,
  measureLayer,
  type AvailableLayer,
} from "@/lib/terrain/layers";
import { percentileLabel, percentileOf, rankOf } from "@/lib/terrain/statistics";
import type { TerrainCell } from "@/lib/terrain/types";

const W = 232;
const H = 44;

interface DistributionPanelProps {
  cells: TerrainCell[];
  layer: AvailableLayer;
  selected: TerrainCell | null;
}

export function DistributionPanel({ cells, layer, selected }: DistributionPanelProps) {
  // Una vez por (lote, capa). Nunca por celda ni por movimiento del ratón.
  const stats = useMemo(() => measureLayer(layer, cells), [layer, cells]);

  const posicion = useMemo(() => {
    if (!stats || !selected) return null;
    const value = layer.valueOf(selected);
    return {
      value,
      percentil: percentileLabel(percentileOf(stats.values, value)),
      puesto: rankOf(stats.values, value),
    };
  }, [stats, selected, layer]);

  if (!stats) return null;

  const { summary, bins, overlap } = stats;
  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  const span = summary.max - summary.min;
  /** Dónde cae un valor a lo ancho del gráfico, de 0 a W. */
  const x = (v: number) => (span === 0 ? W / 2 : ((v - summary.min) / span) * W);

  return (
    <div className="floating w-[16rem] rounded-lg px-3 py-2.5">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="eyebrow">{layer.label}</p>
        <span className="tabular text-[10px] text-muted">
          {formatInteger(summary.n)} celdas
        </span>
      </div>

      {/* Reparto. Barras neutras: el color del mapa ya codifica el valor, y
          repetirlo aquí solo añadiría una segunda escala que leer. */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[44px] w-full"
        role="img"
        aria-label={`Reparto de ${layer.label.toLowerCase()} en ${summary.n} celdas, de ${layer.format(summary.min)} a ${layer.format(summary.max)}.`}
      >
        {bins.map((bin, i) => {
          const bw = bins.length === 1 ? W : W / bins.length;
          const bh = (bin.count / maxCount) * (H - 2);
          const contiene =
            posicion !== null &&
            posicion.value >= bin.from &&
            (i === bins.length - 1 ? posicion.value <= bin.to : posicion.value < bin.to);
          return (
            <rect
              key={i}
              x={i * bw + 0.5}
              y={H - bh}
              width={Math.max(0.5, bw - 1)}
              height={bh}
              fill={contiene ? "var(--color-ink)" : "var(--color-line-strong)"}
            />
          );
        })}

        {posicion && (
          // La plomada ancla la celda al eje. Sin ella, la barra resaltada dice
          // "por aquí" pero no exactamente dónde.
          <line
            x1={x(posicion.value)}
            y1={0}
            x2={x(posicion.value)}
            y2={H}
            stroke="var(--color-ink)"
            strokeWidth="1"
            strokeDasharray="2 2"
          />
        )}
      </svg>

      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="tabular text-[10px] text-muted">{layer.format(summary.min)}</span>
        <span className="eyebrow">mediana {layer.format(summary.median)}</span>
        <span className="tabular text-[10px] text-muted">{layer.format(summary.max)}</span>
      </div>

      {posicion && selected && (
        <p className="mt-2 border-t border-line pt-2 text-[11px] leading-relaxed text-ink-soft">
          <span className="tabular text-ink">{selected.cell_code}</span>{" "}
          <span className="tabular">{layer.format(posicion.value)}</span> · percentil{" "}
          <span className="tabular text-ink">{posicion.percentil}</span> · puesto{" "}
          <span className="tabular">
            {posicion.puesto} de {summary.n}
          </span>
        </p>
      )}

      {overlap && (
        <div className="mt-2 border-t border-line pt-2">
          <p className="eyebrow mb-1 flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: RISK_COLORS[REFERENCE_LEVEL].fill }}
            />
            Coincidencia con riesgo alto
          </p>
          <p className="text-[11px] leading-relaxed text-muted">
            Mediana{" "}
            <span className="tabular text-ink-soft">{layer.format(overlap.medianInside)}</span>{" "}
            dentro de la zona ·{" "}
            <span className="tabular text-ink-soft">{layer.format(overlap.medianOutside)}</span>{" "}
            fuera.
            {layer.extremeTail !== null && (
              <>
                {" "}
                <span className="tabular text-ink-soft">
                  {overlap.both} de {overlap.region}
                </span>{" "}
                {/* "más bajo" / "más alto" y no "menos rinde": la frase la
                    comparten seis capas, y con Suelo activa decir que una celda
                    "rinde" poco hablaría de otra métrica. */}
                caen en el quintil más{" "}
                {layer.extremeTail === "low" ? "bajo" : "alto"} de{" "}
                {layer.label.toLowerCase()}.
              </>
            )}
          </p>

          {/* LA ADVERTENCIA NO ES PRUDENCIA GENERICA, ES UN HECHO DEL MOTOR.
              El riesgo se calcula a partir de la sanidad, el suelo y la
              pendiente; el rendimiento y la pérdida salen de esos mismos tres
              campos. Así que este bloque compara, casi siempre, una entrada del
              modelo contra su propio resultado. La cifra sigue sirviendo para
              saber DONDE y CUANTO; lo que no puede es leerse como evidencia de
              una relación descubierta en el campo, y ese salto lo da cualquiera
              en dos segundos si nadie lo dice.

              Va aquí y en ningún otro sitio: es el único lugar de CERES donde
              se ponen dos variables una al lado de la otra. */}
          {layer.caution && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-faint">{layer.caution}</p>
          )}
        </div>
      )}
    </div>
  );
}
