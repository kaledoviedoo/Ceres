import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": resolve(__dirname, ".") },
  },
  test: {
    // Sin esto, el cliente lanzaria ConfigurationError en cada test. Se fija
    // aqui y no en un .env para que los tests no dependan de la maquina.
    env: { NEXT_PUBLIC_API_BASE_URL: "http://localhost:8010" },
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
