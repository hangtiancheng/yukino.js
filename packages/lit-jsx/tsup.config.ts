import { defineConfig } from "tsup";
import { cpSync } from "node:fs";

// tsup runs array configs in parallel via Promise.all — a single config's
// onSuccess fires before other configs' DTS generation finishes.
// Defer the copy to process exit so all builds are fully complete.
(() => {
  process.on("exit", () => {
    cpSync("../../.agents/skills/yukino-lit-jsx", "skills/yukino-lit-jsx", {
      errorOnExist: false,
      force: true,
      recursive: true,
    });
  });
})();

export default defineConfig({
  entry: ["src/index.ts", "src/jsx-runtime.ts"],
  format: ["esm", "cjs"],
  dts: {
    // tsup's dts pipeline internally emits a deprecated baseUrl option,
    // which TypeScript 6 rejects unless explicitly silenced.
    compilerOptions: { ignoreDeprecations: "6.0" },
  },
  clean: true,
  sourcemap: false,
  minify: true,
  tsconfig: "tsconfig.json",
});
