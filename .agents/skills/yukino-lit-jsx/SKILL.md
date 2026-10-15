---
name: yukino-lit-jsx
description: >
  @yukino.js/lit-jsx (packages/lit-jsx/, v0.0.1): JSX runtime for Lit (dep
  lit, range "latest", resolves 3.3.3). React-style JSX instead of html
  templates. Covers jsx/jsxs/jsxDEV/Fragment; createElement prop semantics
  (onXxx to @event on primitives, class/className to .className, style to
  styleMap, ref to lit's ref, hyphenated to attributes, booleans to
  attribute plus property, nullish props omitted, key stripped, select
  value/defaultValue applied after options commit, textarea children as
  initial value); createRoot; assignElements/resetElements tag registry,
  div fallback; lit-jsx customElement decorator; re-exported lit
  decorators; spread/createRef; onXxx to lowercase event mapping; JSX type
  layer (React event aliases, custom onXxx props win, numeric value).
  vitest+jsdom tests, type fixtures via pnpm typecheck. Also covers the
  @yukino.js/lit-jsx/community entry: dual-mode router (createHashRouter,
  createBrowserRouter/createHistoryRouter, LocationAdapter, HashLocation,
  HistoryLocation, route-view/route-outlet, Link/NavLink/Form/Outlet/Fetcher,
  useParams/useLocation/useNavigate/useLoaderData/useSearchParams/useMatch),
  PoweredByLit badge, icon helpers, and Vite-style ?raw imports in the tsup
  build. Triggers: lit-jsx, jsxImportSource, jsx-runtime, createRoot(,
  assignElements(, createHashRouter, createBrowserRouter, community router.
  Use for JSX with LitElement/web components. NOT for React, Vue, Preact,
  Solid, plain lit html templates, non-JSX Lit.
---

# @yukino.js/lit-jsx

A JSX runtime for Lit. Lets you write Lit templates and whole apps with
React-style JSX instead of `html` string templates. `lit` is a regular
runtime dependency declared as `"latest"` (workspace currently resolves
lit 3.3.3). JSX compiles to lit `TemplateResult`s built with the
`html` tag from `lit/static-html.js` (required for dynamic tag names), so
JSX output renders anywhere a Lit template does: `LitElement.render()`,
`root.render()`, or inside other templates.

- Package: `@yukino.js/lit-jsx` v0.0.1 (workspace package at `packages/lit-jsx/`)
- Source root: `packages/lit-jsx/src/` (core, directives, decorators, utils, types)
- Build: `tsup` — ESM + CJS + dts, clean, minify; entries `src/index.ts`,
  `src/jsx-runtime.ts` and `src/community/index.ts`; a `raw-import` esbuild
  plugin in `tsup.config.ts` implements Vite-style `?raw` imports
- Scripts: `pnpm build`, `pnpm test` (`vitest run` + jsdom, `tests/`),
  `pnpm typecheck`
- The build copies this skill from `.agents/skills/yukino-lit-jsx` into
  `packages/lit-jsx/skills/` (`tsup.config.ts`); edit only the `.agents` copy.

## Entry points

| Import                               | Purpose                                                                                                                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yukino.js/lit-jsx`                 | Re-exports everything from `lit` PLUS `createRoot`, `assignElements`, `resetElements`, decorators, directives (`spread`, `createRef`, `Ref`), types. Import `LitElement`, `html`, decorators etc. from here, not from `lit`, so the runtime's wiring is consistent. |
| `@yukino.js/lit-jsx/jsx-runtime`     | The automatic JSX runtime (`jsx`, `jsxs`, `jsxDEV`, `Fragment`). Referenced by the transpiler via `jsxImportSource`; you rarely import it by hand.                                                                                                                  |
| `@yukino.js/lit-jsx/jsx-dev-runtime` | Same dist files as `jsx-runtime` (package.json `exports` maps both specifiers to `dist/jsx-runtime.*`).                                                                                                                                                             |
| `@yukino.js/lit-jsx/community`       | Optional higher-level utilities: the dual-mode router (hash + history), the `PoweredByLit` badge, icon helpers. Built from `src/community/index.ts` to `dist/community/index.*`.                                                                                    |

Note: lit's main entry does not export `literal`/`unsafeStatic`; import
those from `lit/static-html.js` when you need them.

### Transpiler setup

TypeScript (`tsconfig.json`):

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@yukino.js/lit-jsx"
  }
}
```

Lit's decorators depend on the class-field semantics TypeScript
configures with `"experimentalDecorators": true`,
`"emitDecoratorMetadata": true` and `"useDefineForClassFields": false` (see
lit docs: "Avoiding issues with class fields").

Babel (`babel.config.js`):

```json
{
  "plugins": [
    [
      "@babel/plugin-transform-react-jsx",
      {
        "throwIfNamespace": false,
        "runtime": "automatic",
        "importSource": "@yukino.js/lit-jsx"
      }
    ]
  ]
}
```

Inside this package, the main `tsconfig.json` enables `"jsx": "react-jsx"`
with self-reference paths to `src`. `tests/types/tsconfig.json` uses
`"jsxImportSource": "../../src"` for the type fixtures.

## How a JSX tree becomes DOM

```
JSX → jsx(type, config)                      (src/jsx-runtime.ts)
    ├─ type is a function?
    │   ├─ extends HTMLElement → resolve tag via customElementRegistry
    │   │   (populated by lit-jsx's @customElement decorator; falls back to
    │   │   constructing once to read .localName) → createElement(tag, config)
    │   └─ plain function      → call type(config)   (functional component)
    └─ type is a string        → createElement(type, config)
createElement                                  (src/core/create-element.ts)
    └─ resolve tag → html`<${tag} ${ref} ${spread(props)} style=${styleMap}>${children}</${tag}>`
       ├─ <select>: value/defaultValue are hoisted out of the spread data and
       │   applied by the selectValue directive as a child part *after* the
       │   options commit (setting .value before any <option> exists is
       │   silently ignored, then the browser falls back to the first option)
       └─ <textarea>/<template>: no child expression (raw-text parsing);
           textarea text children are forwarded as the initial value instead
```

`jsx`, `jsxs` and `jsxDEV` are the same function; extra dev args from the
transpiler are ignored. `Fragment({ children })` returns an array (a single
child is wrapped), which `createElement`'s `parseChildren` consumes.

### Tag resolution order (`getHTMLTag`, src/utils/element-utils.ts)

1. `window.customElements.get(type)` → render that exact tag via
   `unsafeStatic(type)`. Registered custom-element tags in JSX always work.
2. `elementRegistry[type]` → the mapped tag (defaults map every standard HTML
   tag to itself with `unsafeStatic`).
3. `elementRegistry.default` → **falls back to `<div>` for anything unknown**.
   Typos in tag names silently render a div — watch for this when debugging.

## Prop semantics (the critical table)

Applied by `parseProps` (src/utils/element-utils.ts) + the `spread` directive
(src/directives/spread.ts). "Primitive" here means: the JSX tag resolved
through the element registry (`registry[type]` truthy), i.e. native tags and
registry overrides — as opposed to registered custom elements rendered by
their own tag.

| JSX prop                             | Primitive tags                                                | Registered custom elements                                                                            |
| ------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `onXxx` (matches `^on[A-Z]`)         | `@event` listener via spread                                  | **not auto-bound** — becomes a `.onXxx` property; the element decides what a prop named onClick means |
| `class`                              | `.className` property                                         | `.class` property                                                                                     |
| `className`                          | `.className` property                                         | `.className` property                                                                                 |
| `style`                              | handled separately: `styleMap` (camelCase StyleInfo object)   | same                                                                                                  |
| `ref`                                | lit `ref` directive (object ref from `createRef` or callback) | same                                                                                                  |
| `data-foo`, `aria-*`, any hyphenated | attribute (`setAttribute`)                                    | `.prop` property                                                                                      |
| boolean                              | `?attr` **and** `.prop` (both)                                | `.prop` property                                                                                      |
| everything else                      | `.prop` property assignment                                   | `.prop` property assignment                                                                           |
| value `null`/`undefined`             | skipped entirely by `parseProps` (nothing set)                | reaches spread, which skips nullish values on apply                                                   |

Core behaviors (differences from React to keep in mind):

- Nullish prop values never set anything: `parseProps` drops them for
  primitives, and `spread.apply` skips `null`/`undefined` values for every
  tag. When a previously-set prop disappears or turns nullish between
  renders, `spread.groom` cleans it up: `removeEventListener` for `@`
  handlers, `removeAttribute` for attributes and `?` booleans, `delete` for
  own properties, `removeAttribute("class")` for a removed `className`,
  otherwise the property is reset to `""` (string-valued) or `undefined`.
  A defined value is always assigned as `.prop`, never as an attribute
  (except the hyphenated/boolean cases above).
- `key` is accepted (React familiarity) and **stripped** — Lit diffing has
  no key semantics; it must not leak onto the DOM as a property.
- `false`/`true`/`null`/`undefined` children render nothing (React-style);
  lit-html alone would render booleans as text, so `parseChildren` filters
  them. `0` renders (also React-style).
- Events are delegated through one `handleEvent` per spread directive;
  changing a handler between renders swaps `addEventListener`/
  `removeEventListener` (the same directive object is the registered
  listener, so the current prop value is always the one invoked), and
  disconnect/reconnect of the part detaches/re-attaches listeners.
- `<select value={x}>` / `defaultValue={x}` behave like React: applied after
  the option children commit (src/directives/select-value.ts). `value` is
  re-applied on every render (controlled — a user change without a state
  update snaps back); `defaultValue` is applied when it first appears or
  changes, never on unrelated re-renders (uncontrolled — user selection
  survives, including equivalent array literals); defaults are compared by
  contents and are applied again after removal/reappearance. Default options
  receive `defaultSelected` so `form.reset()` restores them. Array values
  select every matching option (`multiple`) and scalars are coerced with
  `String(value)`. Nullish value props set nothing.
  The `<option selected={...}>` pattern also works and needs no value prop.
- `<textarea>{"text"}</textarea>` forwards text children (string/number,
  joined; nullish/boolean skipped) through `defaultValue`, preserving user
  edits when the children change and restoring the latest default on reset.
  Explicit non-null `value`/`defaultValue` props win; children containing
  anything non-text are dropped (lit-html cannot render child expressions
  inside raw-text elements). `<template>` children are dropped the same way.
- `value`/`defaultValue` JSX types accept `number` (and `readonly string[]`)
  like React's, on top of the DOM property types (`ValueProps` in
  src/jsx-runtime.ts); the runtime assigns through the DOM property, which
  coerces.

### Event-name resolution

`getNativeEventName` (src/utils/event-utils.ts) is a Proxy over a one-entry
special-case map (`onDoubleClick → "dblclick"`). Any prop matching
`/^on[A-Z]/` derives its native event name by slicing off `on` and
lowercasing the rest — `onKeyDown → "keydown"`, `onGotPointerCapture →
"gotpointercapture"`, `onMyEvent → "myevent"`. Nothing needs to be added per
event. Props that don't match (e.g. all-lowercase `onclick`) are not treated
as events: they fall through to `.onclick` property assignment. Custom-event
names containing hyphens (e.g. `toggle-locale`) cannot be bound with an
`onXxx` prop at all — listen with `addEventListener` on a ref or container.

The JSX type layer mirrors this: `NativeEventProps` generates
`on${Capitalize<event>}` handlers from `HTMLElementEventMap`, and
`ReactEventNames`/`ReactEventProps` (src/jsx-runtime.ts) add typed
React-style aliases for every multi-word event (`onKeyDown`,
`onDoubleClick`, `onTransitionEnd`, `onGotPointerCapture`, …), filtered
against the consumer's `HTMLElementEventMap` so missing events degrade to
the index signature instead of erroring. A custom element's own declared
`onXxx` property types win over both (`Omit<EventProps, KnownKeys<T>>` —
`KnownKeys` strips index signatures so `[name: string]: any` carriers like
`<form>` keep their event props). `ElementProps` also keeps `children`,
`ref` (contextually typed `RefOrCallback<T>`, so `ref={(el) => ...}` needs
no annotation), a `StyleInfo` `style`, and an index signature.

## Registry overrides (assignElements / resetElements)

Map JSX tag names to different tags — e.g. render every `<button />` as
`my-custom-button` (src/core/create-element.ts):

```ts
import { assignElements, resetElements } from "@yukino.js/lit-jsx";
import { literal } from "lit/static-html.js";

assignElements({ button: "my-custom-button" }); // plain strings OK
assignElements({ div: literal`my-panel` }); // Lit StaticValues OK too
assignElements({ default: "my-fallback" }); // can override the fallback
resetElements(); // back to stock mapping
```

Values are normalized: plain strings are wrapped with `unsafeStatic`, so a
raw string never reaches the tag position (where lit-html throws "Bindings
in tag names are not supported"). `parseChildren` also consults the registry
by `typeof child` (`registry["string"]`, `registry["number"]`, …): a registry
can wrap plain text children in another element. `resetElements()` also runs
at module load to initialize the live registry from the defaults.

## Components

Functional components are plain functions `(props) => JSX`; they receive the
props object and their returned JSX recurses through the runtime. Use them
for view composition; they are called on every render (no hooks/memos — Lit
reactivity lives in elements).

Custom elements: declare with LitElement and lit-jsx's decorator, then use
the tag (or the class) in JSX:

```tsx
import { LitElement, customElement, property } from "@yukino.js/lit-jsx";

@customElement("resume-header")
export class ResumeHeaderElement extends LitElement {
  @property() name = "";
  protected override render() {
    return <h1>{this.name}</h1>;  // JSX works inside render() too
  }
}

// JSX side — both forms render <resume-header>, props arrive as properties:
<resume-header name={data.name} />
<ResumeHeaderElement name={data.name} />
```

lit-jsx's `@customElement` (src/decorators/custom-element.ts) does
`customElements.define(tag, clazz)` — handling both the
experimentalDecorators function form and the TC39 class-descriptor form —
and additionally records constructor→tag in a module-level
`customElementRegistry` Map so the JSX runtime can render class references
without instantiating. Classes reaching `jsx()` without a registry entry are
resolved by constructing one instance and reading `.localName` — that only
works for classes that have already gone through `customElements.define`.
Import the decorator from `@yukino.js/lit-jsx`, not `lit/decorators.js`: the
lit variant skips the local registry record. Declare tags in
`HTMLElementTagNameMap` for full typing.

Re-exported from `lit/decorators.js` via the root entry: `property`, `state`,
`query`, `queryAll`, `queryAsync`, `queryAssignedElements`,
`queryAssignedNodes`, `eventOptions`.

Events from custom elements: dispatch bubbling `CustomEvent`s and listen at
the parent (container `addEventListener`) — `onXxx` props on custom elements
become `.onXxx` property assignments, not listeners.

## createRoot (src/core/create-root.ts)

```ts
const root = createRoot(document.getElementById("app")!);
root.render(<App />);      // returns the rendered element
root.unmount();            // clears the container, detaches the root
```

- Rendering again on the same root efficiently updates (lit-html diff).
- `createRoot` on an already-rooted container logs a warning and returns the
  existing root.
- `render()` after `unmount()` throws "Cannot render an unmounted root."
- Containers are tracked in `Root._roots` (module-level Map).

## Community entry (@yukino.js/lit-jsx/community)

Barrel `src/community/index.ts` → `dist/community/index.*` (package.json
`exports["./community"]`). Re-exports three modules: router, icon,
powered-by.

### Router (src/community/router.tsx)

A react-router-flavored client-side router bound to a module-level singleton
`router` — every hook and the `<route-view>`/`<route-outlet>` elements read
from it. Two location strategies share one core:

- `createHashRouter(routes)` — the route lives in `location.hash`
  (`#/users/42`); listens to `hashchange`; works on any static host.
- `createBrowserRouter(routes)` (alias `createHistoryRouter`) — the route is
  the real pathname via the History API; listens to `popstate`; needs a
  server fallback to the app shell.

Both configure + start the singleton and return it; calling one after the
other switches modes at runtime. `router.mode` reports `"hash" | "history"`,
`router.stop()` detaches the URL listener and invalidates pending results;
`router.use(adapter)` swaps the strategy directly (re-subscribing and
resolving the new location when started). Factory calls stop/reconfigure/start
atomically so old routes cannot redirect the new mode before configuration.

The strategy is a `LocationAdapter` (`getPath`/`getSearch`/`createHref`/
`requestUrl`/`listen`/`push`/`replace`); `HashLocation` and `HistoryLocation`
implement it (shared instances `hashLocation`/`historyLocation`). `push`/
`replace` return whether the browser will fire a change event on its own —
true only when the hash actually changes — so `navigate()` knows when to
resolve immediately (History API never fires `popstate` for pushState).
`Link`/`NavLink` hrefs are mode-aware via `router.createHref`.

Route matching: `flatten` compiles `RouteConfig[]` (nested `children`,
`index`, `:params`, `*` catch-all, `{ to, replace }` redirects) into ranked
flat routes; `bestMatch` prefers static > param > catch-all. Leaf elements
receive `{ params, loaderData, actionData, navigation }` props; `loader` runs
on match (navigation state `"loading"`), `action` runs via `router.submit`,
`<Form>` or `Fetcher` (state `"submitting"`, then the loader re-runs). Stale
loader and action results are dropped via an operation token, including
action-triggered loader revalidation and the interval before hashchange.
Action requests retain the query string. GET form submissions navigate with
serialized search parameters; form data includes the clicked submitter.
Fetcher ignores older results from overlapping submissions on the same instance.
Redirect chains are checked for cycles before URL writes; cycles render no
matched content instead of recursing or endlessly emitting hashchange.

Matching supports params before splats and tolerates malformed URL escapes.
Parent routes match without requiring an index child; an index child wins
ties at its parent path. Absolute child paths are not prefixed a second time.
Element-less route groups do not consume a rendered outlet level.
`<Outlet />` and `<route-outlet>` infer depth through parent outlets, crossing
Shadow DOM boundaries; `<Outlet depth={1} />` and `Outlet(1)` explicitly render
level 2. Reconnected routed elements request an update to refresh stale content.

Hooks: `useParams`, `useLocation`, `useNavigate`, `useNavigation`,
`useLoaderData`, `useActionData`, `useSearchParams` (setter navigates),
`useMatch(pattern)`, `useOutletContext`/`setOutletContext`. Components:
`Link`, `NavLink` (active className string/fn + `aria-current`), `Form`,
`Outlet(depth)`, `Fetcher`. `RoutedElement` is the LitElement base that
re-renders on router change (light DOM, `display: block`); `RouteView` /
`RouteOutlet` register as `<route-view>` / `<route-outlet>`. router.tsx also
re-exports `createRoot` and `jsx` for convenience.

Note: router.tsx imports lit directly (`lit`, `../decorators`,
`../core/create-root`, `../jsx-runtime`) — NOT the `../index` barrel. esbuild
cannot statically verify named imports through `export * from "lit"` when lit
is external, so barrel imports fail the ESM build with "No matching export".

### PoweredByLit (src/community/powered-by.tsx)

Floating "Powered by Lit + @yukino.js/lit-jsx" badge. Styled entirely via
lit-jsx's `style` prop (Lit `styleMap`) — NO Tailwind/CSS framework (the
repo has none); `powered-by-lit`/`powered-by-lit-badge` class names stay as
override hooks. The only file in src
using real JSX syntax, and the reason the package tsconfig sets
`"jsx": "react-jsx"` + `"jsxImportSource": "@yukino.js/lit-jsx"` with `paths`
mapping the self-reference back to `./src/*` (no `baseUrl` — deprecated in
TS 6). The lit logo arrives via `import litSvg from "../assets/lit.svg?raw"`.

### Icon helpers (src/community/icon.ts)

`icon(svg, className?)` strips comments/newlines and replaces/adds the root
SVG class with `lucide ${className}` (escaping attribute values).
`iconWith(svg, { className, strokeWidth })` also replaces/adds root
stroke-width without changing child attributes or creating duplicate attributes.

### ?raw imports

Vite-style `?raw` works in all three toolchains: tsup via the `raw-import`
esbuild plugin in `tsup.config.ts` (reads the file, emits
`export default "<contents>"`, registers `watchFiles`), vitest via Vite's
native `?raw` support, and tsc via the ambient `declare module "*?raw"` in
`src/types/raw.d.ts`. vitest.config.ts maps the self-reference
(`@yukino.js/lit-jsx` plus `/jsx-runtime` and `/jsx-dev-runtime`) to src via
`resolve.alias` — longest keys first, vite alias matching is prefix-based;
the transformer (oxc in vitest 5) reads decorator/JSX options straight from
tsconfig.json.

## Rendering surface details

- `createElement` always renders an open+close tag pair with children inside;
  the HTML parser handles void elements (`<input>`, `<br>`).
- `style` accepts a `styleMap` StyleInfo (camelCase CSS properties); passing
  nothing uses a shared empty object (no allocation per render).
- SVG fragments: JSX renders via `html`, so inline `<svg>` subtrees work, but
  there is no `svg`-tagged JSX variant.
- Lit DEV-mode warnings apply; production builds of lit silently drop some
  dev-time validation.

## Testing (vitest + jsdom)

`vitest.config.ts` pins `environment: "jsdom"`, includes `tests/**/*.test.ts`,
restates `experimentalDecorators`/`useDefineForClassFields: false` via
`esbuild.tsconfigRaw` (needed to transform decorator tests), and aliases `@`
to `./src`. Tests import from `../src/*` directly — no build step required —
and render with lit's `render()` into a `<div>` appended to `document.body`
and removed per test. Coverage: `createElement` prop semantics (incl. nullish
prop omission and textarea children-as-value), select value/defaultValue
ordering (`tests/select-value.test.ts`), registry overrides (incl. overrides
mapping to `textarea`), the event-name Proxy incl. derived names outside the
special-case map, spread cleanup between renders (handler swap, reused-node
property resets), `createRoot` lifecycle, functional/class components and
Fragment. Run with `pnpm test`. Router coverage lives in
`tests/router.test.ts` (hash + history modes, redirects, search params,
loaders/actions, Fetcher, mode switching, popstate/hashchange flows) and
the community barrel, `?raw` imports and `PoweredByLit` in
`tests/community.test.ts`.

Type-level regressions live in `tests/types/jsx-types.tsx` (never executed —
checked by `tsc -p tests/types/tsconfig.json`, which `pnpm typecheck` runs
after the main `tsc --noEmit`). Positive cases: React-style camelCase event
names, custom-element `onXxx` callback properties, numeric
`value`/`defaultValue`, unannotated callback `ref` params. The
`@ts-expect-error` lines pin the negative cases: a custom `onSubmit` given a
`SubmitEvent` where it expects form values, wrong event payload properties
(`e.button` on a KeyboardEvent, `e.key` on a MouseEvent), and object
`value`s on `<input>`.

## Sharp edges

- Unknown/unregistered tags silently render `<div>` (registry default). If
  something "doesn't show up", check the tag spelling/registration first.
- `onXxx` on custom elements → property, not listener (documented above).
- `onXxx` on primitives becomes a listener only for props matching
  `/^on[A-Z]/`; all-lowercase spellings (`onclick`) take the property path,
  and hyphenated custom event names have no JSX prop form — use
  `addEventListener`.
- Class references used as JSX tags must already be defined custom elements
  (unregistry-resolved classes are instantiated to read `.localName`).
- `useDefineForClassFields: false` is load-bearing for Lit properties; do not
  "modernize" it away.
- Nullish prop values set nothing (neither attributes nor properties) and
  only clear DOM state through the removal/cleanup path on re-render.
- The community router is a module singleton: `createHashRouter`/
  `createBrowserRouter` reconfigure the same `router` instance that all
  hooks and `<route-view>`/`<route-outlet>` elements read from.
- Inside this package, never import lit symbols through the `src/index.ts`
  barrel from another entry (e.g. community): `export * from "lit"` with
  lit external breaks esbuild's ESM named-export verification. Import from
  `lit` (or the concrete local module) directly.
- `literal`/`unsafeStatic` come from `lit/static-html.js`, not the
  `@yukino.js/lit-jsx` root entry.
