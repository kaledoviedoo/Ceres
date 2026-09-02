/** Indicador de carga. `label` se anuncia a lectores de pantalla. */

export function Spinner({ label = "Cargando" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted" role="status">
      <span
        aria-hidden="true"
        className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-ink"
      />
      <span>{label}…</span>
    </div>
  );
}
