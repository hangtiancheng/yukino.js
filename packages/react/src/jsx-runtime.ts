/**
 * JSX automatic runtime (`jsxImportSource: "@yukino.js/react"`).
 *
 * Runtime: `jsx`/`jsxs` build VNode descriptors; the incoming props object is
 * used verbatim (the compiler owns it — it may be frozen and MUST NOT be
 * mutated or copied). `children` stays inside props; `key` arrives as the
 * third argument.
 *
 * Types: the JSX namespace is DERIVED from `@types/react` (a types-only
 * dependency — the runtime never imports "react") with two adaptations:
 *   1. event handlers receive NATIVE events — every
 *      `(event: SyntheticEvent) => void` prop is remapped to
 *      `(event: NativeEvent & { currentTarget: TTag }) => void`;
 *   2. `ref` accepts this framework's `Ref<T>` (object ref, or callback ref
 *      optionally returning a cleanup — React 19 semantics).
 * Everything else (per-tag attributes, aria-*, data-*, CSSProperties, svg /
 * mathml tags) comes from `@types/react` unchanged.
 */

import type { ComponentRef, JSX as ReactJSX } from "react";
import { createVNode, Fragment } from "./element";
import type {
  Children,
  ComponentType,
  Key,
  Props,
  VNode,
  VNodeType,
} from "./element";

export { Fragment };

/** Ref shape accepted on host elements (React 19 callback-cleanup compatible) */
export type Ref<T> =
  { current: T | null } | ((instance: T | null) => void | (() => void)) | null;

export function jsx(
  type: VNodeType,
  props: Props | null,
  key?: Key | null,
): VNode {
  return createVNode(type, key, props ?? {});
}

export const jsxs = jsx;

/**
 * Remap a React synthetic-event handler prop to a native one. Matches any
 * single-argument function whose parameter looks like a SyntheticEvent
 * (probed via nativeEvent/currentTarget, which survives React's
 * bivarianceHack alias); every other prop type passes through unchanged
 * (`| undefined` unions survive via conditional-type distribution).
 */
type NativeHandler<H> = H extends (event: infer E) => void
  ? [E] extends [{ nativeEvent: infer N; currentTarget: infer C }]
    ? (event: N & { currentTarget: C }) => void
    : H
  : H;

/**
 * Per-tag props: drop React's ref, remap event handlers, retype `children`
 * as this framework's Children (React's ReactNode rejects VNode — VNodeType
 * includes the Fragment/Text symbols), add this framework's ref.
 */
type TagProps<P, T> = {
  [K in keyof P as K extends "ref" ? never : K]: K extends "children"
    ? Children
    : NativeHandler<P[K]>;
} & { ref?: Ref<T> | undefined };

type ReactIntrinsicElements = {
  [K in keyof ReactJSX.IntrinsicElements]: TagProps<
    ReactJSX.IntrinsicElements[K],
    ComponentRef<K>
  >;
};

export declare namespace JSX {
  type Element = VNode;
  type ElementType = string | ComponentType<any> | symbol;
  interface ElementChildrenAttribute {
    children: {};
  }
  interface IntrinsicAttributes {
    key?: Key | null | undefined;
  }
  // interface-extends keeps the map open for module augmentation (custom elements)
  interface IntrinsicElements extends ReactIntrinsicElements {}
}
