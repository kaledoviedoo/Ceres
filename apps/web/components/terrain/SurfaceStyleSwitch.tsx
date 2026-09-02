"use client";

/**
 * Conmutador entre las dos lecturas del mismo terreno.
 *
 * No son dos estilos decorativos: son dos preguntas distintas sobre la misma
 * parcela, y por eso va arriba y con las etiquetas escritas, no escondido en un
 * icono.
 *
 *   Campo    cómo es este terreno. Césped y surcos, sin dato encima.
 *   Análisis qué dice el motor. Mapa de calor sobre el relieve.
 *
 * El cambio es instantáneo: las dos vistas comparten geometría y solo cambia el
 * material.
 */

import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { SurfaceStyle } from "@/stores/useCeresStore";

const STYLES = [
  { id: "lindo" as const, label: "Campo", hint: "Cómo se ve el terreno: césped y surcos, sin datos encima" },
  { id: "pro" as const, label: "Análisis", hint: "Qué dice el motor: mapa de calor sobre el relieve" },
];

interface SurfaceStyleSwitchProps {
  value: SurfaceStyle;
  onChange: (style: SurfaceStyle) => void;
}

export function SurfaceStyleSwitch({ value, onChange }: SurfaceStyleSwitchProps) {
  return (
    <SegmentedControl
      options={STYLES}
      value={value}
      onChange={onChange}
      label="Lectura del terreno"
      size="md"
    />
  );
}
