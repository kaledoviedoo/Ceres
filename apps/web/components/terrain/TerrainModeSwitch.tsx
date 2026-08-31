"use client";

/** Conmutador entre el relieve 3D y la malla plana. */

import type { TerrainMode } from "@/stores/useCeresStore";

const MODES: { id: TerrainMode; label: string; hint: string }[] = [
  { id: "3d", label: "3D", hint: "Relieve del terreno" },
  { id: "2d", label: "2D", hint: "Malla plana, sin perspectiva" },
];

interface TerrainModeSwitchProps {
  value: TerrainMode;
  onChange: (mode: TerrainMode) => void;
}

export function TerrainModeSwitch({ value, onChange }: TerrainModeSwitchProps) {
  return (
    <div role="group" aria-label="Representación del terreno" className="floating flex rounded-full p-0.5">
      {MODES.map((mode) => {
        const active = mode.id === value;
        return (
          <button
            key={mode.id}
            type="button"
            title={mode.hint}
            aria-pressed={active}
            onClick={() => onChange(mode.id)}
            className={`rounded-full px-3 py-1 font-mono text-[11px] tracking-wider transition-colors ${
              active
                ? "bg-bone-100 text-soil-900"
                : "text-bone-400 hover:bg-soil-700 hover:text-bone-100"
            }`}
          >
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}
