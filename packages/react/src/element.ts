import type { Hook } from "./hooks";

export type Key = string | number | bigint;

export interface Props {
  [name: string]: any;
}

export type ComponentType<P extends Props = Props> = (props: P) => Children;

export type VNodeType = string | ComponentType | symbol;

export type Children =
  VNode | string | number | boolean | null | undefined | Children[];

export interface VNode {
  readonly type: VNodeType;
  readonly key: string | null;
  readonly props: Props;
  dom: Node | null;
  children: VNode[] | null;
  hooks: Hook[] | null;
  refCleanup: (() => void) | null;
}

export const Fragment = Symbol.for("yukino.react.fragment");
export const Text = Symbol.for("yukino.react.text");

export function createVNode(
  type: VNodeType,
  key: Key | null | undefined,
  props: Props,
): VNode {
  return {
    type,
    key: key === null || key === undefined ? null : String(key),
    props,
    dom: null,
    children: null,
    hooks: null,
    refCleanup: null,
  };
}

export function createElement(
  type: VNodeType,
  config?: (Props & { key?: Key }) | null,
  ...children: Children[]
): VNode {
  let key: Key | null = null;
  const props: Props = {};

  if (config) {
    for (const name of Object.keys(config)) {
      if (name === "key") {
        key = config.key ?? null;
        continue;
      }
      props[name] = config[name];
    }
  }
  if (children.length > 0) {
    props.children = children.length === 1 ? children[0] : children;
  }
  return createVNode(type, key, props);
}

function createTextVNode(nodeValue: string | number): VNode {
  return createVNode(Text, null, { nodeValue: String(nodeValue) });
}

export function toChildArray(
  children: Children,
  target: VNode[] = [],
): VNode[] {
  if (
    children === null ||
    children === undefined ||
    typeof children === "boolean"
  ) {
    return target;
  }
  if (Array.isArray(children)) {
    for (const child of children) {
      toChildArray(child, target);
    }
    return target;
  }
  if (typeof children === "string" || typeof children === "number") {
    target.push(createTextVNode(children));
    return target;
  }
  target.push(children);
  return target;
}
