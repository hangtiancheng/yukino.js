/**
 * Ambient type declarations for yukino-react-signal.
 *
 * This file is a SCRIPT declaration file (no top-level import/export) so its
 * `declare module "*.css"` wildcards register as ambient modules and its
 * declarations land in the global scope — a module file (with `export {}`)
 * would silently turn the wildcards into no-op augmentations.
 *
 * Scope: webpack (and other non-Vite) projects. Vite projects should rely on
 * `vite/client`, which already declares `import.meta` HMR types and `*.css` /
 * `*.module.css` modules — referencing both would produce conflicting
 * declarations. Likewise, if you already include webpack's own `ImportMeta`
 * types (`"types": ["webpack/module"]`), omit this reference.
 *
 * Declares:
 * - `__yukino_hmr__` — the global HMR handle registered by the package entry
 *   and called by auto-injected HMR snippets (see hmr-inject.ts)
 * - `import.meta.webpackHot` — used by the injected webpack snippet, which
 *   runs through ts-loader BEFORE type stripping and must typecheck
 * - `*.module.css` (`Record<string, string>`) and `*.css` (side-effect /
 *   string) module shapes for css-loader-style pipelines
 */

declare var __yukino_hmr__: {
  hotSwapByComponent: (oldFn: unknown, newFn: unknown) => boolean;
};

interface ImportMeta {
  /** Webpack HMR context (webpack dev server). Undefined in production. */
  webpackHot?: {
    accept(errorHandler?: (err: unknown) => void): void;
    dispose(cb: (data: Record<string, unknown>) => void): void;
    data?: Record<string, unknown>;
  };
}
