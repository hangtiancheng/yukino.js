import type { ReadonlySignal } from "./reactive";
import type { Component } from "./jsx/vnode";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFunc = (...args: any[]) => unknown;

export type RefValue =
  ((el: Element | null) => void) | { current: Element | null };

export type FC<P = Record<string, unknown>> = Component<P>;

export interface Location {
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
  key: string;
}

export type To = string | { pathname?: string; search?: string; hash?: string };

export interface NavigateOptions {
  replace?: boolean;
  state?: unknown;
}

export interface RouteObject {
  path: string;
  component?: Component;
  lazy?: () => Promise<Component | { default: Component }>;
}

export interface RouteMatch {
  route: RouteObject;
  params: Record<string, string>;
  pathname: string;
}

export type Blocker = (
  next: Location,
  current: Location,
) => boolean | Promise<boolean>;

export interface RouterApi {
  readonly location: ReadonlySignal<Location>;
  readonly match: ReadonlySignal<RouteMatch | null>;
  readonly params: ReadonlySignal<Record<string, string>>;
  readonly searchParams: ReadonlySignal<URLSearchParams>;
  navigate(to: To | number, options?: NavigateOptions): Promise<boolean>;
  block(blocker: Blocker): () => void;
  dispose(): void;
}
