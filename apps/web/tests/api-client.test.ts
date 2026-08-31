/**
 * Cliente de API: construcción de URLs y traducción de errores.
 *
 * Lo importante que se fija aquí es que `POST /predictions` envía SOLO
 * identificadores. El servidor es la fuente de verdad de cualquier valor
 * agronómico, y esa regla tiene que ser imposible de romper por accidente
 * desde el frontend.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { ceresApi } from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/errors";
import { CELL_ID, CYCLE_ID, PLOT_A_ID, prediction } from "./fixtures";

function mockFetch(response: Partial<Response> & { jsonBody?: unknown }) {
  const fetchMock = vi.fn(async () => ({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => response.jsonBody ?? {},
  })) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("construcción de peticiones", () => {
  it("el overview manda el crop_cycle_id como query param", async () => {
    const fetchMock = mockFetch({ jsonBody: { cells: [] } });

    await ceresApi.getPlotOverview(PLOT_A_ID, CYCLE_ID);

    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain(`/api/v1/plots/${PLOT_A_ID}/overview`);
    expect(String(url)).toContain(`crop_cycle_id=${CYCLE_ID}`);
  });

  it("POST /predictions envía únicamente identificadores", async () => {
    const fetchMock = mockFetch({ jsonBody: prediction });

    await ceresApi.createPrediction({ cell_id: CELL_ID, crop_cycle_id: CYCLE_ID });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/api/v1/predictions");
    expect((init as RequestInit).method).toBe("POST");

    const body = JSON.parse((init as RequestInit).body as string);
    expect(Object.keys(body).sort()).toEqual(["cell_id", "crop_cycle_id"]);
    // Ni un solo valor agronómico puede salir del navegador.
    for (const forbidden of [
      "soil_quality",
      "health_factor",
      "slope_deg",
      "projected_yield_kg",
      "risk_score",
      "model_version",
    ]) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });

  it("carga las 400 celdas en una sola petición", async () => {
    const fetchMock = mockFetch({ jsonBody: { cells: [] } });

    await ceresApi.listCells(PLOT_A_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("traducción de errores", () => {
  it("un 404 se convierte en ApiError not_found", async () => {
    mockFetch({ ok: false, status: 404, jsonBody: { detail: "Cell abc no encontrado" } });

    await expect(ceresApi.getCell("abc")).rejects.toMatchObject({
      kind: "not_found",
      status: 404,
    });
  });

  it("un 409 conserva el mensaje del backend", async () => {
    mockFetch({
      ok: false,
      status: 409,
      jsonBody: { detail: "La celda A-00001 pertenece al lote X" },
    });

    try {
      await ceresApi.getPlotOverview(PLOT_A_ID, CYCLE_ID);
      expect.unreachable("debería haber lanzado");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).userMessage).toContain("pertenece al lote");
    }
  });

  it("aplana el detalle de un 422 de Pydantic", async () => {
    mockFetch({
      ok: false,
      status: 422,
      jsonBody: {
        detail: [
          { loc: ["body", "soil_quality"], msg: "Extra inputs are not permitted" },
          { loc: ["body", "risk_score"], msg: "Extra inputs are not permitted" },
        ],
      },
    });

    try {
      await ceresApi.createPrediction({ cell_id: CELL_ID, crop_cycle_id: CYCLE_ID });
      expect.unreachable("debería haber lanzado");
    } catch (error) {
      const message = (error as ApiError).userMessage;
      expect(message).toContain("soil_quality");
      expect(message).toContain("risk_score");
    }
  });

  it("una caída de red se explica de forma accionable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));

    try {
      await ceresApi.health();
      expect.unreachable("debería haber lanzado");
    } catch (error) {
      expect((error as ApiError).kind).toBe("network");
      expect((error as ApiError).userMessage).toContain("FastAPI");
    }
  });
});
