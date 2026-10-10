import { signal, batch, type Signal } from "./reactive";
import { hasOwnProperty, devWarn } from "./utils";
import type { Component } from "./jsx/vnode";

const VALUE_SLOT = 1;
const MOUNT_SLOT = 2;

export interface ValueSlot {
  t: typeof VALUE_SLOT;
  value: unknown;
  dispose?: (value: unknown) => void;
  keep?: boolean;
}

export interface MountSlot {
  t: typeof MOUNT_SLOT;
  fn: () => void | (() => void);
  cleanup: (() => void) | undefined;
  pending: boolean;
}

export type HookSlot = ValueSlot | MountSlot;

export interface Instance {
  fn: Component;
  destroyed: boolean;
  proxy: Record<string, unknown>;
  propsTarget: Record<string, unknown>;
  propsSignals: Map<string, Signal<unknown>>;
  keysVersion: Signal<number>;
  propsKeys: Set<string>;
  hooks: Array<HookSlot | undefined>;
  hookIndex: number;
  hookCount: number;
  renderCount: number;
  invalidate: Signal<number>;
  renderDispose: (() => void) | undefined;
}

export function createInstance(fn: Component): Instance {
  const propsSignals = new Map<string, Signal<unknown>>();
  const propsTarget: Record<string, unknown> = {};
  const keysVersion = signal(0);
  const proxy = new Proxy(propsTarget, {
    get(target, prop, receiver) {
      if (typeof prop === "string") {
        const sig = propsSignals.get(prop);
        if (sig) return sig.value;
      }
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      keysVersion.value;
      return Reflect.has(target, prop);
    },
    ownKeys(target) {
      keysVersion.value;
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
        sig.value = value;
      } else {
        propsSignals.set(key, signal(value));
      }
    }
    if (keysChanged) inst.keysVersion.value = inst.keysVersion.peek() + 1;
  });
}

let currentInstance: Instance | null = null;

export function requireInstance(hook: string): Instance {
  if (!currentInstance) {
    throw new Error(`${hook} can only be called inside a component function`);
  }
  return currentInstance;
}

export function beginRender(inst: Instance): Instance | null {
  const prev = currentInstance;
  currentInstance = inst;
  inst.hookIndex = 0;
  return prev;
}

export function endRender(inst: Instance, prev: Instance | null): void {
  currentInstance = prev;
  if (inst.renderCount > 0 && inst.hookIndex !== inst.hookCount) {
    devWarn(
      `Component "${inst.fn.name || "anonymous"}" called a different number of hooks ` +
        `than the previous render (${inst.hookIndex} vs ${inst.hookCount}). ` +
        `Hooks must run unconditionally in the same order every render.`,
    );
  }
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

function replaceSlotWarn(inst: Instance, prev: HookSlot): void {
  devWarn(
    `Component "${inst.fn.name || "anonymous"}" changed the type of a hook between ` +
      `renders — the previous slot was reset. Hooks must run in a stable order.`,
  );
  disposeSlot(prev);
}

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

const instanceRegistry = new Map<Component, Set<Instance>>();

export function registerInstance(inst: Instance): void {
  let set = instanceRegistry.get(inst.fn);
  if (!set) {
    set = new Set();
    instanceRegistry.set(inst.fn, set);
  }
  set.add(inst);
}

export function unregisterInstance(inst: Instance): void {
  const set = instanceRegistry.get(inst.fn);
  if (set) {
    set.delete(inst);
    if (set.size === 0) instanceRegistry.delete(inst.fn);
  }
}

export function getInstances(fn: Component): ReadonlySet<Instance> {
  return instanceRegistry.get(fn) ?? EMPTY_INSTANCES;
}

const EMPTY_INSTANCES: ReadonlySet<Instance> = new Set();

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
  inst.renderCount = 0;
}
