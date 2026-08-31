"use client";

/**
 * Iluminación de la escena.
 *
 * Una sola luz direccional proyecta sombras. Eso es lo que hace legible el
 * relieve: sin sombras, cuatrocientos bloques de distinta altura vistos desde
 * arriba se ven planos y el terreno deja de comunicar nada.
 *
 * El sol viene del noroeste y bajo, como a media tarde: un ángulo rasante
 * alarga las sombras y exagera las diferencias de altura, que con 3 metros de
 * desnivel real es exactamente lo que hace falta.
 *
 * El resto es relleno frío muy tenue para que las caras en sombra no se hundan
 * en negro puro. Nada de luces de colores: la única saturación de la pantalla
 * es la rampa de riesgo, y una luz teñida contaminaría los tonos que el
 * agrónomo tiene que distinguir.
 */

import { useMemo } from "react";
import type { DirectionalLight } from "three";

interface TerrainLightingProps {
  /** Lado del lote en unidades de mundo: dimensiona la cámara de sombras. */
  extent: number;
}

export function TerrainLighting({ extent }: TerrainLightingProps) {
  // El volumen de sombra se ajusta al lote. Más grande desperdicia resolución
  // del mapa de sombras; más pequeño recorta las sombras por los bordes.
  const shadowExtent = extent * 0.8;

  const lightRef = useMemo(() => ({ current: null as DirectionalLight | null }), []);

  return (
    <>
      {/* Relleno general, apenas azulado, para que la sombra no sea un agujero. */}
      <ambientLight intensity={0.35} color="#8fa3b0" />

      {/* Cielo arriba, rebote de tierra abajo: da volumen sin una segunda sombra. */}
      <hemisphereLight args={["#cfd8dc", "#2a2118", 0.45]} />

      <directionalLight
        ref={lightRef}
        position={[-extent * 0.7, extent * 0.9, extent * 0.55]}
        intensity={2.1}
        color="#fff4e0"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-shadowExtent}
        shadow-camera-right={shadowExtent}
        shadow-camera-top={shadowExtent}
        shadow-camera-bottom={-shadowExtent}
        shadow-camera-near={0.5}
        shadow-camera-far={extent * 3}
        // Sin sesgo, cuatrocientos bloques producen bandas de sombra sobre sus
        // propias caras superiores.
        shadow-bias={-0.0015}
        shadow-normalBias={0.02}
      />
    </>
  );
}
