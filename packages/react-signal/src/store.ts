import {
  signal,
  batch,
  untracked,
  Signal,
  type ReadonlySignal,
} from "./reactive";

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

type StateInit<T> = { [K in keyof T]: T[K] | ReadonlySignal<T[K]> };

type StateCreator<T> = (
  set: (
    partial: Partial<T> | ((prev: T) => Partial<T>),
    replace?: boolean,
  ) => void,
  get: () => T,
) => StateInit<T>;

export function createStore<T extends object>(
  creator: StateCreator<T>,
): StoreApi<T> {
  const listeners = new Set<Listener<T>>();
  const keySignals = new Map<string, Signal<unknown>>();
  const derived = new Map<string, ReadonlySignal<unknown>>();
  const actionKeys = new Set<string>();
  const mirror: Record<string, unknown> = {};

  let destroyed = false;

  const proxy = new Proxy(mirror, {
    get(target, prop, receiver) {
      if (typeof prop === "string") {
        const d = derived.get(prop);
        if (d) return d.value;
        const s = keySignals.get(prop);
        if (s) return s.value;
      }
      return Reflect.get(target, prop, receiver);
    },
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

  const getState = (): T => proxy;

  const syncDerived = (): void => {
    for (const [key, d] of derived) {
      mirror[key] = untracked(() => d.value);
    }
  };

  const setState = (
    partial: Partial<T> | ((prev: T) => Partial<T>),
    replace?: boolean,
  ): void => {
    if (destroyed) return;
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

  const destroy = (): void => {
    destroyed = true;
    listeners.clear();
  };

  const api: StoreApi<T> = { getState, setState, subscribe, destroy };

  const body = creator(setState, getState);

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

  syncDerived();

  return api;
}
