/**
 * HMR alias map for function components.
 *
 * `aliasComponent(old, new)` records that `new` replaces `old`, and
 * `canonicalComponent(fn)` resolves a (possibly stale) component reference
 * through the alias chain to the latest version. The reconciler matches
 * component tags by canonical identity, so parents (or route tables)
 * holding a stale import keep matching hot-swapped instances.
 *
 * There is no string→component registry: routes hold component references
 * (or per-route `lazy()` loaders) directly, and JSX tags are always direct
 * function references.
 */
import type { Component } from "./jsx/vnode";

/** HMR replacement links: old component -> its replacement. */
const aliasMap = new WeakMap<Component, Component>();

/**
 * Resolve a component reference through the HMR alias chain to its latest
 * version. Non-aliased components resolve to themselves. (`aliasComponent`
 * guarantees the latest version has no outgoing edge, so chains are acyclic;
 * the bound is cheap insurance.)
 */
export function canonicalComponent(fn: Component): Component {
  let current = fn;
  for (let i = 0; i < 100; i++) {
    const next = aliasMap.get(current);
    if (!next || next === current) return current;
    current = next;
  }
  return current;
}

/**
 * Record that `newFn` replaces `oldFn` (HMR). `newFn` is the LATEST version,
 * so any stale forward edge from it (left by an edit-revert ping-pong like
 * A→B then B→A) is dropped first — otherwise the chain would cycle and
 * canonical resolution would depend on the starting point.
 */
export function aliasComponent(oldFn: Component, newFn: Component): void {
  if (oldFn === newFn) return;
  aliasMap.delete(newFn);
  aliasMap.set(oldFn, newFn);
}
