/**
 * La capa accesible sobre el canvas 3D.
 *
 * Un canvas de WebGL es un mapa de píxeles: no tiene estructura recorrible ni
 * recibe foco por celda. Estos tests son la garantía de que pasar a 3D no se
 * llevó por delante lo que la fase 6 construyó.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AccessibleCellLayer } from "@/components/terrain/AccessibleCellLayer";
import { getAvailableLayer } from "@/lib/terrain/layers";
import { buildTerrainCells } from "./fixtures";

function renderLayer(overrides: Partial<Parameters<typeof AccessibleCellLayer>[0]> = {}) {
  const cells = buildTerrainCells();
  const onSelect = vi.fn();
  const onFocusCell = vi.fn();

  render(
    <AccessibleCellLayer
      cells={cells}
      gridWidth={20}
      gridHeight={20}
      layer={getAvailableLayer("risk")}
      selectedCellId={null}
      onSelect={onSelect}
      onFocusCell={onFocusCell}
      {...overrides}
    />,
  );

  return { cells, onSelect, onFocusCell };
}

describe("AccessibleCellLayer", () => {
  it("expone la malla como grid > row > gridcell", () => {
    renderLayer();

    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(20);
    for (const row of rows) {
      expect(within(row).getAllByRole("gridcell")).toHaveLength(20);
    }
  });

  it("solo una celda está en el orden de tabulación", () => {
    renderLayer();

    const cells = screen.getAllByRole("gridcell");
    expect(cells.filter((c) => c.getAttribute("tabindex") === "0")).toHaveLength(1);
    expect(cells.filter((c) => c.getAttribute("tabindex") === "-1")).toHaveLength(399);
  });

  it("se entra por la esquina noroeste", () => {
    renderLayer();

    const entry = screen.getAllByRole("gridcell").find((c) => c.getAttribute("tabindex") === "0")!;
    expect(entry.getAttribute("aria-label")).toContain("columna 1, fila 20");
  });

  it("las flechas mueven el foco", async () => {
    const user = userEvent.setup();
    renderLayer();

    const entry = screen.getAllByRole("gridcell").find((c) => c.getAttribute("tabindex") === "0")!;
    entry.focus();

    await user.keyboard("{ArrowRight}");
    const derecha = screen
      .getAllByRole("gridcell")
      .find((c) => c.getAttribute("tabindex") === "0")!;
    expect(derecha.getAttribute("aria-label")).toContain("columna 2, fila 20");

    // El norte está arriba, así que bajar reduce y.
    await user.keyboard("{ArrowDown}");
    const abajo = screen.getAllByRole("gridcell").find((c) => c.getAttribute("tabindex") === "0")!;
    expect(abajo.getAttribute("aria-label")).toContain("columna 2, fila 19");
  });

  it("el foco no se sale de la malla", async () => {
    const user = userEvent.setup();
    renderLayer();

    const entry = screen.getAllByRole("gridcell").find((c) => c.getAttribute("tabindex") === "0")!;
    entry.focus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}{ArrowUp}{ArrowUp}");

    const sigue = screen.getAllByRole("gridcell").find((c) => c.getAttribute("tabindex") === "0")!;
    expect(sigue.getAttribute("aria-label")).toContain("columna 1, fila 20");
  });

  it("cada celda anuncia sus métricas, no solo su nombre", () => {
    const { cells } = renderLayer();
    const alta = cells.find((c) => c.risk_level === "high")!;

    const label = screen.getByTestId(`a11y-cell-${alta.cell_code}`).getAttribute("aria-label")!;
    expect(label).toContain(alta.cell_code);
    expect(label).toContain("kg");
    expect(label).toContain("pérdida");
    expect(label).toContain("riesgo alto");
  });

  it("activar una celda emite su cell_id", async () => {
    const user = userEvent.setup();
    const { cells, onSelect } = renderLayer();
    const target = cells[123]!;

    await user.click(screen.getByTestId(`a11y-cell-${target.cell_code}`));

    expect(onSelect).toHaveBeenCalledWith(target.cell_id);
  });

  it("enfocar una celda la resalta en la escena", () => {
    const { cells, onFocusCell } = renderLayer();
    const target = cells[10]!;

    screen.getByTestId(`a11y-cell-${target.cell_code}`).focus();

    expect(onFocusCell).toHaveBeenCalledWith(target);
  });

  it("marca la celda seleccionada con aria-selected", () => {
    const cells = buildTerrainCells();
    renderLayer({ cells, selectedCellId: cells[5]!.cell_id });

    expect(screen.getByTestId(`a11y-cell-${cells[5]!.cell_code}`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("no captura el puntero: la cámara necesita los arrastres", () => {
    renderLayer();

    // El contenedor deja pasar el ratón; solo los botones lo recuperan, y a
    // ellos se llega por teclado.
    const grid = screen.getByRole("grid");
    expect(grid.className).toContain("pointer-events-none");
  });
});

describe("el color no puede ser el único portador del dato", () => {
  it("el nombre de la celda lleva el valor de la capa activa", () => {
    /*
     * Con Suelo o Sanidad activas, lo que la capa proyecta sobre el terreno es
     * un tono y nada más. En planta ese valor ya estaba en el nombre de cada
     * cuadro; aquí, en relieve, la malla accesible enumeraba rendimiento,
     * pérdida y riesgo y callaba justo lo que se estaba mirando.
     */
    const { cells } = renderLayer({ layer: getAvailableLayer("soil") });
    const primera = cells.find((c) => c.x === 0 && c.y === 19)!;
    const boton = screen.getByRole("gridcell", { name: new RegExp(primera.cell_code) });

    expect(boton.getAttribute("aria-label")).toContain("Suelo");
    expect(boton.getAttribute("aria-label")).toContain(
      getAvailableLayer("soil").format(primera.soil_quality),
    );
  });

  it("no repite lo que el nombre ya dice", () => {
    // El rendimiento se enuncia en toda celda: repetirlo alargaría cada lectura
    // sin añadir nada.
    const { cells } = renderLayer({ layer: getAvailableLayer("yield") });
    const primera = cells.find((c) => c.x === 0 && c.y === 19)!;
    const boton = screen.getByRole("gridcell", { name: new RegExp(primera.cell_code) });

    expect(boton.getAttribute("aria-label")).not.toContain("Rendimiento");
  });
});
