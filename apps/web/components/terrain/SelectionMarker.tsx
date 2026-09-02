"use client";

/**
 * Marcador de la celda seleccionada: un jalón con su lectura clavada encima.
 *
 * El vástago no es decorativo. Con la cámara orbitando, un resaltado plano sobre
 * la superficie desaparece en cuanto la celda queda detrás de un lomo del
 * terreno o el ángulo se vuelve rasante. Un elemento vertical sobresale del
 * relieve y sigue diciendo "esta es" desde cualquier posición. Es lo mismo que
 * hacen los jalones de un topógrafo, y por la misma razón.
 *
 * NO LLEVA ETIQUETA. La llevó, y era información repetida: la leader line ya
 * une esta celda con su ficha, y la ficha dice el código, el rendimiento y el
 * nivel con mucho más contexto del que cabe en una pastilla. Además, sobre una
 * celda del borde norte la etiqueta se salía del encuadre.
 *
 * Lo que queda es lo que solo puede hacerse aquí: marcar un punto del espacio.
 *
 * El punto de anclaje llega ya calculado desde la escena. El marcador no sabe
 * cómo se construye el relieve, solo dónde apoyarse.
 */

import { Color } from "three";


const SIGNAL = new Color("#f2efe8");

/**
 * Alto del jalón sobre el terreno, en unidades de mundo.
 *
 * Lo justo para despegarse del relieve y verse desde cualquier ángulo. Con el
 * encuadre cerrado, un vástago más alto empuja la etiqueta fuera del viewport
 * cuando la celda elegida está cerca del borde norte —que es justo donde vive la
 * zona crítica del dataset—.
 */
const STEM_HEIGHT = 1.7;

interface SelectionMarkerProps {
  /** Punto de la superficie donde se apoya, en coordenadas de mundo. */
  anchor: [number, number, number];
}

export function SelectionMarker({ anchor }: SelectionMarkerProps) {
  const [x, y, z] = anchor;
  const tip: [number, number, number] = [x, y + STEM_HEIGHT, z];

  return (
    <group>
      {/* Vástago. Fino para no tapar la celda que señala. */}
      <mesh position={[x, y + STEM_HEIGHT / 2, z]}>
        <cylinderGeometry args={[0.028, 0.028, STEM_HEIGHT, 8]} />
        <meshBasicMaterial color={SIGNAL} toneMapped={false} />
      </mesh>

      {/* Remate. Da un punto de fijación claro a la vista. */}
      <mesh position={tip}>
        <sphereGeometry args={[0.1, 16, 12]} />
        <meshBasicMaterial color={SIGNAL} toneMapped={false} />
      </mesh>

      {/* Anillo apoyado en la superficie: ancla el jalón a su celda cuando la
          cámara está alta y el vástago se ve escorzado. */}
      <mesh position={[x, y + 0.05, z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.38, 0.46, 40]} />
        <meshBasicMaterial color={SIGNAL} toneMapped={false} transparent opacity={0.85} />
      </mesh>

    </group>
  );
}
