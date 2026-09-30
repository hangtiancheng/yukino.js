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

- `onXxx` props become real DOM event listeners on native tags (`onClick` → `click`, plus the full modern event surface — `onWheel`, `onTouchEnd`, composition, animation, transition events, etc.).
- `onXxx` props on **your own custom elements** are not auto-bound: they are forwarded as properties, so the element decides what a prop named `onClick` means. The usual web-components pattern applies — dispatch a bubbling `CustomEvent` and listen for it on the parent.
- `className` (or `class`) sets the class, `style` takes a camelCase style object (Lit's `styleMap`), and `ref` accepts Lit's ref objects or callbacks.
- Hyphenated props (`data-*`, `aria-*`, …) become attributes; everything else is assigned as a DOM property — even when `undefined`, so reactive properties reset like you'd expect in Lit.
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

Override values can be plain strings (wrapped internally with Lit's `unsafeStatic`) or Lit static values such as `literal`my-button``. You can also override the `default` mapping that unknown tags fall back to (by default, `<div>`).

#### And why in the world would I want to do _that_?

The original motivation behind this jsx-runtime was for a WebXR UI framework I was working on. In WebXR, any UI you make _has_ to be rendered using Canvas/webgl which is as fun as it sounds so I wanted to be able to define UI components using HTML syntax. My basic idea was to create webgl/three-js versions of each HTML element and then configure `lit-jsx` so that whenever the JSX called for say, a "button" to be rendered, the webgl equivalent would be rendered instead.

I got a fair amount of it working including divs, images, text, overflow management, scroll bars, flex-box, border-radii, background colors, etc.
<details>

<summary>Expand to see the code for this "component"</summary>

</details>

## Development

This package lives in a pnpm workspace together with the demo app at the repository root.

```bash
pnpm test        # vitest + jsdom, tests in tests/
pnpm typecheck   # tsc --noEmit
pnpm build       # tsup — ESM + CJS + dts
```
