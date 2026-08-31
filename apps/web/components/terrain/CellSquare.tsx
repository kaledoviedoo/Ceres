"use client";

/**
 * Un cuadro de la malla: ~1 m² de terreno.
 *
 * Es un `<button>` de verdad y no un `<div>` con onClick, para que la malla se
 * pueda recorrer con el teclado. Con 400 celdas eso importa: un agrónomo que
 * revisa un lote entero no debería estar obligado a usar el ratón.
 */

import { memo } from "react";

import { formatKg, formatPercent, formatScore } from "@/lib/presentation/format";
import { RISK_COLORS } from "@/lib/presentation/risk";
import type { CellOverview } from "@/lib/types/api";

interface CellSquareProps {
  cell: CellOverview;
  color: string;
  isSelected: boolean;
  isHovered: boolean;
  rowIndex: number;
  onSelect: (cellId: string) => void;
  onHover: (cellId: string | null) => void;
}

function CellSquareComponent({
  cell,
  color,
  isSelected,
  isHovered,
  rowIndex,
  onSelect,
  onHover,
}: CellSquareProps) {
  // El tooltip nativo evita montar 400 popovers en el DOM. En 3D lo sustituirá
  // un panel flotante, pero el dato que muestra será el mismo.
  const tooltip = [
    cell.cell_code,
    `(${cell.x}, ${cell.y})`,
    `${formatKg(cell.projected_yield_kg)}`,
    `pérdida ${formatPercent(cell.estimated_loss_percentage)}`,
    `riesgo ${RISK_COLORS[cell.risk_level].label.toLowerCase()} (${formatScore(cell.risk_score)})`,
  ].join(" · ");

  return (
    <button
      type="button"
      role="gridcell"
      aria-rowindex={rowIndex + 1}
      aria-colindex={cell.x + 1}
      aria-label={tooltip}
      aria-pressed={isSelected}
      title={tooltip}
      data-testid={`cell-${cell.cell_code}`}
      data-risk={cell.risk_level}
      data-selected={isSelected || undefined}
      onClick={() => onSelect(cell.cell_id)}
      onMouseEnter={() => onHover(cell.cell_id)}
      onFocus={() => onHover(cell.cell_id)}
      className="relative aspect-square w-full cursor-pointer transition-[transform,filter] duration-75 hover:z-10 hover:scale-125 hover:brightness-125"
      style={{
        backgroundColor: color,
        // El anillo de selección va por box-shadow para no alterar el tamaño
        // del cuadro y no descuadrar la malla.
        boxShadow: isSelected
          ? "0 0 0 2px #e6f0ea, 0 0 0 4px #0a0f0d"
          : isHovered
            ? "0 0 0 1px #e6f0ea"
            : undefined,
        zIndex: isSelected ? 20 : undefined,
      }}
    />
  );
}

// 400 celdas: sin memo, mover el ratón repintaría toda la malla en cada píxel.
export const CellSquare = memo(CellSquareComponent);
