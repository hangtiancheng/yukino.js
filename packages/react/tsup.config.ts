import { cpSync } from "fs";
import { defineConfig } from "tsup";

// tsup runs array configs in parallel via Promise.all — a single config's
// onSuccess fires before other configs' DTS generation finishes.
// Defer the copy to process exit so all builds are fully complete.
(() => {
  process.on("exit", () => {
    // copyFileSync("src/client.d.ts", "dist/client.d.ts");
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
    // Bundler integrations — splitting: false keeps each ESM output a single
    // self-contained file with no shared chunk extraction. shims: true
    // provides __filename in ESM output (ReactPlugin resolves the loader
    // path through it).
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
    // JSX automatic runtime — imported by compiled JSX modules
    // (jsxImportSource: "@yukino.js/react"). Pure VNode factories, kept tiny so
    // the runtime doesn't drag the whole framework into consumer chunks.
    entry: ["src/jsx-runtime.ts", "src/jsx-dev-runtime.ts"],
    dts: true,
    format: ["esm", "cjs"],
    minify: false,
    sourcemap: false,
    tsconfig: "./tsconfig.build.json",
  },
]);
