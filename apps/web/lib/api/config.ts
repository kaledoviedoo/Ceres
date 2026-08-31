/**
 * Resolución de la URL de la API.
 *
 * Antes esto tenía un `?? "http://localhost:8000"`. Parecía un valor por
 * defecto razonable y era una trampa: en la máquina de desarrollo el puerto
 * 8000 lo ocupa otra aplicación, así que un `.env.local` ausente no daba un
 * error de configuración sino una conversación silenciosa con el backend
 * equivocado. El síntoma eran 404 incomprensibles en pantalla.
 *
 * Un fallo de configuración tiene que sonar como un fallo de configuración.
 * Aquí no hay valor por defecto: si falta la variable o no es una URL http(s)
 * válida, se lanza un error que dice exactamente qué falta y cómo arreglarlo.
 *
 * La comprobación también corre en tiempo de build (`next.config.ts`), que es
 * cuando `NEXT_PUBLIC_*` se hornea en el bundle: fallar ahí evita desplegar un
 * frontend que apunta a ninguna parte.
 */

/** Falta configuración o es inválida. No es un fallo de red ni de la API. */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

const VARIABLE = "NEXT_PUBLIC_API_BASE_URL";

const HOW_TO_FIX = [
  `Define ${VARIABLE} en apps/web/.env.local y reconstruye.`,
  "  cp .env.local.example .env.local",
  "",
  "Es una variable de build: cambiarla exige `npm run build` de nuevo,",
  "no basta con reiniciar el servidor.",
].join("\n");

/**
 * Valida un valor y devuelve la base de la API, sin barra final.
 *
 * Se separa de `resolveApiBaseUrl` para poder probarla con entradas concretas:
 * con un parámetro por defecto, pasar `undefined` explícitamente activaba el
 * valor del entorno y el test no podía comprobar el caso "falta la variable".
 *
 * @throws ConfigurationError si el valor falta, está vacío o no es una URL
 *   http(s) válida.
 */
export function assertApiBaseUrl(raw: string | undefined): string {
  const value = raw?.trim();

  if (!value) {
    throw new ConfigurationError(
      `Falta ${VARIABLE}: CERES no sabe con qué API hablar.\n\n${HOW_TO_FIX}`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigurationError(
      `${VARIABLE} no es una URL válida (se recibió "${value}").\n\n${HOW_TO_FIX}`,
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConfigurationError(
      `${VARIABLE} debe usar http o https (se recibió "${parsed.protocol}//").\n\n${HOW_TO_FIX}`,
    );
  }

  return value.replace(/\/$/, "");
}


/**
 * Base de la API leída del entorno.
 *
 * @throws ConfigurationError si `NEXT_PUBLIC_API_BASE_URL` no está definida o
 *   no es válida.
 */
export function resolveApiBaseUrl(): string {
  return assertApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL);
}
