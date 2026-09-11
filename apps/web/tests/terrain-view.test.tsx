/**
 * TerrainView: el punto de sustitución.
 *
 * Lo que se fija aquí es que cambiar de representación es cambiar qué
 * componente se monta, y que ambos cumplen el mismo contrato: reciben celdas
 * ya calculadas y emiten `cell_id`. Ninguno conoce la API.
 *
 * El canvas 3D se sustituye por un doble porque jsdom no tiene WebGL. No es una
 * limitación del test: lo que importa comprobar aquí es el cableado, y el
 * comportamiento de la escena se verifica en el navegador real.
 */

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ElevationField, gridElevationSource } from "@/lib/terrain/elevation";
import { TerrainView } from "@/components/terrain/TerrainView";
import { useCeresStore } from "@/stores/useCeresStore";
import { buildTerrainCells, malla } from "./fixtures";

vi.mock("@/components/terrain/TerrainCanvas", () => ({
  TerrainCanvas: ({
    cells,
    onSelect,
  }: {
    cells: { cell_id: string; cell_code: string }[];
    onSelect: (id: string) => void;
  }) => (
    <div data-testid="terrain-canvas" data-cells={cells.length}>
      <button type="button" onClick={() => onSelect(cells[7]!.cell_id)}>
        seleccionar
      </button>
    </div>
  ),
}));

const initial = useCeresStore.getState();

function renderTerrain() {
  const cells = buildTerrainCells();
  // El campo de elevación se construye desde las mismas celdas, igual que en la
  // página: la vista solo lo reparte, no lo deriva.
  const campo = new ElevationField(gridElevationSource(cells, malla(20, 20)), 1);
  const view = render(<TerrainView field={campo} cells={cells} plot={malla(20, 20)} />);
  return { cells, view };
}

describe("TerrainView", () => {
  beforeEach(() => {
    useCeresStore.setState(initial, true);
  });

  it("monta el terreno 3D por defecto", () => {
    renderTerrain();

    expect(screen.getByTestId("terrain-canvas")).toHaveAttribute("data-cells", "400");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("monta la malla plana al cambiar de representación", () => {
    act(() => useCeresStore.getState().setTerrainMode("2d"));
    renderTerrain();

    expect(screen.queryByTestId("terrain-canvas")).not.toBeInTheDocument();
    expect(screen.getAllByRole("gridcell")).toHaveLength(400);
  });

  it("las dos vistas escriben el mismo cell_id en el store", async () => {
    const user = userEvent.setup();
    const { cells, view } = renderTerrain();

    await user.click(screen.getByRole("button", { name: "seleccionar" }));
    const desdeElCanvas = useCeresStore.getState().selectedCellId;
    expect(desdeElCanvas).toBe(cells[7]!.cell_id);

    // Se desmonta antes de montar la otra vista: si no, quedan dos mallas en
    // el documento y la consulta encuentra la celda por duplicado.
    view.unmount();
    act(() => {
      useCeresStore.setState(initial, true);
      useCeresStore.getState().setTerrainMode("2d");
    });
    const campo = new ElevationField(gridElevationSource(cells, malla(20, 20)), 1);
    render(<TerrainView field={campo} cells={cells} plot={malla(20, 20)} />);

    await user.click(screen.getByTestId(`cell-${cells[7]!.cell_code}`));
    expect(useCeresStore.getState().selectedCellId).toBe(desdeElCanvas);
  });

  it("un consumidor que solo mira la selección no se repinta con el modo de vista", () => {
    const renders = vi.fn();

    function SoloSeleccion() {
      const selected = useCeresStore((state) => state.selectedCellId);
      renders();
      return <span>{selected ?? "ninguna"}</span>;
    }

    render(<SoloSeleccion />);
    const antes = renders.mock.calls.length;

    act(() => useCeresStore.getState().setActiveLayer("yield"));
    expect(renders.mock.calls.length).toBe(antes);

    act(() => useCeresStore.getState().selectCell("celda-x"));
    expect(renders.mock.calls.length).toBeGreaterThan(antes);
  });
});
