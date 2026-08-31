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
 */

import { useCallback, useEffect, useState } from "react";

import { ApiError } from "@/lib/api/errors";

export interface ApiResource<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  reload: () => void;
}

export function useApiResource<T>(
  fetcher: ((signal: AbortSignal) => Promise<T>) | null,
  deps: unknown[],
): ApiResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    if (!fetcher) {
      setData(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    let active = true;

    setIsLoading(true);
    setError(null);

    fetcher(controller.signal)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof ApiError ? cause.userMessage : "Error inesperado");
        setData(null);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
    // `fetcher` se reconstruye en cada render; las dependencias reales son las
    // que declara quien llama.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadToken]);

  return { data, isLoading, error, reload };
}
