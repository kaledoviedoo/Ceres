/**
 * Cell Inspector.
 *
 * El test central es el último: que el panel muestre EXACTAMENTE los valores
 * que devuelve el backend. Si la interfaz redondeara, derivara o recalculara
 * algo, ahí se vería.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CellInspector } from "@/components/cell-inspector/CellInspector";
import { CELL_ID, CYCLE_ID, cellDetail, cellOverview, farmDetail, prediction } from "./fixtures";

function renderInspector(props: Partial<Parameters<typeof CellInspector>[0]> = {}) {
  return render(
    <CellInspector
      cell={cellDetail}
      overview={cellOverview}
      cells={[cellOverview]}
      plot={farmDetail.plots[0]!}
      cropCycleId={CYCLE_ID}
      isLoading={false}
      error={null}
      onClear={() => {}}
      {...props}
    />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("estados", () => {
  it("sin celda seleccionada, muestra el resumen del lote", () => {
    // Un panel de 360 px esperando un clic es espacio desperdiciado.
    renderInspector({ cell: null });

    expect(screen.getByText("Plot A")).toBeInTheDocument();
    expect(screen.getByText(/reparto del riesgo/i)).toBeInTheDocument();
    expect(screen.getByText(/haz clic en una celda/i)).toBeInTheDocument();
  });

  it("muestra estado de carga", () => {
    renderInspector({ cell: null, isLoading: true });

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("muestra el error con opción de reintentar", async () => {
    const onRetry = vi.fn();
    renderInspector({ cell: null, error: "No se pudo contactar con la API", onRetry });

    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo contactar con la API");

    await userEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("sin ciclo de cultivo, no ofrece predecir", () => {
    renderInspector({ cropCycleId: null });

    expect(screen.queryByRole("button", { name: /guardar predicción/i })).not.toBeInTheDocument();
    expect(screen.getByText(/no tiene ningún ciclo de cultivo activo/i)).toBeInTheDocument();
  });
});

describe("contenido", () => {
  it("muestra el código de la celda y su posición", () => {
    renderInspector();

    expect(screen.getByText("A-00240")).toBeInTheDocument();
    expect(screen.getByText(/x 19/)).toBeInTheDocument();
    expect(screen.getByText(/y 11/)).toBeInTheDocument();
  });

  it("muestra los campos mínimos exigidos por la fase 5", () => {
    renderInspector();

    for (const label of [
      "Pendiente",
      "Calidad de suelo",
      "Densidad de siembra",
      "Sanidad",
      "Rendimiento proyectado",
      "Cajas proyectadas",
      "Pérdida estimada",
      "Risk score",
      "Nivel de riesgo",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("distingue el estado guardado de la estimación no guardada", () => {
    // Confundirlos sería el error más caro: el valor del Digital Twin está en
    // poder separar lo que se midió de lo que se estimó.
    renderInspector();

    expect(screen.getByText(/estado del terreno/i)).toBeInTheDocument();
    expect(screen.getByText(/estimación actual · sin guardar/i)).toBeInTheDocument();
  });
});

describe("predicción contra la API", () => {
  it("llama a POST /predictions y muestra el resultado guardado", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => prediction,
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    renderInspector();
    await userEvent.click(screen.getByRole("button", { name: /guardar predicción/i }));

    await waitFor(() => {
      expect(screen.getByText(/predicción guardada/i)).toBeInTheDocument();
    });

    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toContain("/api/v1/predictions");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      cell_id: CELL_ID,
      crop_cycle_id: CYCLE_ID,
    });
  });

  it("muestra los factores explicativos que devuelve el motor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 201, json: async () => prediction })),
    );

    renderInspector();
    await userEvent.click(screen.getByRole("button", { name: /guardar predicción/i }));

    // "Sanidad" aparece tambien en el estado del terreno: se acota la consulta
    // al bloque de la prediccion guardada.
    const panel = within(await screen.findByTestId("saved-prediction"));
    for (const label of ["Densidad", "Suelo", "Sanidad", "Terreno", "Residual"]) {
      expect(panel.getByText(label)).toBeInTheDocument();
    }
    expect(panel.getByText("rule-based-v0.1")).toBeInTheDocument();
  });

  it("un fallo de la API no rompe el panel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 409,
        json: async () => ({ detail: "La celda pertenece a otro lote" }),
      })),
    );

    renderInspector();
    await userEvent.click(screen.getByRole("button", { name: /guardar predicción/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("otro lote");
    });
    // La celda sigue visible: el error es de la acción, no de la pantalla.
    expect(screen.getByText("A-00240")).toBeInTheDocument();
  });
});

describe("fidelidad con el backend", () => {
  it("muestra exactamente los valores que devuelve la API, sin recalcular", () => {
    renderInspector();

    // Estado (GET /cells/{id}): pendiente 2.03°, suelo 0.722, sanidad 0.929.
    expect(screen.getByText("2,03°")).toBeInTheDocument();
    expect(screen.getByText("72,2 %")).toBeInTheDocument();
    expect(screen.getByText("92,9 %")).toBeInTheDocument();
    expect(screen.getByText("2,65 pl/m²")).toBeInTheDocument();

    // Estimación (overview): 11.9634 kg, 2 cajas, 9.18 %, score 0.1492.
    expect(screen.getByText("11,96 kg")).toBeInTheDocument();
    expect(screen.getByText("9,18 %")).toBeInTheDocument();
    expect(screen.getByText("0,1492")).toBeInTheDocument();
    // El nivel se muestra dos veces a proposito: en la cabecera y en la fila.
    expect(screen.getAllByText("Bajo")).toHaveLength(2);
  });
});
