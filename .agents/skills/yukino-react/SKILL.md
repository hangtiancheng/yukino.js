---
name: yukino-react
description: >-
  Authoritative reference for @yukino.js/react v0.0.1 (packages/react), a
  lightweight React-like framework: virtual-DOM reconciler with React-style
  hooks (useState/useEffect/useRef/useMemo/useCallback, microtask batching
  with a "Maximum update depth exceeded" guard), keyed diff, Fragment/ref,
  native DOM event handlers, a flat history router (createRouter/matchPath/
  matchRoutes/RouterView/useRouter/useBlocker, lazy routes, basename),
  zustand-style createStore/useStore with a read-only state proxy, useUrlState,
  and state-preserving component HMR (hotSwapByComponent, Vite reactPlugin,
  Webpack ReactPlugin/reactLoader). Use when code imports @yukino.js/react or
  its subpaths /jsx-runtime, /jsx-dev-runtime, /vite, /webpack; when working
  in packages/react; when porting a React app onto it; or when debugging
  non-batching re-renders, hook order, event/style/SVG prop semantics,
  navigation blocking, or HMR losing state. This is the hooks-based sibling
  of @yukino.js/react-signal (which is signals-based) — do not mix them.
---

# yukino-react Framework (`@yukino.js/react`)

Lightweight React-like UI framework, zero runtime npm deps (`@types/react`
supplies only JSX intrinsic-element types). ESM+CJS dual build via tsup.
Source: `packages/react/src`, tests: `packages/react/tests`.

Do not confuse with `@yukino.js/react-signal` (sibling package): that one is
signals-based with no deps arrays; this one is React-style hooks with deps
arrays and microtask batching.

## Package entry points

| Import                             | Provides                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yukino.js/react`                 | `render`, `createRoot`, `createElement`, `Fragment`, `useState`/`useEffect`/`useRef`/`useMemo`/`useCallback`, `createStore`/`useStore`/`StoreApi`, `createRouter`/`matchPath`/`matchRoutes`/`RouterView`/`useRouter`/`useBlocker`, `useUrlState`/`SetUrlState`, `hotSwapByComponent`, types (`VNode`, `Children`, `ComponentType`, `Props`, `Key`, `Dispatch`, `SetStateAction`, `EffectCallback`, `DepList`, `Ref`, router types); also sets `globalThis.__react_hmr__` (side effect) |
| `@yukino.js/react/jsx-runtime`     | `jsx`/`jsxs` (same function), `Fragment`, `Ref`, `JSX` namespace — wired via `jsxImportSource`, not imported by hand                                                                                                                                                                                                                                                                                                                                                                   |
| `@yukino.js/react/jsx-dev-runtime` | `jsxDEV` (extra dev args accepted and ignored)                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `@yukino.js/react/vite`            | `reactPlugin()` (also default export) — dev JSX config + component HMR injection                                                                                                                                                                                                                                                                                                                                                                                                       |
| `@yukino.js/react/webpack`         | `ReactPlugin` class, `reactLoader` (also default export)                                                                                                                                                                                                                                                                                                                                                                                                                               |

JSX setup (required for authoring): `"jsx": "react-jsx"`,
`"jsxImportSource": "@yukino.js/react"` in tsconfig. With
`@yukino.js/react/vite` the plugin sets `esbuild.jsx: "automatic"` +
`jsxImportSource` automatically (unless already set or `jsx: "preserve"`).

## The 60-second mental model

```
render(<App/>, container)            // mount once; call again to re-render same root
                                     // render(null, container) unmounts; createRoot(container) sugar
setState(x)                          // marks root dirty → ONE microtask flush re-renders all dirty roots
effects                              // after DOM commit: ALL cleanups pass, then ALL creates pass (depth-first, children before parent)
createRouter(routes) + <RouterView/> // flat routes, best-score match, navigate() async
createStore(creator) + useStore(store, sel) // read-only proxy state, selector-bailed re-render
vite reactPlugin / webpack ReactPlugin       // dev-only HMR: default-exported components swap in place
```

## Rendering API (`src/index.ts`, `src/diff.ts`)

- `render(element, container)` — one root per container (WeakMap). First call
  renders **synchronously**; later calls diff in place on the same root.
  Passing `null`/`undefined` unmounts the tree.
- `createRoot(container)` → `{ render(element), unmount() }` — sugar over the
  same root.
- Updates from `setState` are **microtask-batched**: all dirty roots flush
  together in one `queueMicrotask` pass. Multiple `setState` calls in one tick
  produce one re-render. A render/effect that schedules an update every pass
  throws after 50 cascade waves: `"Maximum update depth exceeded..."` — fix by
  making the update conditional or moving it out of the render path.
- In tests, await the microtask with `flush()` (`await Promise.resolve()`).

### Element model (`src/element.ts`)

- Components are plain functions `(props) => Children`. No class components,
  no context, no `memo`, no portals, no `Suspense`, no error boundaries —
  render errors propagate to the caller.
- `Fragment` is `Symbol.for("yukino.react.fragment")`; strings/numbers become
  internal Text vnodes; `null`/`undefined`/booleans are dropped from children.
- `key` is coerced with `String()`; single children stored bare, multiple in
  an array (`props.children`).
- `VNode` is mutable/owning: `{ type, key, props, dom, children, hooks, refCleanup }` —
  a VNode returned from `createElement`/`jsx` doubles as the reconciliation
  instance; do not reuse one VNode in two places.

### Keyed diff (`src/diff.ts`)

- Fast path: leading children matched by same index + same `key` + same type.
- After the first key mismatch, remaining children are matched through a
  `key ?? index` map; unmatched old nodes unmount (effect cleanups + ref
  detach run BEFORE DOM removal). Reorder detected via `lastPlacedIndex`.
- Matched component vnodes keep their `hooks` array — state survives reorder/
  patching only when key+type match. List items whose state matters need
  stable `key`s.
- HMR aliasing: while HMR is active, two different function types count as
  "same type" if their `canonical()` aliases resolve equal, preserving state.

## Hooks (`src/hooks.ts`)

Call-order slots per component vnode. Calling a hook outside render throws
`"Hooks can only be called inside a function component."` Conditional hooks:
a changed slot tag silently replaces the hook (state reset, effect cleanup);
fewer hooks than last time truncates and cleans up the rest. Keep hooks
unconditional.

- `useState(initial | () => initial)` — lazy initializer runs once. Queue of
  actions is applied during the next render. **Eager bailout**: if the queue
  is empty and `Object.is(next, current)`, no re-render is scheduled.
- `useEffect(create, deps?)` — `create` may return a cleanup. Semantics of
  `deps`:
  - omitted / `undefined` → effect runs after EVERY render;
  - `[]` → mount-only;
  - `[a, b]` → runs when any dep changes by `Object.is` (length change always
    counts as changed).
  - Commit order per root render: first cleanup ALL changed effects
    (depth-first, children before parents), then create ALL. Not interleaved
    per component like React.
- `useMemo(factory, deps)` — deps required. `useCallback(cb, deps)` is
  `useMemo(() => cb, deps)`. `useRef(init)` is `useMemo(() => ({ current: init }), [])`
  — identity is stable, initial value captured at mount only.
- No `useLayoutEffect`, no `useReducer`, no `useContext`, no `useId`, no
  `useSyncExternalStore`.

## DOM prop semantics (`src/dom.ts`)

- Events: any prop matching `/^on[A-Z]/` attaches a **native**
  `addEventListener` for `name.slice(2).toLowerCase()` (`onClick` → `click`).
  Handlers receive the native `Event` (React's `SyntheticEvent` does not
  exist); the JSX layer retypes `onXxx` handlers from `@types/react` event
  params to the native event type plus `currentTarget`.
- Aliases: `className` → `class`, `htmlFor` → `for`.
- `style`: object (patched per key, `Object.is` compared) or string
  (`cssText`). Numbers get `px` appended unless unitless (preact-style regex:
  `animation*`, `flexGrow`, `zIndex`, `opacity`, `order`, ...); CSS custom
  properties (`--foo`) use `setProperty`.
- Non-event props: set as DOM **property** when `name in element` (non-SVG),
  where `null`/`undefined` become `""` (property is NOT removed); otherwise
  set as attribute, where `null`/`undefined`/`false` remove the attribute,
  `true` becomes `""`, and other values are stringified.
- SVG: `<svg>` and its descendants use the SVG namespace except under
  `foreignObject`.
- `dangerouslySetInnerHTML={{ __html }}`: takes over the element's children
  (diffing skips child reconciliation for that node).
- `ref` (host elements only): object ref or callback ref; a callback may
  return a cleanup function (invoked on detach). Refs change-attach on patch,
  detach on unmount. Passing `ref` to a function component is just a prop —
  there is no `forwardRef`; handle it inside the component or avoid it.

## Router (`src/router.ts`)

Flat route table, react-router-aligned data model, history-based (hash/SSR
not supported).

```ts
import { createRouter, RouterView, render } from "@yukino.js/react";

const router = createRouter(
  [
    { path: "/", component: Home },
    { path: "/users/:id", component: User },
    { path: "/files/*", lazy: () => import("./Files") }, // trailing splat only
  ],
  { basename: "app" }, // optional
);
render(<RouterView />, document.querySelector("#root")!);
```

- `createRouter(routes, { basename? })` returns `RouterApi`
  (`location`, `match`, `params`, `searchParams` getters; `navigate`,
  `subscribe`, `block`, `dispose`). The LAST created router becomes the
  module-level `activeRouter` used by `useRouter()`/`useUrlState`/
  `useBlocker` — they throw without it. Create the router BEFORE rendering.
- Matching: segment-wise, exact count (or trailing `*` captured as
  `params["*"]`); literal segments are **case-insensitive**; `:param` values
  are `decodeURIComponent`-ed (fallback raw). `matchRoutes` picks the BEST
  score across all routes (literal 10, `:param` 3, `*` -2, +1 per segment) —
  route order in the array does not matter. `matchPath` warns and fails for
  non-trailing `*`.
- `navigate(to, { replace?, state? })` → `Promise<boolean>` (`false` if a
  blocker vetoed it). `to` may be a path string, `{ pathname, search, hash }`,
  or a delta number (`history.go`, skips blockers, always resolves `true`).
  Navigating to the identical href silently uses `replaceState`. History
  entries carry `{ usr, key, idx }` wrappers; `location.state` reads `usr`,
  `location.key` is auto-generated.
- Blockers: `useBlocker(fn)` or `router.block(fn)`; `fn(next, current)`
  returns `boolean | Promise<boolean>`; running sequentially, any `false` or
  throw blocks. Blocked popstate is reverted with `history.go(delta)`.
  GOTCHA: `useBlocker` captures the blocker function AT MOUNT (stored in a
  ref that is never updated) — if the decision must read fresh state, read it
  from a store or a mutable ref inside the blocker, not from closed-over
  render state.
- `RouterView({ router? })` renders the matched route's component (defaults to
  `activeRouter`); unmatched renders `null` — there is no built-in 404, catch
  with a splat route. Route components receive **no props** (unlike
  react-router): read `useRouter().params` / `.searchParams` inside them. No
  nested routes, no `<Link>`; use
  `onClick={() => useRouter().navigate(...)}` or an `<a>` with
  `preventDefault`.
- Lazy routes: `lazy: () => import(...)` (module or default component).
  Pending promises are deduplicated per route object and cached onto
  `route.component`; while loading, `RouterView` renders `null` (no Suspense),
  then self-forces on resolve. A failed load clears the cache; retry
  re-invokes `lazy`.
- `useRouter()` subscribes the component to location changes (with a
  stale-location guard). `dispose()` removes the popstate listener and, if it
  is the active router, clears `activeRouter`.

## Store (`src/store.ts`)

```ts
import { createStore, useStore } from "@yukino.js/react";

const useTodos = createStore((set, get) => ({
  todos: [] as string[],
  add: (t: string) => set((s) => ({ todos: [...s.todos, t] })),
}));
const todos = useStore(useTodos, (s) => s.todos); // selector overload
```

- `createStore(creator)` → `StoreApi`. Creator receives
  `set(partial | (prev) => partial, replace?)` and `get`. Function values
  returned by the creator are **actions** (permanently excluded from
  `setState` writes); non-functions are state.
- `getState()` returns a read-only Proxy: direct property write or delete
  throws `store state is read-only — use setState()`.
- `setState` merges partials key-by-key with `Object.is` bail-out; no change
  → no listeners called. `replace: true` sets state keys missing from the
  partial to `undefined` (not actions, not deleted).
- `subscribe` overloads: `subscribe((state, prevState) => ...)` for all
  changes, or `subscribe(selector, (slice, prevSlice) => ...)` with
  `Object.is` bail. Both return unsubscribe. `destroy()` clears listeners.
- `useStore(store)` re-renders on any state version bump;
  `useStore(store, selector)` re-renders only when the selector slice changes
  by `Object.is`. Selectors must be cheap/pure — they run every render.
  Updates from actions flow through each subscribed root's microtask flush,
  so components updating in one tick batch together.
- No middleware, no persist/devtools. Prefer selectors returning primitives
  or stable references; a selector building a fresh object every render never
  bails out.

## URL state (`src/url-state.ts`)

`useUrlState(defaults?)` → `[readonly values, setValue]`, requires an active
router. With `defaults`, only those keys are tracked (empty-string query
values count as absent); without it, ALL query params are read. `setValue`
has stable identity (captures router + defaults at mount) and accepts a patch
object or `(prev) => patch` plus `NavigateOptions` — `null`/`undefined`
values DELETE the param. Default navigation is push; pass `{ replace: true }`
to avoid history spam (recommended, since the URL is the state).

## HMR (`src/hmr.ts`, `src/hmr-inject.ts`, `src/vite.ts`, `src/webpack.ts`)

State-preserving component hot-swap; dev-only, both plugins skip production.

```ts
// vite.config.ts
import reactPlugin from "@yukino.js/react/vite";
export default defineConfig({ plugins: [reactPlugin()] });
```

```js
// webpack.config.js
const { ReactPlugin } = require("@yukino.js/react/webpack");
module.exports = { plugins: [new ReactPlugin()], mode: "development" };
```

- The plugin injects a snippet into every `.jsx`/`.tsx` module (skips
  `node_modules`, skips files without `export default`) that binds
  `__react_component__` to the default export and, on hot update, calls
  `globalThis.__react_hmr__.hotSwapByComponent(old, new)` (the global is set
  when `@yukino.js/react`'s root entry is imported).
- Consequence: only **default-exported components** get HMR. Keep one
  top-level component per file as `export default`.
- `hotSwapByComponent(old, new)` (also manually callable) maps old →
  canonical alias and re-renders every live root; the reconciler treats the
  aliased pair as the same type, so hooks/state and DOM nodes survive the
  swap. Returns `false` for non-functions or identical functions. Once any
  swap happens, `hmrActive` stays on for the page lifetime.
- `ReactPlugin` accepts `{ test?, exclude? }` (default `/\.[jt]sx$/`,
  `/node_modules/`); `reactLoader` can also be used standalone in a rule.

## JSX runtime details (`src/jsx-runtime.ts`)

- `jsx`/`jsxs` are the same function (no static-children distinction);
  `jsxDEV` ignores `_isStaticChildren`/`_source`/`_self`.
- `JSX.Element` is `VNode`. Intrinsic props come from `@types/react`'s
  `JSX.IntrinsicElements` with `onXxx` handlers remapped to native events and
  `ref?: Ref<T>` added per tag.
- `Ref<T>` accepts object refs, callback refs, and callback refs returning a
  cleanup (React 19 style).

## Testing conventions (`packages/react/tests`)

- Vitest + jsdom (`environment: "jsdom"`); include `tests/**/*.test.{ts,tsx}`.
- The vitest config aliases `@yukino.js/react*` to `src/*` — tests run against
  source, not dist. `esbuild.jsxImportSource` points at this package, so
  `.tsx` tests use the local JSX runtime.
- Helpers in `tests/helpers.ts`: `flush()` = `await Promise.resolve()`
  (drains the microtask batch), `createContainer()` (appends a div to body),
  `click(el)` (native bubbling `MouseEvent`).
- `tests/types.test-d.tsx` covers type-level assertions; DOM assertions
  compare `container.innerHTML` strings.
- From `packages/react`: `pnpm test` (vitest run), `pnpm typecheck`,
  `pnpm build` (tsup).

## Source map

| File                                            | Responsibility                                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                                  | root registry, microtask batching + cascade guard, `render`/`createRoot`, `__react_hmr__` global         |
| `src/element.ts`                                | `createElement`, `createVNode`, `Fragment`/`Text` symbols, `toChildArray`                                |
| `src/diff.ts`                                   | `renderRoot`, `diffChildren`, mount/patch/unmount, anchors, `sameType` (HMR alias)                       |
| `src/dom.ts`                                    | `createDom`/`updateProps`, event/alias/style/SVG/`setProp`, `attachRef`/`detachRef`                      |
| `src/hooks.ts`                                  | slot machine (`getSlot`), `useState`/`useEffect`/`useMemo`/`useCallback`/`useRef`, `flushEffects`        |
| `src/router.ts`                                 | `createRouter`, `matchPath`/`matchRoutes`, lazy cache, blockers, `RouterView`, `useRouter`, `useBlocker` |
| `src/store.ts`                                  | `createStore` (proxy/actions/replace/version), `useStore`                                                |
| `src/url-state.ts`                              | `useUrlState` + stable setter                                                                            |
| `src/hmr.ts`                                    | alias map, `hotSwapByComponent`, live-root set                                                           |
| `src/hmr-inject.ts`                             | shared Vite/Webpack source injection (default-export rewrite)                                            |
| `src/vite.ts` / `src/webpack.ts`                | bundler plugins (dev-only, `enforce: "pre"`)                                                             |
| `src/jsx-runtime.ts` / `src/jsx-dev-runtime.ts` | JSX factories + `JSX` namespace                                                                          |

## Common pitfalls

1. Reading `container` right after `setState` — updates flush on a microtask;
   `await flush()` / `await Promise.resolve()` first.
2. The eager `Object.is` bailout in `useState` only applies while the hook's
   action queue is empty; queued actions always schedule a render.
3. `useEffect(fn)` WITHOUT a deps array runs after EVERY render — pass `[]`
   for mount-only.
4. Handler params are NATIVE events: use `e.currentTarget` during dispatch;
   there is no `SyntheticEvent` and no `persist()`.
5. `useRouter()`/`useUrlState()`/`useBlocker()` throw before `createRouter` —
   create the router before rendering; only the latest router is active.
6. `useBlocker` and the `useUrlState` setter freeze their inputs at mount
   (see sections above).
7. Lists without stable keys lose component state on reorder (diff matches by
   `key ?? index`).
8. `ref` on a custom component is an ordinary prop — nothing is auto-forwarded.
9. `store.getState()` returns a read-only Proxy: property writes/deletes
   throw even though reads look like a plain object.
10. HMR only works for `export default` components under dev with the
    matching plugin; a named-only export never hot-swaps.
