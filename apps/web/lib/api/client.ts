/**
 * Cliente HTTP de la API de CERES.
 *
 * Un solo sitio donde se construye una URL y se interpreta una respuesta. Los
 * componentes no llaman a `fetch` nunca.
 *
 * No maneja credenciales: el frontend habla con FastAPI y solo con FastAPI.
 * Nunca con Supabase directamente, asi que no necesita ninguna clave.
 */

import { resolveApiBaseUrl } from "@/lib/api/config";
import { ApiError, apiErrorFromResponse } from "@/lib/api/errors";

/**
 * Base de la API. `NEXT_PUBLIC_` llega al navegador, asi que aqui no puede
 * viajar nada secreto: es solo una URL.
 *
 * Se resuelve en la primera peticion y no al cargar el modulo: lanzar durante
 * la importacion romperia el prerender de Next antes de que nadie pueda ver el
 * mensaje. Asi el error viaja por el mismo camino que cualquier otro y la
 * interfaz lo muestra.
 */
export function apiBaseUrl(): string {
  return resolveApiBaseUrl();
}

type QueryValue = string | number | boolean | undefined | null;

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${apiBaseUrl()}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function request<T>(
  path: string,
  options: { method?: string; query?: Record<string, QueryValue>; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const { method = "GET", query, body, signal } = options;

  // Fuera del try a proposito: si falta la configuracion, `buildUrl` lanza un
  // ConfigurationError y meterlo dentro lo disfrazaria de fallo de red, que es
  // exactamente la confusion que este cambio viene a eliminar.
  const url = buildUrl(path, query);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    // Un AbortError no es un fallo de red: es una petición que ya no interesa.
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError("network", "No hubo respuesta de la API");
  }

  if (!response.ok) throw await apiErrorFromResponse(response);

  return (await response.json()) as T;
}

export const apiClient = {
  get: <T>(path: string, query?: Record<string, QueryValue>, signal?: AbortSignal) =>
    request<T>(path, { query, signal }),

  post: <T>(path: string, body: unknown, signal?: AbortSignal) =>
    request<T>(path, { method: "POST", body, signal }),
};
