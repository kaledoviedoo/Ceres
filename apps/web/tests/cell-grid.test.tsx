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
import { zoneBorders } from "@/lib/terrain/analysis";
import { getAvailableLayer } from "@/lib/terrain/layers";
import { buildOverview, buildTerrainCells } from "./fixtures";

function renderGrid(overrides: Partial<Parameters<typeof CellGrid>[0]> = {}) {
  const overview = buildOverview();
  const onSelect = vi.fn();

  render(
    <CellGrid
      cells={buildTerrainCells()}
      gridWidth={overview.grid_width}
      gridHeight={overview.grid_height}
      layer={getAvailableLayer("risk")}
      selectedCellId={null}
      onSelect={onSelect}
      {...overrides}
    />,
  );

  return { overview, onSelect };
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

  it("resalta la celda bajo el cursor sin salir del componente", async () => {
    // El hover es estado local: en 3D pasa decenas de veces por segundo y no
    // le interesa a nadie fuera de la vista.
    const user = userEvent.setup();
    const { overview } = renderGrid();
    const target = overview.cells[42]!;
    const cell = screen.getByTestId(`cell-${target.cell_code}`);
    const antes = cell.style.boxShadow;

    await user.hover(cell);

    // Se comprueba que APARECE un anillo, no de qué color es. Fijar el hex ataba
    // el test a la paleta, y cambiar de tema oscuro a claro lo rompía sin que
    // nada del comportamiento hubiera cambiado.
    expect(cell.style.boxShadow).not.toBe(antes);
    expect(cell.style.boxShadow).toMatch(/0 0 0 1px/);

    await user.unhover(cell);
    expect(cell.style.boxShadow).toBe(antes);
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

  it("el valor de la capa activa no depende solo del color", () => {
    // Verde, ámbar y rojo son justo los tonos que pierde un daltonismo
    // rojo-verde. Con Suelo o Sanidad activas —rampas continuas, sin trama— el
    // único camino no cromático al dato es el nombre accesible del cuadro.
    renderGrid({ layer: getAvailableLayer("soil") });
    const celda = screen.getAllByRole("gridcell")[0]!;
    expect(celda.getAttribute("aria-label")).toContain("Suelo");
  });

  it("no repite el dato cuando la capa ya sale en la línea de siempre", () => {
    // Rendimiento y pérdida ya estaban en la descripción: añadirlos otra vez
    // haría al lector de pantalla leer dos veces lo mismo.
    renderGrid({ layer: getAvailableLayer("yield") });
    const etiqueta = screen.getAllByRole("gridcell")[0]!.getAttribute("aria-label") ?? "";
    expect(etiqueta).not.toContain("Rendimiento ");
    expect(etiqueta).toContain("kg");
  });

  it("cambiar de capa repinta la malla sin cambiar las celdas", () => {
    const props = {
      cells: buildTerrainCells(),
      gridWidth: 20,
      gridHeight: 20,
      selectedCellId: null,
      onSelect: vi.fn(),
    };
    const { rerender } = render(<CellGrid {...props} layer={getAvailableLayer("risk")} />);

    // En modo riesgo solo hay tres colores: son los tres niveles del dominio.
    const riskColors = new Set(
      screen.getAllByRole("gridcell").map((cell) => cell.style.backgroundColor),
    );
    expect(riskColors).toEqual(
      new Set(["rgb(34, 197, 94)", "rgb(234, 179, 8)", "rgb(239, 68, 68)"]),
    );
    expect(RISK_COLORS.high.fill).toBe("#ef4444");

    rerender(<CellGrid {...props} layer={getAvailableLayer("loss")} />);

    // Las celdas siguen siendo las mismas; lo que cambia es como se pintan.
    expect(screen.getAllByRole("gridcell")).toHaveLength(400);
    const lossColors = new Set(
      screen.getAllByRole("gridcell").map((cell) => cell.style.backgroundColor),
    );
    expect(lossColors).not.toEqual(riskColors);
  });
});

describe("contorno de zona en la malla plana", () => {
  it("marca exactamente las celdas que `zoneBorders` declara frontera", () => {
    // La afirmacion que se protege aqui es que las dos vistas cuentan LO MISMO.
    // La malla plana y el relieve dibujan el contorno de forma distinta —sombras
    // interiores frente a segmentos de linea—, pero la frontera sale de la misma
    // funcion. Si alguien reimplementa una de las dos, esto se cae.
    const { overview } = renderGrid();
    const esperadas = zoneBorders(overview.cells);

    const marcadas = screen
      .getAllByRole("gridcell")
      .filter((c) => c.getAttribute("data-zone") === "high-border");

    expect(marcadas.length).toBe(esperadas.size);
    expect(marcadas.length).toBeGreaterThan(0);

    for (const celda of marcadas) {
      const clave = `${celda.getAttribute("data-x")},${celda.getAttribute("data-y")}`;
      expect(esperadas.has(clave)).toBe(true);
      expect(celda.getAttribute("data-risk")).toBe("high");
    }
  });

  it("ninguna celda que no sea de riesgo alto lleva contorno", () => {
    renderGrid();

    for (const celda of screen.getAllByRole("gridcell")) {
      if (celda.getAttribute("data-zone")) {
        expect(celda.getAttribute("data-risk")).toBe("high");
      }
    }
  });
});

describe("la planta no afirma tamaños físicos", () => {
  it("el nombre de la malla dice cuántas celdas hay, no cuánto miden", () => {
    /*
     * Decía "celdas de 1 m²". Era la última afirmación física del frontend
     * construida sobre la suposición de que una celda mide un metro, y la única
     * que sobrevivió al barrido de `CELL_SIZE`: con `cell_size_m = 0,5` le
     * habría dicho a un lector de pantalla que cada celda tiene cuatro veces su
     * superficie real.
     *
     * La planta es la vista TOPOLOGICA y no recibe `cellSizeM` a propósito. La
     * medida vive donde sí se conoce: el inspector, que la calcula desde
     * `cell_size_m`.
     */
    renderGrid();
    const malla = screen.getByRole("grid");
    const nombre = malla.getAttribute("aria-label")!;

    expect(nombre).toContain("20 por 20");
    expect(nombre).not.toMatch(/m²|metro/i);
  });
});
