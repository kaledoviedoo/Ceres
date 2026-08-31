"use client";

/** Selector de qué métrica colorea el terreno. */

import { VIEW_MODES, type ViewMode } from "@/lib/presentation/risk";

interface ViewModeSwitchProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export function ViewModeSwitch({ value, onChange }: ViewModeSwitchProps) {
  return (
    <div
      role="group"
      aria-label="Métrica que colorea el terreno"
      className="floating flex rounded-full p-0.5"
    >
      {VIEW_MODES.map((mode) => {
        const active = mode.id === value;
        return (
          <button
            key={mode.id}
            type="button"
            title={mode.description}
            aria-pressed={active}
            onClick={() => onChange(mode.id)}
            className={`rounded-full px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors ${
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
