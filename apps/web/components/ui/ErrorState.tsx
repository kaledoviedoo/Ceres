/**
 * Error visible y accionable.
 *
 * Muestra el mensaje real de la API en vez de un "algo salió mal": si FastAPI
 * no está levantado, el usuario tiene que poder deducirlo desde la pantalla.
 */

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="rounded-md border border-risk-high/40 bg-risk-high/10 px-4 py-3"
    >
      <p className="text-sm text-ink">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded border border-line px-3 py-1 text-xs text-ink transition-colors hover:bg-line-soft"
        >
          Reintentar
        </button>
      )}
    </div>
  );
}
