/**
 * EL INSPECTOR SIGUE AL MOMENTO SELECCIONADO.
 *
 * El mapa ya lo hacía; la ficha no. Mostraba el historial de predicciones sin
 * cosecha y sin error, así que la comparación contra la verdad no llegaba a la
 * pantalla.
 *
 * Lo que estos tests vigilan NO es que el parámetro exista, sino que la ficha
 * pida EL MOMENTO QUE DICE ESTAR MOSTRANDO. Es la trampa que importa: conectar
 * el inspector al instante equivocado deja unas cifras que siguen pareciendo
 * razonables, y nadie se entera mirando la pantalla.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CellInspector } from "@/components/cell-inspector/CellInspector";
import { CELL_ID, CYCLE_ID, cellDetail, cellOverview, farmDetail } from "./fixtures";

/** Los dos momentos REALES del lote de papa. Copiados de `/timeline`. */
const T0 = "2026-04-14T12:00:00Z";
const T2 = "2026-08-13T12:00:00Z";

/** Las del ciclo, que NO son momentos. Ver el test que las vigila. */
const SIEMBRA = "2026-03-15";
const COSECHA_ESPERADA = "2026-08-20";

/**
 * La cosecha real de la celda. LA MISMA en los dos momentos: se cosechó lo que
 * se cosechó, y eso no depende de desde cuándo se mire.
 */
const REAL_KG = 3.0299;

/** Predicción y error por momento, como los devuelve la API para P-00074. */
const POR_MOMENTO: Record<string, { pred: number; abs: number; pct: number }> = {
  [T0]: { pred: 3.3648, abs: 0.3349, pct: 11.0532 },
  [T2]: { pred: 3.2046, abs: 0.1747, pct: 5.7659 },
};

function entrada(asOf: string) {
  const m = POR_MOMENTO[asOf]!;
  return {
    prediction_id: `pred-${asOf}`,
    predicted_at: "2026-09-09T20:50:06Z",
    as_of: asOf,
    model_version: "rule-based-v0.1+impact-v0",
    projected_yield_kg: m.pred,
    projected_boxes: 1,
    estimated_loss_percentage: 12.5,
    risk_level: "low",
    harvest_id: "harvest-1",
    harvested_at: "2026-08-20",
    actual_yield_kg: REAL_KG,
    actual_boxes: 1,
    absolute_error_kg: m.abs,
    percentage_error: m.pct,
  };
}

/** Cada URL pedida, en orden. Es la evidencia de qué momento se consultó. */
let pedidas: string[] = [];

function stubFetch() {
  pedidas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      pedidas.push(url);

      if (url.includes("/performance")) {
        const asOf = new URL(url, "http://x").searchParams.get("as_of");
        const entries = asOf && POR_MOMENTO[asOf] ? [entrada(asOf)] : [];
        return new Response(
          JSON.stringify({
            cell_id: CELL_ID,
            cell_code: cellDetail.cell_code,
            crop_cycle_id: CYCLE_ID,
            entries,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      // El histórico: dos predicciones ejecutadas en el MISMO segundo y que
      // solo se distinguen por `as_of`.
      return new Response(
        JSON.stringify({
          cell_id: CELL_ID,
          // Devueltas al REVES y con una sin fechar, que es lo que hace el
          // endpoint real: ordena por `created_at desc` y aqui las dos se
          // ejecutaron en el mismo segundo, asi que el orden es arbitrario.
          predictions: [T2, T0, null].map((asOf) => ({
            ...(asOf ? entrada(asOf) : entrada(T0)),
            as_of: asOf,
            id: `pred-${asOf ?? "base"}`,
            cell_id: CELL_ID,
            crop_cycle_id: CYCLE_ID,
            created_at: "2026-09-09T20:50:06Z",
            projected_yield_tons: 0,
            risk_score: 0.2,
            factors: {
              density_factor: 1,
              soil_factor: 1,
              health_factor: 1,
              terrain_factor: 1,
              base_yield_factor: 1,
            },
            inputs: {},
          })),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }),
  );
}

function pintar(props: Partial<Parameters<typeof CellInspector>[0]> = {}) {
  return render(
    <CellInspector
      cell={cellDetail}
      overview={cellOverview}
      cells={[cellOverview]}
      overviewPersisted={false}
      asOf={T0}
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

/** Las peticiones a `/performance`, con el `as_of` que llevaban. */
function momentosPedidos(): (string | null)[] {
  return pedidas
    .filter((u) => u.includes("/performance"))
    .map((u) => new URL(u, "http://x").searchParams.get("as_of"));
}

beforeEach(stubFetch);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("el inspector y el eje temporal", () => {
  it("pide /performance con el momento que se le pasa", async () => {
    pintar({ asOf: T0 });

    await waitFor(() => expect(momentosPedidos()).toContain(T0));
  });

  it("cambiar de momento cambia el as_of que se pide", async () => {
    // EL TEST QUE DETECTA UNA CONEXIÓN AL MOMENTO EQUIVOCADO.
    const { rerender } = pintar({ asOf: T0 });
    await waitFor(() => expect(momentosPedidos()).toEqual([T0]));

    rerender(
      <CellInspector
        cell={cellDetail}
        overview={cellOverview}
        cells={[cellOverview]}
        overviewPersisted={false}
        asOf={T2}
        field={null}
        plot={farmDetail.plots[0]!}
        cropCycleId={CYCLE_ID}
        isLoading={false}
        error={null}
        onClear={() => {}}
      />,
    );

    await waitFor(() => expect(momentosPedidos()).toEqual([T0, T2]));
  });

  it("muestra la predicción del momento pedido, no la del otro", async () => {
    pintar({ asOf: T2 });

    const bloque = await screen.findByRole("region", { name: /predicción vs cosecha/i });

    expect(within(bloque).getByText(/3,20 kg|3\.20 kg/)).toBeInTheDocument();
    // Y no la de t0, que es un número distinto de la misma celda.
    expect(within(bloque).queryByText(/3,36 kg|3\.36 kg/)).not.toBeInTheDocument();
  });

  it("muestra el error del momento pedido", async () => {
    pintar({ asOf: T0 });

    await waitFor(() => expect(screen.getByText(/11,05|11\.05/)).toBeInTheDocument());
  });

  it("la cosecha real es la misma en los dos momentos", async () => {
    // LA GARANTÍA QUE SEPARA VERDAD DE PREDICCIÓN. Si la ficha mostrara una
    // cosecha distinta según el momento, estaría tratando la predicción como
    // verdad.
    const vista = pintar({ asOf: T0 });
    await waitFor(() => expect(screen.getByText(/3,03 kg|3\.03 kg/)).toBeInTheDocument());
    vista.unmount();

    pintar({ asOf: T2 });
    await waitFor(() => expect(screen.getByText(/3,03 kg|3\.03 kg/)).toBeInTheDocument());
  });

  it("NO pide ninguna fecha del ciclo", async () => {
    // La razón por la que existe `/timeline`: `planted_at` es el 15 de marzo y
    // el primer momento el 14 de abril. Si la ficha dedujera el instante del
    // ciclo, pediría una fecha que no existe en `predictions`.
    pintar({ asOf: T0 });

    await waitFor(() => expect(momentosPedidos().length).toBeGreaterThan(0));
    for (const pedido of momentosPedidos()) {
      expect(pedido?.startsWith(SIEMBRA)).toBe(false);
      expect(pedido?.startsWith(COSECHA_ESPERADA)).toBe(false);
    }
  });

  it("sin momento no pide un rendimiento temporal ni enseña el bloque", async () => {
    // Es el caso de la finca demo: sin predicciones no hay eje, y pedir un
    // momento inexistente sería inventarlo.
    pintar({ asOf: null });

    await waitFor(() => expect(pedidas.length).toBeGreaterThan(0));
    expect(screen.queryByText(/predicción vs cosecha/i)).not.toBeInTheDocument();
    expect(momentosPedidos()).toEqual([]);
  });

  it("un momento del que no hay predicción se dice, no se rellena", async () => {
    pintar({ asOf: "2020-01-01T00:00:00Z" });

    await waitFor(() =>
      expect(
        screen.getByText(/no hay ninguna predicción guardada de este momento/i),
      ).toBeInTheDocument(),
    );
  });

  it("el histórico deja fuera las predicciones sin fechar", async () => {
    // La serie se construye sobre `as_of`, no sobre `created_at`. Una predicción
    // sin `as_of` es el estado base, sin fecha, y no se puede situar en un eje
    // temporal: son tres registros y solo dos entran.
    pintar({ asOf: T0 });

    const bloque = await screen.findByRole("region", { name: /histórico/i });

    expect(bloque.textContent).toMatch(/2 registros/);
  });

  it("el histórico ordena la serie por as_of, no por como llegue", async () => {
    // El endpoint las devuelve por `created_at desc`, y con las dos ejecutadas
    // en el mismo segundo ese orden es arbitrario. Sin ordenar por `as_of` la
    // línea podría dibujarse de agosto a abril.
    pintar({ asOf: T0 });

    const grafico = await screen.findByLabelText(/historial de predicciones/i);
    // El trazo de la serie es el `path` sin relleno; el otro es el degradado.
    const trazo = [...grafico.querySelectorAll("path")].find(
      (n) => n.getAttribute("fill") === "none",
    )!;
    // `d` es "M x y L x y": las coordenadas impares son las y.
    const numeros = trazo
      .getAttribute("d")!
      .split(/[ML\s]+/)
      .filter(Boolean)
      .map(Number);
    const ys = numeros.filter((_, i) => i % 2 === 1);

    // t0 rinde MAS que t2 (3,3648 > 3,2046). En SVG la y crece hacia abajo, así
    // que un primer punto más alto en pantalla significa mayor rendimiento: la
    // serie va de abril a agosto y no al revés.
    expect(ys).toHaveLength(2);
    expect(ys[0]!).toBeLessThan(ys[1]!);
  });
});
