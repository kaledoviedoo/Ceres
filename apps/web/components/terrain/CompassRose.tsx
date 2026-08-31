"use client";

/**
 * Rosa de los vientos y controles de cámara.
 *
 * El compás no es adorno. Los datos de CERES están orientados —x crece hacia el
 * este, y hacia el norte— y las conclusiones dependen de esa orientación: "la
 * zona crítica está al noroeste" solo significa algo si sabes dónde está el
 * norte. Con una cámara que orbita libremente, esa referencia se pierde en dos
 * arrastres si nadie la mantiene.
 *
 * El disco gira imperativamente desde una referencia, no con estado de React:
 * orbitar dispara el cambio de ángulo continuamente y no debe repintar el árbol.
 * Es una única `transform`, propiedad de composición.
 */

import { useImperativeHandle, useRef, type RefObject } from "react";

export interface CompassHandle {
  /** Ángulo acimutal de la cámara, en radianes. */
  setAzimuth: (radians: number) => void;
}

interface CompassRoseProps {
  handle: RefObject<CompassHandle | null>;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

export function CompassRose({ handle, onZoomIn, onZoomOut, onReset }: CompassRoseProps) {
  const dialRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(handle, () => ({
    setAzimuth(radians) {
      const dial = dialRef.current;
      if (!dial) return;
      dial.style.transform = `rotate(${(radians * 180) / Math.PI}deg)`;
    },
  }));

  return (
    <div className="floating flex items-center gap-1 rounded-full p-1">
      <button
        type="button"
        onClick={onReset}
        aria-label="Restablecer la vista de la cámara"
        title="Restablecer la vista"
        className="group relative grid h-9 w-9 place-items-center rounded-full transition-colors hover:bg-soil-700"
      >
        {/* El disco gira; la aguja no. Así el norte siempre apunta al norte. */}
        <div ref={dialRef} className="absolute inset-1 transition-transform duration-75">
          <span className="absolute left-1/2 top-0 -translate-x-1/2 font-mono text-[8px] leading-none text-bone-100">
            N
          </span>
          <span className="absolute bottom-0 left-1/2 -translate-x-1/2 font-mono text-[8px] leading-none text-bone-600">
            S
          </span>
          <span className="absolute left-0 top-1/2 -translate-y-1/2 font-mono text-[8px] leading-none text-bone-600">
            O
          </span>
          <span className="absolute right-0 top-1/2 -translate-y-1/2 font-mono text-[8px] leading-none text-bone-600">
            E
          </span>
        </div>
        <span aria-hidden="true" className="h-1 w-1 rounded-full bg-bone-400" />
      </button>

      <div aria-hidden="true" className="h-5 w-px bg-soil-600" />

      <button
        type="button"
        onClick={onZoomOut}
        aria-label="Alejar la cámara"
        className="grid h-8 w-8 place-items-center rounded-full text-bone-400 transition-colors hover:bg-soil-700 hover:text-bone-100"
      >
        <span aria-hidden="true" className="text-base leading-none">
          −
        </span>
      </button>
      <button
        type="button"
        onClick={onZoomIn}
        aria-label="Acercar la cámara"
        className="grid h-8 w-8 place-items-center rounded-full text-bone-400 transition-colors hover:bg-soil-700 hover:text-bone-100"
      >
        <span aria-hidden="true" className="text-base leading-none">
          +
        </span>
      </button>
    </div>
  );
}
