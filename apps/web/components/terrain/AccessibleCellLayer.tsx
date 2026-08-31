"use client";

/**
 * La malla, para quien no usa el ratón.
 *
 * Un canvas de WebGL es un mapa de píxeles: no tiene estructura que un lector
 * de pantalla pueda recorrer y no recibe foco por celda. Dar el terreno 3D por
 * accesible porque "se ve bien" sería perder de golpe todo lo que la fase 6
 * construyó.
 *
 * Esta capa reproduce la malla como DOM real —`grid` → `row` → `gridcell`, con
 * roving tabindex y flechas, el mismo patrón ya probado en `CellGrid`— encima
 * del canvas y sin pintar nada. Enfocar una celda aquí la selecciona en la
 * escena 3D.
 *
 * `pointer-events: none` es imprescindible: sin eso, cuatrocientos botones
 * invisibles se tragarían los arrastres destinados a la cámara. El teclado
 * llega igual, porque el foco no depende del puntero.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatKg, formatPercent, formatScore } from "@/lib/presentation/format";
import { RISK_COLORS } from "@/lib/presentation/risk";
import type { TerrainCell } from "@/lib/terrain/types";

interface AccessibleCellLayerProps {
  cells: TerrainCell[];
  gridWidth: number;
  gridHeight: number;
  selectedCellId: string | null;
  onSelect: (cellId: string) => void;
  /** Se llama al mover el foco, para resaltar la celda en la escena. */
  onFocusCell: (cell: TerrainCell | null) => void;
}

export function AccessibleCellLayer({
  cells,
  gridWidth,
  gridHeight,
  selectedCellId,
  onSelect,
  onFocusCell,
}: AccessibleCellLayerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState({ x: 0, y: gridHeight - 1 });
  const shouldRestoreFocus = useRef(false);

  // Se recorta al renderizar, no con un efecto: un `setState` dentro de un
  // efecto encadena un render de más para llegar al mismo sitio.
  const focusX = Math.min(focus.x, gridWidth - 1);
  const focusY = Math.min(focus.y, gridHeight - 1);

  const rows = useMemo(() => {
    const byRow = new Map<number, TerrainCell[]>();
    for (const cell of cells) {
      const row = byRow.get(cell.y) ?? [];
      row.push(cell);
      byRow.set(cell.y, row);
    }
    // Norte arriba, igual que en la escena y en el mapa.
    return Array.from({ length: gridHeight }, (_, index) => {
      const y = gridHeight - 1 - index;
      return (byRow.get(y) ?? []).sort((a, b) => a.x - b.x);
    });
  }, [cells, gridHeight]);

  useEffect(() => {
    if (!shouldRestoreFocus.current) return;
    shouldRestoreFocus.current = false;
    rootRef.current
      ?.querySelector<HTMLButtonElement>(`[data-x="${focusX}"][data-y="${focusY}"]`)
      ?.focus();
  }, [focusX, focusY]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const moves: Record<string, [number, number]> = {
        // El norte está arriba, así que ArrowUp aumenta y.
        ArrowUp: [0, 1],
        ArrowDown: [0, -1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
      };

      const move = moves[event.key];
      if (move) {
        event.preventDefault();
        shouldRestoreFocus.current = true;
        setFocus((current) => ({
          x: Math.min(gridWidth - 1, Math.max(0, current.x + move[0])),
          y: Math.min(gridHeight - 1, Math.max(0, current.y + move[1])),
        }));
        return;
      }

      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        shouldRestoreFocus.current = true;
        setFocus((current) => ({
          x: event.key === "Home" ? 0 : gridWidth - 1,
          y: event.ctrlKey ? (event.key === "Home" ? gridHeight - 1 : 0) : current.y,
        }));
      }
    },
    [gridWidth, gridHeight],
  );

  return (
    <div
      ref={rootRef}
      role="grid"
      aria-label={`Celdas del lote, ${gridWidth} por ${gridHeight}. Usa las flechas para recorrerlas y Intro para inspeccionar una.`}
      aria-rowcount={gridHeight}
      aria-colcount={gridWidth}
      onKeyDown={handleKeyDown}
      // Invisible y sin capturar el puntero: la cámara necesita los arrastres.
      className="pointer-events-none absolute inset-0 z-10"
    >
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} role="row" aria-rowindex={rowIndex + 1} className="sr-only">
          {row.map((cell) => {
            const description = [
              cell.cell_code,
              `columna ${cell.x + 1}, fila ${cell.y + 1}`,
              formatKg(cell.projected_yield_kg),
              `pérdida ${formatPercent(cell.estimated_loss_percentage)}`,
              `riesgo ${RISK_COLORS[cell.risk_level].label.toLowerCase()}, ${formatScore(cell.risk_score)}`,
            ].join(", ");

            return (
              <button
                key={cell.cell_id}
                type="button"
                role="gridcell"
                aria-colindex={cell.x + 1}
                aria-selected={cell.cell_id === selectedCellId}
                aria-label={description}
                tabIndex={cell.x === focusX && cell.y === focusY ? 0 : -1}
                data-x={cell.x}
                data-y={cell.y}
                data-testid={`a11y-cell-${cell.cell_code}`}
                // El foco llega por teclado, así que hay que devolverle el
                // puntero a este botón concreto para que sea activable.
                className="pointer-events-auto"
                onFocus={() => onFocusCell(cell)}
                onBlur={() => onFocusCell(null)}
                onClick={() => onSelect(cell.cell_id)}
              >
                {cell.cell_code}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
