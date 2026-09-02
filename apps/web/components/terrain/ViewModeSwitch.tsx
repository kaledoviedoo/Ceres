"use client";

/** Selector de qué métrica colorea el terreno. */

import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { VIEW_MODES, type ViewMode } from "@/lib/presentation/risk";

interface ViewModeSwitchProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export function ViewModeSwitch({ value, onChange }: ViewModeSwitchProps) {
  return (
    <SegmentedControl
      options={VIEW_MODES.map((mode) => ({
        id: mode.id,
        label: mode.label,
        hint: mode.description,
      }))}
      value={value}
      onChange={onChange}
      label="Métrica que colorea el terreno"
    />
  );
}
