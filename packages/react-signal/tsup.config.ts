import { copyFileSync, cpSync } from "node:fs";
import { defineConfig } from "tsup";

(() => {
  process.on("exit", () => {
    copyFileSync("src/client.d.ts", "dist/client.d.ts");
    cpSync(
      "../../.agents/skills/yukino-react-signal",
      "skills/yukino-react-signal",
      {
        errorOnExist: false,
        force: true,
        recursive: true,
      },
    );
  });
})();

export default defineConfig([
  {
    entry: ["src/index.ts"],
    clean: true,
    dts: {
      resolve: ["@preact/signals-core"],
    },
    format: ["esm", "cjs"],
    minify: false,
    noExternal: [],
    sourcemap: false,
    tsconfig: "./tsconfig.build.json",
  },
  {
    entry: ["src/webpack.ts", "src/vite.ts"],
    dts: true,
    format: ["esm", "cjs"],
    minify: false,
    noExternal: [],
    shims: true,
    splitting: false,
    sourcemap: false,
    tsconfig: "./tsconfig.build.json",
  },
  {
    entry: ["src/jsx-runtime.ts", "src/jsx-dev-runtime.ts"],
    dts: true,
    format: ["esm", "cjs"],
    minify: false,
    noExternal: [],
    sourcemap: false,
    tsconfig: "./tsconfig.build.json",
  },
]);
