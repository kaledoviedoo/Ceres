/** Superficie base del dashboard: un bloque con título y borde fino. */

interface PanelProps {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Panel({ title, subtitle, actions, children, className = "" }: PanelProps) {
  return (
    <section
      className={`rounded-lg border border-soil-600 bg-soil-800 ${className}`}
    >
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-soil-600 px-4 py-3">
          <div>
            {title && (
              <h2 className="text-sm font-semibold tracking-wide text-bone-100 uppercase">
                {title}
              </h2>
            )}
            {subtitle && <p className="mt-0.5 text-xs text-bone-400">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}
