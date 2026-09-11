"use client";

/**
 * Primitivas de lectura para el inspector.
 *
 * El problema que resuelven: una cifra sola no dice si es buena. "Suelo 18,1 %"
 * obliga a saberse el lote de memoria. Estas piezas ponen cada número EN SU
 * CONTEXTO —dónde cae dentro del reparto de la parcela— usando únicamente
 * valores que el motor ya calculó. Ordenar no es modelar: no hay ningún umbral
 * nuevo escondido aquí.
 *
 * Están inspiradas en el vocabulario de Bklit —línea limpia con área, barras de
 * progreso, badges— pero escritas a mano y sobre los tokens de CERES: importar
 * una librería de gráficos entera para cuatro formas simples traería su sistema
 * de color y su tipografía, que es justo lo que hace que un producto parezca
 * ensamblado con piezas de otros.
 */

import type { ReactNode } from "react";

import { percentileLabel } from "@/lib/terrain/statistics";

// --- Barra con posición en el reparto ---------------------------------------

interface MetricBarProps {
  label: string;
  /** Valor ya formateado. Se muestra tal cual. */
  value: string;
  /** Posición dentro del rango del lote, de 0 a 1. */
  fill: number;
  /** Percentil dentro del lote, de 0 a 1. `undefined` lo oculta. */
  percentile?: number;
  /** Color de la barra. Por defecto, tinta: la métrica no es semántica. */
  tone?: string;
}

export function MetricBar({ label, value, fill, percentile, tone }: MetricBarProps) {
  const pct = Math.round(Math.min(1, Math.max(0, fill)) * 100);

  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-muted">{label}</span>
        <span className="tabular text-sm text-ink">{value}</span>
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        <div
          className="h-1 flex-1 overflow-hidden rounded-full bg-line-soft"
          role="img"
          aria-label={`${label}: ${value}${
            percentile === undefined
              ? ""
              : `, percentil ${percentileLabel(percentile)} del lote`
          }`}
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${pct}%`, backgroundColor: tone ?? "var(--color-ink-soft)" }}
          />
        </div>
        {percentile !== undefined && (
          <span className="tabular w-9 shrink-0 text-right text-[10px] text-muted">
            p{percentileLabel(percentile)}
          </span>
        )}
      </div>
    </div>
  );
}

// --- Medidor de score --------------------------------------------------------

/**
 * Arco para un valor de 0 a 1.
 *
 * Un arco y no una barra porque el risk score es la conclusión del motor, no una
 * más de las condiciones: merece una forma distinta a las barras de arriba para
 * que el ojo no lo lea como una fila más de la misma lista.
 */
export function ScoreDial({ value, tone }: { value: number; tone: string }) {
  const v = Math.min(1, Math.max(0, value));
  const R = 26;
  const CIRC = Math.PI * R; // media circunferencia

  return (
    <svg viewBox="0 0 64 38" className="h-10 w-16" role="img" aria-label={`Score ${v.toFixed(4)}`}>
      <path
        d={`M 6 32 A ${R} ${R} 0 0 1 58 32`}
        fill="none"
        stroke="var(--color-line)"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d={`M 6 32 A ${R} ${R} 0 0 1 58 32`}
        fill="none"
        stroke={tone}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${v * CIRC} ${CIRC}`}
      />
    </svg>
  );
}

// --- Gráfico de línea --------------------------------------------------------

export interface SeriesPoint {
  label: string;
  value: number;
}

interface LineChartProps {
  points: SeriesPoint[];
  /** Formatea el valor para el eje y la etiqueta accesible. */
  format: (value: number) => string;
  /** Índice a destacar. Sirve para marcar "esta celda" dentro de una serie. */
  highlight?: number;
  caption?: ReactNode;
  /** Qué decir cuando no hay serie. Nunca se inventan puntos para rellenar. */
  emptyTitle: string;
  emptyHint: string;
  ariaLabel: string;
}

const W = 264;
const H = 68;
const PAD = 5;

/**
 * Línea con área, en el lenguaje de Bklit.
 *
 * SI NO HAY DATOS, NO HAY GRAFICO. Con menos de dos puntos no se dibuja una
 * línea plana ni se rellenan huecos: se dice que no hay registros. Un gráfico
 * inventado sobre un dato que no existe es peor que no tener gráfico, porque se
 * lee como información.
 */
export function LineChart({
  points,
  format,
  highlight,
  caption,
  emptyTitle,
  emptyHint,
  ariaLabel,
}: LineChartProps) {
  if (points.length < 2) {
    return (
      <div className="rounded-lg border border-dashed border-line px-3 py-5 text-center">
        <p className="text-xs text-ink-soft">{emptyTitle}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">{emptyHint}</p>
      </div>
    );
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const px = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const py = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${px(i)} ${py(p.value)}`).join(" ");
  const area = `${line} L ${px(points.length - 1)} ${H} L ${px(0)} ${H} Z`;
  const active = highlight !== undefined && highlight >= 0 ? points[highlight] : undefined;

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[68px] w-full" role="img" aria-label={ariaLabel}>
        <defs>
          <linearGradient id="ceres-line-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-ink)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--color-ink)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d={area} fill="url(#ceres-line-fill)" />
        <path
          d={line}
          fill="none"
          stroke="var(--color-ink)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {active && highlight !== undefined && (
          <g>
            {/* La plomada ancla el punto al eje: sin ella el círculo flota y no
                se sabe a qué posición corresponde. */}
            <line
              x1={px(highlight)}
              y1={py(active.value)}
              x2={px(highlight)}
              y2={H}
              stroke="var(--color-muted)"
              strokeWidth="1"
              strokeDasharray="2 2"
            />
            <circle
              cx={px(highlight)}
              cy={py(active.value)}
              r="3.5"
              fill="var(--color-canvas)"
              stroke="var(--color-ink)"
              strokeWidth="1.5"
            />
          </g>
        )}
      </svg>

      <figcaption className="mt-1.5 flex items-baseline justify-between gap-3">
        <span className="eyebrow truncate">{caption}</span>
        <span className="tabular shrink-0 text-[10px] text-muted">
          {format(min)} – {format(max)}
        </span>
      </figcaption>
    </figure>
  );
}

// --- Dato con etiqueta -------------------------------------------------------

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      <p className="tabular mt-1 truncate text-sm text-ink">{value}</p>
      {hint && <p className="mt-0.5 truncate text-[10px] text-muted">{hint}</p>}
    </div>
  );
}
