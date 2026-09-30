/**
 * Hot Module Replacement (HMR) for function components.
 *
 * `hotSwapByComponent(oldFn, newFn)` hot-swaps component code without a full
 * page reload, preserving instance state across updates:
 *
 * 1. `aliasComponent(old, new)` — parents (or route tables) holding the
 *    STALE import keep matching live instances (the reconciler compares
 *    canonical identities).
 * 2. Every live instance of the old function is swapped in place
 *    (`swapInstanceFn`): plain state slots (`useSignal` / `useRef`) survive;
 *    closure-bound slots (effects, computeds, memos, queries) are disposed
 *    and recreated by the next render so no stale closures linger. The
 *    instance then re-renders via its `invalidate` signal.
 *
 * The swap function is exposed on `globalThis.__yukino_hmr__` so auto-injected
 * HMR snippets (see ./hmr-inject.ts) can call it WITHOUT importing
 * "@yukino.js/react-signal" — under Module Federation any import of the shared singleton
 * inside an HMR callback registers the module as a shared consumer, which
 * makes webpack expect a main-chunk hot-update it never emits
 * (ChunkLoadError). The global sidesteps module resolution entirely.
 */
import { batch } from "./reactive";
import { aliasComponent } from "./component-registry";
import { getInstances, swapInstanceFn } from "./component";
import type { Component } from "./jsx/vnode";

/**
 * Component HMR: alias + in-place instance swap.
 *
 * Runtime-guarded: non-function arguments and functions with no live
 * instances no-op safely, so the broad injection gate (any `.tsx`/`.jsx`
 * default export) cannot break non-component modules.
 *
 * @returns whether any live instance was swapped
 */
export function hotSwapByComponent(oldFn: unknown, newFn: unknown): boolean {
  if (
    typeof oldFn !== "function" ||
    typeof newFn !== "function" ||
    oldFn === newFn
  ) {
    return false;
  }
  const oldC = oldFn as Component;
  const newC = newFn as Component;
  aliasComponent(oldC, newC);
  const instances = Array.from(getInstances(oldC));
  batch(() => {
    for (const inst of instances) {
      swapInstanceFn(inst, newC);
      inst.invalidate.value++; // re-render with the new function
    }
  });
  return instances.length > 0;
}

// The `globalThis.__yukino_hmr__` handle is registered ONCE at the package
// entry (src/index.ts top level) — the single registration point.
