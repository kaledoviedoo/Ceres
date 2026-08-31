/** Una fila etiqueta / valor del panel. */

interface MetricRowProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
}

export function MetricRow({ label, value, hint }: MetricRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-soil-700/70 py-1.5 last:border-b-0">
      <span className="text-xs text-bone-400">
        {label}
        {hint && <span className="ml-1 text-bone-600">({hint})</span>}
      </span>
      <span className="tabular text-sm text-bone-100">{value}</span>
    </div>
  );
}

export function MetricGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="eyebrow mb-1.5">
        {title}
      </h3>
      {children}
    </div>
  );
}
