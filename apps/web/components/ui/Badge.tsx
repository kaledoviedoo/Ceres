import { RISK_COLORS } from "@/lib/presentation/risk";
import type { RiskLevel } from "@/lib/types/api";

/**
 * Etiqueta de nivel de riesgo, con el mismo color que usa la malla.
 *
 * Lleva prefijo solo para lectores de pantalla. Visualmente el contexto lo da
 * la posición —junto al código de la celda—, pero leída en voz alta la palabra
 * "Bajo" a secas no dice bajo QUE. El prefijo cuesta cero píxeles.
 */
export function RiskBadge({ level }: { level: RiskLevel }) {
  const { fill, text, label } = RISK_COLORS[level];
  return (
    <span
      className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide"
      style={{ backgroundColor: fill, color: text }}
    >
      <span className="sr-only">Nivel de riesgo: </span>
      {label}
    </span>
  );
}

/** Etiqueta neutra, para versiones de modelo y similares. */
export function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="tabular inline-flex items-center rounded border border-line px-2 py-0.5 text-xs text-muted">
      {children}
    </span>
  );
}
