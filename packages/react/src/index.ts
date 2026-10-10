import { renderRoot } from "./diff";
import { createElement, Fragment } from "./element";
import type { Children } from "./element";
import { hotSwapByComponent, registerRoot, unregisterRoot } from "./hmr";
import { useCallback, useEffect, useMemo, useRef, useState } from "./hooks";
import type { Root } from "./hooks";

const globalScope = globalThis as {
  __react_hmr__?: { hotSwapByComponent: typeof hotSwapByComponent };
};
if (!globalScope.__react_hmr__) {
  globalScope.__react_hmr__ = { hotSwapByComponent };
}

const roots = new WeakMap<Node, Root>();

const dirtyRoots = new Set<Root>();
let flushScheduled = false;

const MAX_CASCADE_WAVES = 50;
let cascadeWaves = 0;
let inFlush = false;

function scheduleFlush(): void {
  if (inFlush && cascadeWaves >= MAX_CASCADE_WAVES) {
    cascadeWaves = 0;
    dirtyRoots.clear();
    throw new Error(
      "Maximum update depth exceeded. A render body or effect schedules another update on every pass, so the tree can never settle. setState with an unchanged value bails out — make the update conditional or move it out of the render/effect path.",
    );
  }
  if (flushScheduled) {
    return;
  }
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    const pending = [...dirtyRoots];
    dirtyRoots.clear();
    inFlush = true;
    cascadeWaves++;
    try {
      for (const root of pending) {
        renderRoot(root);
      }
    } finally {
      inFlush = false;
      if (dirtyRoots.size === 0) {
        cascadeWaves = 0;
      }
    }
  });
}

export function render(element: Children, container: Node): void {
  let root = roots.get(container);
  if (root === undefined) {
    const created: Root = {
      container,
      element,
      children: [],
      schedule() {
        dirtyRoots.add(created);
        scheduleFlush();
      },
    };
    root = created;
    roots.set(container, root);
  }
  root.element = element;
  dirtyRoots.delete(root);
  if (element === null || element === undefined) {
    unregisterRoot(root);
  } else {
    registerRoot(root);
  }
  renderRoot(root);
}

export function createRoot(container: Node): {
  render(element: Children): void;
  unmount(): void;
} {
  return {
    render(element) {
      render(element, container);
    },
    unmount() {
      render(null, container);
    },
  };
}

export { createElement, Fragment };
export { useCallback, useEffect, useMemo, useRef, useState };
export { hotSwapByComponent };
export { createStore, useStore } from "./store";
export type { StoreApi } from "./store";
export {
  createRouter,
  matchPath,
  matchRoutes,
  RouterView,
  useBlocker,
  useRouter,
} from "./router";
export type {
  Blocker,
  Location,
  NavigateOptions,
  RouteMatch,
  RouteObject,
  RouterApi,
  RouterOptions,
  To,
} from "./router";
export { useUrlState } from "./url-state";
export type { SetUrlState } from "./url-state";
export type {
  Children,
  ComponentType,
  Key,
  Props,
  VNode,
  VNodeType,
} from "./element";
export type {
  DepList,
  Dispatch,
  EffectCallback,
  SetStateAction,
} from "./hooks";
export type { Ref } from "./jsx-runtime";
