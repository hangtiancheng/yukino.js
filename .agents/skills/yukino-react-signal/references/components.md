# Function Components, Hooks, Props & the Instance Lifecycle

Source of truth: `src/component.ts`, `src/hooks.ts`, `src/jsx/reconcile.ts`,
`src/component-registry.ts`, `src/types.ts` in `packages/react-signal`.

## The component contract

```ts
type FC<P = Record<string, unknown>> = (props: P) => JSXNode; // = Component<P>

// Used ONLY as a JSX tag:
//   <MyComp x={1} onSave={fn} key="k">slot content</MyComp>
// The reconciler mounts an INSTANCE per tag — never call components manually.
```

- The function **re-runs on every render pass** inside the instance's render
  effect — the body is the tracked template (React model on signals).
- `props` is a stable reactive proxy: reading `props.x` in the body
  subscribes the instance to that key only.
- Hostless: the component's output splices directly into the parent element
  (a comment end-anchor terminates the range). No wrapper `<div>` — list
  and table structures stay valid.
- Instances are matched across renders by **function identity + `key`**
  (HMR-canonicalized). A different function at the same position remounts.

## render / unmount (root API)

```ts
import { render, unmount } from "@yukino.js/react-signal";

render(<App />, container);      // first call clears the container's content
render(<App page={2} />, container); // re-render: diff in place, state survives
unmount(container);              // dispose all instances + effects, clear DOM
```

- Repeat `render()` diffs against the previous tree — matched instances keep
  their hook state and receive changed props through per-key signals (an
  embedding host can drive a component purely by repeated `render()` calls).
- Signal children/attributes at the root stay live without re-calling
  `render` (the root owns a render effect).
- `unmount` returns `false` when nothing was mounted on the container.

## Instance lifecycle

1. Parent render emits a component vnode → the reconciler creates an
   `Instance` (props signals seeded) + an end-anchor comment, positioned by
   the parent's order pass.
2. Post-commit (deferred op, untracked): `mountComponent` registers the
   instance (HMR) and creates its render effect — the first run renders.
3. Each pass: `beginRender` (hook cursor reset) → `fn(props)` TRACKED →
   `endRender` (hook-count check) → slice diff into the host between the
   previous nodes and the end anchor → post-commit flush (child mounts,
   prop pushes, refs) → `flushInstanceEffects` (pending mount `useEffect`s).
4. Prop updates: the parent's flush batch-writes changed keys into the
   instance's per-key signals; keys absent this round are removed
   (`undefined` — React removal semantics). The child re-renders only if it
   READ a changed key.
5. Unmount (tag disappears / `unmount(container)`): dispose the render
   effect FIRST (no re-entry) → destroy child instances bottom-up (child
   cleanups run before parent cleanups, React order) → dispose hook slots
   in reverse (`useSignalEffect` disposes, `useEffect` cleanups, `onCleanup`
   callbacks — all slots) → element refs get `null` → the
   DOM range (incl. anchor) is removed.

## Hooks (call-order slots — React rules of hooks)

Hooks read a module-level `currentInstance` — calling one outside a
component body throws. Because the body re-runs, hooks must run
unconditionally, in the same order, top-level only. A hook-count/type change
between renders dev-warns and resets the affected slots (HMR intentionally
resets closure-bound slots).

```ts
useSignal<T>(initial: T): Signal<T>
// Stable Signal per slot — created from `initial` on the first render only.
// THE instance-state primitive; survives re-renders AND HMR swaps.
// (A bare signal() in the body is recreated every render — don't.)

useRef<T = Element>(initial?: T | null): { current: T | null }
// Stable mutable cell — element refs (ref={r}) or non-reactive storage.
// Survives HMR swaps.

useComputed<T>(fn: () => T): ReadonlySignal<T>
// computed(fn) created ONCE — lazy, auto-tracked, no deps array. The
// closure is captured on the first render: read reactive inputs (signals /
// props / stores) inside it, not captured locals.

useSignalEffect(fn: () => void | (() => void)): void
// effect(fn) created once on mount, re-runs when any signal it read
// changes, disposed on unmount. Async bodies: read signals first, then
// untracked(() => ...). First-render closure (like useComputed).

useEffect(fn: () => (() => void) | void): void
// MOUNT-ONLY: runs once AFTER the first DOM commit (refs filled); a
// returned fn is the unmount cleanup. There is NO deps parameter — for
// data-driven re-runs use useSignalEffect (signals ARE the deps).

onCleanup(fn: () => void): void
// Register a teardown callback exactly once per slot — runs when the slot
// is disposed: on unmount, and on an HMR swap (the next render registers
// the new version's callback).

useBlocker(blocker)          // navigation blocker for the component lifetime
useUrlState(defaults)        // [value, stable setValue] — see state-routing.md
```

There are NO deps arrays anywhere: `useMemo` and `useEffect(fn, deps)` do
not exist. Derive → `useComputed`; react → `useSignalEffect`; mount/unmount
→ `useEffect(fn)`.

DOM access pattern (ref + mount effect — no `setTimeout` hacks):

```tsx
function SearchBox() {
  const input = useRef<HTMLInputElement>();
  useEffect(() => input.current?.focus());
  return <input ref={input} />;
}
```

Async server state: not part of this package — build SWR-style queries on
signals directly (`useSignal` for the cache + `useSignalEffect` for
refetching) or a dedicated data-fetching package.

## DOM events — per-node inline listeners

Events are camelCase props with **inline function values only**
(`onClick={fn}` → a `click` listener on that node). The reconciler attaches
ONE native listener per (node, event type) with a stable proxy; each render
swaps the proxy's `.current` handler, so closures never go stale and
removing the prop parks the listener. Dispatch runs inside `batch()`.

The handler receives the **native DOM event** — use `e.target` (hit element)
and `e.currentTarget` (the node carrying the handler). Closures capture loop
variables directly:

```tsx
{
  items.value.map((item) => (
    <button key={`del-${item.id}`} onClick={() => del(item.id)}>
      ×
    </button>
  ));
}
```

Multi-event = same fn on several props; modifiers = ordinary checks
(`if (!(e as MouseEvent).ctrlKey) return;`). Lowercase `onclick` props and
string handler values are rejected (XSS guard). Window/document listeners:
`useEffect` + `addEventListener`.

## Component props, callbacks, children, key

```tsx
import type { JSXNode } from "@yukino.js/react-signal";

function Parent() {
  const rows = useSignal<Row[]>([]);
  return (
    <Child key="c1" rows={rows.value} onSelect={(d) => pick(d)}>
      <em>slot content</em>
    </Child>
  );
}

function Child(props: {
  rows?: Row[];
  children?: JSXNode;
  onSelect?: (d: { id: number }) => void;
}) {
  return (
    <section>
      <ul>
        {(props.rows ?? []).map((r) => (
          <li key={`r-${r.id}`} onClick={() => props.onSelect?.({ id: r.id })}>
            {r.name}
          </li>
        ))}
      </ul>
      {props.children}
    </section>
  );
}
```

| Prop            | Behavior                                                            |
| --------------- | ------------------------------------------------------------------- |
| `key`           | Vnode-level compare key — preserves the INSTANCE across reorders    |
| `children`      | Delivered as `props.children` (JSXNode) — render `{props.children}` |
| callbacks       | Plain function props — child calls `props.onX?.(data)` directly     |
| everything else | The reactive `props` proxy — objects/functions by live reference    |

**Props flow (fine-grained):** per-key signals behind one stable proxy.
Reading `props.key` in the BODY subscribes to that key; parent re-renders
batch-write only CHANGED values (reference comparison) — an untouched prop
never re-renders the child. `key` never lands in props. A prop the parent
stops passing reads as `undefined`.

**Callbacks (React semantics):** no emitter, no trampolines — the child
invokes the prop. Call callbacks from HANDLERS (call-time proxy read =
always the latest parent closure, no subscription). Reading a callback prop
in the body would subscribe the child to its identity, which changes every
parent render. Compose across levels by wrapping:
`<GrandChild onPick={(d) => props.onPick?.(d * 2)} />`.

**Signal-as-prop:** pass the signal itself (`<Child count={count}/>`) — the
child reads `.value` in its own body and updates **without the parent
re-rendering** (component props are the one place signals are NOT
auto-unwrapped).

**No host element:** `class`/`style`/`id`/`ref` on a component tag are
ordinary props — the component applies them where it chooses
(`<div class={[styles["x"], props.class]}>`). React-19-style ref
forwarding: pass `props.ref` on to an element yourself.

**Children identity:** children vnodes are created in the PARENT's body —
slot signal reads subscribe the parent, and a child that reads
`props.children` re-renders whenever the parent re-renders (fresh vnode
identity — same as React).

## Component identity (no string registry)

Components are always direct function references — JSX tags, route
`component` entries, and `lazy()` results alike; there is no path-string
registry.

Internals (`src/component-registry.ts`): `aliasComponent(old, new)` +
`canonicalComponent(fn)` form the HMR alias chain the reconciler matches
through — stale imports (in parents or route tables) keep matching
hot-swapped instances.

## Composition patterns (no inheritance)

```tsx
// Higher-order component — wrap and forward props
function withLogging<P extends object>(Inner: FC<P>): FC<P> {
  return function Logged(props: P) {
    useEffect(() => () => console.log("destroyed"));
    return <Inner {...props} />;
  };
}

// Custom hooks — extract stateful logic
function useToggle(initial = false) {
  const on = useSignal(initial);
  return { on, toggle: () => (on.value = !on.value) };
}
```
