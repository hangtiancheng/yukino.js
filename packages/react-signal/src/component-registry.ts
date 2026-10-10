import type { Component } from "./jsx/vnode";

const aliasMap = new WeakMap<Component, Component>();

export function canonicalComponent(fn: Component): Component {
  let current = fn;
  for (let i = 0; i < 100; i++) {
    const next = aliasMap.get(current);
    if (!next || next === current) return current;
    current = next;
  }
  return current;
}

export function aliasComponent(oldFn: Component, newFn: Component): void {
  if (oldFn === newFn) return;
  aliasMap.delete(newFn);
  aliasMap.set(oldFn, newFn);
}
