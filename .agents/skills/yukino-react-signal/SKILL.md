---
name: yukino-react-signal
description: >-
  Authoritative reference for @yukino.js/react-signal (v0.0.36, signals-only,
  react-router-aligned, factory router), the functional-first TypeScript
  frontend framework located at packages/react-signal — plain function
  components ((props) => JSX, body re-runs per render, hostless instances
  with NO wrapper elements), call-order-indexed hooks with NO deps arrays
  (useSignal, useRef, useComputed, useSignalEffect, useEffect is MOUNT-ONLY,
  onCleanup, useBlocker, useUrlState with stable setter), signals reactivity
  via @preact/signals-core (one render effect per instance, shallow
  reference comparison, NO event emitters, NO error-swallowing wrappers —
  errors bubble), per-key reactive props with plain callback props and
  props.children, React-DOM-style render(vnode, container) / unmount, direct
  VNode → DOM reconciliation (keyed diff, comment end-anchors), a
  FACTORY-based history-only router aligned with react-router's data model
  (createRouter(routes, {basename}) — no module singleton,
  location/match/params/searchParams signals, ranked "/users/:id" and "*"
  matching, navigate(to, {replace, state}), async block()/useBlocker,
  <RouterView/> outlet with per-route lazy() dedup, useRouter() active
  instance), anonymous zustand-aligned createStore(creator) with
  auto-tracked computed and selector subscribe, and Vite/Webpack plugins
  with auto-injected state-preserving component HMR (hotSwapByComponent,
  registered once at the index entry). Use this skill whenever the user
  reads, writes, debugs, reviews, or extends code that imports from
  "@yukino.js/react-signal" (or any sub-path like /vite, /webpack,
  /jsx-runtime, /client), works under packages/react-signal, or mentions
  any of these symbols — render, unmount, FC, useSignal, useComputed,
  useSignalEffect, useEffect, onCleanup, createRouter, RouterView,
  useRouter, useBlocker, useUrlState, matchRoutes, RouteObject, createStore,
  raw, yukinoReactSignalPlugin, YukinoReactSignalPlugin, hotSwapByComponent
  — or asks "why doesn't my component re-render". Even if the user just
  says "add a page/view/component to the Yukino app", consult this skill
  first. SWR-style async server state is intentionally OUT of this package
  (a future dedicated package built on the same signals).
---

# yukino-react-signal Framework (`@yukino.js/react-signal`)

A lightweight, functional-first TypeScript framework for SPAs and
micro-frontends. Source: `packages/react-signal` (v0.0.36, ESM+CJS dual
build; reactive core re-exported from `@preact/signals-core`, the typed JSX
attribute layer is sourced type-only from `preact`).

Core philosophy: **no `class`, no `this`, no `prototype`, no mixin — and
signals are the ONLY reactive mechanism**: no event emitters, no deps
arrays, no second dependency-tracking system, no error-swallowing wrappers
(errors bubble). Components are **React-style plain functions**
`(props) => JSX` — the body re-runs per render inside the instance's render
effect; state lives in call-order-indexed hooks. Rendering is a **hostless
VNode → DOM reconciler** (comment end-anchors, NO wrapper elements — output
DOM identical to React's). The router is a **factory**
(`createRouter(routes)`, no module singleton) mirroring react-router's data
model, with a `<RouterView/>` outlet. Cross-component state has one answer:
anonymous `createStore`. There is **no Framework/boot object** — an app
boots with `render(<RouterView router={r}/>, container)` (routed) or
`render(<App/>, container)` (plain).

## Package entry points

| Import                                    | Provides                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yukino.js/react-signal`                 | Runtime: `render`, `unmount`, `signal`, `computed`, `effect`, `batch`, `untracked`, `Signal`, hooks (`useSignal`, `useRef`, `useComputed`, `useSignalEffect`, `useEffect` mount-only, `onCleanup`), `createRouter`/`RouterView`/`useRouter`/`useBlocker`/`matchPath`/`matchRoutes`, `createStore`, `useUrlState`, `hotSwapByComponent`, all types (`FC`, `Location`, `RouteObject`, `RouterApi`, ...) plus the `JSX` type namespace and per-tag DOM attribute types |
| `@yukino.js/react-signal/jsx-runtime`     | JSX automatic runtime (`jsx`/`jsxs`, `Fragment`, `raw`, JSX types) — referenced by `jsxImportSource`, not imported by hand                                                                                                                                                                                                                                                                            |
| `@yukino.js/react-signal/jsx-dev-runtime` | `jsxDEV` dev runtime (debug args accepted and ignored)                                                                                                                                                                                                                                                                                                                                                |
| `@yukino.js/react-signal/vite`            | `yukinoReactSignalPlugin()` — auto component HMR (dev only); the JSX transform comes from tsconfig                                                                                                                                                                                                                                                                                                    |
| `@yukino.js/react-signal/webpack`         | `YukinoReactSignalPlugin` (recommended), `yukinoReactSignalLoader` (also the default export)                                                                                                                                                                                                                                                                                                          |
| `@yukino.js/react-signal/client`          | Ambient types for webpack/non-Vite projects: `__yukino_hmr__`, `import.meta.webpackHot`, `*.module.css`/`*.css` modules (Vite projects use `vite/client` instead)                                                                                                                                                                                                                                     |

tsconfig (required on every bundler — the plugins do NOT configure the JSX
transform): `"jsx": "react-jsx"`, `"jsxImportSource": "@yukino.js/react-signal"`.

## The 60-second mental model

```
render(<App/>, container)    // routed apps: render(<RouterView router={r}/>, el)
        │
every FUNCTION TAG mounts an INSTANCE (hostless — children splice directly
into the parent element, terminated by a comment end-anchor)
        │
ONE @preact/signals-core effect per instance
        │
effect run:  fn(props)  ── TRACKED: every signal read subscribes the
        │                   instance (useSignal state, props.key,
        │                   store.getState().key,
        │                   router.location/params/searchParams .value)
   slice diff (keyed)     — per-node listeners, form-state props, refs
        │
   post-commit flush ───── UNTRACKED: child instance mounts, batched
        │                  per-key prop pushes, ref calls
   flushInstanceEffects ── pending useEffect (mount) callbacks run
        │
signal / prop write ──> only SUBSCRIBED instances re-render (batch() coalesces)
```

A **component** is `function MyComp(props: P) { return <div/>; }` — used
directly as a JSX tag (`<MyComp x={1} onSave={fn}/>`). The body re-runs per
render; hooks are call-order slots (React rules of hooks). Instances are
matched across renders by function identity + `key`.

## Quick start (canonical shape)

```tsx
// src/views/user-detail.tsx
import { useSignal, useRouter } from "@yukino.js/react-signal";
import styles from "./user-detail.module.css";

export default function UserDetail() {
  const router = useRouter();
  const { id } = router.params.value; // "/users/:id" → tracked read
  const clicks = useSignal(0);
  return (
    <div class={styles["user"]}>
      <p>
        user {id}, clicks {clicks.value}
      </p>
      <button onClick={() => clicks.value++}>+1</button>
      <button onClick={() => router.navigate("/", { state: { from: id } })}>
        Home
      </button>
    </div>
  );
}
```

```tsx
// src/main.tsx — routing app; plain apps just call render(<Home/>, el)
import { render, createRouter, RouterView } from "@yukino.js/react-signal";
import Home from "./views/home";
import UserDetail from "./views/user-detail";
import NotFound from "./views/not-found";

const router = createRouter([
  { path: "/", component: Home },
  { path: "/users/:id", component: UserDetail },
  { path: "/admin", lazy: () => import("./views/admin") }, // code splitting / MF
  { path: "*", component: NotFound },
]);
render(<RouterView router={router} />, document.getElementById("root")!);
```

```ts
// vite.config.ts — HMR injection only; JSX compiling is tsconfig's job
import { yukinoReactSignalPlugin } from "@yukino.js/react-signal/vite";
export default defineConfig({ plugins: [yukinoReactSignalPlugin()] });
```

Component HMR is auto-injected — never write `import.meta.hot` boilerplate
by hand.

## Critical rules (violating these causes the classic bugs)

1. **The component body IS the tracked region** — it re-runs per render;
   reading a signal, `props.key`, store state, or
   `router.location.value`/`router.params.value` in it subscribes the
   instance. Event handlers and async callbacks read snapshots (no
   subscription).
2. **Rules of hooks (React)** — the body re-runs, so hooks must run
   unconditionally, in the same order, at the top level. `useSignal(initial)`
   returns the SAME signal every render; a plain `signal()` in the body
   would be recreated per render (footgun — always use `useSignal` for
   instance state). Hook-count changes between renders dev-warn and reset
   trailing slots.
3. **NO deps arrays** — there is no `useMemo` and no `useEffect(fn, deps)`.
   Derive with `useComputed(fn)` (auto-tracked); run reactive side effects
   with `useSignalEffect(fn)` (auto-tracked, created once); `useEffect(fn)`
   is MOUNT-ONLY (runs once post-commit, returned fn = unmount cleanup).
4. **Shallow reactivity** — signals compare by reference (`===`).
   `list.value.push(x)` renders nothing; write `list.value = [...list.value, x]`.
   Same rule for `store.setState` and props.
5. **Never write a signal the same body/computed reads** — that is a cycle
   (`Cycle detected`). Derive with `useComputed`; write from event handlers
   or `useSignalEffect` with disjoint reads.
6. **Callbacks are plain props** (React semantics) — child calls
   `props.onSelect?.(data)` directly; there is no emitter. Call callbacks
   from handlers (reading one in the BODY subscribes to its identity).
7. **`children` arrive as `props.children`**; `key` is a vnode-level sibling
   compare key (never a DOM id) — on component tags it preserves the
   INSTANCE (and its hook state) across reorders. `class`/`style`/`id`/`ref`
   on a component tag are ordinary props the component must apply itself
   (hostless — there is no host element to route them to).
8. **Routing is a factory** — `const router = createRouter(routes, {basename?})`
   (react-router data model, history-only, per-instance state);
   `<RouterView router={router}/>` is the outlet; `useRouter()` resolves the
   ACTIVE (last-created) router; guard with `router.block(fn)` /
   `useBlocker(fn)`. Components read `router.params.value` etc. directly —
   react-router muscle-memory hooks (`useParams`, `useLocation`,
   `useSearchParams`) do not exist here; the URL-params hook is
   `useUrlState(defaults)` → `[value, setValue]` (value tracked, setter
   slot-stable, component-only).
9. **Errors bubble** — no try-catch wrappers, no error sink. A throw in a
   body/effect/handler propagates to the signal write site; lazy-route
   failures are unhandled rejections.
10. **Cross-component state = `createStore(creator)`** (anonymous, zustand
    semantics). Keyed lists need stable `key`s; strings are TEXT everywhere
    (`raw(html)` is the only trusted-HTML path); routes hold component
    REFERENCES or `lazy()` loaders (no string registry).

## Reference files — read on demand

| File                                                                   | Read when working on                                                                                                                                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [references/components.md](references/components.md)                   | Function components: props/callbacks/children/key/ref, all hooks in depth, instance lifecycle, `render`/`unmount`, DOM events, composition patterns                                             |
| [references/templates.md](references/templates.md)                     | JSX semantics: children/attribute tables, Signal unwrapping, `raw()`, key semantics, namespaces, security guards                                                                                |
| [references/state-routing.md](references/state-routing.md)             | Signals API, anonymous `createStore`/auto-tracked `computed`/selector subscribe, `createRouter` (location/match/params/searchParams, navigate, block), `RouterView`, `useRouter`, `useUrlState` |
| [references/build-and-hmr.md](references/build-and-hmr.md)             | tsconfig/bundler setup, Vite/Webpack plugins, lazy loading & Module Federation, HMR internals, scaffolding conventions                                                                           |
| [references/rendering-internals.md](references/rendering-internals.md) | Instance render effects, anchor-slice reconciliation, keyed diff, attribute snapshots, batching/timing — read when debugging renders/perf                                                       |
