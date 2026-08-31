import type { NextConfig } from "next";

/**
 * CERES - frontend del Digital Twin agricola.
 *
 * El frontend NO calcula agricultura. Toda formula vive en FastAPI; aqui solo
 * se representan valores. Ver docs/architecture.md.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
