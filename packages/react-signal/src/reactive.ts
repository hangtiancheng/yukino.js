/**
 * Reactive core — the framework's single reactivity primitive set, backed by
 * `@preact/signals-core`.
 *
 * Every data source in yukino-react-signal is signal-based:
 * - component state: `useSignal()` hook slots read by component bodies
 * - props: per-key signals behind each instance's props proxy
 * - stores: per-key signals behind a tracked `getState()` proxy
 * - router: `location` / `match` / `params` / `searchParams` signals on the
 *   `createRouter` instance
 *
 * Each mounted component re-runs its function inside one `effect()` — any
 * signal read during the body subscribes the instance, and writes re-render
 * it synchronously (writes inside `batch()` coalesce into a single
 * re-render).
 *
 * ## Shallow reactivity
 *
 * Signals compare by reference (`===`). Mutating a nested field or calling
 * `arr.push()` does NOT notify — replace the reference instead:
 * `sig.value = [...sig.value, item]`. This matches React/Preact semantics.
 */
export {
  signal,
  computed,
  effect,
  batch,
  untracked,
  Signal,
} from "@preact/signals-core";
export type { ReadonlySignal } from "@preact/signals-core";
