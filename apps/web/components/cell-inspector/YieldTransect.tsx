"use client";

/**
 * Perfil de rendimiento a lo largo de la hilera.
 *
 * POR QUE ESTE GRAFICO Y NO OTRO
 * Una cifra sola no dice si es buena. "0,29 kg" solo significa algo comparado
 * con algo, y la comparación que le importa a quien va a caminar el campo es la
 * espacial: cómo cambia el rendimiento a lo largo de la línea en la que está esa
 * celda. Un bache en la curva es una zona a la que ir; una curva plana es un
 * lote uniforme.
 *
 * Es UN gráfico, no un panel de seis. Cada uno más tendría que ganarse el sitio
 * respondiendo una pregunta que este no responde, y un inspector saturado de
 * gráficas es exactamente lo que impide leer la que importa.
 *
 * Los veinte valores salen del overview del lote —ya calculados por el motor—.
 * Aquí solo se escalan a píxeles: no hay ninguna agregación ni ningún promedio
 * inventado.
 */

import { useMemo } from "react";

import { formatKg } from "@/lib/presentation/format";
import type { CellOverview } from "@/lib/types/api";

const WIDTH = 260;
const HEIGHT = 64;
const PAD = 4;

interface YieldTransectProps {
  cells: CellOverview[];
  /** Celda seleccionada: fija la hilera y el punto marcado. */
  x: number;
  y: number;
}

export function YieldTransect({ cells, x, y }: YieldTransectProps) {
  const row = useMemo(
    () => cells.filter((cell) => cell.y === y).sort((a, b) => a.x - b.x),
    [cells, y],
  );

  if (row.length < 2) return null;

  const values = row.map((cell) => cell.projected_yield_kg);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const px = (index: number) => PAD + (index / (row.length - 1)) * (WIDTH - PAD * 2);
  const py = (value: number) => HEIGHT - PAD - ((value - min) / span) * (HEIGHT - PAD * 2);

  const line = row.map((cell, i) => `${i === 0 ? "M" : "L"} ${px(i)} ${py(cell.projected_yield_kg)}`);
  const area = `${line.join(" ")} L ${px(row.length - 1)} ${HEIGHT} L ${px(0)} ${HEIGHT} Z`;

  const activeIndex = row.findIndex((cell) => cell.x === x);
  const active = activeIndex >= 0 ? row[activeIndex] : null;

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-16 w-full"
        role="img"
        aria-label={`Rendimiento a lo largo de la fila ${y + 1}: de ${formatKg(min)} a ${formatKg(max)}${
          active ? `. Esta celda, ${formatKg(active.projected_yield_kg)}` : ""
        }.`}
      >
        <defs>
          <linearGradient id="transect-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-ink)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--color-ink)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d={area} fill="url(#transect-fill)" />
        <path
          d={line.join(" ")}
          fill="none"
          stroke="var(--color-ink)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {active && (
          <g>
            {/* La plomada ancla el punto al eje: sin ella, el círculo flota y no
                se sabe a qué posición de la hilera corresponde. */}
            <line
              x1={px(activeIndex)}
              y1={py(active.projected_yield_kg)}
              x2={px(activeIndex)}
              y2={HEIGHT}
              stroke="var(--color-muted)"
              strokeWidth="1"
              strokeDasharray="2 2"
            />
            <circle
              cx={px(activeIndex)}
              cy={py(active.projected_yield_kg)}
              r="3.5"
              fill="var(--color-canvas)"
              stroke="var(--color-ink)"
              strokeWidth="1.5"
            />
          </g>
        )}
      </svg>

      <figcaption className="mt-1.5 flex items-baseline justify-between">
        <span className="eyebrow">Fila {y + 1} · oeste → este</span>
        <span className="tabular text-[10px] text-muted">
          {formatKg(min)} – {formatKg(max)}
        </span>
      </figcaption>
    </figure>
  );
}
