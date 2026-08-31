/** Una fila etiqueta / valor del panel. */

interface MetricRowProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
}

export function MetricRow({ label, value, hint }: MetricRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ceres-border/60 py-1.5 last:border-b-0">
      <span className="text-xs text-ceres-muted">
        {label}
        {hint && <span className="ml-1 text-ceres-dim">({hint})</span>}
      </span>
      <span className="tabular text-sm text-ceres-text">{value}</span>
    </div>
  );
}

export function MetricGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-ceres-dim">
        {title}
      </h3>
      {children}
    </div>
  );
}
