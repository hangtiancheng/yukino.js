import type { ReadonlySignal } from "../reactive";

export const VNODE_MARK: symbol = Symbol.for("yukino.react-signal.vnode");

export const RAW_MARK: symbol = Symbol.for("yukino.react-signal.raw");

export const Fragment: symbol = Symbol.for("yukino.react-signal.fragment");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Component<P = any> = (props: P) => JSXNode;

export interface VNode {
  $$: symbol;
  type: string | Component | symbol;
  props: Record<string, unknown>;
  key: string | undefined;
}

export interface RawHTML {
  $$: symbol;
  html: string;
}

export type JSXNode =
  | VNode
  | RawHTML
  | ReadonlySignal<unknown>
  | string
  | number
  | boolean
  | null
  | undefined
  | JSXNode[];

export function createVNode(
  type: string | Component | symbol,
  props: Record<string, unknown> | null | undefined,
  key?: unknown,
): VNode {
  return {
    $$: VNODE_MARK,
    type,
    props: props || {},
    key: key == null ? undefined : String(key),
  };
}

export function raw(html: unknown): RawHTML {
  return { $$: RAW_MARK, html: html == null ? "" : String(html) };
}

export function isVNode(value: unknown): value is VNode {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { $$?: unknown }).$$ === VNODE_MARK
  );
}

export function isRawHTML(value: unknown): value is RawHTML {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { $$?: unknown }).$$ === RAW_MARK
  );
}
