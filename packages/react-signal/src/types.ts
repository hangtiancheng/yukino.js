/**
 * Yukino framework type definitions.
 *
 * This module is the **single source of truth** for all shared types across
 * the framework. Defining them here (rather than inline in each module)
 * enforces a consistent interface contract and prevents circular type imports.
 *
 * ## Framework architecture
 *
 * Yukino is a lightweight frontend framework for single-page applications
 * and micro-frontend scenarios:
 *
 * - **Component** — plain function components `(props) => JSXNode` (`FC<P>`),
 *   mounted hostless by the VNode reconciler; state via hooks
 * - **Router** — `createRouter(routes)` factory (no module singleton):
 *   history-only, aligned with react-router's data model — a `location`
 *   signal, ranked `:param`/`*` route matching, `navigate`, async blockers,
 *   `<RouterView/>` outlet
 * - **Store** — zustand-aligned state management with `createStore` /
 *   `getState` / `setState` / `subscribe` / `computed`
 *
 * ## Design principles
 *
 * - Functional API — no `class`, no `this`, no `prototype`, no `mixin`
 * - Signals-based reactivity (`@preact/signals-core`) — read = subscribe,
 *   write = re-render; shallow (reference) comparison. Signals are the ONLY
 *   notification mechanism — there are no event emitters.
 * - Direct VNode → DOM reconciliation (hostless component instances, keyed
 *   diff, per-node event listeners)
 */

import type { ReadonlySignal } from "./reactive";
import type { Component } from "./jsx/vnode";

// ============================================================
// Function types
// ============================================================

/** Generic function type for event handlers and callbacks.
 *  Uses any[] to accept callbacks with specific parameter types
 *  (TypeScript function parameters are contravariant).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFunc = (...args: any[]) => unknown;

// ============================================================
// DOM types
// ============================================================

/**
 * Value for the JSX `ref` prop: a callback receiving the element (and `null`
 * on unmount), or a mutable `{ current }` cell (see `useRef`).
 */
export type RefValue =
  ((el: Element | null) => void) | { current: Element | null };

// ============================================================
// Component types
// ============================================================

/**
 * A function component (React-FC style): receives the reactive props proxy
 * and returns JSX. The function re-runs per render inside the instance's
 * render effect; state lives in hooks (`useSignal`, `useEffect`, ...).
 *
 * Alias of `Component<P>` for React muscle memory.
 */
export type FC<P = Record<string, unknown>> = Component<P>;

// ============================================================
// Router types (react-router data model)
// ============================================================

/**
 * The current location (react-router shape).
 */
export interface Location {
  /** Path portion of the URL, always starting with "/" (e.g. `/users/42`). */
  pathname: string;
  /** Search string including the leading "?" (or "" when absent). */
  search: string;
  /** Hash fragment including the leading "#" (or "" when absent). */
  hash: string;
  /** History state passed via `navigate(to, { state })`. */
  state: unknown;
  /** Unique key of the history entry (`"default"` for external entries). */
  key: string;
}

/**
 * A navigation target: a href string (`"/users/42?tab=posts#top"`) or a
 * partial path object. Omitted parts of the object form fall back to the
 * current location's pathname (search/hash default to "").
 */
export type To = string | { pathname?: string; search?: string; hash?: string };

/** Options for `Router.navigate` (react-router `NavigateOptions`). */
export interface NavigateOptions {
  /** Replace the current history entry instead of pushing a new one. */
  replace?: boolean;
  /** Arbitrary value stored on the history entry (read via `location.state`). */
  state?: unknown;
}

/**
 * A route definition. `path` supports dynamic segments (`/users/:id`) and a
 * trailing splat (`*`, `/files/*` — captured as `params["*"]`).
 *
 * The component comes from `component` (eager reference) or `lazy` (code
 * splitting / Module Federation — resolved on first match, then cached on
 * the route).
 */
export interface RouteObject {
  path: string;
  component?: Component;
  lazy?: () => Promise<Component | { default: Component }>;
}

/** A successful route match. */
export interface RouteMatch {
  /** The matched route definition. */
  route: RouteObject;
  /** Decoded params captured from `:param` segments (+ `"*"` for splats). */
  params: Record<string, string>;
  /** The pathname that was matched (basename already stripped). */
  pathname: string;
}

/**
 * A navigation blocker: receives `(next, current)` locations; returning or
 * resolving `false` (or throwing) blocks the navigation.
 */
export type Blocker = (
  next: Location,
  current: Location,
) => boolean | Promise<boolean>;

/**
 * History router instance (signals-first, react-router data model),
 * created by `createRouter(routes, { basename })`.
 *
 * All four signals are tracked reads: reading `.value` inside a component
 * body / `computed` / `useSignalEffect` subscribes the reader to navigation.
 */
export interface RouterApi {
  /** The current location (pathname is basename-stripped). */
  readonly location: ReadonlySignal<Location>;
  /** The current route match (or `null` when no route matches). */
  readonly match: ReadonlySignal<RouteMatch | null>;
  /** Params of the current match (`{}` when unmatched). */
  readonly params: ReadonlySignal<Record<string, string>>;
  /** Search params parsed from `location.search`. */
  readonly searchParams: ReadonlySignal<URLSearchParams>;
  /**
   * Navigate to a new location (react-router `navigate` semantics).
   *
   * - `navigate("/users/42?tab=posts")` — href string
   * - `navigate({ pathname: "/users/42", search: "?tab=posts" })` — partial path
   * - `navigate(-1)` — history traversal (delta)
   *
   * Navigating to the current href converts the push into a replace.
   * Resolves `false` when a blocker rejected the navigation.
   */
  navigate(to: To | number, options?: NavigateOptions): Promise<boolean>;
  /**
   * Register a navigation blocker; returns an unregister function. Blockers
   * run in registration order for pushes, replaces, AND history traversals
   * (blocked pops are reverted).
   */
  block(blocker: Blocker): () => void;
  /** Detach the popstate listener and clear blockers. */
  dispose(): void;
}

// ============================================================
// Cross-component state
// ============================================================

// Cross-component state is served by `createStore` (zustand-aligned) — see
// src/store.ts. There is no separate global State singleton and no
// Framework object: boot an app with
// `render(<RouterView router={createRouter(routes)}/>, container)`.
