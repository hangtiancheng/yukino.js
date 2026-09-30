/**
 * @yukino.js/react Store
 *
 * Zustand-aligned state management (vanilla-store style).
 *
 * Core API (zustand semantics — stores are anonymous, no global registry):
 * - createStore(creator): define a store with (set, get) => initialState
 * - store.getState(): stable read-only snapshot (direct writes throw)
 * - store.setState(partial | updater, replace?): merge-write keys and notify
 *   listeners; `replace: true` resets plain state keys missing from the
 *   partial to `undefined` (actions are untouched)
 * - store.subscribe(listener) / store.subscribe(selector, listener): manual
 *   subscriptions; the selector form only fires when the selected slice
 *   changes (`Object.is`)
 * - store.destroy(): clear listeners; further `setState` calls are no-ops
 * - useStore(store, selector?): component hook — subscribes the component
 *   and re-renders it when the store (or the selected slice) changes
 *
 * There is no computed/derived-key support — derive with a selector
 * (`useStore(store, s => s.count * 2)`) or compute in the component body.
 *
 * ## Reactivity (shallow)
 *
 * Key values are compared by reference (`Object.is`). Mutating a nested field
 * or pushing into an array does NOT notify — replace the reference:
 * `set({ list: [...get().list, item] })`.
 */

import { useEffect, useRef, useState } from "./hooks";

type Listener<T> = (state: T, prevState: T) => void;

export interface StoreApi<T = object> {
  getState(): T;
  setState(
    partial: Partial<T> | ((prev: T) => Partial<T>),
    replace?: boolean,
  ): void;
  subscribe(listener: Listener<T>): () => void;
  subscribe<S>(
    selector: (state: T) => S,
    listener: (slice: S, prevSlice: S) => void,
  ): () => void;
  destroy(): void;
}

type StateCreator<T> = (
  set: (
    partial: Partial<T> | ((prev: T) => Partial<T>),
    replace?: boolean,
  ) => void,
  get: () => T,
) => T;

/**
 * Per-store change counter, readable only by useStore. The whole-state
 * `useStore(store)` form needs it because `getState()` returns a stable
 * proxy whose identity never changes — identity comparison alone cannot
 * detect a change that happened between render and effect subscription.
 */
const storeInternals = new WeakMap<object, { version(): number }>();

/**
 * Create a zustand-aligned store.
 *
 * The `creator` function receives `(set, get)` and executes **once** during
 * store creation. Iterates the return value:
 * - **Functions** become actions (attached to state, unaffected by `setState`)
 * - **All other fields** become plain state keys
 *
 * `getState()` returns a stable read-only proxy over the state snapshot —
 * spread / `Object.keys` behave like a plain object; direct writes throw.
 *
 * @param creator - Factory function `(set, get) => initialState`
 * @returns A `StoreApi` with `getState` / `setState` / `subscribe` / `destroy`
 *
 * @example
 * ```ts
 * const store = createStore((set, get) => ({
 *   count: 0,
 *   increment: () => set({ count: get().count + 1 }),
 * }));
 * ```
 */
export function createStore<T extends object>(
  creator: StateCreator<T>,
): StoreApi<T> {
  /** Listeners notified on every state change. */
  const listeners = new Set<Listener<T>>();
  /** Plain state keys (writable through setState; `replace` resets these). */
  const stateKeys = new Set<string>();
  /** Action keys (functions — writes ignored by setState). */
  const actionKeys = new Set<string>();
  /**
   * State snapshot (state + actions). Serves as the proxy target so
   * `ownKeys` / spread / `Object.keys` behave like a plain object, and as
   * the `prevState` source for listeners.
   */
  const mirror: Record<string, unknown> = {};

  let destroyed = false;
  /** Bumped on every actual change; useStore's whole-state dirty check. */
  let version = 0;

  // Direct writes would bypass setState's change detection and listener
  // notification — reads would show the new value while subscribers were
  // never told. Fail loudly instead.
  const proxy = new Proxy(mirror, {
    set(_target, prop) {
      throw new Error(
        `store state is read-only — use setState() (attempted to write "${String(prop)}")`,
      );
    },
    deleteProperty(_target, prop) {
      throw new Error(
        `store state is read-only — use setState() (attempted to delete "${String(prop)}")`,
      );
    },
  }) as T;

  /** Read the stable state snapshot proxy. */
  const getState = (): T => proxy;

  /**
   * Merge `partial` into state and notify listeners.
   *
   * Accepts a partial object or an updater function `(prev) => partial`.
   * Action keys are skipped. If no value actually changed (`Object.is`),
   * the update is a no-op — listeners are NOT notified. Unknown keys create
   * new state slots. With `replace: true`, plain state keys missing from
   * the partial are reset to `undefined`.
   */
  const setState = (
    partial: Partial<T> | ((prev: T) => Partial<T>),
    replace?: boolean,
  ): void => {
    if (destroyed) return;
    const resolved = typeof partial === "function" ? partial(proxy) : partial;

    const prevState = { ...mirror } as T;
    let changed = false;

    const writeKey = (key: string, newVal: unknown): void => {
      if (!stateKeys.has(key)) {
        stateKeys.add(key);
        mirror[key] = newVal;
        changed = true;
        return;
      }
      if (!Object.is(mirror[key], newVal)) {
        mirror[key] = newVal;
        changed = true;
      }
    };

    for (const key of Object.keys(resolved)) {
      if (actionKeys.has(key)) continue;
      writeKey(key, Reflect.get(resolved, key));
    }
    if (replace) {
      for (const key of stateKeys) {
        if (!Object.prototype.hasOwnProperty.call(resolved, key)) {
          writeKey(key, undefined);
        }
      }
    }

    if (!changed) return;
    version++;

    for (const listener of listeners) {
      listener(proxy, prevState);
    }
  };

  /**
   * Subscribe to state changes.
   *
   * - `subscribe(listener)` — fires on every change with `(state, prevState)`
   *   (`state` is the stable proxy, `prevState` a plain snapshot).
   * - `subscribe(selector, listener)` — fires only when the selected slice
   *   changes (`Object.is`), with `(slice, prevSlice)`.
   *
   * Returns an unsubscribe function.
   */
  function subscribe(listener: Listener<T>): () => void;
  function subscribe<S>(
    selector: (state: T) => S,
    listener: (slice: S, prevSlice: S) => void,
  ): () => void;
  function subscribe<S>(
    selectorOrListener: Listener<T> | ((state: T) => S),
    sliceListener?: (slice: S, prevSlice: S) => void,
  ): () => void {
    let entry: Listener<T>;
    if (sliceListener) {
      const selector = selectorOrListener as (state: T) => S;
      let prevSlice = selector(proxy);
      entry = () => {
        const nextSlice = selector(proxy);
        if (!Object.is(nextSlice, prevSlice)) {
          const before = prevSlice;
          prevSlice = nextSlice;
          sliceListener(nextSlice, before);
        }
      };
    } else {
      entry = selectorOrListener as Listener<T>;
    }
    listeners.add(entry);
    return () => {
      listeners.delete(entry);
    };
  }

  /**
   * Tear down the store: clear listeners; further `setState` calls are
   * no-ops.
   */
  const destroy = (): void => {
    destroyed = true;
    listeners.clear();
  };

  const api: StoreApi<T> = { getState, setState, subscribe, destroy };
  storeInternals.set(api, { version: () => version });

  // Run creator to get the initial body, then classify: actions vs state keys
  const body = creator(setState, getState);
  for (const key of Object.keys(body)) {
    const val = Reflect.get(body, key);
    if (typeof val === "function") {
      mirror[key] = val;
      actionKeys.add(key);
    } else {
      stateKeys.add(key);
      mirror[key] = val;
    }
  }

  return api;
}

interface RenderedSnapshot<T, S> {
  selector: ((state: T) => S) | undefined;
  slice: unknown;
  version: number;
}

/**
 * Subscribe a component to a store.
 *
 * - `useStore(store)` — returns the whole state; re-renders on every change.
 * - `useStore(store, selector)` — returns the selected slice; re-renders
 *   only when the slice changes (`Object.is`). Selectors returning fresh
 *   objects per call defeat the comparison — select primitives or stable
 *   references.
 *
 * The subscription starts in a post-commit effect, so the hook re-checks
 * the store immediately after subscribing: a change that landed between
 * render and subscription (e.g. another component's mount effect calling
 * `setState`) still re-renders this component instead of being missed.
 */
export function useStore<T extends object>(store: StoreApi<T>): T;
export function useStore<T extends object, S>(
  store: StoreApi<T>,
  selector: (state: T) => S,
): S;
export function useStore<T extends object, S>(
  store: StoreApi<T>,
  selector?: (state: T) => S,
): T | S {
  const [, force] = useState(0);
  const rendered = useRef<RenderedSnapshot<T, S> | null>(null);

  const value = selector ? selector(store.getState()) : store.getState();
  rendered.current = {
    selector,
    slice: value,
    version: storeInternals.get(store)!.version(),
  };

  useEffect(() => {
    const check = (): void => {
      const snapshot = rendered.current!;
      if (snapshot.selector) {
        if (!Object.is(snapshot.selector(store.getState()), snapshot.slice)) {
          force((tick) => tick + 1);
        }
      } else if (storeInternals.get(store)!.version() !== snapshot.version) {
        force((tick) => tick + 1);
      }
    };
    const unsubscribe = store.subscribe(() => check());
    // Post-subscribe staleness re-check: catch changes that happened between
    // this component's render and this effect running.
    check();
    return unsubscribe;
  }, [store]);

  return value;
}
