# lit-jsx

> Requires `lit@latest` (3.x); older Lit versions are not supported.

`lit-jsx` is a library that provides a convenient way to build Lit components using JSX syntax.

## Installation

```bash
pnpm install @yukino.js/lit-jsx
```

## Usage

To use `lit-jsx` simply import from `@yukino.js/lit-jsx` whatever you would otherwise import from `lit`. You also need to configure your bundler or transpiler to use `lit-jsx` for processing JSX, instead of the default. For example in TypeScript you would add something like this to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@yukino.js/lit-jsx"
  }
}
```

There is a similar mechanism for Babel where you would add something like this to your `babel.config.js`:

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

Because Lit relies on legacy class-field semantics, also keep these options enabled: `experimentalDecorators`, `emitDecoratorMetadata` and `useDefineForClassFields: false`.

### Rendering

JSX compiles to a Lit `TemplateResult`, so you can render it anywhere a Lit template is expected. The package ships a tiny `createRoot` wrapper for app-style mounting:

```tsx
import { createRoot } from "@yukino.js/lit-jsx";

const root = createRoot(document.getElementById("app")!);
root.render(<App />);
```

Call `root.render(...)` again to update (lit-html diffs efficiently), and `root.unmount()` to clear the container.

### Components

Functional components are plain functions that return JSX:

```tsx
const Greeting = ({ name }: { name: string }) => <div>hi {name}</div>;
```

Custom elements are declared with LitElement and the `customElement` decorator exported from this package (it also records the tag name so the JSX runtime can render class references without instantiating them):

```tsx
import { LitElement, customElement, property } from "@yukino.js/lit-jsx";

@customElement("my-greeting")
export class MyGreeting extends LitElement {
  @property() name = "";

  render() {
    return <h1>hello {this.name}</h1>;
  }
}

// Later, in any JSX — props arrive as element properties:
<my-greeting name="world" />;
```

### Props

Prop handling follows React conventions where it makes sense and Lit/web-platform conventions where those differ:

- `onXxx` props become real DOM event listeners on native tags (`onClick` → `click`, plus the full modern event surface — `onWheel`, `onTouchEnd`, composition, animation, transition events, etc.). Both React-style camelCase names (`onKeyDown`, `onDoubleClick`, `onTransitionEnd`, …) and the direct DOM spellings (`onKeydown`, `onDblclick`, …) are bound at runtime **and** typed.
- `onXxx` props on **your own custom elements** are not auto-bound: they are forwarded as properties, so the element decides what a prop named `onClick` means. The usual web-components pattern applies — dispatch a bubbling `CustomEvent` and listen for it on the parent. If your element declares its own `onXxx` callback property, that declared type wins over the native event-handler typing (no more uncallable intersections).
- `className` (or `class`) sets the class, `style` takes a camelCase style object (Lit's `styleMap`), and `ref` accepts Lit's ref objects or callbacks.
- Hyphenated props (`data-*`, `aria-*`, …) become attributes; everything else is assigned as a DOM property — even when `undefined`, so reactive properties reset like you'd expect in Lit.
- `value` / `defaultValue` accept numbers (and string arrays) like React's types do; string-valued DOM properties are coerced on assignment.
- `<select value={x}>` and `<select defaultValue={x}>` work as in React: the value is applied **after** the `<option>` children commit (assigning `.value` before any option exists is silently ignored by the browser, which then falls back to the first option). `value` is re-applied on every render (controlled); `defaultValue` is applied when it first appears or changes but never overrides a newer user selection (uncontrolled); array values select every matching option for `multiple` selects.
- `<textarea>{"initial text"}</textarea>` forwards text children as the initial value (React semantics), unless an explicit `value`/`defaultValue` prop is given. Non-text children are dropped — lit-html cannot render child expressions inside `<textarea>` (raw-text parsing).
- `false`, `null` and `undefined` children render nothing, just like React (`{cond && <div />}` is safe).
- `key` is accepted for React familiarity but unused — Lit's diffing has no key semantics.

### Custom Elements

`lit-jsx` allows you to customize what should be rendered for each tag name. For example, if you want JSX `<button />` to result in `<my-custom-button />`, you would pass an override in your registry.

Here's how you would do that:

```typescript
import { assignElements, resetElements } from "@yukino.js/lit-jsx";

// Define your custom elements
const customElements = {
  button: "my-custom-button",
  // Add more custom elements as needed
};

// Assign your custom elements
assignElements(customElements);

// Later, if you want to reset to the default elements
resetElements();
```

Override values can be plain strings (wrapped internally with Lit's `unsafeStatic`) or Lit static values such as `literal`my-button``. You can also override the `default`mapping that unknown tags fall back to (by default,`<div>`).

#### And why in the world would I want to do _that_?

The original motivation behind this jsx-runtime was for a WebXR UI framework I was working on. In WebXR, any UI you make _has_ to be rendered using Canvas/webgl which is as fun as it sounds so I wanted to be able to define UI components using HTML syntax. My basic idea was to create webgl/three-js versions of each HTML element and then configure `lit-jsx` so that whenever the JSX called for say, a "button" to be rendered, the webgl equivalent would be rendered instead.

I got a fair amount of it working including divs, images, text, overflow management, scroll bars, flex-box, border-radii, background colors, etc.

<details>

<summary>Expand to see the code for this "component"</summary>

</details>

## Community

Optional, higher-level utilities built on top of the runtime live behind the `@yukino.js/lit-jsx/community` entry point.

### Router

A small react-router-flavored client-side router. Pick one of two location strategies — both share the same route matching, loader/action pipeline, hooks and components:

- `createHashRouter(routes)` keeps the route in the URL hash (`#/users/42`). Works on any static host.
- `createBrowserRouter(routes)` (alias `createHistoryRouter`) routes on the real pathname (`/users/42`) via the History API. The server must serve the app shell for every path.

```tsx
import { createRoot } from "@yukino.js/lit-jsx";
import { createHashRouter, Link, Outlet } from "@yukino.js/lit-jsx/community";

function Layout() {
  return (
    <div>
      <nav>
        <Link to="/">Home</Link>
        <Link to="/users/42">User 42</Link>
      </nav>
      <Outlet />
    </div>
  );
}

createHashRouter([
  {
    path: "/",
    element: Layout,
    children: [
      { index: true, element: Home },
      {
        path: "users/:id",
        element: UserPage,
        loader: ({ params }) => fetchUser(params.id),
      },
    ],
  },
]);

createRoot(document.getElementById("app")!).render(<route-view />);
```

Route configs support `path`/`index` segments, `:params`, `*` catch-alls, nested `children` rendered through `<route-outlet>`, redirects (`{ path: "old", to: "/new" }`), and per-leaf `loader`/`action` functions. Leaf elements receive `{ params, loaderData, actionData, navigation }` as props.

Components: `<route-view>` (renders the matched route chain), `<route-outlet>` (renders the next level), `Link`, `NavLink` (active-state className, `aria-current`), `Form` (submits to the route action), `Outlet(depth?)`, and `Fetcher` for out-of-band submissions.

Hooks (all read from the shared router instance): `useParams`, `useLocation`, `useNavigate`, `useNavigation`, `useLoaderData`, `useActionData`, `useSearchParams`, `useMatch`, `useOutletContext`.

The underlying `Router` class takes a swappable `LocationAdapter` (`HashLocation` / `HistoryLocation` are provided, custom strategies work too); `router.mode` reports the active one, and `router.stop()` detaches the URL listener.

### PoweredByLit badge

`PoweredByLit` renders a floating "Powered by Lit + @yukino.js/lit-jsx" badge with the lit logo.

### Icon helpers

`icon(svg, className)` and `iconWith(svg, { className, strokeWidth })` normalize lucide-style SVG strings (strip comments, collapse whitespace) and re-class / re-stroke them for inline use.

### `?raw` imports

The tsup build understands Vite-style `?raw` imports — `import text from "./file.svg?raw"` yields the file contents as a string default export (implemented as an esbuild plugin in `tsup.config.ts`; type-level support via `src/types/raw.d.ts`).

## Development

This package lives in a pnpm workspace together with the demo app at the repository root.

```bash
pnpm test        # vitest + jsdom, tests in tests/
pnpm typecheck   # tsc --noEmit
pnpm build       # tsup — ESM + CJS + dts
```
