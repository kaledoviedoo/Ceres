"use client";

/**
 * Iluminación de la escena: luz de campo, no de estudio.
 *
 * Una sola direccional proyecta sombras. Eso es lo que hace legible el relieve:
 * sin sombras, una superficie ondulada vista desde arriba se ve plana y el
 * terreno deja de comunicar nada.
 *
 * El sol viene del noroeste y bajo, como a media tarde. Un ángulo rasante alarga
 * las sombras, exagera las diferencias de altura —que con 3 metros de desnivel
 * real es exactamente lo que hace falta— y, sobre todo, es lo que hace que los
 * surcos del cultivo se vean: un relieve de milímetros solo existe si algo lo
 * ilumina de lado.
 *
 * El cielo aporta el relleno frío por arriba y la tierra un rebote cálido por
 * abajo, que es como se ve un campo real a esa hora. Nada de luces saturadas: la
 * única saturación de la pantalla es la rampa de riesgo, y una luz teñida
 * contaminaría los tonos que el agrónomo tiene que distinguir.
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
  const shadowExtent = extent * 0.75;

  const lightRef = useMemo(() => ({ current: null as DirectionalLight | null }), []);

  return (
    <>
      {/* Relleno general muy tenue: la sombra tiene que ser sombra, no un agujero. */}
      <ambientLight intensity={0.34} color="#8fa3b0" />

      {/* Cielo arriba, rebote de tierra abajo: da volumen sin una segunda sombra. */}
      <hemisphereLight args={["#c2d6e6", "#3a2c1a", 0.5]} />

      <directionalLight
        ref={lightRef}
        // Bajo y lateral: es el ángulo que revela los surcos.
        position={[-extent * 0.75, extent * 0.62, extent * 0.5]}
        intensity={2.4}
        color="#ffeeca"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-shadowExtent}
        shadow-camera-right={shadowExtent}
        shadow-camera-top={shadowExtent}
        shadow-camera-bottom={-shadowExtent}
        shadow-camera-near={0.5}
        shadow-camera-far={extent * 3}
        // Sin sesgo, una superficie con relieve produce bandas de sombra sobre
        // sí misma.
        shadow-bias={-0.0012}
        shadow-normalBias={0.03}
      />

      {/* Contraluz muy débil desde el sureste: despega el borde del lote del
          fondo negro cuando la cámara mira a contraluz. */}
      <directionalLight position={[extent * 0.6, extent * 0.25, -extent * 0.7]} intensity={0.35} color="#8fa8bd" />
    </>
  );
}
