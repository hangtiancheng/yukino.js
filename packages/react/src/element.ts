import type { Hook } from "./hooks";

export type Key = string | number | bigint;

export interface Props {
  [name: string]: any;
}

/** Function components only — no class components */
export type ComponentType<P extends Props = Props> = (props: P) => Children;

export type VNodeType = string | ComponentType | symbol;

/** The child node forms allowed in JSX */
export type Children =
  VNode | string | number | boolean | null | undefined | Children[];

/**
 * type / key / props are the immutable "descriptor", produced by the JSX
 * runtimes / createElement; dom / children / hooks / refCleanup are
 * "instance" fields, filled in by the renderer on mount / update.
 *
 * The descriptor is never mutated by the renderer (React's element immutability
 * principle); each diff produces fresh instance objects. Only the hooks array is
 * shared across renders — that is where component state lives.
 */
export interface VNode {
  readonly type: VNodeType;
  readonly key: string | null;
  readonly props: Props;
  /** Host DOM; function components and Fragments produce no DOM of their own, so this is always null */
  dom: Node | null;
  /** Normalized child instances; for function components this holds their render output */
  children: VNode[] | null;
  /** Owned by function components only; keeps the same array reference across renders */
  hooks: Hook[] | null;
  /** Cleanup returned by a function ref (React 19 ref-cleanup semantics); host elements only */
  refCleanup: (() => void) | null;
}

export const Fragment = Symbol.for("yukino.react.fragment");
export const Text = Symbol.for("yukino.react.text");

/** Shared descriptor factory for the classic (createElement) and automatic (jsx) runtimes */
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

/**
 * Normalize children: wrap strings/numbers into text VNodes, discard
 * null / undefined / boolean, and flatten nested arrays. After normalization a
 * level contains only VNodes, so the diff needs no further branching.
 *
 * Note: flattening does not rewrite keys, so keys must not collide across
 * multiple arrays at the same level.
 */
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
