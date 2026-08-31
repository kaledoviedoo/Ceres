"use client";

/**
 * Malla 20×20 del lote. Cada cuadro es ~1 m².
 *
 * ESTE COMPONENTE ES EL QUE SE SUSTITUYE EN LA FASE 7.
 *
 * Su contrato con el resto de la aplicación es deliberadamente estrecho:
 * recibe celdas ya calculadas y avisa de hover y click. No pide datos, no
 * calcula nada y no sabe qué es una predicción. Un `TerrainCanvas` de React
 * Three Fiber podrá ocupar su lugar implementando exactamente esta interfaz,
 * sin que el panel lateral, el store ni el cliente de API se enteren.
 *
 * La correspondencia `GridCell ↔ cuadro` se mantiene por `cell_id`, no por
 * posición: en 3D el raycasting devolverá ese mismo identificador.
 */

import { useMemo } from "react";

import { CellSquare } from "@/components/terrain/CellSquare";
import { cellColor, metricRange, type ViewMode } from "@/lib/presentation/risk";
import type { CellOverview } from "@/lib/types/api";

export interface CellGridProps {
  cells: CellOverview[];
  gridWidth: number;
  gridHeight: number;
  viewMode: ViewMode;
  selectedCellId: string | null;
  hoveredCellId: string | null;
  onSelect: (cellId: string) => void;
  onHover: (cellId: string | null) => void;
}

export function CellGrid({
  cells,
  gridWidth,
  gridHeight,
  viewMode,
  selectedCellId,
  hoveredCellId,
  onSelect,
  onHover,
}: CellGridProps) {
  const range = useMemo(() => metricRange(cells, viewMode), [cells, viewMode]);

  // La API devuelve las celdas ordenadas de sur a norte (y creciente), pero en
  // pantalla el norte va arriba. Se invierten las filas al pintar en vez de
  // reordenar el array: así el índice sigue coincidiendo con (x, y).
  const rows = useMemo(() => {
    const byRow = new Map<number, CellOverview[]>();
    for (const cell of cells) {
      const row = byRow.get(cell.y) ?? [];
      row.push(cell);
      byRow.set(cell.y, row);
    }
    return Array.from({ length: gridHeight }, (_, index) => {
      const y = gridHeight - 1 - index;
      return (byRow.get(y) ?? []).sort((a, b) => a.x - b.x);
    });
  }, [cells, gridHeight]);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex w-full max-w-[680px] items-center justify-between text-[10px] uppercase tracking-widest text-ceres-dim">
        <span>Oeste</span>
        <span>Norte ↑</span>
        <span>Este</span>
      </div>

      {/*
        `grid` y no `inline-grid`: un inline-grid se encoge a su contenido, y las
        celdas usan `w-full`, asi que el ancho quedaria indefinido y la malla
        colapsaria a nada. Con un ancho explicito y columnas `1fr`, el
        `aspect-square` de cada celda ya tiene de que agarrarse.

        El maximo evita que en una pantalla ancha cada celda se vuelva enorme:
        la malla es un mapa, no un mosaico decorativo.
      */}
      <div
        role="grid"
        aria-label={`Malla del lote, ${gridWidth} por ${gridHeight} celdas de 1 m²`}
        aria-rowcount={gridHeight}
        aria-colcount={gridWidth}
        className="grid w-full max-w-[680px] gap-px rounded border border-ceres-border-strong bg-ceres-border p-px"
        style={{ gridTemplateColumns: `repeat(${gridWidth}, minmax(0, 1fr))` }}
        onMouseLeave={() => onHover(null)}
      >
        {rows.map((row, rowIndex) =>
          row.map((cell) => (
            <CellSquare
              key={cell.cell_id}
              cell={cell}
              color={cellColor(cell, viewMode, range)}
              isSelected={cell.cell_id === selectedCellId}
              isHovered={cell.cell_id === hoveredCellId}
              rowIndex={rowIndex}
              onSelect={onSelect}
              onHover={onHover}
            />
          )),
        )}
      </div>

      <div className="text-[10px] uppercase tracking-widest text-ceres-dim">Sur ↓</div>
    </div>
  );
}
