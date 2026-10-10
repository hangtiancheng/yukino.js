import { hotSwapByComponent } from "./hmr";

if (typeof globalThis !== "undefined" && !globalThis.__yukino_hmr__) {
  globalThis.__yukino_hmr__ = { hotSwapByComponent };
}

export { signal, computed, effect, batch, untracked, Signal } from "./reactive";
export type { ReadonlySignal } from "./reactive";

export { render, unmount } from "./jsx/reconcile";
export { raw, Fragment } from "./jsx/vnode";
export type { JSXNode, VNode, RawHTML, Component } from "./jsx/vnode";

export type * from "./jsx/dom-types";

export type { JSX } from "./jsx-runtime";

export {
  useSignal,
  useRef,
  useComputed,
  useSignalEffect,
  useEffect,
  onCleanup,
} from "./hooks";

export {
  createRouter,
  RouterView,
  useRouter,
  useBlocker,
  matchPath,
  matchRoutes,
} from "./router";
export type { RouterOptions } from "./router";

export { createStore } from "./store";
export type { StoreApi } from "./store";

export { useUrlState } from "./url-state";

export { hotSwapByComponent };

export * from "./types";
