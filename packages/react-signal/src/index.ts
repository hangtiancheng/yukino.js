/**
 * Yukino Framework — public API barrel export.
 *
 * Re-exports the complete public surface of `@yukino.js/react-signal` from a single
 * entry point. Consumers can `import { render, useSignal, createRouter, ... }`
 * from `"@yukino.js/react-signal"` without knowing the internal module layout.
 *
 * ## API surface
 *
 * | Category | Exports |
 * | -------- | ------- |
 * | Reactive | `signal`, `computed`, `effect`, `batch`, `untracked`, `Signal` |
 * | Rendering | `render`, `unmount`, `raw`, `Fragment` |
 * | Hooks | `useSignal`, `useRef`, `useComputed`, `useSignalEffect`, `useEffect` (mount-only), `onCleanup` |
 * | Router | `createRouter`, `RouterView`, `useRouter`, `useBlocker`, `matchPath`, `matchRoutes` |
 * | State | `createStore`, `useUrlState` |
 * | HMR | `hotSwapByComponent` |
 * | Types | All types from `./types` via `export *` |
 *
 * There is no Framework/boot object — an app boots with:
 * `render(<RouterView router={createRouter(routes)}/>, container)`.
 * Async server state (SWR-style queries) is intentionally NOT part of this
 * package — it belongs to a dedicated data-fetching package built on the
 * same signals.
 */
import { hotSwapByComponent } from "./hmr";

// Global HMR handle — THE single registration point. Auto-injected HMR
// snippets (see ./hmr-inject.ts) call it via `globalThis.__yukino_hmr__`
// instead of importing "@yukino.js/react-signal" (an import inside an HMR callback
// would register the module as an MF shared consumer → ChunkLoadError).
if (typeof globalThis !== "undefined" && !globalThis.__yukino_hmr__) {
  globalThis.__yukino_hmr__ = { hotSwapByComponent };
}

// Reactive core (@preact/signals-core) — the framework's single reactivity
// primitive set. Reads inside component bodies/computed/effects subscribe;
// writes re-render synchronously (batched inside `batch()`).
export { signal, computed, effect, batch, untracked, Signal } from "./reactive";
export type { ReadonlySignal } from "./reactive";

// Rendering (React-DOM style root API + JSX helpers)
export { render, unmount } from "./jsx/reconcile";
export { raw, Fragment } from "./jsx/vnode";
export type { JSXNode, VNode, RawHTML, Component } from "./jsx/vnode";

// Typed DOM attribute layer (per-tag intrinsic props, native-event handler
// types, `Signalish`/`Ref`/`ClassValue`/`CSSProperties`, aria/svg/mathml) —
// sourced from the preact package and adapted to Yukino semantics.
export type * from "./jsx/dom-types";

// The JSX namespace (React-19-style import): `import type { JSX } from
// "@yukino.js/react-signal"` enables `JSX.HTMLAttributes<T>`, `JSX.IntrinsicElements`,
// `JSX.TargetedEvent`, ... in user type positions.
export type { JSX } from "./jsx-runtime";

// Hooks (call-order-indexed slots — React rules of hooks; signals-only,
// no deps arrays)
export {
  useSignal,
  useRef,
  useComputed,
  useSignalEffect,
  useEffect,
  onCleanup,
} from "./hooks";

// Router (factory-based, history-only, react-router data model on signals)
export {
  createRouter,
  RouterView,
  useRouter,
  useBlocker,
  matchPath,
  matchRoutes,
} from "./router";
export type { RouterOptions } from "./router";

// Store (zustand-aligned state management — per-key signals)
export { createStore } from "./store";
export type { StoreApi } from "./store";

// URL state hook (sync component state with URL search params)
export { useUrlState } from "./url-state";

// HMR (called by auto-injected snippets through globalThis.__yukino_hmr__)
export { hotSwapByComponent };

// Types (re-exported for consumer convenience)
export * from "./types";
