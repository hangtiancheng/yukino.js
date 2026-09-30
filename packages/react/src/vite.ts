/**
 * @yukino.js/react Vite plugin — zero-config JSX + state-preserving HMR.
 *
 * 1. **JSX transform defaults** — configures the esbuild automatic JSX
 *    runtime with `jsxImportSource: "@yukino.js/react"` (unless the user
 *    already set one), so `.tsx` / `.jsx` files compile against
 *    `@yukino.js/react/jsx-runtime` without tsconfig/vite tweaking.
 * 2. **Component HMR** — auto-injects state-preserving HMR into every
 *    `.tsx` / `.jsx` module with a line-leading default export. Editing a
 *    component hot-swaps all live instances in place (`useState`/`useRef`
 *    state survives) — no `import.meta.hot` boilerplate required.
 *
 * There is no compile-time "is this a component?" marker (components are
 * plain functions), so the gate is intentionally broad and the RUNTIME is the
 * guard: the snippet checks `typeof === "function"`, and `hotSwapByComponent`
 * no-ops on non-functions. A `.tsx` file default-exporting a config object
 * simply self-accepts and does nothing.
 *
 * Usage in vite.config.ts:
 * ```ts
 * import { reactPlugin } from "@yukino.js/react/vite";
 *
 * export default defineConfig({
 *   plugins: [reactPlugin()],
 * });
 * ```
 */
import type { Plugin, UserConfig } from "vite";

import { injectComponentHmrSnippet as injectShared } from "./hmr-inject";

/** Module ids eligible for component-HMR injection (JSX modules only) */
const COMPONENT_MODULE_ID_REGEXP = /\.[jt]sx$/;

/**
 * Transform a component module source to add Vite component HMR.
 *
 * Thin wrapper over the shared bundler-agnostic injector (./hmr-inject) —
 * kept as the public 1-arg API of "@yukino.js/react/vite".
 */
export function injectComponentHmrSnippet(source: string): string {
  return injectShared(source, "vite");
}

/**
 * Create the @yukino.js/react Vite plugin.
 *
 * @returns Vite plugin instance
 */
export function reactPlugin(): Plugin {
  let isBuild = false;
  return {
    name: "yukino-react",
    enforce: "pre",

    /**
     * Default the esbuild JSX transform to the automatic runtime.
     * User-provided settings always win; `esbuild: false` disables the
     * transform entirely and `jsx: "preserve"` is respected.
     */
    config(userConfig): UserConfig | undefined {
      const esbuild = userConfig.esbuild;
      if (esbuild === false) return undefined;
      if (esbuild?.jsx === "preserve") return undefined;
      const patch: { jsx?: "automatic"; jsxImportSource?: string } = {};
      if (!esbuild?.jsx) patch.jsx = "automatic";
      if (!esbuild?.jsxImportSource) patch.jsxImportSource = "@yukino.js/react";
      if (Object.keys(patch).length === 0) return undefined;
      return { esbuild: patch };
    },

    configResolved(config): void {
      isBuild = config.command === "build";
    },

    /**
     * Inject component HMR into `.tsx`/`.jsx` modules with a default export.
     * Dev-server only — the snippet would be dead code in production, so
     * builds skip the rewrite entirely.
     */
    transform(code, id) {
      if (isBuild) return undefined;
      // Only process JSX modules (query-suffixed ids excluded)
      if (!COMPONENT_MODULE_ID_REGEXP.test(id.split("?")[0])) return undefined;
      if (id.includes("node_modules")) return undefined;
      const transformed = injectComponentHmrSnippet(code);
      // Skip the no-op: returning an unchanged string counts as a transform
      // and would break sourcemaps.
      if (transformed === code) return undefined;
      // map: null tells the bundler no sourcemap exists for the injection
      return { code: transformed, map: null };
    },
  };
}

export default reactPlugin;
