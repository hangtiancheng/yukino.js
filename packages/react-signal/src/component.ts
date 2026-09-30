/**
 * Component instance runtime (React-FC model).
 *
 * A component is a plain function `(props) => JSXNode`. The function re-runs
 * on every render pass inside a per-instance signals effect — the body IS the
 * tracked template. State lives in call-order-indexed hook slots (`useSignal`,
 * `onMount`, ... — see ./hooks.ts), which are preserved across re-runs.
 *
 * This module owns everything about an instance EXCEPT its rendered DOM
 * slice (nodes/anchor live on the reconciler's `RComponent` bookkeeping):
 *
 * - the **props store** — one signal per prop key behind a stable proxy;
 *   reading `props.x` inside the component body subscribes the instance to
 *   THAT key only (finer-grained than React's whole-props identity model)
 * - the **hook slot array** + `currentInstance` tracking (rules of hooks)
 * - **mount flushing** — `onMount` callbacks run after the DOM commit
 * - **teardown** — hook slots disposed in reverse order (`onCleanup`
 *   callbacks are slots too)
 * - the **live-instance registry** used by HMR to hot-swap component code
 *   while preserving state slots
 *
 * There is deliberately NO deps-array machinery (no useMemo/useEffect):
 * signals are the single dependency-tracking mechanism — derive with
 * `useComputed`, react with `useSignalEffect`.
 */
import { signal, batch, type Signal } from "./reactive";
import { hasOwnProperty, devWarn } from "./utils";
import type { Component } from "./jsx/vnode";

// ============================================================
// Hook slots
// ============================================================

const VALUE_SLOT = 1;
const MOUNT_SLOT = 2;

/** A once-created value (signal, ref cell, computed, effect dispose). */
export interface ValueSlot {
  t: typeof VALUE_SLOT;
  value: unknown;
  /** Disposer run on unmount (and on HMR swap unless `keep`). */
  dispose?: (value: unknown) => void;
  /** Plain state (signals/refs) — preserved across HMR swaps. */
  keep?: boolean;
}

/** `onMount` slot — run once post-commit; cleanup on unmount. */
export interface MountSlot {
  t: typeof MOUNT_SLOT;
  fn: () => void | (() => void);
  cleanup: (() => void) | undefined;
  /** Set on creation; cleared by `flushInstanceEffects`. */
  pending: boolean;
}

export type HookSlot = ValueSlot | MountSlot;

// ============================================================
// Instance
// ============================================================

/**
 * A live component instance. Created by the reconciler when a function tag
 * mounts; destroyed when the tag leaves the tree.
 */
export interface Instance {
  /** The component function (mutated in place by HMR swaps). */
  fn: Component;
  destroyed: boolean;
  /** Stable tracked props proxy passed to `fn` on every render. */
  proxy: Record<string, unknown>;
  /** Proxy target — plain mirror of current props (spread/`in` support). */
  propsTarget: Record<string, unknown>;
  /** One signal per prop key (created on first sight). */
  propsSignals: Map<string, Signal<unknown>>;
  /** Bumped when the prop KEY SET changes — tracks `in`/spread/Object.keys. */
  keysVersion: Signal<number>;
  /** Keys owned by parent pushes — removal candidates (React semantics). */
  propsKeys: Set<string>;
  /** Call-order-indexed hook slots. */
  hooks: Array<HookSlot | undefined>;
  hookIndex: number;
  /** Hook count of the last completed render (rules-of-hooks check). */
  hookCount: number;
  /** Completed render passes (0 = mounting; reset by HMR swaps). */
  renderCount: number;
  /** Manual/HMR re-render channel — the render effect reads it. */
  invalidate: Signal<number>;
  /** Dispose of the instance's render effect (set by the reconciler). */
  renderDispose: (() => void) | undefined;
}

/** Create an instance for a component function (props seeded separately). */
export function createInstance(fn: Component): Instance {
  const propsSignals = new Map<string, Signal<unknown>>();
  const propsTarget: Record<string, unknown> = {};
  const keysVersion = signal(0);
  const proxy = new Proxy(propsTarget, {
    get(target, prop, receiver) {
      if (typeof prop === "string") {
        const sig = propsSignals.get(prop);
        if (sig) return sig.value; // tracked read
      }
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      keysVersion.value; // tracked — `"x" in props` reacts to key changes
      return Reflect.has(target, prop);
    },
    ownKeys(target) {
      keysVersion.value; // tracked — spread / Object.keys react to key changes
      return Reflect.ownKeys(target);
    },
  });
  return {
    fn,
    destroyed: false,
    proxy,
    propsTarget,
    propsSignals,
    keysVersion,
    propsKeys: new Set(),
    hooks: [],
    hookIndex: 0,
    hookCount: 0,
    renderCount: 0,
    invalidate: signal(0),
    renderDispose: undefined,
  };
}

/**
 * Push a props object into the instance's per-key signals. Batched —
 * subscribed reads re-render once. Keys previously pushed but absent this
 * round are removed (`undefined` — React prop-removal semantics). The
 * vnode-level `key` never lands in props.
 */
export function writeInstanceProps(
  inst: Instance,
  props: Record<string, unknown>,
): void {
  const { propsSignals, propsTarget, propsKeys } = inst;
  batch(() => {
    let keysChanged = false;
    for (const key of propsKeys) {
      if (!hasOwnProperty(props, key)) {
        propsKeys.delete(key);
        Reflect.deleteProperty(propsTarget, key);
        keysChanged = true;
        const sig = propsSignals.get(key);
        if (sig) sig.value = undefined;
      }
    }
    for (const key of Object.keys(props)) {
      if (key === "key") continue;
      if (!propsKeys.has(key)) {
        propsKeys.add(key);
        keysChanged = true;
      }
      const value = props[key];
      propsTarget[key] = value;
      const sig = propsSignals.get(key);
      if (sig) {
        sig.value = value; // same-value writes are no-ops
      } else {
        propsSignals.set(key, signal(value));
      }
    }
    // peek(): ++ would READ .value first, and the seed path runs inside the
    // parent's tracked render effect — that read would subscribe the parent
    // and the write would immediately re-render it (double mount render).
    if (keysChanged) inst.keysVersion.value = inst.keysVersion.peek() + 1;
  });
}

// ============================================================
// Current instance + render bracketing (rules of hooks)
// ============================================================

let currentInstance: Instance | null = null;

/** Get the current instance or throw (hooks outside a component body). */
export function requireInstance(hook: string): Instance {
  if (!currentInstance) {
    throw new Error(`${hook} can only be called inside a component function`);
  }
  return currentInstance;
}

/**
 * Enter a render pass: set the hook context and reset the slot cursor.
 * Returns the previously current instance — pass it back to `endRender`
 * (stack discipline: nested passes restore the outer context).
 */
export function beginRender(inst: Instance): Instance | null {
  const prev = currentInstance;
  currentInstance = inst;
  inst.hookIndex = 0;
  return prev;
}

/** Leave a render pass: verify hook-count stability, bump the pass counter. */
export function endRender(inst: Instance, prev: Instance | null): void {
  currentInstance = prev;
  if (inst.renderCount > 0 && inst.hookIndex !== inst.hookCount) {
    devWarn(
      `Component "${inst.fn.name || "anonymous"}" called a different number of hooks ` +
        `than the previous render (${inst.hookIndex} vs ${inst.hookCount}). ` +
        `Hooks must run unconditionally in the same order every render.`,
    );
  }
  // Dispose orphaned trailing slots: hook-count shrink between renders, or
  // leftover `keep` slots after an HMR swap to a version with fewer hooks.
  if (inst.hooks.length > inst.hookIndex) {
    for (let i = inst.hooks.length - 1; i >= inst.hookIndex; i--) {
      const slot = inst.hooks[i];
      if (slot) disposeSlot(slot);
    }
    inst.hooks.length = inst.hookIndex;
  }
  inst.hookCount = inst.hookIndex;
  inst.renderCount++;
}

// ============================================================
// Slot primitives (consumed by ./hooks.ts)
// ============================================================

function replaceSlotWarn(inst: Instance, prev: HookSlot): void {
  devWarn(
    `Component "${inst.fn.name || "anonymous"}" changed the type of a hook between ` +
      `renders — the previous slot was reset. Hooks must run in a stable order.`,
  );
  disposeSlot(prev);
}

/**
 * A once-created value slot: `create` runs on the first render (or after an
 * HMR reset); later renders return the stored value. `dispose` runs on
 * unmount. `keep: true` marks plain state preserved across HMR swaps.
 */
export function useValueSlot<T>(
  create: () => T,
  dispose?: (value: T) => void,
  keep?: boolean,
): T {
  const inst = requireInstance("useValueSlot");
  const i = inst.hookIndex++;
  const prev = inst.hooks[i];
  if (prev) {
    if (prev.t === VALUE_SLOT) return prev.value as T;
    replaceSlotWarn(inst, prev);
  }
  const value = create();
  inst.hooks[i] = {
    t: VALUE_SLOT,
    value,
    dispose: dispose as ((value: unknown) => void) | undefined,
    keep: !!keep,
  };
  return value;
}

/**
 * `useEffect` slot (mount-only): registered on the first render, run once
 * post-commit via `flushInstanceEffects` (the DOM exists). A returned
 * function is the unmount cleanup. Later renders are no-ops (the first
 * render's `fn` wins).
 */
export function useMountSlot(fn: () => void | (() => void)): void {
  const inst = requireInstance("useEffect");
  const i = inst.hookIndex++;
  const prev = inst.hooks[i];
  if (prev) {
    if (prev.t === MOUNT_SLOT) return;
    replaceSlotWarn(inst, prev);
  }
  inst.hooks[i] = { t: MOUNT_SLOT, fn, cleanup: undefined, pending: true };
}

// ============================================================
// Post-commit mounts / teardown
// ============================================================

/**
 * Run pending `onMount` callbacks (slot order). Called by the reconciler
 * after the DOM commit, inside `untracked()`. Errors bubble to the caller
 * (the render effect / signal write site) — there is no swallowing.
 */
export function flushInstanceEffects(inst: Instance): void {
  for (const slot of inst.hooks) {
    if (slot && slot.t === MOUNT_SLOT && slot.pending && !inst.destroyed) {
      slot.pending = false;
      const result = slot.fn();
      if (typeof result === "function") {
        slot.cleanup = result;
      }
    }
  }
}

function disposeSlot(slot: HookSlot): void {
  if (slot.t === MOUNT_SLOT) {
    if (slot.cleanup) {
      const cleanup = slot.cleanup;
      slot.cleanup = undefined;
      cleanup();
    }
  } else if (slot.dispose) {
    slot.dispose(slot.value);
  }
}

/**
 * Destroy the instance's logical state: dispose hook slots in reverse order
 * (`useSignalEffect` disposers, `useEffect` cleanups, and `onCleanup`
 * callbacks are all slots), unregister from the HMR registry. The reconciler
 * disposes the render effect and removes the DOM range separately (child
 * instances are destroyed before this runs — React's
 * child-cleanups-before-parent order).
 */
export function destroyInstanceState(inst: Instance): void {
  if (inst.destroyed) return;
  inst.destroyed = true;
  unregisterInstance(inst);
  for (let i = inst.hooks.length - 1; i >= 0; i--) {
    const slot = inst.hooks[i];
    if (slot) disposeSlot(slot);
  }
  inst.hooks.length = 0;
}

// ============================================================
// Live-instance registry (HMR)
// ============================================================

/** Live instances per component function. */
const instanceRegistry = new Map<Component, Set<Instance>>();

/** Register a mounted instance (reconciler mount path). */
export function registerInstance(inst: Instance): void {
  let set = instanceRegistry.get(inst.fn);
  if (!set) {
    set = new Set();
    instanceRegistry.set(inst.fn, set);
  }
  set.add(inst);
}

/** Unregister a destroyed instance. */
export function unregisterInstance(inst: Instance): void {
  const set = instanceRegistry.get(inst.fn);
  if (set) {
    set.delete(inst);
    if (set.size === 0) instanceRegistry.delete(inst.fn);
  }
}

/** Live instances of a component function (empty set if none). */
export function getInstances(fn: Component): ReadonlySet<Instance> {
  return instanceRegistry.get(fn) ?? EMPTY_INSTANCES;
}

const EMPTY_INSTANCES: ReadonlySet<Instance> = new Set();

/**
 * Swap the instance's component function (HMR). Plain state slots
 * (`useSignal`/`useRef`, marked `keep`) survive; everything closure-bound
 * (effects, computeds, memos, queries) is disposed and recreated by the next
 * render so no stale closures linger. Caller triggers the re-render via
 * `inst.invalidate`.
 *
 * Known limit: keep slots pair by CALL ORDER (there is no Fast-Refresh-style
 * signature hashing), so an edit that reorders `useSignal`/`useRef` calls can
 * hand a slot's old state to a different hook. Trailing surplus slots are
 * disposed by the post-swap render (`endRender`).
 */
export function swapInstanceFn(inst: Instance, newFn: Component): void {
  unregisterInstance(inst);
  inst.fn = newFn;
  registerInstance(inst);
  for (let i = 0; i < inst.hooks.length; i++) {
    const slot = inst.hooks[i];
    if (!slot) continue;
    if (slot.t === VALUE_SLOT && slot.keep) continue;
    disposeSlot(slot);
    inst.hooks[i] = undefined;
  }
  // The new version may legitimately use a different hook layout — treat the
  // next render as a mount for the hook-count check.
  inst.renderCount = 0;
}
