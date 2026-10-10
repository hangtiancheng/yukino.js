import { defineConfig } from "tsup";
import { cpSync } from "node:fs";

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
    compilerOptions: { ignoreDeprecations: "6.0" },
  },
  clean: true,
  sourcemap: false,
  minify: true,
  tsconfig: "tsconfig.json",
});
