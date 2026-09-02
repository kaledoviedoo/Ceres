/**
 * Filas y grupos del panel de métricas.
 *
 * El grupo lleva cabecera en sans y no en versalitas de instrumento. Es el nivel
 * 2 de la escala: separa bloques de sentido dentro del panel —lo medido, lo
 * estimado, lo guardado— y tiene que verse por encima de las etiquetas de cada
 * fila. Cuando todas las cabeceras eran `.eyebrow`, el panel se leía como una
 * lista de veinte filas iguales sin nada que guiara el ojo.
 */

interface MetricRowProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
}

export function MetricRow({ label, value, hint }: MetricRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line-soft/70 py-[7px] last:border-b-0">
      <span className="text-xs text-muted">
        {label}
        {hint && <span className="ml-1 text-muted">({hint})</span>}
      </span>
      <span className="tabular text-sm text-ink">{value}</span>
    </div>
  );
}

export function MetricGroup({
  title,
  note,
  children,
}: {
  title: string;
  /** Matiz corto: de dónde sale el dato o qué le falta. */
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-line pb-1.5">
        <h3 className="group-title">{title}</h3>
        {note && <span className="eyebrow shrink-0">{note}</span>}
      </div>
      {children}
    </section>
  );
}
