import { cpSync } from "fs";
import { defineConfig } from "tsup";

(() => {
  process.on("exit", () => {
    cpSync("../../.agents/skills/yukino-react", "skills/yukino-react", {
      errorOnExist: false,
      force: true,
      recursive: true,
    });
  });
})();

export default defineConfig([
  {
    entry: ["src/index.ts"],
    clean: true,
    dts: true,
    format: ["esm", "cjs"],
    minify: false,
    sourcemap: false,
    tsconfig: "./tsconfig.build.json",
  },
  {
    entry: ["src/vite.ts", "src/webpack.ts"],
    dts: true,
    format: ["esm", "cjs"],
    minify: false,
    splitting: false,
    shims: true,
    sourcemap: false,
    tsconfig: "./tsconfig.build.json",
  },
  {
    entry: ["src/jsx-runtime.ts", "src/jsx-dev-runtime.ts"],
    dts: true,
    format: ["esm", "cjs"],
    minify: false,
    sourcemap: false,
    tsconfig: "./tsconfig.build.json",
  },
]);
