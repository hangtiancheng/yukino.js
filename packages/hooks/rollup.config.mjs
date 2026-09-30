import { defineConfig } from "rollup";
import typescript from "@rollup/plugin-typescript";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import dts from "rollup-plugin-dts";

const external = [
  "react",
  "react-dom",
  "react-router",
  "react-router-dom",
  "query-string",
];

export default defineConfig([
  // ESM output
  {
    input: "src/index.ts",
    output: {
      dir: "dist",
      format: "esm",
      preserveModules: true,
      preserveModulesRoot: "src",
      entryFileNames: "[name].mjs",
    },
    plugins: [
      resolve(),
      commonjs(),
      typescript({
        tsconfig: "./tsconfig.json",
        declaration: false,
        outDir: "dist",
      }),
    ],
    external,
  },
  // CJS output
  {
    input: "src/index.ts",
    output: {
      dir: "dist",
      format: "cjs",
      preserveModules: true,
      preserveModulesRoot: "src",
      entryFileNames: "[name].cjs",
      exports: "named",
    },
    plugins: [
      resolve(),
      commonjs(),
      typescript({
        tsconfig: "./tsconfig.json",
        declaration: false,
        outDir: "dist",
      }),
    ],
    external,
  },
  // Type declarations
  {
    input: "src/index.ts",
    output: {
      file: "dist/index.d.ts",
      format: "esm",
    },
    plugins: [dts()],
  },
]);
