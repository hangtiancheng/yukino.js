import { defineConfig } from "rollup";
import typescript from "@rollup/plugin-typescript";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import copy from "rollup-plugin-copy";
import dts from "rollup-plugin-dts";

const external = [
  "@grpc/grpc-js",
  "@grpc/proto-loader",
  "etcd3",
  /^node:/,
  "fs",
  "path",
  "url",
  "os",
  "buffer",
  "crypto",
  "events",
  "stream",
  "util",
];

export default defineConfig([
  {
    input: "src/index.ts",
    output: {
      dir: "dist",
      format: "esm",
      preserveModules: true,
      preserveModulesRoot: "src",
      entryFileNames: "[name].mjs",
      chunkFileNames: "[name]-[hash].mjs",
      sourcemap: false,
      generatedCode: { constBindings: true },
    },
    external,
    plugins: [
      resolve({ preferBuiltins: true }),
      commonjs(),
      typescript({
        tsconfig: "./tsconfig.build.json",
        sourceMap: false,
        inlineSources: false,
      }),
      copy({
        targets: [
          { src: "src/proto/*.proto", dest: "dist/proto" },
          {
            src: "../../.agents/skills/yukino-cache",
            dest: "skills/",
          },
        ],
      }),
    ],
  },
  {
    input: "src/index.ts",
    output: {
      file: "dist/index.d.ts",
      format: "esm",
    },
    plugins: [
      dts({
        tsconfig: "./tsconfig.build.json",
      }),
    ],
  },
]);
