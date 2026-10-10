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

const storeInternals = new WeakMap<object, { version(): number }>();

export function createStore<T extends object>(
  creator: StateCreator<T>,
): StoreApi<T> {
  const listeners = new Set<Listener<T>>();
  const stateKeys = new Set<string>();
  const actionKeys = new Set<string>();
  const mirror: Record<string, unknown> = {};

  let destroyed = false;
  let version = 0;

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

  const getState = (): T => proxy;

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

  const destroy = (): void => {
    destroyed = true;
    listeners.clear();
  };

  const api: StoreApi<T> = { getState, setState, subscribe, destroy };
  storeInternals.set(api, { version: () => version });

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
    check();
    return unsubscribe;
  }, [store]);

  return value;
}
