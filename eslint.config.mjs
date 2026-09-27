import { defineConfig } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "load-test.js",
    ],
  },
  {
    rules: {
      // Aturan gaya, bukan bug. Migrasi codebase ini bertahap — biarkan
      // lewat dulu, sisipkan `any` yang disengaja untuk select Supabase/RPC.
      "@typescript-eslint/no-explicit-any": "warn",

      // Aturan ini baru masuk di eslint-config-next 16 dan memang
      // ditujukan untuk React Compiler, bukan untuk kode yang belum
      // dimigrasi. Menandainya error akan memblokir CI tanpa benefit.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
    },
  },
]);
