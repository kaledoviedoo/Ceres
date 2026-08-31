"use client";

/** Selector de qué métrica colorea la malla. */

import { VIEW_MODES, type ViewMode } from "@/lib/presentation/risk";

interface ViewModeSwitchProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export function ViewModeSwitch({ value, onChange }: ViewModeSwitchProps) {
  return (
    <div
      role="group"
      aria-label="Modo de visualización"
      className="inline-flex rounded border border-ceres-border-strong p-0.5"
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
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              active
                ? "bg-ceres-accent text-ceres-bg"
                : "text-ceres-muted hover:bg-ceres-elevated hover:text-ceres-text"
            }`}
          >
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}
