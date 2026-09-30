# Rendering Internals: Instance Effects, Anchor Slices & Batching

Source of truth: `src/jsx/reconcile.ts` (reconciler + `render`/`unmount`),
`src/component.ts` (instances, hook slots, props store).
Read this when debugging "why didn't it re-render", double renders, flicker,
lost focus, child instances unexpectedly remounting, or performance.

## The render effect (one per instance)

Every component instance gets exactly one `@preact/signals-core` `effect()`,
created in the post-commit flush of the pass that mounted it
(`mountComponent`). Its dispose lives on `instance.renderDispose` (run first
during teardown so nothing re-enters).

Each pass (`renderComponent`):

```
read instance.invalidate      // manual/HMR re-render channel
beginRender(instance)         // set currentInstance, hook cursor = 0
out = fn(props)               // TRACKED — dependency set re-collected from
                              // scratch every pass (branch switches update
                              // subscriptions automatically)
endRender(instance)           // hook-count stability check (dev warning)
patchChildren(host, prev, out, ns, END_ANCHOR)   // slice diff
untracked:
  flushOps                    // child instance mounts, batched prop pushes, refs
  flushInstanceEffects        // pending mount useEffect callbacks (run once)
```

Errors thrown during a pass BUBBLE to the signal write site (there is no
try-catch wrapper and no global error sink) — catch at the source or let it
crash loudly, React-style.

The root (`render(vnode, container)`) works the same way: a root record
holds a vnode signal + its own render effect, so repeat `render()` calls and
Signal children at the root both go through the normal diff.

There is **no dirty-checking, no digest queue, no dispatcher walk** — the
effect IS the dirty check.

## Hostless slices & the end anchor

An instance owns a contiguous DOM RANGE in its parent element:
`collectDoms(nodes) ++ [end]`, where `end` is a persistent comment node
(`<!---->`). Invariants:

- The slice's order pass is a REVERSE insertion walk anchored at `end`
  (the instance does not own the host, so there is no `firstChild` cursor).
  Element children use the same walk with a `null` anchor (append).
- Parents treat a component range as an opaque atomic unit when moving or
  removing keyed siblings — nested instance ranges are collected
  recursively.
- Empty output leaves just the anchor; the range grows/shrinks in place
  between stable siblings.
- Namespace is captured from the mount position (a component under
  `<foreignObject>` renders HTML, not SVG).

Anchors are comment nodes: invisible to layout and `querySelector`, but they
DO appear in `innerHTML` and affect `:empty` — strip `<!---->` in test
assertions.

## When do effects run?

- A plain signal write outside `batch()` re-runs subscribed effects
  **synchronously** at the write site.
- Writes inside `batch(fn)` coalesce — subscribers run once at batch end.
  Auto-batched call sites: per-node DOM event listeners, `store.setState`,
  prop pushes (`writeInstanceProps`), HMR swaps.
- Same-value writes (`===`) are no-ops.
- `computed` is lazy — it recomputes on read, only if a dependency changed.
- Cycle guard: an effect writing a signal it also reads throws
  `Cycle detected` (after 100 batch iterations).

**Re-entrancy protection** (why children never render mid-parent-pass):
new-instance mounts and prop pushes are DEFERRED ops flushed after the
slice's DOM commit inside `untracked()`; prop writes are batched, so a child
invalidated during a parent pass renders after the parent completes, exactly
once. Nested render passes save/restore the hook context (stack discipline).

## The keyed diff

Node kinds: **text**, **element**, **raw** (trusted HTML block),
**component** (instance + slice).

1. **Normalize** — flatten arrays/Fragments, unwrap Signal children (tracked
   read), drop `null/boolean/""`; function tags become component items
   (never invoked inline) with the HMR alias chain resolved HERE — once per
   vnode (`canonicalComponent`), keeping the diff hot path alias-free.
2. **Match** — explicit `key` → keyed map (first wins); unkeyed → positional
   pool, first compatible (same kind + tag / plain component-fn identity)
   unclaimed node. Incompatible matches are replaced, not patched.
3. **Patch / create** — text: `nodeValue`; element: attribute snapshot diff +
   recurse into children; raw: keep nodes when the html string is identical,
   otherwise swap the whole block; component: queue a props push (create =
   new instance + anchor, mounted post-commit).
4. **Remove** — unmatched old nodes are destroyed depth-first: render effect
   disposed first, child instances bottom-up, hook slots + `onCleanup`
   reverse, element refs get `null`, then the DOM range is removed.
5. **Order pass** — reverse walk anchored at the slice end (or `null` for
   element children), `insertBefore` any node not already in place.
6. **Post-commit flush (untracked)** — instance mounts, batched per-key prop
   pushes, ref calls. Child bodies never subscribe the parent's effect; each
   child owns its own render effect.

### Attribute snapshot diffing

Attributes are compared via a **resolved snapshot** per element: Signals
unwrapped, `class`+`className` merged into one string, `style` normalized to
a string. (Comparing raw props would miss Signal-valued attributes — the
instance is stable while `.value` changes.) Form-state props
(`value`/`checked`/`selected`) are synced as DOM **properties** and
re-asserted every render, so the template value wins over user edits.

### Events

One native listener per (node, type), attached once, with a stable proxy
holding `.current`. Renders swap `.current`; a removed handler prop parks
the binding (no removeEventListener churn). The proxy wraps handler calls in
`batch()`.

### Props store (`src/component.ts`)

Per-instance per-key signals behind one stable proxy (`props`). Parent
pushes batch-write changed values; previously-pushed keys absent this round
are deleted (child reads `undefined`). `key` never lands in props. Props are
**real in-memory objects end to end** — no wire attributes, no tokens, no
serialization.

## Runtime-injected DOM

DOM injected outside the component's output (e.g. a button appended by a
third-party lib) is invisible to the reconciler's bookkeeping: it is not
removed by diffs of SIBLING nodes, but content injected INSIDE a managed
element can be displaced when that element's children change, and the first
`render()` on a container clears any pre-existing static content. Own such
nodes via `ref` + `useEffect`, or replay the enhancement in a
`useSignalEffect` keyed to the same data.

## Debugging checklist

- Nothing re-rendered? The read was probably not in a tracked region (event
  handler / async callback are snapshots) — move the read into the component
  body, `useComputed`, or `useSignalEffect`.
- Write "didn't work"? Shallow comparison — in-place mutation is invisible;
  replace the reference (`sig.value = [...sig.value, x]`).
- `Cycle detected`? A body/computed/effect writes a signal it also reads —
  derive with `useComputed` or move the write to a handler.
- State resets every render? A bare `signal()`/object created in the body is
  recreated per pass — use `useSignal`/`useRef`.
- "Hooks can only be called inside a component function"? A hook ran in a
  handler/async callback, or a component was CALLED instead of used as a tag.
- Hook-count warning? A hook is inside a condition/loop — hoist it.
- Too many renders? Wrap multi-writes in `batch()` (handlers already are).
  A child re-rendering with every parent render usually reads a fresh-
  identity prop (inline object/children/callback) in its body.
- List not reordering / inputs losing state? Add stable `key`s to loop items
  (sibling-scoped; they are not DOM ids).
- Child instance remounting on every parent render? Its `key` or component
  function identity changes between renders; keep both stable (don't define
  components inside other components).
- HTML showing up as literal text? Strings are text by design — wrap trusted
  markup in `raw(html)`.
- Element ref is `null`? Refs fill post-commit — read them in
  `useEffect`, not during the render body.
- `<!---->` in innerHTML assertions? Those are instance/root end anchors —
  strip them when comparing markup.
