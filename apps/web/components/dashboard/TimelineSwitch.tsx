"use client";

/**
 * EL EJE TEMPORAL, hecho visible.
 *
 * El backend tenía eje temporal desde hacía dos fases —`state_at`, `as_of` en
 * las predicciones, `overview(as_of=…)`— y la interfaz no lo dejaba explorar:
 * fijaba la fecha al `expected_harvest_at` del ciclo y el usuario veía un solo
 * instante, siempre el mismo.
 *
 * NO INTERPOLA NADA. Cada pastilla manda su `as_of` al backend y el mapa se
 * repinta con lo que devuelve `overview`. Entre un momento y otro no hay
 * transición calculada aquí: hay dos respuestas distintas del motor.
 *
 * LAS FECHAS NO SE INVENTAN NI SE DEDUCEN
 * Vienen de `GET /plots/{id}/timeline`, que las lee de `predictions.as_of`.
 * Deducirlas del ciclo daría fechas equivocadas: en el lote de papa, `t0` es
 * siembra + 30 días (14 de abril, no 15 de marzo) y `t2` es cosecha − 7 (13 de
 * agosto, no 20). Este componente no construye ninguna fecha.
 *
 * LAS ETIQUETAS SON LA FECHA, y no `T0`/`T1`.
 *
 * Numerar por posición parecía lo natural y decía algo falso. El escenario
 * llama a sus dos instantes `t0` y `t2` —hubo un `t1` intermedio que se retiró
 * porque en dos lotes derivaba el mismo estado—, así que un control que
 * rotulara la segunda pastilla como «T1» contradiría al manifiesto. Y la
 * interfaz no puede saber esos nombres: le llegan fechas, no etiquetas.
 *
 * Tampoco dicen «Siembra» ni «Cosecha»: ninguno de los dos instantes lo es. En
 * el lote de papa, el primero cae 30 días DESPUÉS de sembrar y el último 7
 * ANTES de cosechar.
 *
 * La fecha no necesita traducción y no puede contradecir a nadie. El subtítulo
 * dice a qué altura del ciclo cae, calculado con `planted_at`.
 */

import { SegmentedControl, type Segment } from "@/components/ui/SegmentedControl";
import type { TimelineMoment } from "@/lib/types/api";

interface TimelineSwitchProps {
  moments: TimelineMoment[];
  /** El `as_of` activo, tal cual viaja a la API. */
  value: string | null;
  /** Del ciclo. Solo para decir a qué altura cae cada momento. */
  plantedAt: string | null;
  onChange: (asOf: string) => void;
}

/** `2026-04-14T12:00:00Z` → `14 abr`. */
function etiquetaCorta(asOf: string): string {
  const fecha = new Date(asOf);
  if (Number.isNaN(fecha.getTime())) return asOf;
  return fecha.toLocaleDateString("es-CO", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Días transcurridos desde la siembra, o `null` si el ciclo no la declara.
 *
 * Es una resta de dos fechas que ya vienen de la API, no una fórmula agrícola.
 */
function diasDesdeSiembra(asOf: string, plantedAt: string | null): number | null {
  if (!plantedAt) return null;
  const momento = new Date(asOf).getTime();
  const siembra = new Date(`${plantedAt}T12:00:00Z`).getTime();
  if (Number.isNaN(momento) || Number.isNaN(siembra)) return null;
  return Math.round((momento - siembra) / 86_400_000);
}

export function TimelineSwitch({
  moments,
  value,
  plantedAt,
  onChange,
}: TimelineSwitchProps) {
  // Sin al menos dos momentos no hay eje que recorrer, y eso es una respuesta de
  // la API, no un fallo: significa que ese lote no tiene predicciones fechadas
  // con las que comparar. Es el caso de la finca demo.
  if (moments.length < 2) return null;

  const options: Segment<string>[] = moments.map((moment) => {
    const dias = diasDesdeSiembra(moment.as_of, plantedAt);
    const cuenta = moment.prediction_count.toLocaleString("es-CO");
    return {
      id: moment.as_of,
      label: etiquetaCorta(moment.as_of),
      hint:
        dias === null
          ? `${cuenta} predicciones guardadas`
          : `Día ${dias} del ciclo · ${cuenta} predicciones guardadas`,
    };
  });

  const activo = value ?? moments[0]!.as_of;
  const dias = diasDesdeSiembra(activo, plantedAt);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <SegmentedControl
        options={options}
        value={activo}
        onChange={onChange}
        label="Momento del ciclo"
        size="md"
      />
      {/* A qué altura del ciclo cae, fuera del botón: dentro haría que las
          pastillas midieran distinto y el indicador cambiaría de ancho al
          moverse por una razón que no es la elección. */}
      {dias !== null && (
        <p className="tabular text-[10px] leading-none text-muted">
          día {dias} del ciclo
        </p>
      )}
    </div>
  );
}
