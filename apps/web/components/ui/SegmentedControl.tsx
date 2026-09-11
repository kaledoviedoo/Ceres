"use client";

/**
 * Conmutador segmentado con indicador deslizante.
 *
 * EL FALLO QUE ESTO ARREGLA
 * La versión anterior calculaba el indicador como `(100% - relleno) / n` y lo
 * desplazaba `index * 100%`, dando por hecho que los segmentos median lo mismo.
 * No lo miden: los botones son `flex-1`, pero un elemento flexible no baja de
 * `min-width: auto`, así que "Rendimiento" ocupa más que "Riesgo" y los tres
 * segmentos salen desiguales. El indicador, calculado sobre una media que no
 * existe, se desbordaba sobre los botones vecinos.
 *
 * La única fuente fiable de dónde está un botón es el botón. Se mide el activo y
 * el indicador se coloca sobre sus coordenadas reales.
 *
 * POR QUE SE DESLIZA
 * Con píldoras que solo cambian de color, el ojo no ve un movimiento: ve una
 * apagarse y otra encenderse, y hay que releer para saber cuál quedó activa. Un
 * indicador que viaja dice de dónde vienes y a dónde vas en el propio gesto.
 *
 * SOBRE LO QUE SE ANIMA
 * `transform` es composición pura. El ancho también cambia —los segmentos son
 * desiguales— y eso sí es layout, pero sobre un elemento absoluto de cien
 * píxeles que no reflota a nadie: es el caso que las guías permiten
 * explícitamente para superficies pequeñas y aisladas. Nunca `transition: all`.
 *
 * SOBRE LA ACCESIBILIDAD
 * Son `<button>` con `aria-pressed` dentro de un grupo, no un `radiogroup` de
 * Radix. Un grupo de botones conmutadores ya es un patrón correcto y no arrastra
 * dependencia; cambiarlo por un radio daría navegación con flechas, que aquí no
 * aporta —dos o tres opciones siempre visibles— y quitaría el `Tab` entre ellas.
 */

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface Segment<T extends string> {
  id: T;
  label: string;
  hint?: string;
  icon?: ReactNode;
}

interface SegmentedControlProps<T extends string> {
  options: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Nombre del grupo para lectores de pantalla. */
  label: string;
  /** `sm` para el cromo secundario, `md` para las decisiones principales. */
  size?: "sm" | "md";
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "sm",
}: SegmentedControlProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef(new Map<T, HTMLButtonElement>());
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  /**
   * Mide el botón activo.
   *
   * En un efecto de layout y no durante el render: leer geometría mientras se
   * renderiza obliga al navegador a resolver la maquetación a mitad de trabajo.
   */
  const measure = useCallback(() => {
    const container = containerRef.current;
    const button = buttonsRef.current.get(value);
    if (!container || !button) return;
    setPill({ left: button.offsetLeft, width: button.offsetWidth });
  }, [value]);

  useLayoutEffect(() => {
    measure();

    // Las etiquetas cambian de ancho al cambiar la tipografía o el idioma, y el
    // contenedor cambia con el viewport. Sin observarlo, el indicador se queda
    // donde estaba y vuelve a desalinearse.
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    observer.observe(container);
    for (const button of buttonsRef.current.values()) observer.observe(button);
    return () => observer.disconnect();
  }, [measure, options.length]);

  // `px-3` y no `px-4`: con seis capas el selector medía 468 px y no cabía entre
  // la columna oeste del mapa y el inspector. Doce píxeles por lado siguen
  // dejando un objetivo de pulsación holgado con la altura de 32 px.
  const alto = size === "md" ? "h-9" : "h-8";
  const texto = size === "md" ? "text-[13px]" : "text-[11px]";

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={label}
      className={`floating relative inline-flex ${alto} items-stretch rounded-full p-1`}
    >
      {/* El indicador. Oculto hasta la primera medida: sin eso aparece en la
          esquina izquierda y salta a su sitio en el primer fotograma. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-1 left-0 rounded-full bg-ink transition-[transform,width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{
          width: pill ? `${pill.width}px` : 0,
          transform: `translateX(${pill?.left ?? 0}px)`,
          opacity: pill ? 1 : 0,
        }}
      />

      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            ref={(node) => {
              if (node) buttonsRef.current.set(option.id, node);
              else buttonsRef.current.delete(option.id);
            }}
            type="button"
            title={option.hint}
            aria-pressed={active}
            onClick={() => onChange(option.id)}
            className={`relative z-10 inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 font-medium transition-colors ${texto} ${
              active ? "text-canvas" : "text-muted hover:text-ink"
            }`}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
