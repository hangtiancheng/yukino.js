---
name: yukino-lit-jsx
description: >
  Authoritative reference for @yukino.js/lit-jsx (lit-jsx/ in this repo), a
  JSX runtime for Lit (lit@3.x only — no older-Lit compatibility). Write
  Lit/web-component applications with React-style JSX instead of html``
  string templates. Covers the automatic JSX runtime (jsx/jsxs/jsxDEV,
  Fragment/<>), createElement's JSX-prop → Lit-expression semantics (onXxx →
  @event listeners on primitives, class/className → .className property,
  style → styleMap, ref → lit ref directive, hyphenated props → attributes,
  booleans → ?boolean-attribute plus property, everything else → property
  assignment even when undefined, key stripped, false/null/undefined children
  skipped), createRoot/Root (render/unmount/duplicate-container warning),
  the element registry (assignElements/resetElements tag overrides accepting
  plain strings or Lit StaticValues, default div fallback), the local
  customElement decorator that registers tag names for class-component JSX,
  re-exported Lit decorators (property, state, query, queryAll, queryAsync,
  queryAssignedElements, queryAssignedNodes, eventOptions), the spread
  directive, the full JSX→DOM event-name map, and the JSX type layer
  (JSX.IntrinsicElements over HTMLElementTagNameMap). Testing setup:
  vitest + jsdom (tests/). Trigger tokens: @yukino.js/lit-jsx, lit-jsx,
  jsxImportSource "@yukino.js/lit-jsx", jsx-runtime, createRoot(,
  assignElements(, resetElements(, customElementRegistry, jsx(",
  Fragment(, yukino-lit-jsx. Use whenever a file in this repo uses JSX with
  LitElement/web components, configures jsxImportSource, or when the user
  mentions lit-jsx, JSX props not applying, onXxx handlers not firing on
  custom elements, tag overrides, or lit-jsx tests. Do NOT use for React,
  Next.js, Preact, Solid or Vue rendering; for Lit html`` templates without
  JSX; for lit's own decorators via "lit/decorators.js" (import them from
  @yukino.js/lit-jsx so tag names register); or for non-JSX Lit apps.
---

# @yukino.js/lit-jsx

A JSX runtime for Lit. Lets you write Lit templates and whole apps with
React-style JSX instead of `html` string templates — the only runtime
dependency is `lit` itself (lit@latest / 3.x). JSX compiles to a
`TemplateResult` (via lit-html), so JSX output renders anywhere a Lit
template does: `LitElement.render()`, `root.render()`, or inside other
templates.

- Package: `@yukino.js/lit-jsx` (workspace package at `lit-jsx/`)
- Source root: `lit-jsx/src/` (core, directives, decorators, utils, types)
- Build: `tsup` — ESM + CJS + dts; entries `src/index.ts` and `src/jsx-runtime.ts`
- Scripts: `pnpm build`, `pnpm test` (vitest + jsdom, `tests/`), `pnpm typecheck`

## Entry points

| Import                               | Purpose                                                                                                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@yukino.js/lit-jsx`                 | Re-exports everything from `lit` PLUS `createRoot`, `assignElements`, `resetElements`, decorators, directives, types. Import `LitElement`, `html`, decorators etc. from here, not from `lit`, so the runtime's wiring is consistent. |
| `@yukino.js/lit-jsx/jsx-runtime`     | The automatic JSX runtime (`jsx`, `jsxs`, `jsxDEV`, `Fragment`). Referenced by the transpiler via `jsxImportSource`; you rarely import it by hand.                                                                                   |
| `@yukino.js/lit-jsx/jsx-dev-runtime` | Same file as `jsx-runtime` (development transforms alias here).                                                                                                                                                                      |

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

Lit also requires legacy class-field semantics — keep
`"experimentalDecorators": true`, `"emitDecoratorMetadata": true` and
`"useDefineForClassFields": false` (see lit docs: "Avoiding issues with class
fields").

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

## How a JSX tree becomes DOM

```
JSX → jsx(type, config)                      (src/jsx-runtime.ts)
    ├─ type is a function?
    │   ├─ extends HTMLElement → resolve tag via customElementRegistry
    │   │   (populated by lit-jsx's @customElement decorator; falls back to
    │   │   constructing once to read .localName) → createElement(tag, config)
    │   └─ plain function      → call type(config)   (functional component)
    └─ type is a string        → createElement(type, config)
createElement                                  (src/core/createElement.ts)
    └─ resolve tag → html`<${tag} ${ref} ${spread(props)} style=${styleMap}>${children}</${tag}>`
```

### Tag resolution order (`getHTMLTag`)

1. `window.customElements.get(type)` → render that exact tag via
   `unsafeStatic(type)`. Registered custom-element tags in JSX always work.
2. `elementRegistry[type]` → the mapped tag (defaults map every standard HTML
   tag to itself using `literal` static values).
3. `elementRegistry.default` → **falls back to `<div>` for anything unknown**.
   Typos in tag names silently render a div — watch for this when debugging.

## Prop semantics (the critical table)

Applied by `parseProps` (src/utils/elementUtils.ts) + the `spread` directive.
"Primitive" here means: the JSX tag resolved through the element registry
(`registry[type]` truthy), i.e. native tags and registry overrides — as opposed
to registered custom elements rendered by their own tag.

| JSX prop                             | Primitive tags                                                | Registered custom elements                                                                            |
| ------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `onXxx` (in event map)               | `@event` listener via spread                                  | **not auto-bound** — becomes a `.onXxx` property; the element decides what a prop named onClick means |
| `class`                              | `.className` property                                         | `.class` property                                                                                     |
| `className`                          | `.className` property                                         | `.className` property                                                                                 |
| `style`                              | handled separately: `styleMap` (camelCase StyleInfo object)   | same                                                                                                  |
| `ref`                                | lit `ref` directive (object ref from `createRef` or callback) | same                                                                                                  |
| `data-foo`, `aria-*`, any hyphenated | attribute (`setAttribute`, removed when null/undefined)       | `.prop` property                                                                                      |
| boolean                              | `?attr` **and** `.prop` (both)                                | `.prop` property                                                                                      |
| everything else                      | `.prop` property assignment                                   | `.prop` property assignment                                                                           |

Deliberate differences from React to keep in mind:

- Props are always forwarded as properties, **even when undefined** — this is
  what resets Lit reactive properties. Undefined does not "clear" the prop.
- `onXxx` names not in the event map (custom events) become plain properties —
  pass them as properties the element understands, or listen with
  `addEventListener` on a ref/container (see the resume demo's
  `toggle-locale` CustomEvent pattern).
- Events are delegated through one `handleEvent` per spread part; changing a
  handler between renders swaps listeners, and dropping a prop removes its
  listener/attribute/property (`apply`/`groom` in src/directives/spread.ts —
  includes the open-wc fix for handlers that become undefined).
- `key` is accepted (React familiarity) and **stripped** — Lit diffing has no
  key semantics; it must not leak onto the DOM as a property.
- `false`/`true`/`null`/`undefined` children render nothing (React-style);
  lit-html alone would render booleans as text, so `parseChildren` filters
  them. `0` renders (also React-style).

### Event name map

`getNativeEventName` (src/utils/eventUtils.ts) maps React-style `onXxx` to
native names: `onDoubleClick→dblclick`, and the standard set including click,
input, keydown/press/up, pointer*, mouse*, touch (start/move/end/cancel),
drag*, focus/blur, scroll, submit, change, wheel, invalid, toggle,
composition(start/update/end), animation(start/end/iteration/cancel),
transition(start/end/cancel), beforeinput, load*, select*, auxclick, and
more. Adding an event = adding one entry to `eventsMap` (tests cover the
full list).

## Registry overrides (assignElements / resetElements)

Map tag names to different tags — originally built for a WebXR/Canvas UI
framework where `<button />` renders a `twixt-button`:

```ts
import { assignElements, resetElements, literal } from "@yukino.js/lit-jsx";

assignElements({ button: "my-custom-button" }); // plain strings OK
assignElements({ div: literal`my-panel` }); // Lit StaticValues OK too
assignElements({ default: "my-fallback" }); // can override the fallback
resetElements(); // back to stock mapping
```

Values are normalized: plain strings are wrapped with `unsafeStatic`
(lit-html throws "Bindings in tag names are not supported" in dev mode if a
raw string reaches the tag position — this normalization is why it can't
happen through the public API). `parseChildren` also consults the registry by
`typeof child` (`registry["string"]`, `registry["number"]`, …): a Canvas
registry can wrap plain text children in a canvas text element.

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

Always import the decorator from `@yukino.js/lit-jsx` (not
`lit/decorators.js`): this variant additionally records constructor→tag in a
local registry so the JSX runtime can render class references without
instantiating. Declare tags in `HTMLElementTagNameMap` for full typing.

Events from custom elements: dispatch bubbling `CustomEvent`s and listen at
the parent (container `addEventListener` or `onXxx` on a primitive wrapper) —
there is no auto-binding of `onXxx` to custom elements by design.

## createRoot (src/core/createRoot.ts)

```ts
const root = createRoot(document.getElementById("app")!);
root.render(<App />);      // returns the rendered element
root.unmount();            // clears the container, detaches the root
```

- Rendering again on the same root efficiently updates (lit-html diff).
- `createRoot` on an already-rooted container logs a warning and returns the
  existing root.
- `render()` after `unmount()` throws "Cannot render an unmounted root."
- Containers are tracked in `Root._roots` (module-level map).

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
and restates `experimentalDecorators`/`useDefineForClassFields: false` via
`esbuild.tsconfigRaw` (needed to transform decorator tests). Tests import
from `../src/*` directly — no build step required — and render with lit's
`render()` into a detached `<div>` appended to `document.body`. Coverage:
`createElement` prop semantics, registry overrides, event-name map, spread
cleanup between renders, `createRoot` lifecycle, functional/class components
and Fragment. Run with `pnpm test`.

## Known sharp edges

- Unknown/unregistered tags silently render `<div>` (registry default). If
  something "doesn't show up", check the tag spelling/registration first.
- `onXxx` on custom elements → property, not listener (documented above).
- Class components that were never `customElements.define`d render their
  dasherized-name tag but the element never upgrades (no reactivity).
- `useDefineForClassFields: false` is load-bearing for Lit properties; do not
  "modernize" it away.
- Property forwarding sets props even when `undefined` (unlike React) —
  intended, so reactive properties reset.
