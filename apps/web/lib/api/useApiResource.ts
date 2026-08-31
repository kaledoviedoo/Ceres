"use client";

/**
 * Hook mínimo para pedir un recurso a la API.
 *
 * Existe para que loading, error y cancelación se escriban una vez y no en cada
 * componente. No es una caché ni un gestor de estado de servidor: si el
 * proyecto crece hasta necesitarlo, aquí es donde entraría TanStack Query. Para
 * cuatro peticiones, añadir esa dependencia sería más peso que ayuda.
 *
 * Cancela la petición anterior al cambiar de dependencia: sin eso, alternar
 * rápido entre lotes puede hacer que llegue antes la respuesta vieja que la
 * nueva y la pantalla acabe mostrando datos del lote equivocado.
 *
 * `isLoading` se DERIVA, no se guarda: es "lo que tengo no corresponde a lo que
 * quiero". Guardarlo obligaría a un `setState` síncrono dentro del efecto —que
 * encadena un render de más, y ESLint lo señala con razón— y además dejaba una
 * ventana en la que se devolvían los datos del recurso anterior como si fueran
 * los del nuevo.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ConfigurationError } from "@/lib/api/config";
import { ApiError } from "@/lib/api/errors";

/**
 * Traduce cualquier fallo a un mensaje para la pantalla.
 *
 * Un ConfigurationError no es un fallo de la API: es que la aplicación no sabe
 * a dónde llamar. Se muestra tal cual porque su texto ya explica qué falta.
 */
export function describeError(cause: unknown): string {
  if (cause instanceof ConfigurationError) return cause.message;
  if (cause instanceof ApiError) return cause.userMessage;
  return "Error inesperado";
}

export interface ApiResource<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  reload: () => void;
}

/** Lo que ya se resolvió, junto a la petición a la que corresponde. */
interface Settled<T> {
  key: string;
  data: T | null;
  error: string | null;
}

export function useApiResource<T>(
  fetcher: ((signal: AbortSignal) => Promise<T>) | null,
  deps: unknown[],
): ApiResource<T> {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Identidad de la petición en curso: cambia cuando cambian las dependencias
  // que declara quien llama, o cuando alguien pide recargar.
  const key = useMemo(() => JSON.stringify([deps, reloadToken]), [deps, reloadToken]);

  // El fetcher se recrea en cada render, así que no puede ser dependencia del
  // efecto sin dispararlo en bucle. Se guarda en una referencia, actualizada
  // desde un efecto y no durante el render —React lo prohíbe, y con razón: un
  // render puede descartarse—. Este efecto se declara ANTES que el de la
  // petición, y los efectos corren en orden de declaración, así que cuando el
  // segundo lee la referencia ya apunta al fetcher de este render.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    const current = fetcherRef.current;
    if (!current) return;

    const controller = new AbortController();
    let active = true;

    current(controller.signal)
      .then((data) => {
        if (active) setSettled({ key, data, error: null });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setSettled({ key, data: null, error: describeError(cause) });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [key]);

  const isActive = Boolean(fetcher);
  const isFresh = settled?.key === key;

  return {
    // Solo se devuelven datos que correspondan a la petición actual: los del
    // recurso anterior no se cuelan mientras carga el nuevo.
    data: isActive && isFresh ? (settled?.data ?? null) : null,
    isLoading: isActive && !isFresh,
    error: isActive && isFresh ? (settled?.error ?? null) : null,
    reload,
  };
}
