/**
 * EL MAPA SE PIDE UNA VEZ POR LOTE, Y CON EL MOMENTO CORRECTO.
 *
 * `overviewAsOf` sale de `/timeline`. Mientras esa respuesta está en vuelo
 * vale `null`, y la página pedía `/overview` sin momento —2.029 KB, 1,4 s—,
 * completaba la petición y la tiraba entera cuando llegaba la segunda, ya con
 * el momento. Medido en la auditoría de la fase anterior.
 *
 * Lo que vigilan estos tests es la SECUENCIA de peticiones, no la pantalla:
 * el mapa espera a saber de qué momento hablar antes de pedirse, y cuando lo
 * sabe se pide una sola vez. Se controla a mano cuándo resuelve `/timeline`
 * para que el orden no dependa de la suerte del event loop.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CeresPage from "@/app/page";
import type { CellCollection, PlotTimeline } from "@/lib/types/api";
import { useCeresStore } from "@/stores/useCeresStore";
import {
  CYCLE_ID,
  PLOT_A_ID,
  buildOverview,
  cellProvenance,
  cropCycle,
  farmDetail,
  health,
} from "./fixtures";

// El terreno monta WebGL, que jsdom no tiene. Aquí solo importa qué se pide.
vi.mock("@/components/terrain/TerrainView", () => ({
  TerrainView: () => <div data-testid="terreno" />,
}));

/** Dos momentos reales, con la forma exacta de `/timeline`. */
const T0 = "2026-04-14T12:00:00Z";
const T2 = "2026-08-13T12:00:00Z";

const inicial = useCeresStore.getState();

/** Las celdas con la forma de `/cells`: geometría, sin métricas del motor. */
function coleccion(): CellCollection {
  return {
    plot_id: PLOT_A_ID,
    grid_width: 20,
    grid_height: 20,
    cell_size_m: 1,
    provenance: cellProvenance,
    cells: buildOverview().cells.map((cell) => ({
      id: cell.cell_id,
      cell_code: cell.cell_code,
      x: cell.x,
      y: cell.y,
      elevation_m: 2140 + cell.y * 0.1,
      slope_deg: 3,
      soil_quality: 0.7,
      plant_density: 2.5,
      health_factor: 0.9,
      base_yield_factor: 1,
    })),
  };
}

function linea(moments: PlotTimeline["moments"]): PlotTimeline {
  return {
    plot_id: PLOT_A_ID,
    crop_cycle_id: CYCLE_ID,
    planted_at: cropCycle.planted_at,
    expected_harvest_at: cropCycle.expected_harvest_at,
    moments,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Cada URL pedida, en orden. */
let pedidas: string[] = [];

/**
 * `/timeline` no responde hasta que el test lo diga. Es lo que permite
 * afirmar qué se pidió MIENTRAS la línea de tiempo estaba en vuelo.
 */
let soltarLinea: (respuesta: Response) => void = () => {};

function stubFetch() {
  pedidas = [];
  const esperaLinea = new Promise<Response>((resolve) => {
    soltarLinea = resolve;
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://x");
      pedidas.push(String(input));
      const ruta = url.pathname;

      if (ruta.endsWith("/health")) return json(health);
      if (ruta.endsWith("/farms")) return json([{ ...farmDetail, plots: undefined }]);
      if (ruta.endsWith(`/farms/${farmDetail.id}`)) return json(farmDetail);
      if (ruta.endsWith("/crop-cycles")) return json([cropCycle]);
      if (ruta.endsWith("/cells")) return json(coleccion());
      if (ruta.endsWith("/timeline")) return esperaLinea;
      if (ruta.endsWith("/overview")) return json(buildOverview());

      return json({ detail: `sin stub: ${ruta}` }, 404);
    }),
  );
}

/** Las peticiones a `/overview`, con el `as_of` que llevaban (`null` = sin él). */
function mapasPedidos(): (string | null)[] {
  return pedidas
    .filter((u) => u.includes("/overview"))
    .map((u) => new URL(u, "http://x").searchParams.get("as_of"));
}

function lineasPedidas(): number {
  return pedidas.filter((u) => u.includes("/timeline")).length;
}

beforeEach(() => {
  useCeresStore.setState(inicial, true);
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("el mapa y la línea de tiempo", () => {
  it("no pide el mapa mientras la línea de tiempo está en vuelo", async () => {
    // EL TEST QUE REPRODUCE C2. Sin la espera, aquí ya habría una petición de
    // `/overview` sin momento, que después se tiraría.
    render(<CeresPage />);

    // La línea de tiempo se pidió: ya se sabe lote y ciclo, y falta saber de
    // qué momento hablar.
    await waitFor(() => expect(lineasPedidas()).toBe(1));
    // Y las celdas ya llegaron: la geometría no depende del momento.
    await waitFor(() => expect(pedidas.some((u) => u.endsWith("/cells"))).toBe(true));

    expect(mapasPedidos()).toEqual([]);
  });

  it("pide el mapa UNA vez, con el primer momento, cuando la línea resuelve", async () => {
    render(<CeresPage />);
    await waitFor(() => expect(lineasPedidas()).toBe(1));

    soltarLinea(
      json(
        linea([
          { as_of: T0, prediction_count: 400 },
          { as_of: T2, prediction_count: 400 },
        ]),
      ),
    );

    await waitFor(() => expect(mapasPedidos()).toEqual([T0]));
    await screen.findByTestId("terreno");
    // Y sigue siendo una: nada la repite al asentarse el resto de la página.
    expect(mapasPedidos()).toEqual([T0]);
  });

  it("enseña que está cargando mientras espera la línea de tiempo", async () => {
    // Sin esto, entre que llegan las celdas y llega la línea el lienzo se
    // queda en blanco: ni terreno, ni error, ni carga.
    render(<CeresPage />);
    await waitFor(() => expect(pedidas.some((u) => u.endsWith("/cells"))).toBe(true));
    await waitFor(() => expect(lineasPedidas()).toBe(1));

    await waitFor(() =>
      expect(screen.getByText(/ejecutando el motor sobre el lote/i)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("terreno")).not.toBeInTheDocument();
  });

  it("un lote sin momentos pide el mapa una vez y sin as_of", async () => {
    // La finca demo: `/timeline` contesta vacío. El estado base es lo único
    // afirmable y se pide UNA vez, no cero —la espera no puede convertirse en
    // un mapa que no llega nunca—.
    render(<CeresPage />);
    await waitFor(() => expect(lineasPedidas()).toBe(1));

    soltarLinea(json(linea([])));

    await waitFor(() => expect(mapasPedidos()).toEqual([null]));
    await screen.findByTestId("terreno");
    expect(mapasPedidos()).toEqual([null]);
  });

  it("si la línea de tiempo falla, el mapa se pide igual con el estado base", async () => {
    // La espera es a que la línea TERMINE, no a que tenga éxito. Un 500 en
    // `/timeline` no puede dejar el lote sin mapa.
    render(<CeresPage />);
    await waitFor(() => expect(lineasPedidas()).toBe(1));

    soltarLinea(json({ detail: "boom" }, 500));

    await waitFor(() => expect(mapasPedidos()).toEqual([null]));
    await screen.findByTestId("terreno");
  });
});
