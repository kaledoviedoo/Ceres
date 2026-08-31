import { RISK_COLORS } from "@/lib/presentation/risk";
import type { RiskLevel } from "@/lib/types/api";

/** Etiqueta de nivel de riesgo, con el mismo color que usa la malla. */
export function RiskBadge({ level }: { level: RiskLevel }) {
  const { fill, text, label } = RISK_COLORS[level];
  return (
    <span
      className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide"
      style={{ backgroundColor: fill, color: text }}
    >
      {label}
    </span>
  );
}

/** Etiqueta neutra, para versiones de modelo y similares. */
export function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="tabular inline-flex items-center rounded border border-soil-600 px-2 py-0.5 text-xs text-bone-400">
      {children}
    </span>
  );
}
