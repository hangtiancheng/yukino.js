import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The transformer (oxc) reads compiler options — decorators, JSX,
// jsxImportSource — straight from tsconfig.json; only module resolution
// needs help here: vite does not apply tsconfig "paths", so the package
// self-reference used by the JSX runtime is mapped back to src via aliases.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // longest keys first: vite alias matching is prefix-based
      "@yukino.js/lit-jsx/jsx-dev-runtime": src("./src/jsx-runtime.ts"),
      "@yukino.js/lit-jsx/jsx-runtime": src("./src/jsx-runtime.ts"),
      "@yukino.js/lit-jsx": src("./src/index.ts"),
      "@": src("./src"),
    },
  },
});
