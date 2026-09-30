/**
 * Hooks for function components (React rules of hooks, signals-only).
 *
 * The component function re-runs on EVERY render pass, so hooks are
 * call-order-indexed slots on the current instance: call them
 * unconditionally, in the same order, at the top level of the component body
 * — never inside conditions, loops, or event handlers.
 *
 * Signals are the SINGLE dependency-tracking mechanism — there are NO deps
 * arrays anywhere:
 * - derive values with `useComputed` (auto-tracked, lazy)
 * - run reactive side effects with `useSignalEffect` (auto-tracked)
 * - run one-time post-commit setup with `useEffect` (mount-only; cleanup on
 *   unmount)
 * - register teardown with `onCleanup`
 * - `useSignal(initial)` returns a stable `Signal` — write `sig.value` from
 *   handlers, read it in JSX. Only readers of that signal re-render.
 */
import {
  signal,
  computed,
  effect,
  type Signal,
  type ReadonlySignal,
} from "./reactive";
import { requireInstance, useValueSlot, useMountSlot } from "./component";

// ============================================================
// State hooks
// ============================================================

/**
 * Declare instance-local reactive state.
 *
 * Returns the SAME `Signal` on every render (created from `initial` on the
 * first). Reading `sig.value` in JSX subscribes the component; writing it
 * from a handler re-renders synchronously. State survives HMR swaps.
 *
 * @example
 * function Counter() {
 *   const count = useSignal(0);
 *   return <button onClick={() => count.value++}>{count.value}</button>;
 * }
 */
export function useSignal<T>(initial: T): Signal<T> {
  return useValueSlot(() => signal(initial), undefined, true);
}

/**
 * Create a stable mutable `{ current }` cell. Pass it to a JSX `ref` prop to
 * receive the DOM element after commit (`null` after unmount), or use it to
 * hold any mutable value across renders without triggering re-renders.
 *
 * @example
 * const input = useRef<HTMLInputElement>();
 * useEffect(() => input.current?.focus());
 * return <input ref={input} />;
 */
export function useRef<T = Element>(
  initial: T | null = null,
): { current: T | null } {
  return useValueSlot(() => ({ current: initial }), undefined, true);
}

/**
 * Create a derived `computed` once per instance. Reading `.value` in JSX
 * subscribes the component; the computation re-runs lazily when its signal
 * dependencies change — no deps array, dependencies are tracked
 * automatically.
 *
 * Note: the computation closure is captured on the FIRST render — read
 * reactive inputs (signals/props/stores) inside it, not captured locals.
 *
 * @example
 * const doubled = useComputed(() => count.value * 2);
 */
export function useComputed<T>(fn: () => T): ReadonlySignal<T> {
  return useValueSlot(() => computed(fn));
}

// ============================================================
// Effect hooks
// ============================================================

/**
 * Run a REACTIVE side effect: created once on mount, runs immediately and
 * re-runs whenever any signal it read changes (`@preact/signals-core`
 * `effect` semantics — no deps array). A returned function is the
 * between-runs / final cleanup. Disposed on unmount.
 *
 * Do not WRITE signals the callback also reads — that is a cycle. The
 * callback closure is captured on the first render; read reactive inputs
 * inside it.
 *
 * @example
 * useSignalEffect(() => {
 *   const path = router.location.value.pathname; // subscribe to navigation
 *   void loadContent(path);
 * });
 */
export function useSignalEffect(fn: () => void | (() => void)): void {
  useValueSlot(
    () => effect(fn),
    (dispose) => (dispose as () => void)(),
  );
}

/**
 * Run a one-time setup AFTER the first DOM commit (refs are filled). A
 * returned function is the unmount cleanup.
 *
 * This is mount-only — there is NO deps parameter. For side effects that
 * should re-run when data changes, use `useSignalEffect` (signals are the
 * dependency-tracking mechanism, not deps arrays).
 *
 * @example
 * useEffect(() => {
 *   const timer = setInterval(tick, 1000);
 *   return () => clearInterval(timer);
 * });
 */
export function useEffect(fn: () => void | (() => void)): void {
  useMountSlot(fn);
}

/**
 * Register a cleanup to run when the instance tears down. Registered once
 * per slot (safe under per-render re-runs — the first render's `fn` wins).
 * The callback runs when its slot is disposed: on unmount, and on an HMR
 * swap (the next render registers the new version's callback).
 */
export function onCleanup(fn: () => void): void {
  requireInstance("onCleanup");
  useValueSlot(
    () => fn,
    (value) => (value as () => void)(),
  );
}
