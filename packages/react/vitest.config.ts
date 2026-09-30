import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "@yukino.js/react",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@yukino.js/react/jsx-dev-runtime": fileURLToPath(
        new URL("./src/jsx-dev-runtime.ts", import.meta.url),
      ),
      "@yukino.js/react/jsx-runtime": fileURLToPath(
        new URL("./src/jsx-runtime.ts", import.meta.url),
      ),
      "@yukino.js/react/vite": fileURLToPath(
        new URL("./src/vite.ts", import.meta.url),
      ),
      "@yukino.js/react/webpack": fileURLToPath(
        new URL("./src/webpack.ts", import.meta.url),
      ),
      "@yukino.js/react": fileURLToPath(
        new URL("./src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
