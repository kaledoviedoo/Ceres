/**
 * GUARDAR UNA PREDICCIÓN ACTUALIZA LO QUE DEPENDE DE ELLA.
 *
 * `PredictionPanel` hacía el POST y se guardaba el resultado para sí. Los
 * bloques «Histórico» y «Predicción vs cosecha» —que viven en `CellInspector`—
 * no se enteraban, y seguían enseñando la lista y la entrada anteriores hasta
 * que el usuario salía de la celda y volvía. Se «arreglaba» solo porque
 * `useApiResource` no es caché, no porque nadie avisara.
 *
 * Lo que vigilan estos tests es la SECUENCIA de peticiones alrededor del POST
 * y con qué parámetros exactos: celda, ciclo y momento. Se usa el flujo real —
 * el botón del panel dentro del inspector— y un POST que no responde hasta que
 * el test lo suelta, para poder cambiar de momento o de celda a mitad.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CellInspector } from "@/components/cell-inspector/CellInspector";
import type { CellDetail } from "@/lib/types/api";
import { CELL_ID, CYCLE_ID, cellDetail, cellOverview, farmDetail, prediction } from "./fixtures";

const T0 = "2026-04-14T12:00:00Z";
const T2 = "2026-08-13T12:00:00Z";

/** Otra celda del mismo lote, para los tests de aislamiento. */
const CELL_B_ID = "b0000000-0000-5000-8000-000000000002";
const cellB: CellDetail = { ...cellDetail, id: CELL_B_ID, cell_code: "A-00099", x: 3, y: 4 };

/**
 * Cuántas predicciones «hay» en el servidor. Sube al guardar, para que el
 * refresco tenga algo distinto que enseñar: es lo que demuestra que la UI se
 * actualizó y no solo que se hizo una petición.
 */
let guardadas = 2;

/** Rendimiento proyectado que devuelve /performance; también cambia al guardar. */
let proyectado = 3.3648;

/** Cada petición, `MÉTODO ruta?query`, en orden. */
let pedidas: string[] = [];

/** El POST no responde hasta que el test lo suelte. */
let soltarPost: (respuesta: Response) => void = () => {};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function historial(cellId: string) {
  return {
    cell_id: cellId,
    predictions: Array.from({ length: guardadas }, (_, i) => ({
      ...prediction,
      id: `pred-${cellId}-${i}`,
      cell_id: cellId,
      as_of: i === 0 ? T0 : T2,
      created_at: "2026-09-09T20:50:06Z",
    })),
  };
}

function rendimiento(cellId: string, asOf: string) {
  return {
    cell_id: cellId,
    cell_code: "x",
    crop_cycle_id: CYCLE_ID,
    entries: [
      {
        prediction_id: `pred-${cellId}-${asOf}`,
        predicted_at: "2026-09-09T20:50:06Z",
        as_of: asOf,
        model_version: "rule-based-v0.1+impact-v0",
        projected_yield_kg: proyectado,
        projected_boxes: 1,
        estimated_loss_percentage: 12.5,
        risk_level: "low",
        harvest_id: "harvest-1",
        harvested_at: "2026-08-20",
        actual_yield_kg: 3.0299,
        actual_boxes: 1,
        absolute_error_kg: 0.3349,
        percentage_error: 11.0532,
      },
    ],
  };
}

function stubFetch() {
  pedidas = [];
  guardadas = 2;
  proyectado = 3.3648;
  const esperaPost = new Promise<Response>((resolve) => {
    soltarPost = resolve;
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://x");
      const metodo = init?.method ?? "GET";
      pedidas.push(`${metodo} ${url.pathname}${url.search}`);

      if (metodo === "POST") return esperaPost;

      const celda = url.pathname.split("/")[4]!;
      if (url.pathname.endsWith("/performance")) {
        return json(rendimiento(celda, url.searchParams.get("as_of") ?? "sin-as_of"));
      }
      return json(historial(celda));
    }),
  );
}

/** Lo que el servidor devolvería a un POST que sí guardó. */
function postGuardado() {
  guardadas += 1;
  proyectado = 9.9;
  return json({ ...prediction, id: "pred-nueva" }, 201);
}

function props(overrides: Partial<Parameters<typeof CellInspector>[0]> = {}) {
  return {
    cell: cellDetail,
    overview: cellOverview,
    cells: [cellOverview],
    overviewPersisted: false,
    asOf: T0,
    field: null,
    plot: farmDetail.plots[0]!,
    cropCycleId: CYCLE_ID,
    isLoading: false,
    error: null,
    onClear: () => {},
    ...overrides,
  };
}

function pintar(overrides: Partial<Parameters<typeof CellInspector>[0]> = {}) {
  return render(<CellInspector {...props(overrides)} />);
}

/** Las peticiones desde el POST en adelante (el POST incluido). */
function desdeElPost(): string[] {
  const i = pedidas.findIndex((p) => p.startsWith("POST"));
  return i === -1 ? [] : pedidas.slice(i + 1);
}

function historiales(lista: string[], cellId = CELL_ID) {
  return lista.filter((p) => p === `GET /api/v1/cells/${cellId}/predictions`);
}

function rendimientos(lista: string[], cellId = CELL_ID) {
  return lista
    .filter((p) => p.startsWith(`GET /api/v1/cells/${cellId}/performance`))
    .map((p) => new URL(p.slice(4), "http://x").searchParams);
}

async function cargaInicial(cellId = CELL_ID) {
  await waitFor(() => expect(historiales(pedidas, cellId)).toHaveLength(1));
  await waitFor(() => expect(rendimientos(pedidas, cellId)).toHaveLength(1));
}

async function guardar() {
  await userEvent.click(screen.getByRole("button", { name: /guardar predicción/i }));
  await waitFor(() => expect(pedidas.some((p) => p.startsWith("POST"))).toBe(true));
}

/** Deja pasar cualquier efecto pendiente sin esperar a nada concreto. */
const asentar = () => new Promise((r) => setTimeout(r, 50));

beforeEach(stubFetch);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("guardar una predicción refresca el inspector", () => {
  it("A · tras un POST exitoso pide el histórico y el rendimiento, una vez cada uno, y nada más", async () => {
    // EL TEST QUE REPRODUCE EL BUG: antes, `desdeElPost()` era `[]`.
    pintar();
    await cargaInicial();
    expect(screen.getByText(/2 registros/)).toBeInTheDocument();

    await guardar();
    soltarPost(postGuardado());

    await waitFor(() => expect(historiales(desdeElPost())).toHaveLength(1));
    await waitFor(() => expect(rendimientos(desdeElPost())).toHaveLength(1));
    // Exactamente esas dos. El inspector no tiene por qué tocar nada más.
    await asentar();
    expect(desdeElPost()).toHaveLength(2);

    // Y la pantalla lo refleja: no vale con haber pedido.
    await waitFor(() => expect(screen.getByText(/3 registros/)).toBeInTheDocument());
    const bloque = screen.getByRole("region", { name: /predicción vs cosecha/i });
    await waitFor(() => expect(within(bloque).getByText(/9,90 kg|9\.90 kg/)).toBeInTheDocument());
  });

  it("el refresco del rendimiento conserva celda, ciclo y momento", async () => {
    pintar();
    await cargaInicial();
    await guardar();
    soltarPost(postGuardado());

    await waitFor(() => expect(rendimientos(desdeElPost())).toHaveLength(1));
    const refresco = desdeElPost().find((p) => p.includes("/performance"))!;
    expect(refresco).toContain(`/cells/${CELL_ID}/performance`);
    expect(rendimientos(desdeElPost())[0]!.get("crop_cycle_id")).toBe(CYCLE_ID);
    expect(rendimientos(desdeElPost())[0]!.get("as_of")).toBe(T0);
  });

  it.each([
    ["B · t0", T0],
    ["C · t2", T2],
  ])("%s · guardar en ese momento refresca el rendimiento de ESE momento", async (_, momento) => {
    pintar({ asOf: momento });
    await cargaInicial();
    await guardar();
    soltarPost(postGuardado());

    await waitFor(() => expect(rendimientos(desdeElPost())).toHaveLength(1));
    expect(rendimientos(desdeElPost())[0]!.get("as_of")).toBe(momento);
  });

  it("D · un POST fallido no refresca nada", async () => {
    // Si no se guardó, no hay nada nuevo que leer. Pedirlo sería ruido, y
    // además taparía el error con datos que parecen frescos.
    pintar();
    await cargaInicial();
    await guardar();
    soltarPost(json({ detail: "boom" }, 500));

    await screen.findByText(/reintentar/i);
    await asentar();
    expect(desdeElPost()).toEqual([]);
    expect(screen.getByText(/2 registros/)).toBeInTheDocument();
  });

  it("E · sin momento activo, guardar refresca el histórico y NO pide rendimiento", async () => {
    // La finca demo: sin predicciones no hay eje temporal y `asOf` es null.
    // El bloque «Predicción vs cosecha» no existe, y `performance.reload()`
    // no puede convertirse en una petición de un momento que no hay.
    pintar({ asOf: null });
    await waitFor(() => expect(historiales(pedidas)).toHaveLength(1));
    expect(rendimientos(pedidas)).toHaveLength(0);

    await guardar();
    soltarPost(postGuardado());

    await waitFor(() => expect(historiales(desdeElPost())).toHaveLength(1));
    await asentar();
    expect(rendimientos(desdeElPost())).toHaveLength(0);
    expect(desdeElPost()).toHaveLength(1);
    await waitFor(() => expect(screen.getByText(/3 registros/)).toBeInTheDocument());
  });

  it("E2 · guardar y cambiar de celda: la nueva se pide entera y no hereda nada", async () => {
    const vista = pintar();
    await cargaInicial();
    await guardar();
    soltarPost(postGuardado());
    await waitFor(() => expect(historiales(desdeElPost())).toHaveLength(1));
    await screen.findByTestId("saved-prediction");

    vista.rerender(<CellInspector {...props({ cell: cellB })} />);

    await cargaInicial(CELL_B_ID);
    expect(screen.queryByTestId("saved-prediction")).not.toBeInTheDocument();
    expect(screen.getByText(cellB.cell_code)).toBeInTheDocument();
  });

  it("F · volver a la misma celda la vuelve a pedir, como siempre", async () => {
    const vista = pintar();
    await cargaInicial();
    vista.rerender(<CellInspector {...props({ cell: cellB })} />);
    await cargaInicial(CELL_B_ID);

    vista.rerender(<CellInspector {...props()} />);

    await waitFor(() => expect(historiales(pedidas)).toHaveLength(2));
    await waitFor(() => expect(rendimientos(pedidas)).toHaveLength(2));
  });

  it("G · guardar en t0 y cambiar a t2: el refresco usa t0, el cambio pide t2, nada se queda pegado", async () => {
    const vista = pintar({ asOf: T0 });
    await cargaInicial();
    await guardar();
    soltarPost(postGuardado());
    await waitFor(() => expect(rendimientos(pedidas)).toHaveLength(2));

    vista.rerender(<CellInspector {...props({ asOf: T2 })} />);

    await waitFor(() => expect(rendimientos(pedidas)).toHaveLength(3));
    expect(rendimientos(pedidas).map((q) => q.get("as_of"))).toEqual([T0, T0, T2]);
  });

  it("§7 · el POST responde tarde, ya en t2: el refresco habla de t2, nunca de t0", async () => {
    // El momento que se ve es el que manda. Refrescar con el momento del POST
    // pondría cifras de abril bajo un rótulo que dice agosto.
    const vista = pintar({ asOf: T0 });
    await cargaInicial();
    await guardar();

    vista.rerender(<CellInspector {...props({ asOf: T2 })} />);
    await waitFor(() => expect(rendimientos(pedidas)).toHaveLength(2));
    const antesDeSoltar = pedidas.length;

    soltarPost(postGuardado());

    await waitFor(() => expect(pedidas.length).toBeGreaterThan(antesDeSoltar));
    await asentar();
    const tardios = rendimientos(pedidas.slice(antesDeSoltar)).map((q) => q.get("as_of"));
    expect(tardios.length).toBeGreaterThan(0);
    expect(tardios.every((m) => m === T2)).toBe(true);
  });

  it("§8 · el POST de la celda A responde cuando ya se mira B: no refresca nada", async () => {
    // El panel de A se desmontó al cambiar de celda. Su respuesta tardía no
    // puede tocar la pantalla de B: ni con datos de A, ni obligando a B a
    // volver a pedirse.
    const vista = pintar();
    await cargaInicial();
    await guardar();

    vista.rerender(<CellInspector {...props({ cell: cellB })} />);
    await cargaInicial(CELL_B_ID);
    const antesDeSoltar = pedidas.length;

    soltarPost(postGuardado());
    await asentar();

    expect(pedidas.slice(antesDeSoltar)).toEqual([]);
    expect(screen.queryByTestId("saved-prediction")).not.toBeInTheDocument();
    expect(screen.getByText(cellB.cell_code)).toBeInTheDocument();
  });
});
