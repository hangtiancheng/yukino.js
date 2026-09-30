/**
 * HMR injection code generator — shared across Vite and Webpack.
 *
 * ## Why this file exists
 *
 * React's `@vitejs/plugin-react` auto-injects HMR boilerplate at compile time
 * so users never write `import.meta.hot` themselves. React's bundler
 * integrations do the same for component modules: any `.tsx` / `.jsx` file
 * with a line-leading `export default` self-accepts, and on update calls
 * `hotSwapByComponent(old, new)` to swap the function on every live
 * instance — preserving `useState`/`useRef` state.
 *
 * There is no compile-time "is this a component?" marker (components are
 * plain functions), so the gate is intentionally broad and the RUNTIME is
 * the guard: the snippet checks `typeof === "function"`, and
 * `hotSwapByComponent` no-ops for non-function arguments. A `.tsx` file
 * default-exporting a config object simply self-accepts and does nothing.
 *
 * ## Cross-bundler HMR API differences
 *
 * | Bundler        | HMR context              | accept(cb) semantics                               |
 * |----------------|--------------------------|----------------------------------------------------|
 * | Vite           | `import.meta.hot`        | cb IS the update-success callback (gets newModule) |
 * | Webpack (ESM)  | `import.meta.webpackHot` | cb is an ERROR handler (never runs on success)     |
 *
 * This asymmetry is the root cause of historic webpack HMR bugs: swap logic
 * placed inside `accept(cb)` never executed on successful updates. The fix:
 * Vite uses `accept(cb)` with swap inside cb; webpack uses the self-accept
 * pattern — `accept()` + `dispose()` + a top-level
 * `import.meta.webpackHot.data` check that runs when the module re-executes
 * after an update.
 *
 * Access to the framework's swap function goes through
 * `globalThis.__react_hmr__` (registered once at the package entry,
 * src/index.ts top level), NOT via import/require of "@yukino.js/react". Under
 * Module Federation (`@yukino.js/react` shared singleton), ANY import of the
 * package inside an HMR callback registers the module as a shared consumer,
 * which causes webpack to mark the main chunk as needing a hot-update it
 * never emits → ChunkLoadError. globalThis sidesteps all module-resolution
 * side effects.
 */

/** Supported bundler identifiers. */
export type Bundler = "vite" | "webpack";

/**
 * Generate the HMR snippet for a component module.
 *
 * The snippet references `__react_component__`, a named const holding
 * the module's default export. `injectComponentHmrSnippet` (below) rewrites
 * `export default <expr>` into
 * `const __react_component__ = <expr>; export default __react_component__;`
 * so the HMR callback can capture the old reference.
 */
function getComponentHmrSnippet(bundler: Bundler): string {
  if (bundler === "vite") {
    return `
// Auto-injected by reactPlugin
if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    data.oldComponent = __react_component__;
  });
  import.meta.hot.accept((newMod) => {
    const newComponent = newMod?.default;
    const oldComponent = import.meta.hot.data?.oldComponent;
    if (
      typeof oldComponent === "function" &&
      typeof newComponent === "function" &&
      oldComponent !== newComponent
    ) {
      globalThis.__react_hmr__?.hotSwapByComponent(oldComponent, newComponent);
    }
  });
}
`;
  }

  // Webpack — self-accept pattern: `accept()` marks the module
  // self-accepted; on update the runtime disposes the old module and
  // RE-EXECUTES the module in place, with `import.meta.webpackHot.data`
  // already populated by the dispose callback. The top-level data check
  // distinguishes HMR re-execution from first load.
  return `
// Auto-injected by ReactPlugin
if (import.meta.webpackHot) {
  const oldComponent = import.meta.webpackHot.data?.oldComponent;
  if (
    typeof oldComponent === "function" &&
    typeof __react_component__ === "function" &&
    oldComponent !== __react_component__
  ) {
    globalThis.__react_hmr__?.hotSwapByComponent(oldComponent, __react_component__);
  }
  import.meta.webpackHot.dispose((data) => {
    data.oldComponent = __react_component__;
  });
  import.meta.webpackHot.accept((err) => {
    if (err) {
      console.error(err);
      globalThis.location?.reload();
    }
  });
}
`;
}

/**
 * Line-leading `export default` — avoids matches inside block comments
 * (`* export default ...`) and line comments (`// export ...`).
 */
const EXPORT_DEFAULT_REGEXP = /^[ \t]*export\s+default\s+/m;

/**
 * Named function/class declaration following `export default `. These must
 * KEEP their declaration form: const-wrapping them into expressions would
 * remove the module-scope name binding, breaking any other module-scope
 * reference (`App.displayName = ...`).
 */
const NAMED_DECLARATION_REGEXP =
  /^(?:(?:async\s+)?function(?:\s*\*)?|(?:abstract\s+)?class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;

/**
 * Quick check: is this source eligible for component HMR injection?
 *
 * Any module with a line-leading `export default` qualifies — components
 * are plain functions with no compile-time marker, so the runtime snippet's
 * `typeof` guard carries the real filtering. Bundler integrations
 * additionally restrict by file extension (`.tsx` / `.jsx`).
 */
export function isComponentSource(source: string): boolean {
  return EXPORT_DEFAULT_REGEXP.test(source);
}

/**
 * Transform a component module source to add component HMR.
 *
 * Strategy (no expression scanning — works for any legal statement,
 * including `as` casts, ternaries, and JSX text containing apostrophes):
 *
 * 1. **Named function/class declarations** (`export default function App()`)
 *    keep their declaration: the `export default ` keywords are dropped so
 *    the declaration stays in module scope (other module code may reference
 *    the name), and `const __react_component__ = App;` + the default
 *    export are appended at the end of the file (function declarations
 *    hoist; classes are declared before the EOF alias runs either way).
 * 2. **Everything else**: the `export default ` keywords are replaced with
 *    `const __react_component__ = ` — the rest of the original
 *    statement, whatever it is, now initializes the const — and
 *    `export default __react_component__;` is appended at the end of
 *    the file (nothing else in a module can reference its own default
 *    export, so moving the export is safe).
 *
 * Idempotent: sources already containing `__react_component__` are
 * returned unchanged, so double-registration (plugin + manual loader rule)
 * cannot produce `const __react_component__ = __react_component__;`.
 *
 * If the source has no line-leading `export default`, it is returned
 * unchanged — modules that export named helpers hot-swap through their
 * importers instead.
 *
 * @param source - The component module source code (TSX/JSX)
 * @param bundler - Which bundler's HMR API to use
 * @returns The transformed source with HMR code, or the original if ineligible
 */
export function injectComponentHmrSnippet(
  source: string,
  bundler: Bundler,
): string {
  if (source.includes("__react_component__")) {
    return source;
  }

  const match = EXPORT_DEFAULT_REGEXP.exec(source);
  if (!match) {
    return source;
  }

  const bodyStart = match.index + match[0].length;
  const named = NAMED_DECLARATION_REGEXP.exec(source.slice(bodyStart));
  if (named) {
    return (
      source.slice(0, match.index) +
      source.slice(bodyStart) +
      `\nconst __react_component__ = ${named[1]};\nexport default __react_component__;\n` +
      getComponentHmrSnippet(bundler)
    );
  }

  return (
    source.slice(0, match.index) +
    "const __react_component__ = " +
    source.slice(bodyStart) +
    "\nexport default __react_component__;\n" +
    getComponentHmrSnippet(bundler)
  );
}
