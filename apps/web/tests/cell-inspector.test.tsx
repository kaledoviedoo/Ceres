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
import { ElevationField, gridElevationSource } from "@/lib/terrain/elevation";
import { CELL_ID, CYCLE_ID, cellDetail, cellOverview, farmDetail, prediction, malla } from "./fixtures";

function renderInspector(props: Partial<Parameters<typeof CellInspector>[0]> = {}) {
  return render(
    <CellInspector
      cell={cellDetail}
      overview={cellOverview}
      cells={[cellOverview]}
      overviewPersisted={false}
      asOf={null}
      // Sin campo de elevación: la nota de procedencia es opcional y su
      // ausencia no debe romper la ficha.
      field={null}
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
      "Latitud",
      "Longitud",
      "Elevación",
      "Pendiente",
      "Calidad de suelo",
      "Densidad de siembra",
      "Sanidad",
      "Pérdida estimada",
      "Risk score",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // El nivel se muestra como insignia y no como fila, pero sigue anunciandose
    // con su contexto: "Bajo" a secas no dice bajo que.
    expect(screen.getByText(/nivel de riesgo:/i)).toBeInTheDocument();
  });

  it("distingue la entrada del modelo de la estimación no guardada", () => {
    // Confundirlas sería el error más caro: el valor del Digital Twin está en
    // poder separar de dónde sale cada número.
    renderInspector();

    // Cada bloque lleva su nota de origen.
    expect(screen.getByText(/condición del terreno/i)).toBeInTheDocument();
    expect(screen.getByText(/rendimiento estimado/i)).toBeInTheDocument();
    expect(screen.getByText("Entrada del modelo")).toBeInTheDocument();
    expect(screen.getAllByText(/sin guardar/i).length).toBeGreaterThan(0);
  });

  it("NO llama medido a nada, porque nada se midió", () => {
    // Este bloque decía "Medido" sobre suelo, sanidad, densidad y factor
    // residual. Ninguno de los cuatro es una medición de campo: llegan en la
    // ficha de la celda y alimentan el motor. La palabra convertía una entrada
    // del modelo en una observación, que es exactamente la confusión que este
    // panel existe para evitar.
    renderInspector();
    expect(screen.queryByText("Medido")).not.toBeInTheDocument();
  });

  it("la pendiente se presenta como derivada, no como levantamiento", () => {
    // Va junto a unas coordenadas con seis decimales y una altitud con dos, y
    // en esa compañía se lee como topografía medida. El backend la deriva de la
    // elevación con `np.gradient`, y esa elevación es sintética.
    renderInspector();
    expect(screen.getByText(/derivada de la elevación/i)).toBeInTheDocument();
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

    // Se busca la llamada POST, no la primera: el inspector tambien pide el
    // historico con un GET, y atarse al orden haria el test fragil.
    const llamadas = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const post = llamadas.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(post).toBeDefined();
    const [url, init] = post!;
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
    // El rendimiento aparece dos veces a proposito: como cifra titular y como
    // posicion dentro del reparto del lote.
    expect(screen.getAllByText("11,96 kg").length).toBeGreaterThan(0);
    expect(screen.getByText("9,18 %")).toBeInTheDocument();
    expect(screen.getByText("0,1492")).toBeInTheDocument();
    // Una sola vez: la insignia de la cabecera. La fila duplicada se retiro.
    expect(screen.getAllByText("Bajo")).toHaveLength(1);
  });
});

describe("la extensión del lote sale del dato, no de suponer 1 m", () => {
  it("con celdas de 1 m dice 20 × 20 m, como siempre", () => {
    const plot = farmDetail.plots[0]!;
    const field = new ElevationField(
      gridElevationSource(alturasDePrueba(), malla(20, 20, plot.cell_size_m)),
      plot.cell_size_m,
    );
    renderInspector({ cell: null, field, plot });
    expect(screen.getByText(/en 20 × 20 m/)).toBeInTheDocument();
  });

  it("con celdas de 0,5 m dice 10 × 10 m", () => {
    // La frase leía el RECUENTO de celdas y le pegaba una "m". Sobre este lote
    // habría afirmado 20 × 20 m de terreno donde hay 10 × 10.
    const plot = { ...farmDetail.plots[0]!, cell_size_m: 0.5 };
    const field = new ElevationField(
      gridElevationSource(alturasDePrueba(), malla(20, 20, 0.5)),
      0.5,
    );
    renderInspector({ cell: null, field, plot });
    expect(screen.getByText(/en 10 × 10 m/)).toBeInTheDocument();
  });
});

/** Un relieve mínimo: el bloque solo aparece si hay desnivel que contar. */
function alturasDePrueba() {
  const cells = [];
  for (let y = 0; y < 20; y += 1) {
    for (let x = 0; x < 20; x += 1) cells.push({ x, y, elevation_m: 1180 + y * 0.1 });
  }
  return cells;
}

describe("guardado o no, lo dice la API", () => {
  it("`persisted: false` se rotula como no guardado", () => {
    // Es el caso de hoy: `/plots/{id}/overview` calcula al vuelo y lo tira, y lo
    // declara en la respuesta. La interfaz lo escribía a mano.
    renderInspector({ overviewPersisted: false });
    expect(screen.getAllByText(/sin guardar/i).length).toBeGreaterThan(0);
  });

  it("`persisted: true` se rotula como guardado", () => {
    /*
     * No hay ningún endpoint que hoy devuelva `true`, y ese es justamente el
     * motivo de este test: cuando lo haya, el rótulo tiene que cambiar solo. Con
     * el texto escrito a mano habría seguido diciendo "Sin guardar" sobre datos
     * guardados, y nadie lo habría notado.
     */
    renderInspector({ overviewPersisted: true });
    expect(screen.getByText("Guardado")).toBeInTheDocument();
    expect(screen.queryByText("Sin guardar")).not.toBeInTheDocument();
  });
});
