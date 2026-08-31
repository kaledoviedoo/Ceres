/**
 * Cliente HTTP de la API de CERES.
 *
 * Un solo sitio donde se construye una URL y se interpreta una respuesta. Los
 * componentes no llaman a `fetch` nunca.
 *
 * No maneja credenciales: el frontend habla con FastAPI y solo con FastAPI.
 * Nunca con Supabase directamente, asi que no necesita ninguna clave.
 */

import { ApiError, apiErrorFromResponse } from "@/lib/api/errors";

/**
 * Base de la API. `NEXT_PUBLIC_` llega al navegador, asi que aqui no puede
 * viajar nada secreto: es solo una URL.
 */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

type QueryValue = string | number | boolean | undefined | null;

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${API_BASE_URL}${path}`);
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

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
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
