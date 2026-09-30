# Signals, Store, Router & useUrlState

Source of truth: `src/reactive.ts`, `src/store.ts`, `src/router.ts`,
`src/url-state.ts`.

## The reactive core (re-exported @preact/signals-core)

```ts
import {
  signal,
  computed,
  effect,
  batch,
  untracked,
} from "@yukino.js/react-signal";
import type { Signal, ReadonlySignal } from "@yukino.js/react-signal";

const count = signal(1); // count.value read/write
const doubled = computed(() => count.value * 2); // derived, auto-tracked, lazy
const dispose = effect(() => log(count.value)); // runs now + on change
batch(() => {
  count.value = 2;
  count.value = 3;
}); // one notification
untracked(() => count.value); // read without subscribing
count.peek(); // same, signal-method form
```

Tracked regions (reads subscribe): **the component body**, **computed /
useComputed(fn)**, **effect / useSignalEffect(fn)**. Everything else (event
handlers, async callbacks) reads snapshots.

**Shallow semantics everywhere**: comparison is by reference (`===` /
`Object.is`). In-place mutation is invisible — replace the reference
(`sig.value = [...sig.value, x]`). Same-value writes are no-ops. Writing a
signal that the same tracked region reads throws `Cycle detected`.

**Signals are the ONLY reactive mechanism** — no event emitters, no deps
arrays, no error-swallowing wrappers. Cross-component state has ONE answer:
`createStore`; simple shared values are small stores or plain module-level
`signal()`s.

## createStore / computed (anonymous, zustand-aligned)

```ts
import { createStore, computed } from "@yukino.js/react-signal";

interface CountStore {
  count: number;
  step: number;
  doubled: number;
  increment: () => void;
}

const useCountStore = createStore<CountStore>((set, get) => ({
  count: 0,
  step: 1,
  doubled: computed(() => get().count * 2), // deps AUTO-tracked — no deps array
  increment() {
    set({ count: get().count + get().step });
  },
}));

useCountStore.getState(); // STABLE tracked proxy (see below)
useCountStore.setState({ count: 5 }); // batched; Object.is-equal values skipped
useCountStore.setState((prev) => ({ count: prev.count + 1 }));
useCountStore.setState({ count: 0 }, true); // replace: missing plain keys → undefined
const off = useCountStore.subscribe((state, prevState) => {
  /* every change */
});
const offSel = useCountStore.subscribe(
  (s) => s.count, // selector — fires only when slice changes
  (count, prevCount) => {
    /* ... */
  },
);
useCountStore.destroy(); // clears listeners; setState becomes no-op
```

Semantics (from `src/store.ts`):

- **Anonymous** — `createStore(creator)`, no name argument, no global
  registry (zustand `create` semantics). Module scope is the identity.
- Creator runs once. Functions become **actions** (immune to setState);
  `computed(fn)` return values (ReadonlySignals) become derived slots —
  dependencies are tracked automatically through `get()` proxy reads.
- `getState()` returns ONE stable proxy: reading a key inside a component
  body subscribes that instance to THAT key only. Spreading it
  (`{ ...getState() }`) yields a plain snapshot including actions.
- Writes to computed/action keys via `setState` are silently ignored;
  unknown keys create new state slots (zustand semantics).
- The `getState()` proxy is READ-ONLY — direct writes/deletes throw; go
  through `setState`. The `setState(prev => ...)` updater runs UNTRACKED:
  its reads never subscribe the caller (safe inside effects/bodies).

In components: **no hook needed** — read `getState()` in the body:

```tsx
export default function CounterButton() {
  const { count, doubled, increment } = useCountStore.getState();
  return (
    <button onClick={increment}>
      {count} ×2={doubled}
    </button>
  );
}
```

## Router (factory, history-only, react-router data model)

`createRouter(routes, { basename? })` is a plain factory — **all navigation
state lives on the instance** (no module-level singleton; MF-safe). The
instance is also recorded as the ACTIVE router, resolved by `useRouter()`
and used by `<RouterView/>` / `useUrlState` when no router is passed.

```ts
import { createRouter, useRouter } from "@yukino.js/react-signal";
import type { Location, RouteMatch, RouterApi } from "@yukino.js/react-signal";

const router = createRouter([
  { path: "/", component: Home },
  { path: "/users/:id", component: UserDetail },
  { path: "/admin", lazy: () => import("./views/admin") },
  { path: "*", component: NotFound },
]);

// FOUR signals — all tracked reads:
router.location.value; // { pathname, search, hash, state, key } (basename-stripped)
router.match.value; // RouteMatch | null — { route, params, pathname }
router.params.value; // { id: "42" } from "/users/:id" ("*" for splats)
router.searchParams.value; // URLSearchParams

// Navigation (react-router `navigate` semantics) — Promise<boolean>:
await router.navigate("/users/42?tab=posts#bio");
await router.navigate({ pathname: "/users/42", search: "?tab=posts" });
await router.navigate("/login", { replace: true, state: { from: "/admin" } });
await router.navigate(-1); // history traversal

// Blockers:
const unblock = router.block(async (next, current) => {
  if (next.pathname.startsWith("/admin")) return await checkAuth();
  return true; // false / throw → blocked
});

router.dispose(); // detach popstate listener (tests / teardown)
```

Semantics (from `src/router.ts`):

- ONE `location` signal per instance is the source of truth; `match` /
  `params` / `searchParams` are computeds. A committed navigation is
  exactly one signal write — subscribed instances re-render.
- **Matching** is ranked react-router style: static segments (+10) >
  dynamic `:param` (+3) > splat `*` (−2); ties resolve in registration
  order. Static compare is case-insensitive; param values are decoded.
  `matchPath(pattern, pathname)` / `matchRoutes(routes, pathname)` are
  exported pure functions.
- **navigate** to the current href converts push → replace (no duplicate
  entries). Resolves `false` when a blocker rejected.
- **Blockers on back/forward**: popstate fires AFTER the browser moved, so
  blockers are consulted at the target; on rejection the traversal is
  reverted via `history.go(delta)` (the echo popstate is swallowed) and the
  location signal never moves. `location.state` rides on `history.state`
  (wrapper `{ usr, key, idx }`); `location.key` is unique per entry.
- **basename**: stripped from `location.pathname` (react-router semantics —
  components see logical paths) and prepended to written hrefs; URLs
  outside the basename yield `match === null`.

### RouterView (the outlet component)

```tsx
import { render, createRouter, RouterView } from "@yukino.js/react-signal";

const router = createRouter(routes);
render(<RouterView router={router} />, document.getElementById("root")!);
// or, using the active router: render(<RouterView />, el)
```

`RouterView`'s body reads `router.match.value` (tracked) and returns the
matched component as a vnode — route dispatch IS the component diff:

- Route change → the matched component swaps (old instance unmounted).
- Param-only change → SAME instance (hook state survives); the component
  re-renders only if it read `router.params`/`location` (tracked).
- `lazy` routes: loads are deduped in flight and cached on the route
  object; a stale load can never overwrite a newer route (the body re-reads
  the CURRENT match). Load failures propagate as unhandled rejections.

### useRouter / useBlocker

```tsx
const router = useRouter(); // ACTIVE router (throws if none created)
useBlocker(() => !dirty.value); // registered on mount, unregistered on unmount
```

`useRouter` is a plain resolver (no hook slot — callable anywhere);
`useBlocker` is a real hook (slot-registered, component-only).

## useUrlState (component hook, stable setter)

```tsx
import { useUrlState } from "@yukino.js/react-signal";

export default function Pager() {
  const [params, setParams] = useUrlState({ page: "1", size: "20" });
  // params: URL search params merged over defaults (all strings) — a TRACKED
  //   read; the component re-renders on URL changes.
  // setParams: STABLE across renders (one slot per instance).
  //   setParams(patch | prevFn, { replace? }) navigates via the active
  //   router — other search params, pathname, and hash preserved;
  //   undefined/null values delete the key.
  return (
    <button
      onClick={() => setParams((p) => ({ page: String(Number(p.page) + 1) }))}
    >
      Page {params.page}
    </button>
  );
}
```

Component-only (a real hook — throws outside a component body). `defaults`
and the router are captured on the FIRST render. Omitting `defaults`
returns every current search param.
