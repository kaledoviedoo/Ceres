"use client";

/**
 * Cámara orbital sobre el terreno.
 *
 * Los límites no son arbitrarios: impiden meterse bajo el suelo (`maxPolarAngle`)
 * y perder el lote de vista (`min/maxDistance`). Una cámara sin restricciones en
 * una herramienta de análisis es una forma rápida de desorientar a quien la usa.
 *
 * El amortiguado se apaga con `prefers-reduced-motion`: el movimiento por
 * inercia después de soltar el ratón es exactamente el tipo de movimiento no
 * esencial que hay que respetar. El control sigue funcionando igual, solo deja
 * de deslizarse.
 */

import { OrbitControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useImperativeHandle, useRef, type RefObject } from "react";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

export interface CameraHandle {
  reset: () => void;
  zoom: (factor: number) => void;
  /** Ángulo horizontal en radianes. Alimenta la rosa de los vientos. */
  azimuth: () => number;
}

interface CameraRigProps {
  extent: number;
  handle: RefObject<CameraHandle | null>;
  /** Se llama al orbitar, para que el compás siga a la cámara. */
  onMove: () => void;
  reducedMotion: boolean;
}

export function CameraRig({ extent, handle, onMove, reducedMotion }: CameraRigProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const invalidate = useThree((state) => state.invalidate);

  useImperativeHandle(handle, () => ({
    reset: () => {
      controlsRef.current?.reset();
      invalidate();
    },
    zoom: (factor: number) => {
      const controls = controlsRef.current;
      if (!controls) return;
      // Se mueve la cámara sobre la línea que la une al objetivo: mantiene el
      // encuadre centrado en el lote en vez de derivar hacia un lado.
      const camera = controls.object;
      const target = controls.target;
      camera.position.sub(target).multiplyScalar(factor).add(target);
      const distance = camera.position.distanceTo(target);
      const clamped = Math.min(controls.maxDistance, Math.max(controls.minDistance, distance));
      camera.position.sub(target).setLength(clamped).add(target);
      controls.update();
      invalidate();
    },
    azimuth: () => controlsRef.current?.getAzimuthalAngle() ?? 0,
  }));

  // El compás necesita el ángulo inicial antes de que nadie toque la cámara.
  useEffect(() => {
    onMove();
  }, [onMove]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping={!reducedMotion}
      dampingFactor={0.08}
      // Sin desplazamiento lateral: el objeto de análisis es el lote y sacarlo
      // del encuadre no aporta nada. Rotar y acercarse, sí.
      enablePan={false}
      // Ajustados al encuadre cerrado: alejarse mas de esto devuelve el lote
      // al vacio negro que el reencuadre vino a eliminar.
      minDistance={extent * 0.42}
      maxDistance={extent * 2}
      // Nunca por debajo del horizonte: no hay nada que ver bajo la parcela.
      maxPolarAngle={Math.PI * 0.46}
      minPolarAngle={Math.PI * 0.08}
      onChange={onMove}
    />
  );
}
