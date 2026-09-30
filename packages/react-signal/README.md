# @yukino.js/react-signal

A lightweight TypeScript frontend framework for single-page applications and micro-frontend scenarios.

## Overview

yukino-react-signal is a functional-first framework built on **signals reactivity**
(`@preact/signals-core`) with **React-style function components**. A
component is a plain function `(props) => JSX`; it re-runs per render inside
its own render effect — reading a signal (or a prop) subscribes the
instance, writing it re-renders synchronously. Rendering is a direct
**VNode → DOM reconciler** with **hostless component instances**: no wrapper
elements, no virtual-DOM double bookkeeping, no HTML-string serialization.

```tsx
import { render, useSignal } from "@yukino.js/react-signal";

function Counter(props: { step?: number }) {
  const count = useSignal(0);
  return <button onClick={() => (count.value += props.step ?? 1)}>Count: {count.value}</button>;
}

render(<Counter step={2} />, document.getElementById("root")!);
```

Design principles:

- Functional API: no class, no this, no prototype, no mixin
- React FC authoring model: plain functions, call-order hooks, callback
  props, `children`, `key`, `ref`
- Signals-based reactivity — read = subscribe, write = re-render; **shallow**
  (reference) comparison, like React/Preact. Signals are the ONLY
  notification mechanism — there are no event emitters.
- Hostless reconciliation — component output splices directly into the
  parent element (output DOM identical to React's)
- Fine-grained updates — one render effect per component instance; props are
  per-key signals, so a child re-renders only when a prop it READ changed
- History-only router aligned with react-router's data model (`location`
  signal, ranked `:param`/`*` matching, `navigate`, blockers)
- Async server state (SWR-style queries) is intentionally **out of scope** —
  it belongs to a dedicated data-fetching package built on the same signals
- One runtime dependency: `@preact/signals-core` (~1.5 kB gzip)

## Architecture

```
         render(<App/>, container)     render(<RouterView router={r}/>, container)
                          |                             |
                          |               router.match signal → matched component
                          +-------------+---------------+
                                        |
                        component INSTANCE (per function tag)
                                        |
             one render effect  (@preact/signals-core)
                                        |
         fn(props)  -- TRACKED: signal reads + props.key reads subscribe
                                        |
         VNode slice diff  -- keyed match, per-node listeners, anchors
                                        |
         post-commit flush (untracked) -- child mounts, prop pushes, refs
                                        |
         flushInstanceEffects -- pending useEffect (mount) callbacks run
                                        |
signal / prop write --> only SUBSCRIBED instances re-render (batched)
```

Every function tag mounts an **instance** whose rendered children live
directly in the parent element as a contiguous range terminated by a
persistent comment anchor. Parents and children re-render independently;
prop pushes are batched per-key signal writes, so an unchanged prop never
touches the child.

## Installation

```bash
# pnpm
pnpm add @yukino.js/react-signal

# npm
npm install @yukino.js/react-signal

# yarn
yarn add @yukino.js/react-signal
```

`@preact/signals-core` is installed automatically as the framework's only
runtime dependency.

### TypeScript setup

Enable the automatic JSX runtime in `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@yukino.js/react-signal",
  },
}
```

Add `"@yukino.js/react-signal/client"` to `types` (or a triple-slash reference) for
`*.css` module declarations and the HMR globals.

### Bundler plugin

Install the bundler plugin matching your build tool. The Vite plugin also
defaults `oxc.jsx = { runtime: "automatic", importSource: "@yukino.js/react-signal" }`
for you; with Webpack the JSX transform comes from your existing
TS/SWC/Babel loader reading the tsconfig above. Both plugins auto-inject
state-preserving component HMR (no `import.meta.hot` boilerplate needed)
and skip the injection in production builds.

> Linking this package via the `file:` protocol? Vite's dependency
> pre-bundle cache is keyed by the lockfile, not by dep contents — after
> rebuilding yukino-react-signal run `vite --force` (or delete `node_modules/.vite`)
> so the browser picks up the new build.

```ts
// vite.config.ts
import { yukinoReactSignalPlugin } from "@yukino.js/react-signal/vite";

export default defineConfig({
  plugins: [yukinoReactSignalPlugin()],
});
```

```ts
// webpack.config.js — plugin form (recommended, zero config)
import { YukinoReactSignalPlugin } from "@yukino.js/react-signal/webpack";

export default {
  plugins: [new YukinoReactSignalPlugin()],
};
```

## Quick Start

### 1. Write a function component

```tsx
// src/views/home.tsx
import { useSignal } from "@yukino.js/react-signal";

export default function Home() {
  const count = useSignal(0);
  return (
    <div class="home">
      <h1>Welcome to Yukino</h1>
      <p>Count: {count.value}</p>
      <button onClick={() => count.value++}>Increment</button>
    </div>
  );
}
```

That's the whole reactive loop: the body reads `count.value` (subscribe),
the click handler writes it (re-render). The function re-runs per render;
`useSignal` state survives because hooks are call-order-indexed slots on the
instance.

### 2a. Mount directly (React-DOM style)

```ts
// src/main.ts
import { render } from "@yukino.js/react-signal";
import Home from "./views/home";

render(<Home />, document.getElementById("root")!);
```

### 2b. Or boot with routing

There is no framework boot object — a routed app is `createRouter` (a plain
factory, react-router data model) plus a `<RouterView/>` outlet:

```tsx
// src/main.ts
import { render, createRouter, RouterView } from "@yukino.js/react-signal";
import Home from "./views/home";
import UserDetail from "./views/user-detail";
import NotFound from "./views/not-found";

const router = createRouter([
  { path: "/", component: Home },
  { path: "/users/:id", component: UserDetail },
  { path: "/admin", lazy: () => import("./views/admin") },
  { path: "*", component: NotFound },
]);

render(<RouterView router={router} />, document.getElementById("root")!);
```

Routes hold component references (or per-route `lazy()` loaders — code
splitting / Module Federation). Matching is react-router style: `:id`
dynamic segments, `*` splats, ranked (static > dynamic > splat). Every
navigation re-renders `<RouterView/>` — the same component keeps its
instance across param-only changes (state survives), and components read URL
data through the router's tracked signals (`useRouter().params.value`,
`useUrlState`).

### 3. HTML entry point

```html
<!doctype html>
<html>
  <head>
    <title>Yukino App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

## Reactivity

The framework re-exports the `@preact/signals-core` primitives — they are the
single reactivity mechanism for everything:

```ts
import { signal, computed, effect, batch, untracked } from "@yukino.js/react-signal";
import type { Signal, ReadonlySignal } from "@yukino.js/react-signal";

const count = signal(1); //   count.value  (read/write)
const doubled = computed(() => count.value * 2); // derived, auto-tracked, lazy
const dispose = effect(() => console.log(count.value)); // runs now + on change
batch(() => {
  count.value = 2;
  count.value = 3; // effects notified ONCE, at batch end
});
untracked(() => count.value); // read without subscribing
```

### Tracked regions

A signal read subscribes the reader **only inside a tracked region**:

| Region                               | Established by               |
| ------------------------------------ | ---------------------------- |
| The component function body          | the instance's render effect |
| `computed(fn)` / `useComputed(fn)`   | the computed                 |
| `useSignalEffect(fn)` / `effect(fn)` | the effect                   |

Every reactive data source in the framework is signal-backed, so reading it
in a tracked region subscribes automatically:

| Source               | Tracked read                     | Write                           |
| -------------------- | -------------------------------- | ------------------------------- |
| instance-local state | `sig.value` (`useSignal`)        | `sig.value = next`              |
| props                | `props.key`                      | parent re-render (per-key push) |
| stores               | `store.getState().key`           | `store.setState({...})`         |
| router               | `router.location.value` (et al.) | `router.navigate(...)`          |

Reads outside a tracked region (event handlers, async callbacks) return the
current value without subscribing — use `.peek()` / `untracked()` when you
want to be explicit about it.

### Shallow reactivity (important)

Signals compare by **reference** (`===`), exactly like React state:

```ts
const list = signal([1, 2]);

list.value.push(3); // ✗ in-place mutation — nothing re-renders
list.value = [...list.value, 3]; // ✓ replace the reference

const user = signal({ name: "a" });
user.value.name = "b"; // ✗ invisible
user.value = { ...user.value, name: "b" }; // ✓
```

The same rule applies to `store.setState` and props: pushing
the **same object reference** again is a no-op; deriving new data requires a
new reference. There is no deep proxy and no dependency on property paths —
one signal per key, compared by identity.

### Rules

- **Do not write a signal that the same body/computed reads.** The effect
  would invalidate itself; `@preact/signals-core` throws `Cycle detected`
  after 100 batch iterations. Derive with `computed`, or write from event
  handlers / `useSignalEffect` with disjoint reads.
- Event handlers already run inside `batch()` — multiple writes in one
  handler produce one render pass per affected instance.
- Rules of hooks apply (the body re-runs per render): call hooks
  unconditionally, in the same order, at the top level of the component.

## Core Concepts

### Components

A component is a plain function used as a JSX tag — never called manually.
Every function tag mounts an **instance** with its own hook slots, props
signals, and render effect. There is no wrapper element: the component's
output is spliced directly into the parent (so `<ul><Row/></ul>` produces
valid `<ul><li>...</li></ul>` DOM).

```tsx
import { useSignal, useComputed, useEffect } from "@yukino.js/react-signal";

interface Props {
  items?: string[];
  onPick?: (data: { item: string }) => void;
}

export default function Picker(props: Props) {
  const query = useSignal("");
  const filtered = useComputed(() => (props.items ?? []).filter((i) => i.includes(query.value)));

  useEffect(() => {
    const timer = setInterval(() => console.log("tick"), 1000);
    return () => clearInterval(timer);
  });

  return (
    <div>
      <input
        value={query.value}
        onInput={(e) => (query.value = (e.target as HTMLInputElement).value)}
      />
      <ul>
        {filtered.value.map((item) => (
          <li key={item} onClick={() => props.onPick?.({ item })}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

The body is the tracked template — it re-runs per render. Derived data is
ordinary code inline, or `useComputed` when it should cache.

### Hooks

Hooks are call-order-indexed slots on the current instance (React rules of
hooks). All state survives re-renders; `useSignal`/`useRef` also survive HMR
swaps.

Signals are the SINGLE dependency-tracking mechanism — there are **no deps
arrays** (no `useMemo`, no `useEffect(fn, deps)`): derive with `useComputed`,
react with `useSignalEffect`, and use `useEffect` only for one-time
mount/unmount setup.

| Hook                    | Semantics                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `useSignal(initial)`    | Stable `Signal` per slot — read in JSX (subscribe), write from handlers (re-render)     |
| `useRef(initial?)`      | Stable `{ current }` cell — element refs (`ref={r}`) or mutable non-reactive storage    |
| `useComputed(fn)`       | `computed(fn)` created once — derived data, dependencies auto-tracked                   |
| `useSignalEffect(fn)`   | Reactive effect created once — re-runs when signals it read change; disposed on unmount |
| `useEffect(fn)`         | MOUNT-ONLY: runs once after the first DOM commit; returned fn = unmount cleanup         |
| `onCleanup(fn)`         | Register an unmount cleanup (once per slot)                                             |
| `useBlocker(fn)`        | Register a navigation blocker for the component's lifetime                              |
| `useUrlState(defaults)` | `[value, setValue]` — URL search params as tracked state (setter is stable)             |

```tsx
// DOM access: ref + mount effect
const input = useRef<HTMLInputElement>();
useEffect(() => input.current?.focus());
return <input ref={input} />;
```

```tsx
// Window listeners: useEffect (mount/unmount); reactive side effects: useSignalEffect
const width = useSignal(window.innerWidth);
useEffect(() => {
  const onResize = () => (width.value = window.innerWidth);
  window.addEventListener("resize", onResize);
  return () => window.removeEventListener("resize", onResize);
});
useSignalEffect(() => {
  document.title = `width: ${width.value}`;
});
```

### render / unmount

React-DOM-style root API:

```ts
import { render, unmount } from "@yukino.js/react-signal";

render(<App />, container); // first call takes ownership (clears content)
render(<App page={2} />, container); // re-render: diff in place, state survives
unmount(container); // dispose everything, run cleanups, clear DOM
```

- Repeat `render()` calls diff against the previous tree: instances are
  matched by function identity (and `key`), changed props are pushed through
  per-key signals.
- Signal children/attributes in the tree stay live without re-calling
  `render` (the root owns a render effect too).

### Component props, callbacks, children, key, ref

Props are **real in-memory objects** delivered through a stable reactive
proxy — reading `props.key` in the body subscribes the instance to THAT key
only.

```tsx
function Parent() {
  const rows = useSignal<Row[]>([]);
  return (
    <Child key="c1" rows={rows.value} onSelect={(d) => console.log(d)}>
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

| Prop            | Behavior                                                                   |
| --------------- | -------------------------------------------------------------------------- |
| `key`           | Vnode-level sibling compare key — preserves the instance across reorders   |
| `children`      | Delivered as `props.children` (JSXNode)                                    |
| callbacks       | Plain function props — the child calls them directly (`props.onX?.(data)`) |
| everything else | The child's reactive `props` proxy — objects/functions by live reference   |

Notes:

- **Callbacks are just props** (React semantics) — there is no event
  emitter, no trampoline, no `fire()`. Compose by wrapping:
  `<Grandchild onPick={(d) => props.onPick?.(transform(d))} />`.
- **Fine-grained updates**: a parent re-render pushes only CHANGED prop
  values (reference comparison); the child re-renders only if it read a
  changed key. A prop the parent stops passing reads as `undefined`.
- **Signal-as-prop**: pass the signal itself (`<Child count={count} />`) —
  the child reads `.value` in its own body and updates **without the parent
  re-rendering** (component props are the one place signals are NOT
  auto-unwrapped).
- `class`/`style`/`id`/`ref` on a component tag are **ordinary props** — the
  component decides where they land (there is no host element). React 19
  style: `ref` is a normal prop to forward.
- Children vnodes are created in the PARENT's body, so signal reads inside
  slot expressions subscribe the parent (React semantics).

### Routing

The router is a **factory** (`createRouter` — no module-level singleton
state, MF-friendly), **history-only**, and aligned with react-router's data
model. Everything derives from ONE `location` signal — reading any router
signal inside a component body, `computed`, or `useSignalEffect` subscribes
the reader to navigation. There are no router events.

```ts
import { createRouter } from "@yukino.js/react-signal";

const router = createRouter(routes, { basename: "/app" }); // options optional

// The current location (react-router shape) — a tracked read:
const { pathname, search, hash, state, key } = router.location.value;

// Derived signals:
router.match.value; // RouteMatch | null   ({ route, params, pathname })
router.params.value; // { id: "42" }        (from "/users/:id")
router.searchParams.value; // URLSearchParams

// Navigate (react-router `navigate` semantics):
await router.navigate("/users/42?tab=posts#bio");
await router.navigate({ pathname: "/users/42", search: "?tab=posts" });
await router.navigate("/login", { replace: true, state: { from: "/admin" } });
await router.navigate(-1); // history traversal

router.dispose(); // detach the popstate listener (tests / teardown)
```

`navigate` resolves `false` when a blocker rejected the navigation.
Navigating to the current href converts the push into a replace (no
duplicate history entries).

`createRouter` records the instance as the **active router**, resolved by
`useRouter()` (and by `<RouterView/>` / `useUrlState` when no router is
passed). Components read the signals directly — there are no
useLocation/useParams-style alias hooks:

```tsx
import { useRouter } from "@yukino.js/react-signal";

function UserDetail() {
  const router = useRouter();
  const { id } = router.params.value; // tracked — re-renders on navigation
  return (
    <div>
      <p>user {id}</p>
      <button onClick={() => router.navigate("/")}>Home</button>
    </div>
  );
}
```

#### Route matching

Flat route tables with react-router path syntax and ranking:

| Pattern      | Matches          | `params`             |
| ------------ | ---------------- | -------------------- |
| `/`          | `/` only         | `{}`                 |
| `/users/:id` | `/users/42`      | `{ id: "42" }`       |
| `/files/*`   | `/files/a/b.txt` | `{ "*": "a/b.txt" }` |
| `*`          | anything         | `{ "*": "..." }`     |

All candidates are ranked — static segments outrank dynamic ones, splats
rank last — so `/users/new` beats `/users/:id` regardless of registration
order. Static comparison is case-insensitive; `:param` values are decoded.

#### Blockers

`router.block(blocker)` replaces guard events. Blockers may be async;
`false` (or a throw) blocks. Blocked history traversals (back/forward) are
reverted via `history.go(delta)`. `useBlocker(fn)` is the component-scoped
form (registered on mount, unregistered on unmount — react-router
`useBlocker`):

```tsx
const unblock = router.block(async (next, current) => {
  if (next.pathname.startsWith("/admin")) return await checkAuth();
  return true;
});
// Later: unblock()

// Or for a component's lifetime:
function EditForm() {
  useBlocker(() => !isDirty.value || confirm("Discard changes?"));
  return <form>…</form>;
}
```

#### RouterView (route dispatch)

`<RouterView router={router}/>` is the outlet component — its body reads
`router.match.value` (tracked), so every committed navigation re-renders it
through the normal component diff:

- Route change → the matched component swaps (old instance unmounted).
- Param-only change → SAME instance; the component re-renders only if it
  read `router.params` / `router.location` (tracked reads).
- `lazy` routes resolve once (in-flight dedup, cached on the route); a stale
  load can never overwrite a newer route because the body always re-reads
  the CURRENT match. Load failures propagate (unhandled rejection) — no
  swallowing.

#### useUrlState

`useUrlState(defaults)` syncs component state with URL search params —
`[value, setValue]`, react `useState` shape:

```tsx
import { useUrlState } from "@yukino.js/react-signal";

export default function Pager() {
  const [params, setParams] = useUrlState({ page: "1", size: "20" });
  return (
    <button onClick={() => setParams((p) => ({ page: String(Number(p.page) + 1) }))}>
      Page {params.page}
    </button>
  );
}
```

A real hook (component-only): the value is a tracked read (the component
re-renders on URL changes) and `setValue` is a STABLE function (one slot per
instance). `setValue(patch, { replace? })` navigates via the active router,
preserving the pathname, hash, and unrelated search params;
`undefined`/`null` values delete the key. Defaults are captured on the
first render.

### State Management

Cross-component state has ONE answer: `createStore` (zustand-aligned,
per-key signals). There is no separate global "State" singleton — a store is
just a module-scoped object, and simple values are simply small stores (or
plain module-level `signal()`s).

```tsx
import { createStore, computed } from "@yukino.js/react-signal";

const counterStore = createStore((set, get) => ({
  count: 0,
  step: 1,

  // Derived: dependencies tracked automatically — no deps array
  doubled: computed(() => get().count * 2),

  // Actions: functions attached to state
  increment() {
    set({ count: get().count + get().step });
  },
  setStep(step: number) {
    set({ step });
  },
}));

// Read state — getState() returns a STABLE tracked proxy: reading a key
// inside a component body subscribes that instance to THAT key only.
counterStore.getState().count;

// Update state — batched; Object.is-equal values are skipped
counterStore.setState({ count: 5 });
counterStore.setState({ count: 0 }, true); // replace: missing plain keys → undefined

// Manual subscriptions (zustand semantics)
const unSub = counterStore.subscribe((state, prevState) => {});
const unSel = counterStore.subscribe(
  (s) => s.count, // selector — fires only when the slice changes
  (count, prevCount) => {},
);

// In a component — no hook needed, just read in the body:
export default function CounterButton() {
  const { count, doubled, increment } = counterStore.getState();
  return (
    <button onClick={increment}>
      {count} (doubled: {doubled})
    </button>
  );
}
```

Notes:

- Stores are **anonymous** (zustand `create` semantics) — no name argument,
  no global registry; module scope is the store's identity.
- `getState()` is one stable proxy — spreading it (`{ ...getState() }`)
  produces a plain snapshot (and subscribes to all keys read).
- Writes to computed/action keys via `setState` are silently ignored;
  unknown keys create new state slots (zustand semantics).
- Shallow: `setState({ list: get().list })` after an in-place `push` is a
  no-op — build a new array.

### Data Fetching

Async server state (SWR/TanStack-style queries) is deliberately **not part
of this package**. Build it on the same signal primitives — a query result
is just `{ data, error, isFetching }` signals that any component body can
read — or wait for the dedicated data-fetching package. Nothing in the
framework core assumes a particular fetching layer.

## JSX Semantics

JSX compiles to plain `jsx()` calls via the standard automatic runtime; the
VNode tree is pure data reconciled directly into the live DOM. There is no
template compiler — conditionals, loops, and formatting are ordinary code.

### Children semantics

| JSX                      | Behavior                                                            |
| ------------------------ | ------------------------------------------------------------------- |
| `{expr}` (string/number) | Text node (`0` renders; `boolean/null/undefined/""` render nothing) |
| `{sig}` (Signal)         | Auto-unwrapped to `sig.value` (tracked read)                        |
| `{raw(html)}`            | Trusted raw HTML block — never pass untrusted input                 |
| `{cond && <div/>}`       | Conditional rendering (falsy values are dropped)                    |
| `{list.map(...)}`        | List rendering (arrays are flattened)                               |
| `<>...</>` (Fragment)    | Multiple roots without a wrapper element                            |
| `<Comp prop={x}/>`       | Function component — mounts a hostless INSTANCE (state, hooks)      |

Strings are ALWAYS text — dangerous characters stay text data, nothing is
parsed as markup. `raw()` is the single explicit trusted-HTML path
(dangerouslySetInnerHTML equivalent).

### Attribute semantics

| Attribute                        | Behavior                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| `class` / `className`            | String, array (falsy entries dropped), or `{ name: boolean }` map — merged               |
| `style`                          | String, or camelCase object (kebab-cased; `--x` custom props pass through)               |
| `key`                            | Vnode-level sibling compare key (React semantics) — NOT written to the DOM               |
| `ref`                            | `(el \| null) => void` callback or `{ current }` cell — called post-commit               |
| `disabled={true}`                | Boolean attribute → `disabled=""`; `false`/nullish remove the attribute                  |
| `title={sig}`                    | Signal attribute values auto-unwrap (tracked read)                                       |
| `value` / `checked` / `selected` | Synced as DOM **properties** on form elements; template value re-asserts over user edits |
| `data-x={object}`                | NOT supported — objects/functions are skipped with a dev warning                         |
| `onClick={fn}`                   | Per-node listener — inline functions only                                                |

SVG (`<svg>`) and MathML (`<math>`) subtrees create namespaced elements;
`<foreignObject>` children return to the HTML namespace.

### Event binding

Events use React-style camelCase props with **inline function values only**;
the type is the lowercased remainder (`onClick` → `click`). Each node gets
ONE native listener per event type with a stable proxy whose `.current`
handler is swapped every render — closures never go stale:

```tsx
{
  items.value.map((item) => (
    <button key={`del-${item.id}`} onClick={() => deleteItem(item.id)}>
      Delete
    </button>
  ));
}
```

Notes:

- Handlers receive the **native DOM event** — use `e.target` /
  `e.currentTarget`.
- Handlers run inside `batch()` — multiple signal writes in one handler
  produce ONE render pass per affected instance.
- Lowercase `onclick`-style props and string handler values are rejected
  (native inline handlers would execute attribute text as JavaScript).
- Window/document listeners: use `useEffect` + `addEventListener`.

## Hot Module Replacement

HMR hot-swaps component code without a full page reload, preserving instance
state.

On module update, `hotSwapByComponent(old, new)`:

1. Aliases the new function to the old one — parents (or route tables)
   holding the stale import keep matching live instances (canonical
   identity).
2. Swaps every live instance in place: **`useSignal`/`useRef` slots
   survive**; closure-bound slots (effects, computeds, memos) are disposed
   and recreated by the next render so no stale closures linger. The
   instance re-renders with the new code.

The bundler plugins auto-inject the HMR boilerplate at compile time into
every `.tsx`/`.jsx` module with a default export (runtime guards make
non-component exports a no-op). Users never write `import.meta.hot` /
`import.meta.webpackHot` themselves.

## Micro-Frontend Support

Micro-frontend and code-splitting scenarios go through per-route `lazy()`
loaders — the react-router data-mode pattern:

```ts
const router = createRouter([
  { path: "/", component: Home },
  // Code splitting: a plain dynamic import
  { path: "/admin", lazy: () => import("./views/admin") },
  // Module Federation: import from the remote
  { path: "/remote/*", lazy: () => import("remote_app/views/detail") },
]);
render(<RouterView router={router} />, container);
```

`lazy()` resolves a component (or a `{ default }` module); loads are
deduped in flight and the result is cached on the route, so subsequent
matches render synchronously. Share `@yukino.js/react-signal` as a singleton in the MF
`shared` config — the router factory keeps navigation state per instance,
and the "active router" pointer (used by `useRouter`) lives in the shared
singleton.

## API Reference

### Exports

| Category  | Exports                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------- |
| Reactive  | `signal`, `computed`, `effect`, `batch`, `untracked`, `Signal`, `ReadonlySignal` (type)        |
| Rendering | `render`, `unmount`, `raw`, `Fragment`                                                         |
| Hooks     | `useSignal`, `useRef`, `useComputed`, `useSignalEffect`, `useEffect` (mount-only), `onCleanup` |
| Router    | `createRouter`, `RouterView`, `useRouter`, `useBlocker`, `matchPath`, `matchRoutes`            |
| State     | `createStore`, `useUrlState`                                                                   |
| HMR       | `hotSwapByComponent` (also on `globalThis.__yukino_hmr__`)                                     |
| Types     | All types from `./types` via `export *` (`FC`, `Location`, `RouteObject`, `RouterApi`, ...)    |

### Package Entry Points

| Import                                    | Description                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| `@yukino.js/react-signal`                 | Main runtime API (`render`, hooks, `raw`, `Fragment`, ...)                 |
| `@yukino.js/react-signal/jsx-runtime`     | JSX automatic runtime (`jsx`, `jsxs`, `Fragment`, `raw`, JSX types)        |
| `@yukino.js/react-signal/jsx-dev-runtime` | JSX automatic dev runtime (`jsxDEV`)                                       |
| `@yukino.js/react-signal/vite`            | Vite plugin (`yukinoReactSignalPlugin`)                                    |
| `@yukino.js/react-signal/webpack`         | Webpack integration (`YukinoReactSignalPlugin`, `yukinoReactSignalLoader`) |
| `@yukino.js/react-signal/client`          | Ambient types (`*.css` modules, HMR globals)                               |

## Configuration

### createRouter(routes, options?)

| Option     | Type     | Default | Description                                               |
| ---------- | -------- | ------- | --------------------------------------------------------- |
| `basename` | `string` | -       | Base path prepended to hrefs and stripped before matching |

There is no error-handler config: errors thrown in component bodies,
effects, and event handlers BUBBLE (React model — crash loudly or catch at
the source). Lazy-route failures surface as unhandled rejections.

### RouteObject

```ts
interface RouteObject {
  path: string; // "/users/:id", "/files/*", "*"
  component?: Component; // eager component reference
  lazy?: () => Promise<Component | { default: Component }>; // code splitting / MF
}
```

## Development

### Build

```bash
pnpm build
```

### Test

```bash
pnpm test           # run tests
pnpm test:watch     # watch mode
pnpm test:coverage  # with coverage
```

### Type Check

```bash
pnpm typecheck
```

### Format

```bash
pnpm format
```

### Project Structure

```
packages/react-signal/
  src/
    index.ts              -- public API barrel export
    types.ts              -- all shared type definitions
    reactive.ts           -- @preact/signals-core facade (signal/computed/...)
    common.ts             -- rendering constants (namespaces, strSafe)
    utils.ts              -- internal utilities (hasOwnProperty, devWarn)
    component.ts          -- instance model, hook slots, props store, HMR registry
    component-registry.ts -- HMR alias map (canonical component identity)
    router.ts             -- createRouter factory, RouterView, matching, blockers
    store.ts              -- createStore (per-key signals, tracked proxy)
    hooks.ts              -- useSignal, useComputed, useSignalEffect, useEffect
    url-state.ts          -- useUrlState hook
    hmr.ts                -- hotSwapByComponent
    hmr-inject.ts         -- HMR code generation for bundlers
    client.d.ts           -- ambient type declarations
    vite.ts               -- Vite plugin
    webpack.ts            -- Webpack loader/plugin
    jsx-runtime.ts        -- JSX automatic runtime entry (jsx/jsxs + JSX types)
    jsx-dev-runtime.ts    -- JSX automatic dev runtime entry (jsxDEV)
    jsx/
      vnode.ts            -- pure VNode model (Symbol.for markers, raw())
      reconcile.ts        -- VNode -> DOM reconciler, instances, render/unmount
  tests/                  -- vitest test suite
  dist/                   -- built output
```

### Key Design Decisions

1. **Functional over OOP**: all APIs are factory functions and closures. No
   class, this, or prototype anywhere in the framework runtime.

2. **React FC authoring, signals execution**: the component function re-runs
   per render inside ONE signals effect per instance — the effect IS the
   dirty check. No digest, no dispatcher, no whole-tree re-render: only
   instances that READ a changed signal/prop re-run.

3. **Hostless reconciliation**: component instances live inside the
   reconciler; their rendered children splice directly into the parent
   element as an anchor-terminated range. Output DOM matches React's — no
   wrapper elements, valid table/list structures.

4. **Per-key props signals**: parents push props through per-key signals
   with reference comparison — finer-grained than React's whole-props
   identity model, no `memo()` needed.

5. **Signals are the ONLY dependency-tracking mechanism**: no deps arrays
   (no useMemo/useEffect-with-deps), no event emitters, no second
   subscription system. Derive with `computed`, react with `effect`;
   cross-component communication is callback props down, signal writes up.

6. **React-router data model, factory-based**: `createRouter(routes)` owns
   all navigation state per instance (no module singleton — MF-safe); one
   `location` signal, ranked `:param`/`*` matching,
   `navigate(to, { replace, state })`, async blockers with reverted history
   traversals. History mode only — no hash routing. Route dispatch is the
   `<RouterView/>` component reading `router.match`.

7. **Errors bubble**: no try-catch wrappers, no global error sink. A throw
   in a body/effect/handler propagates to the write site (React model) —
   catch at the source or crash loudly.

8. **Per-node event listeners**: one native listener per (node, type) with a
   stable proxy; renders swap `.current`. Dispatch runs inside `batch()`.

9. **State-preserving HMR**: live instances swap their component function in
   place — plain state slots survive, closure-bound slots are recreated —
   via a broad compile-time injection with runtime guards. HMR alias
   resolution happens ONCE at vnode-normalize time, never in the diff
   comparison hot path.
