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

type NativeHandler<H> = H extends (event: infer E) => void
  ? [E] extends [{ nativeEvent: infer N; currentTarget: infer C }]
    ? (event: N & { currentTarget: C }) => void
    : H
  : H;

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
  interface IntrinsicElements extends ReactIntrinsicElements {}
}
