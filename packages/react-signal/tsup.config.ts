import { copyFileSync, cpSync } from "node:fs";
import { defineConfig } from "tsup";

// tsup runs array configs in parallel via Promise.all — a single config's
// onSuccess fires before other configs' DTS generation finishes.
// Defer the copy to process exit so all builds are fully complete.
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
      // Inline only signals-core types; keep `preact` as an external import —
      // dts flatteners mangle its namespace-heavy JSX types (see dom-types.ts).
      resolve: ["@preact/signals-core"],
    },
    format: ["esm", "cjs"],
    minify: false,
    noExternal: [],
    sourcemap: false,
    tsconfig: "./tsconfig.build.json",
  },
  {
    // Webpack / Vite plugin entries — each needs __filename shim to
    // resolve to its own file (not a shared chunk) for the YukinoReactSignalPlugin to
    // locate the loader at runtime. splitting: false ensures each ESM entry
    // is a single self-contained file with no shared chunk extraction.
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
    // JSX automatic runtime — imported by compiled JSX modules
    // (jsxImportSource: "@yukino.js/react-signal"). Pure VNode factories with zero
    // framework imports, kept tiny so the runtime doesn't drag the whole
    // framework into consumer chunks.
    entry: ["src/jsx-runtime.ts", "src/jsx-dev-runtime.ts"],
    dts: true,
    format: ["esm", "cjs"],
    minify: false,
    noExternal: [],
    sourcemap: false,
    tsconfig: "./tsconfig.build.json",
  },
]);
