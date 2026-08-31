/**
 * Formato de números para la interfaz.
 *
 * Solo presentación: ni redondea para calcular ni deriva nada. El backend ya
 * manda los valores con la precisión que quiere que se guarde; aquí solo se
 * decide cuántos decimales caben en un panel sin que se lea como ruido.
 */

const LOCALE = "es-CO";

function fixed(value: number, decimals: number): string {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export const formatKg = (value: number): string => `${fixed(value, 2)} kg`;

export const formatTons = (value: number): string => `${fixed(value, 4)} t`;

export const formatPercent = (value: number): string => `${fixed(value, 2)} %`;

export const formatDegrees = (value: number): string => `${fixed(value, 2)}°`;

export const formatMeters = (value: number): string => `${fixed(value, 2)} m`;

export const formatDensity = (value: number): string => `${fixed(value, 2)} pl/m²`;

/** Índices 0..1 se muestran como porcentaje: 0.722 -> "72.2 %". */
export const formatIndex = (value: number): string => `${fixed(value * 100, 1)} %`;

/** El risk_score se muestra crudo: es una escala del dominio, no un porcentaje. */
export const formatScore = (value: number): string => fixed(value, 4);

export const formatInteger = (value: number): string =>
  new Intl.NumberFormat(LOCALE).format(value);

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/**
 * Cambio relativo respecto a 1.0, con signo.
 *
 * Es como se leen los factores explicativos: `soil_factor: 1.061` -> "+6.1 %".
 */
export function formatFactorDelta(factor: number): string {
  const delta = (factor - 1) * 100;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${fixed(delta, 1)} %`;
}
