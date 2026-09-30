/**
 * @yukino.js/react Webpack Integration.
 *
 * Injects state-preserving component HMR into every `.tsx` / `.jsx` module
 * with a default export. Editing a component hot-swaps all live instances in
 * place (`useState`/`useRef` state survives) without a full reload —
 * runtime guards make non-component default exports a no-op.
 *
 * The JSX transform itself is the responsibility of your TS/JS loader
 * (babel-loader / swc-loader / ts-loader): configure the automatic runtime
 * with `jsxImportSource: "@yukino.js/react"`, e.g. in tsconfig.json:
 *
 * ```jsonc
 * { "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "@yukino.js/react" } }
 * ```
 *
 * Two integration modes:
 *
 * 1. **Plugin** (ReactPlugin) — auto-registers the HMR loader rule.
 *    Zero-config, recommended.
 * 2. **Loader** (reactLoader) — manual rule setup.
 *
 * Usage with Plugin (recommended):
 * ```js
 * import { ReactPlugin } from '@yukino.js/react/webpack';
 *
 * export default {
 *   plugins: [
 *     new ReactPlugin(),
 *   ],
 * };
 * ```
 *
 * Usage with Loader (manual):
 * ```js
 * export default {
 *   module: {
 *     rules: [{
 *       test: /\.[jt]sx$/,
 *       exclude: /node_modules/,
 *       enforce: 'pre',
 *       loader: '@yukino.js/react/webpack',
 *     }],
 *   },
 * };
 * ```
 */
import { injectComponentHmrSnippet } from "./hmr-inject";

// tsconfig.json compiles with `"types": []`, so Node globals are undeclared
// there; the runtime value comes from tsup's shim (ESM) or natively (CJS).
declare const __filename: string;

/** Plugin options */
export interface ReactWebpackPluginOptions {
  /** Component-module extensions to match (default: /\.[jt]sx$/) */
  test?: RegExp;
  /** Exclude pattern (default: /node_modules/) */
  exclude?: RegExp;
}

/**
 * Webpack loader entry point.
 *
 * Injects the component HMR snippet into modules with a default export.
 * Runs with `enforce: "pre"` (before ts-loader/babel/SWC), receiving raw
 * source — the injected code is plain `import.meta.webpackHot` JavaScript,
 * valid in both TS and TSX. Other modules pass through untouched.
 */
function reactLoader(this: unknown, source: string): string {
  // Production builds get no HMR runtime — skip the rewrite entirely.
  if ((this as { mode?: string } | null | undefined)?.mode === "production") {
    return source;
  }
  try {
    return injectComponentHmrSnippet(source, "webpack");
  } catch (err) {
    console.error(err);
    return source;
  }
}

/**
 * Webpack plugin that auto-registers the @yukino.js/react HMR loader.
 *
 * This is the recommended integration approach. The plugin adds a single
 * `enforce: "pre"` rule over JSX modules; the loader is a fast no-op for
 * files without a line-leading `export default`.
 */
class ReactPlugin {
  private options: ReactWebpackPluginOptions;

  constructor(options: ReactWebpackPluginOptions = {}) {
    this.options = {
      test: /\.[jt]sx$/,
      exclude: /node_modules/,
      ...options,
    };
  }

  /**
   * Webpack plugin entry point.
   * Called by webpack when the plugin is applied.
   */
  apply(compiler: {
    options: {
      mode?: unknown;
      module: {
        rules: unknown[];
      };
    };
  }): void {
    // Explicit production builds ship no HMR runtime — skip the rule.
    if (compiler.options.mode === "production") {
      return;
    }

    const { test, exclude } = this.options;

    compiler.options.module = compiler.options.module || {};
    compiler.options.module.rules = compiler.options.module.rules || [];

    // Component HMR injection rule. `enforce: "pre"` ensures this loader
    // runs BEFORE ts-loader/SWC/babel, receiving the raw TSX/JSX source.
    compiler.options.module.rules.push({
      test,
      exclude,
      enforce: "pre",
      use: [
        {
          // Resolve the loader path (this file). __filename comes from tsup's
          // ESM shim in ESM output and is native in CJS output. Webpack's
          // loader-runner loads loaders with require(), so from the ESM build
          // we point at the .cjs sibling instead (require(esm) needs newer Node).
          loader: __filename.endsWith(".js")
            ? __filename.slice(0, -3) + ".cjs"
            : __filename,
        },
      ],
    });
  }
}

export { reactLoader, ReactPlugin };
export { reactLoader as default };
