/**
 * JSX automatic DEV runtime for `@yukino.js/react-signal`.
 *
 * Bundlers import `jsxDEV` from `<jsxImportSource>/jsx-dev-runtime` in
 * development mode (e.g. Vite dev server, vitest). The extra debug arguments
 * (`isStaticChildren`, `source`, `self`) are accepted and ignored — the
 * produced VNode is identical to the production runtime's.
 */

import { createVNode, type Component, type VNode } from "./jsx/vnode";

export * from "./jsx-runtime";

/**
 * Create a JSX element (dev-runtime entry).
 *
 * @param type - Tag name, functional component, or `Fragment`
 * @param props - Props object (children under `props.children`)
 * @param key - The JSX `key` (third argument per automatic-runtime convention)
 * @param _isStaticChildren - Debug info (ignored)
 * @param _source - Debug source location (ignored)
 * @param _self - Debug `this` reference (ignored)
 */
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
