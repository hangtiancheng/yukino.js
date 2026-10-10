// @ts-check

import { rmSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import alias from "@rollup/plugin-alias";
import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";
import { dts } from "rollup-plugin-dts";

const srcDir = fileURLToPath(new URL("src", import.meta.url));
const distDir = fileURLToPath(new URL("dist", import.meta.url));
const srcSkill = fileURLToPath(
  new URL("../../.agents/skills/yukino-anti-copy", import.meta.url),
);
const destSkill = fileURLToPath(
  new URL("skills/yukino-anti-copy", import.meta.url),
);

function cleanThenInstall() {
  return {
    name: "clean-then-install",
    buildStart() {
      rmSync(distDir, { recursive: true, force: true });
    },
    buildEnd() {
      cpSync(srcSkill, destSkill, {
        recursive: true,
        force: true,
        errorOnExist: false,
      });
    },
  };
}

const input = {
  index: "src/index.ts",
};

const external = [/^react(\/|$)/, /^vue(\/|$)/];

export default [
  {
    input,
    external,
    plugins: [
      cleanThenInstall(),
      alias({
        entries: [{ find: "@", replacement: srcDir }],
      }),
      typescript({ tsconfig: "./tsconfig.build.json" }),
      terser({ compress: { drop_debugger: false } }),
    ],
    output: [
      {
        dir: "dist",
        format: "es",
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        sourcemap: false,
      },
      {
        dir: "dist",
        format: "cjs",
        entryFileNames: "[name].cjs",
        chunkFileNames: "chunks/[name]-[hash].cjs",
        exports: "named",
        sourcemap: false,
      },
    ],
  },
  {
    input,
    external,
    plugins: [dts({ tsconfig: "./tsconfig.build.json" })],
    output: {
      dir: "dist",
      format: "es",
      entryFileNames: "[name].d.ts",
      chunkFileNames: "chunks/[name]-[hash].d.ts",
    },
  },
];
