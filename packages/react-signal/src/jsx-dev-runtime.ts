import { createVNode, type Component, type VNode } from "./jsx/vnode";

export * from "./jsx-runtime";

export function jsxDEV(
  type: string | Component | symbol,
  props: Record<string, unknown> | null | undefined,
  key?: unknown,
  _isStaticChildren?: boolean,
  _source?: unknown,
  _self?: unknown,
): VNode {
  return createVNode(type, props, key);
}
