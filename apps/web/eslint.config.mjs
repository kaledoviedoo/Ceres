import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

/**
 * ESLint para CERES web.
 *
 * Sustituye a `next lint`, que Next 16 elimino: el script anterior fallaba con
 * "no such directory: .../lint" porque interpretaba "lint" como una ruta. El
 * resultado era un proyecto sin linter, donde un `eslint-disable` no lo leia
 * nadie.
 *
 * `eslint-config-next` 16 ya publica config plana nativa, asi que no hace falta
 * FlatCompat.
 */
export default tseslint.config(
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
  },

  ...nextCoreWebVitals,
  ...nextTypescript,
  ...tseslint.configs.recommended,

  {
    rules: {
      // El proyecto ya usa `import type` en todas partes; que sea obligatorio
      // evita que un tipo acabe arrastrando codigo al bundle del navegador.
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      // Los `_` iniciales marcan a proposito lo que no se usa.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // `any` desactiva justo lo que hace util tener los tipos espejados de
      // los schemas de FastAPI.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },

  {
    // Los tests montan dobles de `fetch` y hacen aserciones sobre estructuras
    // que TypeScript no puede estrechar; ahi los casts son legitimos.
    files: ["tests/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
