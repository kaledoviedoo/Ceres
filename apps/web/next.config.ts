import type { NextConfig } from "next";

import { resolveApiBaseUrl } from "./lib/api/config";

/**
 * CERES - frontend del Digital Twin agricola.
 *
 * El frontend NO calcula agricultura. Toda formula vive en FastAPI; aqui solo
 * se representan valores. Ver docs/architecture.md.
 */

// NEXT_PUBLIC_API_BASE_URL se hornea en el bundle durante el build, asi que es
// aqui donde hay que comprobarla: construir un frontend que apunta a ninguna
// parte y descubrirlo en produccion sale mucho mas caro que fallar ahora.
resolveApiBaseUrl();

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
