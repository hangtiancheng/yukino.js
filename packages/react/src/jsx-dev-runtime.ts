import type { Key, Props, VNode, VNodeType } from "./element";
import { jsx } from "./jsx-runtime";

export * from "./jsx-runtime";
export type { JSX } from "./jsx-runtime";

export function jsxDEV(
  type: VNodeType,
  props: Props | null,
  key?: Key | null,
  _isStaticChildren?: boolean,
  _source?: unknown,
  _self?: unknown,
): VNode {
  return jsx(type, props, key);
}
