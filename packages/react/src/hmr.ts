import type { ComponentType } from "./element";
import type { Root } from "./hooks";

const aliasMap = new WeakMap<ComponentType, ComponentType>();

export let hmrActive = false;

const liveRoots = new Set<Root>();

export function registerRoot(root: Root): void {
  liveRoots.add(root);
}

export function unregisterRoot(root: Root): void {
  liveRoots.delete(root);
}

export function canonical(fn: ComponentType): ComponentType {
  let current = fn;
  for (let i = 0; i < 100; i++) {
    const next = aliasMap.get(current);
    if (next === undefined || next === current) {
      return current;
    }
    current = next;
  }
  return current;
}

export function hotSwapByComponent(oldFn: unknown, newFn: unknown): boolean {
  if (
    typeof oldFn !== "function" ||
    typeof newFn !== "function" ||
    oldFn === newFn
  ) {
    return false;
  }
  aliasMap.delete(newFn as ComponentType);
  aliasMap.set(oldFn as ComponentType, newFn as ComponentType);
  hmrActive = true;
  for (const root of liveRoots) {
    root.schedule();
  }
  return true;
}
