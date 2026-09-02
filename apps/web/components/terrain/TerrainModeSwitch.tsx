"use client";

/**
 * Conmutador entre el relieve 3D y la malla plana.
 *
 * Deliberadamente DISTINTO del selector de métrica, y colocado lejos de él.
 *
 * Hasta la fase 7 los dos eran la misma píldora con las mismas proporciones y
 * estaban pegados en el centro inferior, así que dos decisiones de naturaleza
 * distinta tenían la misma forma. Son cosas diferentes:
 *
 *   métrica  QUE miras   → riesgo, rendimiento o pérdida sobre el mismo terreno
 *   terreno  COMO miras  → relieve o planta
 *
 * Este vive abajo a la derecha, bajo la rosa de los vientos y el zoom, porque
 * pertenece al mismo grupo que ellos: los controles de punto de vista.
 */

import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { TerrainMode } from "@/stores/useCeresStore";

interface TerrainModeSwitchProps {
  value: TerrainMode;
  onChange: (mode: TerrainMode) => void;
}

/** Bloque en perspectiva: relieve. */
function IconRelief() {
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true" className="h-3.5 w-3.5">
      <path
        d="M7 1.5 12.5 4.5 7 7.5 1.5 4.5 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path
        d="M1.5 4.5v4.2L7 11.7l5.5-3V4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path d="M7 7.5v4.2" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

/** Cuadrícula de frente: planta. */
function IconPlan() {
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true" className="h-3.5 w-3.5">
      <rect
        x="1.7"
        y="1.7"
        width="10.6"
        height="10.6"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <path d="M5.23 1.7v10.6M8.77 1.7v10.6M1.7 5.23h10.6M1.7 8.77h10.6" stroke="currentColor" strokeWidth="0.8" />
    </svg>
  );
}

const MODES = [
  { id: "3d" as const, label: "Relieve", hint: "Terreno en tres dimensiones", icon: <IconRelief /> },
  { id: "2d" as const, label: "Planta", hint: "Malla plana, sin perspectiva", icon: <IconPlan /> },
];

export function TerrainModeSwitch({ value, onChange }: TerrainModeSwitchProps) {
  return (
    <SegmentedControl
      options={MODES}
      value={value}
      onChange={onChange}
      label="Representación del terreno"
    />
  );
}
