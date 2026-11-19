import { defineConfig } from "rolldown";
export default defineConfig({
  input: "src/index.ts",
  platform: "node",
  external: [/^node:/, /^@yukino\.js\//, "mime-types", "minimatch"],
  output: { dir: "dist", format: "esm", sourcemap: true, cleanDir: true },
});
