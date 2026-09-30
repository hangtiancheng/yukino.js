/**
 * @yukino.js/react-signal Store
 *
 * Zustand-aligned state management, backed by per-key signals.
 *
 * Core API (zustand semantics — stores are anonymous, no global registry):
 * - createStore(creator): define a store with (set, get) => initialState
 * - store.getState(): stable tracked proxy — reading a key inside a tracked
 *   region (component body / computed / useSignalEffect) subscribes the
 *   reader to THAT key only
 * - store.setState(partial | updater, replace?): batch-write keys and notify
 *   listeners; `replace: true` resets plain state keys missing from the
 *   partial to `undefined` (actions and computed slots are untouched)
 * - store.subscribe(listener) / store.subscribe(selector, listener): manual
 *   subscriptions; the selector form only fires when the selected slice
 *   changes (`Object.is`)
 * - store.destroy(): clear listeners; further `setState` calls are no-ops
 * - `computed(fn)` (from the reactive core) declares derived state — its
 *   dependencies are tracked automatically, no deps array
 *
 * ## Reactivity (shallow)
 *
 * Key values are compared by reference (`Object.is`). Mutating a nested field
 * or pushing into an array does NOT notify — replace the reference:
 * `set({ list: [...get().list, item] })`.
 */

import {
  signal,
  batch,
  untracked,
  Signal,
  type ReadonlySignal,
} from "./reactive";

// ---- Types ----------------------------------------------------------------

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

/**
 * Creator return shape: each key holds either its plain initial value, an
 * action function, or a `computed(fn)` (ReadonlySignal) derived slot.
 */
type StateInit<T> = { [K in keyof T]: T[K] | ReadonlySignal<T[K]> };

type StateCreator<T> = (
  set: (
    partial: Partial<T> | ((prev: T) => Partial<T>),
    replace?: boolean,
  ) => void,
  get: () => T,
) => StateInit<T>;

// ---- create ----------------------------------------------------------------

/**
 * Create a zustand-aligned store.
 *
 * The `creator` function receives `(set, get)` and executes **once** during
 * store creation. Yukino iterates the return value:
 * - **Functions** become actions (attached to state, unaffected by `setState`)
 * - **`computed(fn)` signals** occupy derived slots — dependencies are
 *   tracked automatically (reads of `get().x` inside the computed subscribe
 *   it to that key), and `getState().derivedKey` unwraps the current value
 * - **All other fields** become signal-backed state keys
 *
 * `getState()` returns a stable proxy: property reads go through the key
 * signals, so reads inside a component body subscribe that component to
 * exactly the keys it uses. Writes to computed/action keys via `setState`
 * are silently ignored.
 *
 * @param creator - Factory function `(set, get) => initialState`
 * @returns A `StoreApi` with `getState` / `setState` / `subscribe` / `destroy`
 *
 * @example
 * ```ts
 * const store = createStore((set, get) => ({
 *   count: 0,
 *   doubled: computed(() => get().count * 2),
 *   increment: () => set({ count: get().count + 1 }),
 * }));
 * ```
 */
export function createStore<T extends object>(
  creator: StateCreator<T>,
): StoreApi<T> {
  /** Listeners notified on every state change. */
  const listeners = new Set<Listener<T>>();
  /** Signal per plain state key. */
  const keySignals = new Map<string, Signal<unknown>>();
  /** Derived (computed) slots keyed by state key. */
  const derived = new Map<string, ReadonlySignal<unknown>>();
  /** Action keys (functions — writes ignored by setState). */
  const actionKeys = new Set<string>();
  /**
   * Plain snapshot mirror (state + actions + last derived values). Serves as
   * the proxy target so `ownKeys` / spread / `Object.keys` behave like a
   * plain object, and as the `prevState` source for listeners.
   */
  const mirror: Record<string, unknown> = {};

  let destroyed = false;

  const proxy = new Proxy(mirror, {
    get(target, prop, receiver) {
      if (typeof prop === "string") {
        const d = derived.get(prop);
        if (d) return d.value; // tracked read
        const s = keySignals.get(prop);
        if (s) return s.value; // tracked read
      }
      return Reflect.get(target, prop, receiver); // actions / unknown keys
    },
    // Direct writes would land on the mirror without updating the key
    // signal — reads would keep returning the signal value while a later
    // legitimate `setState` with the same value would be treated as a
    // no-change (mirror comparison) and never notify. Fail loudly instead.
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

  /** Read the stable tracked state proxy. */
  const getState = (): T => proxy;

  /** Refresh the mirror's derived-value snapshot (untracked reads). */
  const syncDerived = (): void => {
    for (const [key, d] of derived) {
      mirror[key] = untracked(() => d.value);
    }
  };

  /**
   * Batch-merge `partial` into state and notify listeners.
   *
   * Accepts a partial object or an updater function `(prev) => partial`.
   * Computed and action keys are skipped. If no value actually changed
   * (`Object.is`), the update is a no-op — listeners are NOT notified.
   * Unknown keys create new signal-backed slots. With `replace: true`,
   * plain state keys missing from the partial are reset to `undefined`
   * (zustand replace semantics for a per-key-signal store).
   */
  const setState = (
    partial: Partial<T> | ((prev: T) => Partial<T>),
    replace?: boolean,
  ): void => {
    if (destroyed) return;
    // untracked: updater reads must never subscribe an enclosing tracked
    // region (zustand `set(prev => ...)` semantics).
    const resolved =
      typeof partial === "function" ? untracked(() => partial(proxy)) : partial;

    const prevState = { ...mirror } as T;
    let changed = false;

    batch(() => {
      const writeKey = (key: string, newVal: unknown): void => {
        let sig = keySignals.get(key);
        if (!sig) {
          sig = signal(newVal);
          keySignals.set(key, sig);
          mirror[key] = newVal;
          changed = true;
          return;
        }
        if (!Object.is(mirror[key], newVal)) {
          mirror[key] = newVal;
          sig.value = newVal;
          changed = true;
        }
      };

      for (const key of Object.keys(resolved)) {
        if (derived.has(key) || actionKeys.has(key)) continue;
        writeKey(key, Reflect.get(resolved, key));
      }
      if (replace) {
        for (const key of keySignals.keys()) {
          if (!Object.prototype.hasOwnProperty.call(resolved, key)) {
            writeKey(key, undefined);
          }
        }
      }
      if (changed) {
        syncDerived();
      }
    });

    if (!changed) return;

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
      let prevSlice = untracked(() => selector(proxy));
      entry = () => {
        const nextSlice = untracked(() => selector(proxy));
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

  // Run creator to get the initial body
  const body = creator(setState, getState);

  // Classify: derived signals, actions, plain state keys
  for (const key of Object.keys(body)) {
    const val = Reflect.get(body, key);
    if (val instanceof Signal) {
      derived.set(key, val as ReadonlySignal<unknown>);
    } else if (typeof val === "function") {
      Reflect.set(mirror, key, val);
      actionKeys.add(key);
    } else {
      keySignals.set(key, signal(val));
      mirror[key] = val;
    }
  }

  // Derived initial values compute AFTER all key signals exist (computed is
  // lazy — first .value read runs the fn, which may call get()).
  syncDerived();

  return api;
}
