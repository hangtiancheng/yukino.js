---
name: yukino-lit-jsx
description: >-
  Use when implementing, debugging, or reviewing @yukino.js/lit-jsx or
  packages/lit-jsx: Lit JSX runtime and types, DOM prop handling, custom
  elements, registry overrides, community router, SVG helpers, and badge.
---

# @yukino.js/lit-jsx

This package converts automatic JSX calls into Lit template results. Paths
below are relative to `packages/lit-jsx/`.

## Entries and source map

| Entry                                | Source and purpose                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `@yukino.js/lit-jsx`                 | `src/index.ts`: Lit exports, `createRoot`, registry functions, decorators, directives, and types |
| `@yukino.js/lit-jsx/jsx-runtime`     | `src/jsx-runtime.ts`: `jsx`, `jsxs`, `jsxDEV`, `Fragment`, and JSX types                         |
| `@yukino.js/lit-jsx/jsx-dev-runtime` | Maps to the same files as `jsx-runtime`                                                          |
| `@yukino.js/lit-jsx/community`       | `src/community/index.ts`: router, icon helpers, and `PoweredByLit`                               |

All entries have ESM, CJS, and declaration outputs. The root does not export
`jsx`, `Fragment`, or `createElement`. `literal` and `unsafeStatic` are imported
from `lit/static-html.js` when needed. Direct imports from `lit` are used by
the package itself; consumers can also use Lit's own entrypoints.

For DOM bindings, forms, event types, and spread cleanup, read
[references/rendering.md](references/rendering.md). For routing, navigation,
loaders/actions, and outlet depth, read
[references/router.md](references/router.md).

## Runtime and registration

`jsx`, `jsxs`, and `jsxDEV` are the same function. A string tag goes through
`src/core/create-element.ts`. A function component is invoked with its props;
an HTMLElement subclass is resolved to its registered tag. `Fragment` returns
its children as an array.

The tag lookup in `src/utils/element-utils.ts` is:

1. A tag defined in `window.customElements` uses that tag.
2. Otherwise use its entry in the element registry.
3. Otherwise use `registry.default`, initially `div`.

`assignElements({ tag: replacement })` updates the shared registry, wrapping
string replacements in `unsafeStatic`; Lit `StaticValue` replacements are
also accepted. `resetElements()` restores the defaults. A child-type registry
entry such as `string` can wrap children of that type.

The default registry in `src/core/element-registry.ts` lists HTML tags; it
contains no `svg` or `path` entry. Unmapped SVG tag names therefore take the
default fallback. The runtime creates templates with static `html`, without
an SVG template variant. Community SVG utilities return strings that can be
inserted using an appropriate Lit directive.

The package's `customElement` decorator records a constructor-to-tag mapping
and calls `customElements.define`. JSX class tags without that local mapping
are instantiated once to read `localName`, so they must already be defined
custom elements. Add custom tag types to `HTMLElementTagNameMap` for prop
inference. The package configures `experimentalDecorators: true` and
`useDefineForClassFields: false` for its decorated elements; keep that
configuration when modifying these elements.

Imports of the runtime/decorators reach
`src/utils/custom-element-registry.ts`, which accesses `window` at module
scope. The community entry also constructs browser objects and defines custom
elements during import. Load these entries with a browser DOM available.

## Root lifecycle

`createRoot(container)` accepts an HTMLElement or DocumentFragment. Calling
it again for the same active container warns and returns the existing root.
`root.render(value)` delegates to Lit and returns the supplied value.
`root.unmount()` renders `nothing`, removes the root registration, and retires
that root. A later render on that root throws; the container can be used for
a new root.

## Community SVG and badge utilities

`icon(svg, className?)` removes comments, collapses whitespace, and, for a
truthy className, sets the first SVG opening tag's class to
`lucide ${className}`. Without a truthy className it leaves class unchanged.
`iconWith(svg, { className, strokeWidth })` also sets SVG `stroke-width` when
provided. Attribute replacement is scoped to that opening tag, parses quoted
values, and escapes inserted values; child attributes remain untouched.
These functions return strings and do not sanitize SVG content.

`PoweredByLit()` returns a fixed-position badge styled through `styleMap`.
It reads `src/assets/lit.svg?raw`, inserts the logo with `unsafeHTML`, and
sets logo dimensions to 13 by 16. No CSS framework is needed by the component.

## Toolchain and verification

Automatic JSX uses `jsx: "react-jsx"` and
`jsxImportSource: "@yukino.js/lit-jsx"`. The package tsconfig maps its own
entrypoints back to source. Vitest's `resolve.alias` supplies the corresponding
runtime resolution with the more specific JSX entrypoints first.

`tsup.config.ts` builds the three source entries to ESM/CJS/declarations. Its
`raw-import` plugin accepts relative or absolute paths ending in `?raw`, reads
UTF-8 text, emits a string default export, and registers `watchFiles`. Bare
package specifiers with `?raw` are rejected. TypeScript recognizes these
imports through `src/types/raw.d.ts`; Vitest uses Vite's raw-import handling.

```sh
pnpm --filter @yukino.js/lit-jsx test
pnpm --filter @yukino.js/lit-jsx typecheck
pnpm --filter @yukino.js/lit-jsx build
```

Runtime tests live in `tests/**/*.test.ts` and use jsdom. Typecheck runs both
the package check and `tests/types/tsconfig.json`; the latter checks the JSX
fixtures without running them. The build copies this skill from
`.agents/skills/yukino-lit-jsx/` into package `skills/`; maintain the source
skill and its references there.
