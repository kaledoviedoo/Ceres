"use client";

/**
 * Un cuadro de la malla: ~1 m² de terreno.
 *
 * Es un `<button>` de verdad y no un `<div>` con onClick, para que la malla se
 * pueda recorrer con el teclado. Solo la celda enfocada está en el orden de
 * tabulación (roving tabindex, gestionado por `CellGrid`); las demás llevan
 * `tabIndex={-1}` y se alcanzan con las flechas. Con 400 celdas, dejarlas todas
 * tabulables convertiría la pantalla en una trampa para quien no usa ratón.
 */

import { memo } from "react";

import { formatKg, formatPercent, formatScore } from "@/lib/presentation/format";
import { RISK_COLORS, RISK_PATTERNS, type ViewMode } from "@/lib/presentation/risk";
import type { ZoneBorders } from "@/lib/terrain/analysis";
import type { CellOverview } from "@/lib/types/api";

/** Grosor del contorno de zona, en píxeles. */
const ZONE_WIDTH = 2;

interface CellSquareProps {
  cell: CellOverview;
  color: string;
  viewMode: ViewMode;
  isSelected: boolean;
  isHovered: boolean;
  isFocusTarget: boolean;
  /** Lados de esta celda que son frontera de la zona en riesgo alto. */
  zone?: ZoneBorders;
  onSelect: (cellId: string) => void;
  onHover: (cellId: string | null) => void;
}

function CellSquareComponent({
  cell,
  color,
  viewMode,
  isSelected,
  isHovered,
  isFocusTarget,
  zone,
  onSelect,
  onHover,
}: CellSquareProps) {
  // El tooltip nativo evita montar 400 popovers en el DOM. En 3D lo sustituye
  // un panel flotante, pero el dato que muestra es el mismo.
  const description = [
    cell.cell_code,
    `(${cell.x}, ${cell.y})`,
    `${formatKg(cell.projected_yield_kg)}`,
    `pérdida ${formatPercent(cell.estimated_loss_percentage)}`,
    `riesgo ${RISK_COLORS[cell.risk_level].label.toLowerCase()} (${formatScore(cell.risk_score)})`,
  ].join(" · ");

  // Señal no cromática del riesgo: una trama sobre el color. Verde, ámbar y
  // rojo son justo los ejes que pierde un daltonismo rojo-verde, así que el
  // nivel no puede comunicarse solo con el tono. Solo en modo riesgo: en los
  // modos continuos el valor es una rampa y la trama sería ruido.
  const pattern = viewMode === "risk" ? RISK_PATTERNS[cell.risk_level] : undefined;

  // Contorno de zona, con la misma frontera y el mismo color que en relieve.
  // Hueso y no rojo: sobre celdas rojas, un borde rojo no separa nada.
  const shadows: string[] = [];
  if (zone) {
    const edge = "#edeae3";
    if (zone.north) shadows.push(`inset 0 ${ZONE_WIDTH}px 0 ${edge}`);
    if (zone.south) shadows.push(`inset 0 -${ZONE_WIDTH}px 0 ${edge}`);
    if (zone.west) shadows.push(`inset ${ZONE_WIDTH}px 0 0 ${edge}`);
    if (zone.east) shadows.push(`inset -${ZONE_WIDTH}px 0 0 ${edge}`);
  }
  // El anillo de selección va por box-shadow para no alterar el tamaño del
  // cuadro y no descuadrar la malla. Anillo oscuro con halo claro: sobre una
  // celda saturada, un anillo claro a secas se pierde.
  if (isSelected) shadows.push("0 0 0 2px #edeae3", "0 0 0 4px #0b0d0c");
  else if (isHovered) shadows.push("0 0 0 1px #edeae3");

  return (
    <button
      type="button"
      role="gridcell"
      // `aria-selected` y no `aria-pressed`: en un grid, la celda no es un
      // conmutador, es una casilla que puede estar seleccionada.
      aria-selected={isSelected}
      aria-colindex={cell.x + 1}
      aria-label={description}
      title={description}
      tabIndex={isFocusTarget ? 0 : -1}
      data-testid={`cell-${cell.cell_code}`}
      data-risk={cell.risk_level}
      data-zone={zone ? "high-border" : undefined}
      data-x={cell.x}
      data-y={cell.y}
      data-selected={isSelected || undefined}
      onClick={() => onSelect(cell.cell_id)}
      onMouseEnter={() => onHover(cell.cell_id)}
      onFocus={() => onHover(cell.cell_id)}
      className="relative aspect-square w-full cursor-pointer transition-[transform,filter] duration-75 hover:z-10 hover:scale-125 hover:brightness-125"
      style={{
        backgroundColor: color,
        backgroundImage: pattern,
        boxShadow: shadows.length > 0 ? shadows.join(", ") : undefined,
        zIndex: isSelected ? 20 : undefined,
      }}
    />
  );
}

// 400 celdas: sin memo, mover el ratón repintaría toda la malla en cada píxel.
export const CellSquare = memo(CellSquareComponent);
