/**
 * Errores de la API, traducidos a algo que la interfaz pueda mostrar.
 *
 * FastAPI devuelve `{"detail": ...}`, donde `detail` es un string en los 404 y
 * 409, pero una lista de objetos en los 422 de validacion de Pydantic. Aqui se
 * normaliza a un mensaje legible para no repetir ese `if` en cada componente.
 */

/** Codigos que la API usa deliberadamente. Ver docs/api.md. */
export type ApiErrorKind =
  | "not_found" // 404: el recurso no existe
  | "conflict" // 409: peticion valida pero incoherente con el estado
  | "validation" // 422: schema rechazado
  | "server" // 5xx
  | "network"; // no hubo respuesta

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;

  constructor(kind: ApiErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }

  /** Mensaje orientado a la persona que está mirando la pantalla. */
  get userMessage(): string {
    switch (this.kind) {
      case "network":
        return "No se pudo contactar con la API de CERES. ¿Está FastAPI levantado?";
      case "not_found":
        return "El recurso solicitado no existe.";
      case "conflict":
        return this.message;
      case "validation":
        return `La petición fue rechazada: ${this.message}`;
      case "server":
        return "La API respondió con un error. Revisa sus logs.";
    }
  }
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "validation";
  return "server";
}

/** Extrae un mensaje legible del cuerpo de error de FastAPI. */
function messageFromBody(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;

    if (typeof detail === "string") return detail;

    // 422 de Pydantic: [{loc: ["body","severity"], msg: "..."}]
    if (Array.isArray(detail)) {
      return detail
        .map((item) => {
          if (typeof item !== "object" || item === null) return String(item);
          const entry = item as { loc?: unknown[]; msg?: string };
          const field = Array.isArray(entry.loc) ? entry.loc.slice(1).join(".") : "";
          return field ? `${field}: ${entry.msg ?? ""}` : (entry.msg ?? "");
        })
        .filter(Boolean)
        .join("; ");
    }
  }
  return `HTTP ${status}`;
}

export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Cuerpo vacío o no-JSON: nos quedamos con el código de estado.
  }
  return new ApiError(
    kindForStatus(response.status),
    messageFromBody(body, response.status),
    response.status,
  );
}
