import { defineConfig } from "rolldown";
export default defineConfig({
  input: { index: "src/index.ts", cli: "src/cli.ts" },
  platform: "node",
  external: [/^node:/, /^@yukino\.js\//, "mime-types", "minimatch"],
  output: { dir: "dist", format: "esm", sourcemap: true, cleanDir: true },
});
