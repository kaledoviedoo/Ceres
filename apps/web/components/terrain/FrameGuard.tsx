"use client";

/**
 * Garantiza que la escena se dibuje cuando se puede ver.
 *
 * EL FALLO QUE ESTO ARREGLA
 * `frameloop="demand"` hace que R3F dibuje dentro de `requestAnimationFrame`, y
 * los navegadores NO ejecutan rAF en pestañas ocultas ni en ventanas
 * minimizadas. Si la página carga en segundo plano —una pestaña abierta de
 * fondo, la ventana minimizada mientras arranca el servidor, un cambio de
 * escritorio— el primer fotograma no llega a dibujarse nunca. Y al volver a la
 * pestaña no hay nada que pida un redibujado: la escena se queda NEGRA hasta
 * que el usuario mueve el ratón por encima.
 *
 * No es un caso raro: es lo que pasa siempre que alguien abre la aplicación en
 * una pestaña que no está mirando.
 *
 * LA SOLUCION
 * Pedir un fotograma en cada momento en que la escena pasa a ser visible o el
 * navegador vuelve a atender a esta ventana. No es un bucle: son escuchadores de
 * eventos que llaman a `invalidate()` una vez. La escena sigue dibujándose bajo
 * demanda y sigue sin consumir nada cuando nadie toca nada.
 */

import { useThree } from "@react-three/fiber";
import { useEffect } from "react";

export function FrameGuard() {
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    // Un fotograma en el montaje, por si el primero de R3F cayó en un rAF que
    // el navegador nunca ejecutó.
    invalidate();

    const draw = () => {
      if (document.visibilityState === "visible") invalidate();
    };

    document.addEventListener("visibilitychange", draw);
    window.addEventListener("focus", draw);
    window.addEventListener("pageshow", draw);
    window.addEventListener("resize", draw);

    return () => {
      document.removeEventListener("visibilitychange", draw);
      window.removeEventListener("focus", draw);
      window.removeEventListener("pageshow", draw);
      window.removeEventListener("resize", draw);
    };
  }, [invalidate]);

  return null;
}
