/**
 * JSX VNode model — the pure data layer of Yukino's JSX support.
 *
 * This module has ZERO runtime framework imports so it can be bundled into
 * the `jsx-runtime` / `jsx-dev-runtime` entries without dragging the
 * framework in (the `ReadonlySignal` import below is type-only — erased at
 * compile time).
 *
 * tsup bundles this module into more than one dist entry (the runtime
 * entries may share a chunk, while `index` carries its own copy), so module
 * instances are NOT shared across entries. All brand markers therefore use
 * `Symbol.for` (the global symbol registry) so that VNodes created by one
 * bundle instance are recognized by another — plain module-level symbols or
 * `instanceof` checks would fail across copies.
 */
import type { ReadonlySignal } from "../reactive";

// NOTE: marker types are `symbol`, NOT `unique symbol` — tsup emits an
// independent .d.ts per package entry, and two `unique symbol` declarations
// (dist/index.d.ts vs dist/jsx-runtime.d.ts) would be nominally unrelated
// types, breaking cross-entry assignability of VNode/RawHTML. Runtime
// identity comes from the global Symbol.for registry either way.

/** Brand marker for VNode objects (global symbol registry — cross-bundle safe). */
export const VNODE_MARK: symbol = Symbol.for("yukino.react-signal.vnode");

/** Brand marker for raw-HTML wrappers (global symbol registry — cross-bundle safe). */
export const RAW_MARK: symbol = Symbol.for("yukino.react-signal.raw");

/**
 * Fragment component — groups children without a wrapper element.
 *
 * `<>...</>` compiles to `jsx(Fragment, { children })`. The reconciler emits
 * the children directly; multi-root component output is supported, so a
 * Fragment is valid at the component root.
 */
export const Fragment: symbol = Symbol.for("yukino.react-signal.fragment");

/**
 * A function component: receives the reactive props proxy (children included
 * under `props.children`) and returns renderable JSX content.
 *
 * Every function tag mounts a component INSTANCE (React semantics, hostless —
 * no wrapper element). The function re-runs on every render pass inside the
 * instance's render effect; state lives in hooks (`useSignal`, `useEffect`,
 * ...). Reading `props.x` in the body subscribes the instance to that key.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Component<P = any> = (props: P) => JSXNode;

/** A JSX element produced by `jsx()` / `jsxs()` / `jsxDEV()`. */
export interface VNode {
  /** Brand marker — `Symbol.for("yukino.react-signal.vnode")`. */
  $$: symbol;
  /** Tag name, functional component, or `Fragment`. */
  type: string | Component | symbol;
  /** Props object including `children`. */
  props: Record<string, unknown>;
  /** Normalized `key` (from the jsx() third argument) — sibling compare key for the keyed diff. */
  key: string | undefined;
}

/** Wrapper marking a string as trusted raw HTML (created via `raw()`). */
export interface RawHTML {
  /** Brand marker — `Symbol.for("yukino.react-signal.raw")`. */
  $$: symbol;
  /** The raw HTML string (rendered without escaping). */
  html: string;
}

/**
 * Anything renderable as JSX content: elements, raw HTML, text-ish primitives
 * (`string` / `number`), readable signals (auto-unwrapped via a tracked
 * `.value` read — detected with `instanceof Signal` by the reconciler),
 * skipped values (`boolean` / `null` / `undefined` — enables
 * `{cond && <div/>}`), or arrays thereof.
 */
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

/**
 * Create a VNode. Shared by `jsx` / `jsxs` / `jsxDEV`.
 *
 * @param type - Tag name, functional component, or `Fragment`
 * @param props - Props object (children under `props.children`), may be null
 * @param key - The JSX `key` (passed as the automatic-runtime third argument)
 */
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

/**
 * Mark a string as trusted raw HTML. The content is rendered WITHOUT
 * escaping; never pass untrusted input.
 *
 * @example
 * <div>{raw(renderedMarkdown)}</div>
 */
export function raw(html: unknown): RawHTML {
  return { $$: RAW_MARK, html: html == null ? "" : String(html) };
}

/** Check whether a value is a VNode (cross-bundle safe via `Symbol.for`). */
export function isVNode(value: unknown): value is VNode {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { $$?: unknown }).$$ === VNODE_MARK
  );
}

/** Check whether a value is a `raw()` HTML wrapper. */
export function isRawHTML(value: unknown): value is RawHTML {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { $$?: unknown }).$$ === RAW_MARK
  );
}
