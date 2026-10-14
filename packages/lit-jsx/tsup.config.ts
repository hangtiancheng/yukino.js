import { defineConfig, type Options } from "tsup";
import { cpSync, readFileSync } from "node:fs";
import nodePath from "node:path";

type EsbuildPlugin = NonNullable<Options["esbuildPlugins"]>[number];

const RAW_QUERY = "?raw";

/**
 * Vite-style `?raw` imports for esbuild/tsup:
 * `import text from "./file.svg?raw"` becomes a module whose default export
 * is the file contents as a string. Only relative/absolute specifiers are
 * supported (bare package specifiers with `?raw` are rejected explicitly).
 */
const rawImportPlugin: EsbuildPlugin = {
  name: "raw-import",
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => {
      const specifier = args.path.slice(0, -RAW_QUERY.length);
      if (!specifier.startsWith(".") && !nodePath.isAbsolute(specifier)) {
        return {
          errors: [
            {
              text: `?raw imports only support relative/absolute paths, got "${args.path}"`,
            },
          ],
        };
      }
      return {
        path: nodePath.resolve(args.resolveDir, specifier),
        namespace: "raw-file",
      };
    });
    build.onLoad({ filter: /./, namespace: "raw-file" }, (args) => {
      const contents = readFileSync(args.path, "utf8");
      return {
        contents: `export default ${JSON.stringify(contents)};`,
        loader: "js",
        watchFiles: [args.path],
      };
    });
  },
};

(() => {
  process.on("exit", () => {
    cpSync("../../.agents/skills/yukino-lit-jsx", "skills/yukino-lit-jsx", {
      errorOnExist: false,
      force: true,
      recursive: true,
    });
  });
})();

export default defineConfig({
  entry: ["src/index.ts", "src/jsx-runtime.ts", "src/community/index.ts"],
  format: ["esm", "cjs"],
  dts: {
    compilerOptions: { ignoreDeprecations: "6.0" },
  },
  clean: true,
  sourcemap: false,
  minify: true,
  tsconfig: "tsconfig.json",
  esbuildPlugins: [rawImportPlugin],
});
