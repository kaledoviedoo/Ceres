/**
 * EL CONTROL TEMPORAL.
 *
 * Lo que se comprueba aquí es que pulsar una pastilla produzca el `as_of` que
 * la API declaró, y NADA MÁS: este componente no construye fechas, no las
 * deduce del ciclo y no interpola entre momentos.
 *
 * Los botones se buscan por POSICIÓN y no por texto. Su etiqueta es una fecha
 * formateada con `toLocaleDateString`, y ese formato depende de los datos ICU
 * del entorno: fijarlo en el test comprobaría la versión de Node, no el
 * comportamiento del control.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TimelineSwitch } from "@/components/dashboard/TimelineSwitch";
import type { TimelineMoment } from "@/lib/types/api";

/**
 * Los momentos REALES del lote de papa de La Cuadrícula.
 *
 * Copiados de la respuesta de `GET /plots/{id}/timeline`, no inventados. Se
 * usan tal cual para que el test falle si alguien empieza a fabricar fechas.
 */
const MOMENTOS: TimelineMoment[] = [
  { as_of: "2026-04-14T12:00:00Z", prediction_count: 10000 },
  { as_of: "2026-08-13T12:00:00Z", prediction_count: 10000 },
];

/** Las del ciclo, que NO son momentos. Ver el test que las vigila. */
const SIEMBRA = "2026-03-15";
const COSECHA_ESPERADA = "2026-08-20";

function pastillas() {
  return within(screen.getByRole("group", { name: "Momento del ciclo" })).getAllByRole(
    "button",
  );
}

function pintar(props: Partial<Parameters<typeof TimelineSwitch>[0]> = {}) {
  return render(
    <TimelineSwitch
      moments={MOMENTOS}
      value={null}
      plantedAt={SIEMBRA}
      onChange={vi.fn()}
      {...props}
    />,
  );
}

describe("control del eje temporal", () => {
  it("ofrece una pastilla por momento", () => {
    pintar();

    expect(pastillas()).toHaveLength(MOMENTOS.length);
  });

  it("cambiar de momento emite EXACTAMENTE el as_of que declaró la API", () => {
    const onChange = vi.fn();
    pintar({ value: MOMENTOS[0]!.as_of, onChange });

    fireEvent.click(pastillas()[1]!);

    expect(onChange).toHaveBeenCalledWith("2026-08-13T12:00:00Z");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("cada pastilla emite un instante distinto", () => {
    const onChange = vi.fn();
    pintar({ onChange });

    fireEvent.click(pastillas()[1]!);
    fireEvent.click(pastillas()[0]!);

    const emitidos = onChange.mock.calls.map(([valor]) => valor);
    expect(emitidos).toEqual(["2026-08-13T12:00:00Z", "2026-04-14T12:00:00Z"]);
  });

  it("NO emite ninguna fecha del ciclo", () => {
    // La razón por la que el endpoint de línea de tiempo existe: `planted_at` es
    // el 15 de marzo y el primer momento es el 14 de abril. Deducir los
    // instantes del ciclo pediría mapas de fechas que no existen en
    // `predictions`.
    const onChange = vi.fn();
    pintar({ onChange });

    fireEvent.click(pastillas()[0]!);
    fireEvent.click(pastillas()[1]!);

    for (const [emitido] of onChange.mock.calls) {
      expect((emitido as string).startsWith(SIEMBRA)).toBe(false);
      expect((emitido as string).startsWith(COSECHA_ESPERADA)).toBe(false);
    }
  });

  it("solo puede emitir instantes que estén en la lista", () => {
    // El control no tiene ninguna fecha propia: todo lo que emite sale de lo
    // que le pasaron.
    const onChange = vi.fn();
    pintar({ onChange });

    for (const boton of pastillas()) fireEvent.click(boton);

    const declarados = MOMENTOS.map((moment) => moment.as_of);
    for (const [emitido] of onChange.mock.calls) {
      expect(declarados).toContain(emitido);
    }
  });

  it("marca como activo el momento que se le pasa", () => {
    pintar({ value: MOMENTOS[1]!.as_of });

    const [primera, segunda] = pastillas();
    expect(segunda).toHaveAttribute("aria-pressed", "true");
    expect(primera).toHaveAttribute("aria-pressed", "false");
  });

  it("sin momento activo marca el primero, no ninguno", () => {
    pintar({ value: null });

    expect(pastillas()[0]!).toHaveAttribute("aria-pressed", "true");
  });

  it("se retira cuando el lote no tiene eje que recorrer", () => {
    // Es el caso de la finca demo: cero predicciones, cero momentos. Enseñar un
    // control con una sola opción, o con ninguna, sugeriría que hay algo que
    // explorar donde no lo hay.
    const { container, rerender } = render(
      <TimelineSwitch moments={[]} value={null} plantedAt={SIEMBRA} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(
      <TimelineSwitch
        moments={[MOMENTOS[0]!]}
        value={null}
        plantedAt={SIEMBRA}
        onChange={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("dice cuántas predicciones respaldan cada momento", () => {
    pintar();

    expect(pastillas()[0]!.getAttribute("title")).toContain(
      "10.000 predicciones guardadas",
    );
  });

  it("sitúa cada momento en el ciclo restando desde la siembra", () => {
    // 15 de marzo → 14 de abril son 30 días. Es una resta de dos fechas que ya
    // vienen de la API, no una fórmula.
    pintar();

    expect(pastillas()[0]!.getAttribute("title")).toContain("Día 30 del ciclo");
    expect(pastillas()[1]!.getAttribute("title")).toContain("Día 151 del ciclo");
  });

  it("sin siembra declarada no inventa a qué altura del ciclo cae", () => {
    pintar({ plantedAt: null });

    expect(pastillas()[0]!.getAttribute("title")).not.toContain("Día");
    expect(screen.queryByText(/día \d+ del ciclo/)).not.toBeInTheDocument();
  });

  it("acepta cuantos momentos declare la API", () => {
    // Si algún día vuelve un instante intermedio, sale solo. El componente no
    // sabe cuántos hay ni cómo se llaman.
    const tres = [...MOMENTOS, { as_of: "2026-09-01T12:00:00Z", prediction_count: 5 }];
    pintar({ moments: tres });

    expect(pastillas()).toHaveLength(3);
  });
});
