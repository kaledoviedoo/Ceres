/**
 * TerrainView: el contenedor que traduce store <-> props.
 *
 * Es el punto de sustitución de la fase 7 y el que aísla el hover. Lo que se
 * fija aquí es que `CellGrid` sigue sin conocer el store, y que mover el ratón
 * no obliga a repintar nada fuera de la malla.
 */

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TerrainView } from "@/components/terrain/TerrainView";
import { useCeresStore } from "@/stores/useCeresStore";
import { buildOverview } from "./fixtures";

const initial = useCeresStore.getState();

function renderTerrain() {
  const overview = buildOverview();
  render(
    <TerrainView cells={overview.cells} gridWidth={20} gridHeight={20} />,
  );
  return overview;
}

describe("TerrainView", () => {
  beforeEach(() => {
    useCeresStore.setState(initial, true);
  });

  it("pinta la malla leyendo el modo de vista del store", () => {
    renderTerrain();

    expect(screen.getAllByRole("gridcell")).toHaveLength(400);
    expect(useCeresStore.getState().viewMode).toBe("risk");
  });

  it("un click escribe el cell_id en el store", async () => {
    const user = userEvent.setup();
    const overview = renderTerrain();
    const target = overview.cells[123]!;

    await user.click(screen.getByTestId(`cell-${target.cell_code}`));

    expect(useCeresStore.getState().selectedCellId).toBe(target.cell_id);
  });

  it("el hover escribe hoveredCellId sin tocar la selección", async () => {
    const user = userEvent.setup();
    const overview = renderTerrain();
    act(() => useCeresStore.getState().selectCell("celda-fijada"));

    await user.hover(screen.getByTestId(`cell-${overview.cells[10]!.cell_code}`));

    expect(useCeresStore.getState().hoveredCellId).toBe(overview.cells[10]!.cell_id);
    expect(useCeresStore.getState().selectedCellId).toBe("celda-fijada");
  });

  it("un consumidor que solo mira la selección no se repinta con el hover", () => {
    // Esta es la razón de que TerrainView exista: antes la página leía el store
    // entero y cada celda que tocaba el cursor la repintaba completa.
    const renders = vi.fn();

    function SoloSeleccion() {
      const selected = useCeresStore((state) => state.selectedCellId);
      renders();
      return <span data-testid="observador">{selected ?? "ninguna"}</span>;
    }

    render(<SoloSeleccion />);
    const antes = renders.mock.calls.length;

    // Sin act() React no vacía la cola y el test pasaría sin probar nada.
    act(() => {
      useCeresStore.getState().hoverCell("celda-a");
      useCeresStore.getState().hoverCell("celda-b");
      useCeresStore.getState().hoverCell("celda-c");
    });

    expect(renders.mock.calls.length).toBe(antes);

    act(() => useCeresStore.getState().selectCell("celda-x"));
    expect(renders.mock.calls.length).toBeGreaterThan(antes);
  });
});
