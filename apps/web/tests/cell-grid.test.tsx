/**
 * Malla 20×20: render, hover y selección.
 *
 * También fija el contrato que tendrá que cumplir el `TerrainCanvas` de React
 * Three Fiber en la fase 7: recibir celdas y emitir `cell_id` en hover y click.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CellGrid } from "@/components/terrain/CellGrid";
import { RISK_COLORS } from "@/lib/presentation/risk";
import { buildOverview } from "./fixtures";

function renderGrid(overrides: Partial<Parameters<typeof CellGrid>[0]> = {}) {
  const overview = buildOverview();
  const onSelect = vi.fn();
  const onHover = vi.fn();

  render(
    <CellGrid
      cells={overview.cells}
      gridWidth={overview.grid_width}
      gridHeight={overview.grid_height}
      viewMode="risk"
      selectedCellId={null}
      hoveredCellId={null}
      onSelect={onSelect}
      onHover={onHover}
      {...overrides}
    />,
  );

  return { overview, onSelect, onHover };
}

describe("CellGrid", () => {
  it("pinta las 400 celdas", () => {
    renderGrid();

    expect(screen.getAllByRole("gridcell")).toHaveLength(400);
  });

  it("coloca el norte arriba y el oeste a la izquierda", () => {
    // La API devuelve las celdas de sur a norte, pero en pantalla el norte va
    // arriba: la primera celda pintada debe ser la esquina noroeste.
    renderGrid();

    const cells = screen.getAllByRole("gridcell");
    expect(cells[0]).toHaveAttribute("aria-colindex", "1");
    expect(cells[0]!.getAttribute("aria-label")).toContain("(0, 19)");
    expect(cells.at(-1)!.getAttribute("aria-label")).toContain("(19, 0)");
  });

  it("colorea cada celda según su nivel de riesgo", () => {
    const { overview } = renderGrid();
    const high = overview.cells.find((c) => c.risk_level === "high")!;
    const low = overview.cells.find((c) => c.risk_level === "low")!;

    expect(screen.getByTestId(`cell-${high.cell_code}`)).toHaveAttribute("data-risk", "high");
    expect(screen.getByTestId(`cell-${low.cell_code}`)).toHaveAttribute("data-risk", "low");
  });

  it("muestra los tres niveles cuando el dataset los tiene", () => {
    renderGrid();

    const levels = new Set(
      screen.getAllByRole("gridcell").map((cell) => cell.getAttribute("data-risk")),
    );
    expect(levels).toEqual(new Set(["low", "medium", "high"]));
  });

  it("avisa del cell_id al hacer hover", async () => {
    const user = userEvent.setup();
    const { overview, onHover } = renderGrid();
    const target = overview.cells[42]!;

    await user.hover(screen.getByTestId(`cell-${target.cell_code}`));

    expect(onHover).toHaveBeenCalledWith(target.cell_id);
  });

  it("avisa del cell_id al hacer click", async () => {
    const user = userEvent.setup();
    const { overview, onSelect } = renderGrid();
    const target = overview.cells[100]!;

    await user.click(screen.getByTestId(`cell-${target.cell_code}`));

    expect(onSelect).toHaveBeenCalledWith(target.cell_id);
  });

  it("marca visualmente la celda seleccionada", () => {
    const overview = buildOverview();
    const target = overview.cells[7]!;
    renderGrid({ selectedCellId: target.cell_id });

    const cell = screen.getByTestId(`cell-${target.cell_code}`);
    expect(cell).toHaveAttribute("data-selected", "true");
    // `aria-selected` y no `aria-pressed`: en un grid la celda es una casilla
    // seleccionable, no un conmutador.
    expect(cell).toHaveAttribute("aria-selected", "true");
  });

  it("cada celda es un botón, para poder recorrer la malla con teclado", () => {
    renderGrid();

    for (const cell of screen.getAllByRole("gridcell").slice(0, 5)) {
      expect(cell.tagName).toBe("BUTTON");
    }
  });

  it("estructura ARIA grid > row > gridcell", () => {
    // Un grid sin filas es ARIA inválido: los lectores de pantalla no pueden
    // anunciar la posición de una celda si no existe la fila que la contiene.
    renderGrid();

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(20);
    for (const row of rows) {
      expect(within(row).getAllByRole("gridcell")).toHaveLength(20);
    }
  });

  it("solo una celda está en el orden de tabulación (roving tabindex)", () => {
    // 400 paradas de tabulación harían la malla intransitable con teclado.
    renderGrid();

    const cells = screen.getAllByRole("gridcell");
    const tabbable = cells.filter((cell) => cell.getAttribute("tabindex") === "0");

    expect(tabbable).toHaveLength(1);
    expect(cells.filter((c) => c.getAttribute("tabindex") === "-1")).toHaveLength(399);
  });

  it("las flechas mueven el foco por la malla", async () => {
    const user = userEvent.setup();
    renderGrid();

    // Se entra por la esquina noroeste: (0, 19).
    const entry = screen.getAllByRole("gridcell").find((c) => c.getAttribute("tabindex") === "0")!;
    expect(entry.getAttribute("aria-label")).toContain("(0, 19)");

    entry.focus();
    await user.keyboard("{ArrowRight}");
    const afterRight = screen
      .getAllByRole("gridcell")
      .find((c) => c.getAttribute("tabindex") === "0")!;
    expect(afterRight.getAttribute("aria-label")).toContain("(1, 19)");

    // El norte está arriba, así que bajar reduce y.
    await user.keyboard("{ArrowDown}");
    const afterDown = screen
      .getAllByRole("gridcell")
      .find((c) => c.getAttribute("tabindex") === "0")!;
    expect(afterDown.getAttribute("aria-label")).toContain("(1, 18)");
  });

  it("el foco no se sale de la malla en los bordes", async () => {
    const user = userEvent.setup();
    renderGrid();

    const entry = screen.getAllByRole("gridcell").find((c) => c.getAttribute("tabindex") === "0")!;
    entry.focus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}{ArrowUp}{ArrowUp}");

    const stillThere = screen
      .getAllByRole("gridcell")
      .find((c) => c.getAttribute("tabindex") === "0")!;
    expect(stillThere.getAttribute("aria-label")).toContain("(0, 19)");
  });

  it("el riesgo no se comunica solo con el color", async () => {
    // Verde, ámbar y rojo son justo los tonos que confunde un daltonismo
    // rojo-verde: el nivel necesita una señal que no sea cromática.
    const { overview } = renderGrid();
    const high = overview.cells.find((c) => c.risk_level === "high")!;
    const medium = overview.cells.find((c) => c.risk_level === "medium")!;
    const low = overview.cells.find((c) => c.risk_level === "low")!;

    const patternOf = (code: string) =>
      screen.getByTestId(`cell-${code}`).style.backgroundImage;

    expect(patternOf(high.cell_code)).toContain("repeating-linear-gradient");
    expect(patternOf(medium.cell_code)).toContain("repeating-linear-gradient");
    expect(patternOf(high.cell_code)).not.toBe(patternOf(medium.cell_code));
    expect(patternOf(low.cell_code)).toBe("");

    // Y el nivel viaja además en el texto que lee un lector de pantalla.
    expect(screen.getByTestId(`cell-${high.cell_code}`).getAttribute("aria-label")).toContain(
      "riesgo alto",
    );
  });

  it("el tooltip de una celda trae sus métricas, no solo su nombre", () => {
    const { overview } = renderGrid();
    const target = overview.cells.find((c) => c.risk_level === "high")!;

    const label = screen.getByTestId(`cell-${target.cell_code}`).getAttribute("aria-label")!;
    expect(label).toContain(target.cell_code);
    expect(label).toContain("kg");
    expect(label).toContain("riesgo alto");
  });

  it("cambiar de modo de vista repinta la malla sin cambiar las celdas", () => {
    const overview = buildOverview();
    const props = {
      cells: overview.cells,
      gridWidth: 20,
      gridHeight: 20,
      selectedCellId: null,
      hoveredCellId: null,
      onSelect: vi.fn(),
      onHover: vi.fn(),
    };
    const { rerender } = render(<CellGrid {...props} viewMode="risk" />);

    // En modo riesgo solo hay tres colores: son los tres niveles del dominio.
    const riskColors = new Set(
      screen.getAllByRole("gridcell").map((cell) => cell.style.backgroundColor),
    );
    expect(riskColors).toEqual(
      new Set(["rgb(34, 197, 94)", "rgb(234, 179, 8)", "rgb(239, 68, 68)"]),
    );
    expect(RISK_COLORS.high.fill).toBe("#ef4444");

    rerender(<CellGrid {...props} viewMode="loss" />);

    // Las celdas siguen siendo las mismas; lo que cambia es como se pintan.
    expect(screen.getAllByRole("gridcell")).toHaveLength(400);
    const lossColors = new Set(
      screen.getAllByRole("gridcell").map((cell) => cell.style.backgroundColor),
    );
    expect(lossColors).not.toEqual(riskColors);
  });
});
