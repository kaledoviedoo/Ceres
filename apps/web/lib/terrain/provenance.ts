/**
 * DE LA PROCEDENCIA QUE SIRVE LA API A LA QUE MUESTRA LA INTERFAZ.
 *
 * Una función y nada más, pero es la que cierra una deuda que arrastraba varias
 * fases: el frontend AFIRMABA que la elevación era sintética. Acertaba, y aun
 * así estaba mal —nadie se lo había dicho—. Ahora lo dice
 * `GET /plots/{id}/cells` en su bloque `provenance`, y este módulo se limita a
 * traducirlo.
 *
 * LA REGLA DE LA AUSENCIA. Si el bloque no llega —backend antiguo, respuesta
 * recortada— no se rellena con nada plausible: se devuelve `unknown`. El cliente
 * no valida en runtime (hace `as T`), así que la ausencia es un caso real y la
 * única respuesta honesta a "no me lo han dicho" es "no lo sé".
 */

import {
  PROVENANCE_LABEL,
  isMeasured,
  unknownProvenance,
  type ElevationProvenance,
} from "@/lib/terrain/elevation";
import type { CellProvenance, ProvenanceKind } from "@/lib/types/api";

/** El vocabulario cerrado, para poder rechazar lo que no esté en él. */
const CONOCIDOS: readonly ProvenanceKind[] = [
  "measured",
  "derived",
  "estimated",
  "synthetic",
  "unknown",
];

/**
 * Una palabra que la API no debería mandar se trata como `unknown`.
 *
 * No es paranoia: sin validación en runtime, un backend más nuevo con un valor
 * de más entraría aquí como string cualquiera y `PROVENANCE_LABEL[kind]` daría
 * `undefined` en pantalla. Degradar a "no declarado" es lo que un valor
 * desconocido significa de verdad.
 */
function normalizar(kind: string | undefined): ProvenanceKind {
  return CONOCIDOS.includes(kind as ProvenanceKind) ? (kind as ProvenanceKind) : "unknown";
}

/**
 * La procedencia de la elevación tal como la declara la API.
 *
 * @param declarada  el bloque de `GET /plots/{id}/cells`, o `undefined`.
 * @param sampleSpacingM  separación entre muestras, para el caso sin declarar.
 */
export function elevationProvenanceFrom(
  declarada: CellProvenance | undefined,
  sampleSpacingM: number,
): ElevationProvenance {
  if (!declarada?.elevation) return unknownProvenance(sampleSpacingM);

  const kind = normalizar(declarada.elevation.kind);
  return {
    kind,
    label: `Elevación ${PROVENANCE_LABEL[kind]}`,
    // La nominal la declara la API, y el contrato del servidor comprueba que
    // coincida con `cell_size_m`. Si faltara, el espaciado real es la única
    // afirmación que se sostiene sola.
    nominalResolutionM: declarada.elevation.nominal_resolution_m || sampleSpacingM,
    // `null` viaja tal cual: es "nadie la ha medido", no cero.
    effectiveResolutionM: declarada.elevation.effective_resolution_m,
    measured: isMeasured(kind),
  };
}
