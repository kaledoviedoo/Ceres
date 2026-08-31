"use client";

/**
 * Contenedor de la representación del terreno.
 *
 * ES EL PUNTO DE SUSTITUCIÓN. Decide qué vista se monta —relieve 3D o malla
 * plana— y traduce store ↔ props. Cambiar de una a otra es cambiar una rama de
 * este archivo: `page.tsx`, el Cell Inspector, el cliente de API y el motor no
 * se enteran, porque ambas vistas cumplen el mismo contrato estrecho.
 *
 * También aísla el repintado. Se suscribe a la selección y al modo con
 * selectores individuales, así que cambiar de celda no toca el selector de
 * lote ni el panel del lado.
 *
 * El hover no aparece por ninguna parte: cada vista lo resuelve por dentro.
 */

import { CellGrid } from "@/components/terrain/CellGrid";
import { TerrainCanvas } from "@/components/terrain/TerrainCanvas";
import type { TerrainCell } from "@/lib/terrain/types";
import { useCeresStore } from "@/stores/useCeresStore";

interface TerrainViewProps {
  cells: TerrainCell[];
  gridWidth: number;
  gridHeight: number;
}

export function TerrainView({ cells, gridWidth, gridHeight }: TerrainViewProps) {
  const viewMode = useCeresStore((state) => state.viewMode);
  const terrainMode = useCeresStore((state) => state.terrainMode);
  const selectedCellId = useCeresStore((state) => state.selectedCellId);
  const selectCell = useCeresStore((state) => state.selectCell);

  if (terrainMode === "2d") {
    return (
      <div className="flex h-full w-full items-center justify-center overflow-auto p-8">
        {/* Ancho explícito: dentro de un flex centrado, el `w-full` de la malla
            no tendría de qué agarrarse y se colapsaría a su contenido. */}
        <div className="w-full max-w-[680px] shrink-0">
        <CellGrid
          cells={cells}
          gridWidth={gridWidth}
          gridHeight={gridHeight}
          viewMode={viewMode}
          selectedCellId={selectedCellId}
          onSelect={selectCell}
        />
        </div>
      </div>
    );
  }

  return (
    <TerrainCanvas
      cells={cells}
      gridWidth={gridWidth}
      gridHeight={gridHeight}
      viewMode={viewMode}
      selectedCellId={selectedCellId}
      onSelect={selectCell}
    />
  );
}
