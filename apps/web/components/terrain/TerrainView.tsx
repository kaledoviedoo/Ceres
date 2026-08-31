"use client";

/**
 * Contenedor de la representación del terreno.
 *
 * Existe para aislar el hover. `hoveredCellId` cambia con cada celda que el
 * cursor toca; si lo leyera la página, cada movimiento del ratón repintaría
 * también el selector, el panel del lote y el Cell Inspector. Suscribiéndose
 * aquí, el repintado se queda dentro de este subárbol.
 *
 * En 2D el coste era despreciable (0,01 ms por hover gracias al memo de
 * `CellSquare`). Importa de cara a React Three Fiber: allí un re-render del
 * árbol en cada movimiento compite con el bucle de render de la escena.
 *
 * ESTE ES EL PUNTO DE SUSTITUCIÓN DE LA FASE 7. Cambiar `CellGrid` por un
 * `TerrainCanvas` es cambiar una línea de este archivo: el contenedor seguirá
 * traduciendo store <-> props, y `page.tsx` no se entera.
 */

import { CellGrid } from "@/components/terrain/CellGrid";
import type { CellOverview } from "@/lib/types/api";
import { useCeresStore } from "@/stores/useCeresStore";

interface TerrainViewProps {
  cells: CellOverview[];
  gridWidth: number;
  gridHeight: number;
}

export function TerrainView({ cells, gridWidth, gridHeight }: TerrainViewProps) {
  // Selectores individuales: este componente solo se repinta cuando cambia una
  // de estas cuatro cosas, no cuando cambia cualquier parte del store.
  const viewMode = useCeresStore((state) => state.viewMode);
  const selectedCellId = useCeresStore((state) => state.selectedCellId);
  const hoveredCellId = useCeresStore((state) => state.hoveredCellId);
  const selectCell = useCeresStore((state) => state.selectCell);
  const hoverCell = useCeresStore((state) => state.hoverCell);

  return (
    <CellGrid
      cells={cells}
      gridWidth={gridWidth}
      gridHeight={gridHeight}
      viewMode={viewMode}
      selectedCellId={selectedCellId}
      hoveredCellId={hoveredCellId}
      onSelect={selectCell}
      onHover={hoverCell}
    />
  );
}
