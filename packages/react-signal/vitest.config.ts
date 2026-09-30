import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "@yukino.js/react-signal",
  },
  resolve: {
    alias: {
      "@yukino.js/react-signal/jsx-dev-runtime": fileURLToPath(
        new URL("./src/jsx-dev-runtime.ts", import.meta.url),
      ),
      "@yukino.js/react-signal/jsx-runtime": fileURLToPath(
        new URL("./src/jsx-runtime.ts", import.meta.url),
      ),
      "@yukino.js/react-signal": fileURLToPath(
        new URL("./src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
