import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "rollup";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import dts from "rollup-plugin-dts";

const distDir = fileURLToPath(new URL("dist", import.meta.url));
const external = [];

function cleanDist() {
  return {
    name: "clean-dist",
    buildStart() {
      rmSync(distDir, { recursive: true, force: true });
    },
  };
}

const minify = () =>
  terser({
    compress: { passes: 2 },
    mangle: true,
    format: { comments: false },
  });

export default defineConfig([
  {
    input: "src/index.ts",
    external,
    plugins: [
      cleanDist(),
      typescript({ tsconfig: "./tsconfig.build.json" }),
      minify(),
    ],
    output: [
      {
        file: "dist/index.js",
        format: "es",
        sourcemap: false,
      },
      {
        file: "dist/index.cjs",
        format: "cjs",
        exports: "named",
        sourcemap: false,
      },
    ],
  },
  {
    input: "src/index.ts",
    external,
    plugins: [dts({ tsconfig: "./tsconfig.build.json" })],
    output: {
      file: "dist/index.d.ts",
      format: "es",
    },
  },
]);
