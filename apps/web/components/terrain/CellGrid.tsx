"use client";

/**
 * Malla 20×20 del lote. Cada cuadro es ~1 m².
 *
 * VISTA ALTERNA. El terreno 3D es la representación principal; esta malla plana
 * se conserva para tres cosas que el canvas no cubre: reserva cuando WebGL no
 * está disponible o el equipo va justo, lectura rápida sin perspectiva, y una
 * ruta de teclado que no depende de una capa superpuesta.
 *
 * Su contrato con el resto de la aplicación es deliberadamente estrecho:
 * recibe celdas ya calculadas y avisa del click. No pide datos, no calcula
 * nada y no sabe qué es una predicción. `TerrainCanvas` implementa esa misma
 * interfaz, y por eso el panel lateral, el store y el cliente de API no se
 * enteran de cuál de las dos está montada.
 *
 * La correspondencia `GridCell ↔ cuadro` se mantiene por `cell_id`, no por
 * posición: en 3D el raycasting devolverá ese mismo identificador.
 *
 * Accesibilidad: la malla sigue el patrón `grid` de ARIA — `grid > row >
 * gridcell` — con roving tabindex. Solo una celda está en el orden de Tab; las
 * flechas mueven el foco dentro de la malla. Con 400 celdas la alternativa
 * (400 paradas de tabulación) hace la pantalla inutilizable con teclado.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CellSquare } from "@/components/terrain/CellSquare";
import { cellColor, metricRange, type ViewMode } from "@/lib/presentation/risk";
import { zoneBorders } from "@/lib/terrain/analysis";
import type { CellOverview } from "@/lib/types/api";

export interface CellGridProps {
  cells: CellOverview[];
  gridWidth: number;
  gridHeight: number;
  viewMode: ViewMode;
  selectedCellId: string | null;
  onSelect: (cellId: string) => void;
}

/** Posición dentro de la malla en coordenadas de dominio (x este, y norte). */
interface Focus {
  x: number;
  y: number;
}

export function CellGrid({
  cells,
  gridWidth,
  gridHeight,
  viewMode,
  selectedCellId,
  onSelect,
}: CellGridProps) {
  // El hover es efímero y solo le importa a esta vista: estado local, no store.
  const [hoveredCellId, setHoveredCellId] = useState<string | null>(null);
  const range = useMemo(() => metricRange(cells, viewMode), [cells, viewMode]);

  // Misma frontera que dibuja el relieve. El objeto por celda se reparte por
  // referencia estable: el `memo` de CellSquare depende de que no cambie.
  const borders = useMemo(() => zoneBorders(cells), [cells]);

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

  // --- Roving tabindex --------------------------------------------------------
  // Solo la celda enfocada tiene tabIndex 0; el resto, -1. Entrar en la malla
  // cuesta un Tab y moverse dentro son las flechas, como en una hoja de cálculo.
  const [focus, setFocus] = useState<Focus>({ x: 0, y: gridHeight - 1 });
  const gridRef = useRef<HTMLDivElement>(null);
  // Solo se mueve el foco del navegador cuando el usuario navega con teclado.
  // Sin esta guarda, cualquier repintado robaría el foco de donde estuviera.
  const shouldRestoreFocus = useRef(false);

  // Si la malla encoge, el foco puede quedar fuera de rango. Se recorta al
  // renderizar en vez de sincronizarlo con un efecto: un `setState` dentro de
  // un efecto provoca un render en cascada para llegar al mismo sitio.
  const focusX = Math.min(focus.x, gridWidth - 1);
  const focusY = Math.min(focus.y, gridHeight - 1);

  useEffect(() => {
    if (!shouldRestoreFocus.current) return;
    shouldRestoreFocus.current = false;
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-x="${focusX}"][data-y="${focusY}"]`)
      ?.focus();
  }, [focusX, focusY]);

  const moveFocus = useCallback(
    (dx: number, dy: number) => {
      shouldRestoreFocus.current = true;
      setFocus((current) => ({
        x: Math.min(gridWidth - 1, Math.max(0, current.x + dx)),
        y: Math.min(gridHeight - 1, Math.max(0, current.y + dy)),
      }));
    },
    [gridWidth, gridHeight],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // Enter y Espacio los gestiona el propio botón: no se interceptan.
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
        moveFocus(move[0], move[1]);
        return;
      }

      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        shouldRestoreFocus.current = true;
        // Con Ctrl, a la esquina de la malla; sin él, al extremo de la fila.
        setFocus((current) => ({
          x: event.key === "Home" ? 0 : gridWidth - 1,
          y: event.ctrlKey ? (event.key === "Home" ? gridHeight - 1 : 0) : current.y,
        }));
      }
    },
    [gridWidth, gridHeight, moveFocus],
  );

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex w-full max-w-[680px] items-center justify-between text-[10px] uppercase tracking-widest text-muted">
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
        ref={gridRef}
        role="grid"
        aria-label={`Malla del lote, ${gridWidth} por ${gridHeight} celdas de 1 m². Usa las flechas para recorrerla.`}
        aria-rowcount={gridHeight}
        aria-colcount={gridWidth}
        className="w-full max-w-[680px] rounded border border-line bg-line-soft p-px"
        onKeyDown={handleKeyDown}
        onMouseLeave={() => setHoveredCellId(null)}
      >
        {rows.map((row, rowIndex) => (
          <div
            key={rowIndex}
            role="row"
            aria-rowindex={rowIndex + 1}
            className="grid gap-px"
            style={{ gridTemplateColumns: `repeat(${gridWidth}, minmax(0, 1fr))` }}
          >
            {row.map((cell) => (
              <CellSquare
                key={cell.cell_id}
                cell={cell}
                color={cellColor(cell, viewMode, range)}
                viewMode={viewMode}
                isSelected={cell.cell_id === selectedCellId}
                isHovered={cell.cell_id === hoveredCellId}
                isFocusTarget={cell.x === focusX && cell.y === focusY}
                zone={borders.get(`${cell.x},${cell.y}`)}
                onSelect={onSelect}
                onHover={setHoveredCellId}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="text-[10px] uppercase tracking-widest text-muted">Sur ↓</div>
    </div>
  );
}
