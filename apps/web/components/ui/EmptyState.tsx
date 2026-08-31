/** Hueco explicado: dice qué falta y qué hacer, no solo que no hay nada. */

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-4 py-10 text-center">
      <p className="text-sm text-ceres-muted">{title}</p>
      {hint && <p className="text-xs text-ceres-dim">{hint}</p>}
    </div>
  );
}
