/**
 * Resolución de la URL de la API.
 *
 * Antes había un `?? "http://localhost:8000"`. En la máquina de desarrollo ese
 * puerto lo ocupa otra aplicación, así que un `.env.local` ausente no daba un
 * error de configuración: daba una conversación silenciosa con el backend
 * equivocado. Estos tests fijan que eso ya no puede pasar.
 */

import { describe, expect, it } from "vitest";

import { ConfigurationError, assertApiBaseUrl, resolveApiBaseUrl } from "@/lib/api/config";

describe("assertApiBaseUrl", () => {
  it("acepta una URL válida", () => {
    expect(assertApiBaseUrl("http://localhost:8010")).toBe("http://localhost:8010");
    expect(assertApiBaseUrl("https://api.ceres.example")).toBe("https://api.ceres.example");
  });

  it("quita la barra final para no generar rutas con doble barra", () => {
    expect(assertApiBaseUrl("http://localhost:8010/")).toBe("http://localhost:8010");
  });

  it("NO cae a ningún valor por defecto cuando falta la variable", () => {
    expect(() => assertApiBaseUrl(undefined)).toThrow(ConfigurationError);
    expect(() => assertApiBaseUrl("")).toThrow(ConfigurationError);
    expect(() => assertApiBaseUrl("   ")).toThrow(ConfigurationError);
  });

  it("nunca resuelve al puerto 8000, que en esta máquina es otra aplicación", () => {
    // La regresión concreta que motivó el cambio.
    for (const entrada of [undefined, "", "   "]) {
      let mensaje = "";
      try {
        assertApiBaseUrl(entrada);
      } catch (error) {
        mensaje = (error as Error).message;
      }
      expect(mensaje).not.toContain("8000");
    }
  });

  it("el mensaje dice qué falta y cómo arreglarlo", () => {
    try {
      assertApiBaseUrl(undefined);
      expect.unreachable("debería haber lanzado");
    } catch (error) {
      const mensaje = (error as Error).message;
      expect(mensaje).toContain("NEXT_PUBLIC_API_BASE_URL");
      expect(mensaje).toContain(".env.local");
      expect(mensaje).toContain("build");
    }
  });

  it("rechaza lo que no es una URL", () => {
    expect(() => assertApiBaseUrl("localhost:8010")).toThrow(ConfigurationError);
    expect(() => assertApiBaseUrl("no-es-una-url")).toThrow(ConfigurationError);
  });

  it("rechaza protocolos que no son http o https", () => {
    expect(() => assertApiBaseUrl("ftp://localhost:8010")).toThrow(ConfigurationError);
    expect(() => assertApiBaseUrl("file:///tmp/api")).toThrow(ConfigurationError);
  });
});

describe("resolveApiBaseUrl", () => {
  it("lee la variable del entorno", () => {
    // vitest.config.ts la fija en :8010, el puerto real de CERES.
    expect(resolveApiBaseUrl()).toBe("http://localhost:8010");
  });
});
