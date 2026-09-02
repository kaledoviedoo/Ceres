"use client";

/**
 * Las tres franjas del pie: el estado del lote de un vistazo.
 *
 * Responden a las tres preguntas que se hacen ANTES de abrir ninguna celda:
 * cuánta superficie está en problemas, cuánto se espera cosechar, y si lo que
 * estoy viendo es de fiar.
 *
 * SIMETRIA, Y NO ES COSMETICA. Las tres son una rejilla de columnas iguales con
 * los elementos estirados, no un `flex` con `flex-1`: en flex, el ancho mínimo
 * del contenido hace que la tarjeta con el texto más largo salga más ancha, y
 * tres tarjetas de anchos distintos se leen como tres cosas de importancia
 * distinta. Aquí las tres pesan lo mismo porque las tres valen lo mismo.
 *
 * La altura la iguala `items-stretch` más una estructura idéntica en las tres:
 * fila de título arriba, contenido abajo, alineado al mismo pie.
 *
 * TODO SALE DEL MOTOR. Los recuentos los da `riskDistribution` sobre las celdas
 * del overview; el mínimo, el máximo y el total son aritmética sobre esos mismos
 * valores ya calculados. Sumar veinte kilogramos que ya vinieron calculados no
 * es modelar.
 */

import { formatInteger, formatKg } from "@/lib/presentation/format";
import { RISK_COLORS, RISK_PATTERNS, riskDistribution } from "@/lib/presentation/risk";
import type { CellOverview, HealthStatus, RiskLevel } from "@/lib/types/api";

const LEVELS: RiskLevel[] = ["low", "medium", "high"];

const DEFAULT_DISCLAIMER =
  "DEMO / SYNTHETIC DATA. Modelo experimental y demostrativo sobre datos sintéticos.";

interface BottomStripsProps {
  cells: CellOverview[];
  health: HealthStatus | null;
  healthError: string | null;
}

export function BottomStrips({ cells, health, healthError }: BottomStripsProps) {
  if (cells.length === 0) return null;

  const counts = riskDistribution(cells);
  const total = cells.length;
  const yields = cells.map((cell) => cell.projected_yield_kg);
  const min = Math.min(...yields);
  const max = Math.max(...yields);
  const suma = yields.reduce((acc, value) => acc + value, 0);

  const online = Boolean(health) && !healthError;
  const disclaimer = health?.disclaimer ?? DEFAULT_DISCLAIMER;

  return (
    <div className="pointer-events-none absolute inset-x-6 bottom-6 z-20 hidden grid-cols-3 items-stretch gap-3 lg:grid">
      <Strip title="Reparto del riesgo" note={`${formatInteger(total)} celdas`}>
        {/* La barra dice cuánta superficie ocupa cada nivel. "34 de 400" obliga
            a dividir de cabeza; una franja estrecha se lee de un vistazo. */}
        <div
          aria-hidden="true"
          className="flex h-1.5 w-full overflow-hidden rounded-full bg-line-soft"
        >
          {LEVELS.map((level) =>
            counts[level] > 0 ? (
              <span
                key={level}
                className="h-full"
                style={{
                  width: `${(counts[level] / total) * 100}%`,
                  backgroundColor: RISK_COLORS[level].fill,
                  backgroundImage: RISK_PATTERNS[level],
                }}
              />
            ) : null,
          )}
        </div>

        <dl className="mt-3 flex gap-6">
          {LEVELS.map((level) => (
            <div key={level} className="min-w-0">
              <dt className="eyebrow flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{
                    backgroundColor: RISK_COLORS[level].fill,
                    backgroundImage: RISK_PATTERNS[level],
                  }}
                />
                {RISK_COLORS[level].label}
              </dt>
              <dd className="tabular mt-1 text-sm text-ink">{formatInteger(counts[level])}</dd>
            </div>
          ))}
        </dl>
      </Strip>

      <Strip title="Rendimiento proyectado" note="Sin guardar">
        <dl className="flex gap-6">
          <Figure label="Mínimo" value={formatKg(min)} />
          <Figure label="Máximo" value={formatKg(max)} />
          <Figure label="Total del lote" value={formatKg(suma)} />
        </dl>
      </Strip>

      <Strip title="Modelo" note={health?.model_version ?? "—"}>
        <dl className="flex gap-6">
          <div className="min-w-0">
            <dt className="eyebrow flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{
                  backgroundColor: online ? RISK_COLORS.low.fill : RISK_COLORS.high.fill,
                }}
              />
              Backend
            </dt>
            <dd className="mt-1 truncate text-sm text-ink">
              {online ? `Base de datos ${health?.database}` : "Sin conexión"}
            </dd>
          </div>

          <div className="min-w-0">
            <dt className="eyebrow">Procedencia</dt>
            {/* Es información sobre la fiabilidad de todo lo demás, así que va
                aquí y siempre visible. La frase entera, detrás. */}
            <dd className="mt-1 truncate text-sm text-ink" title={disclaimer}>
              Datos sintéticos
              <span className="sr-only"> — {disclaimer}</span>
            </dd>
          </div>
        </dl>
      </Strip>
    </div>
  );
}

/**
 * Una franja.
 *
 * `flex-col` con el contenido empujado al pie iguala la línea de base de las
 * tres aunque una tenga una barra extra: sin eso, la primera cifra de cada
 * tarjeta cae a una altura distinta y el pie se ve descuadrado.
 */
function Strip({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel pointer-events-auto flex min-w-0 flex-col rounded-xl px-4 py-3">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="group-title truncate">{title}</h2>
        {note && <span className="eyebrow shrink-0">{note}</span>}
      </div>
      <div className="mt-auto">{children}</div>
    </section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="tabular mt-1 truncate text-sm text-ink">{value}</dd>
    </div>
  );
}
