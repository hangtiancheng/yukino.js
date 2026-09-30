# JSX Semantics

Source of truth: `src/jsx/reconcile.ts`, `src/jsx/vnode.ts`,
`src/jsx-runtime.ts`.

There is **no template compiler, no `.html` files, and no HTML-string
serialization** — JSX/TSX compiles through the standard automatic runtime
(`jsxImportSource: "@yukino.js/react-signal"`) into pure-data VNodes, reconciled
**directly into the live DOM** every render. The component body IS the
template: it re-runs per render inside the instance's render effect, so
every signal read subscribes the instance.

```tsx
import { useSignal, useComputed, raw } from "@yukino.js/react-signal";

export default function Dashboard() {
  const user = useSignal({ isAdmin: false });
  const items = useSignal<{ id: number; name: string }[]>([]);
  const total = useComputed(() => items.value.length);

  return (
    <>
      {user.value.isAdmin ? <div class="admin">Admin</div> : <div>Guest</div>}
      <ul>
        {items.value.map((item) => (
          <li key={`item-${item.id}`}>{item.name}</li>
        ))}
      </ul>
      <p>{total.value} items</p>
    </>
  );
}
```

## Render pipeline (per pass)

```
fn(props) → VNode tree (plain jsx() calls — pure data)
  → normalize (flatten arrays/Fragments, unwrap Signal children, drop
      null/boolean/""; function tags become COMPONENT items — never invoked
      inline)
  → keyed slice diff vs the previous rendered nodes (anchor-bounded)
  → patch attributes via a RESOLVED snapshot; swap per-node listeners
  → post-commit flush (untracked): mount child instances, batch-push
      changed props, call refs
  → flushInstanceEffects: pending mount useEffect callbacks run
```

## Children semantics

| JSX                         | Behavior                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `{expr}` (string/number)    | Text node (`0` renders; `boolean/null/undefined/""` render nothing)                                         |
| `{sig}` (Signal)            | Auto-unwrapped to `sig.value` — a tracked read                                                              |
| `{raw(html)}`               | Trusted raw HTML block — parsed once, swapped wholesale when the string changes; never pass untrusted input |
| `{cond && <div/>}`          | Conditional rendering (falsy values dropped)                                                                |
| `{list.map(...)}`           | List rendering (arrays flattened)                                                                           |
| `<>...</>` (Fragment)       | Multiple roots without a wrapper element                                                                    |
| `<Comp prop={x}>...</Comp>` | Function component — mounts a hostless INSTANCE; children arrive as `props.children`                        |

Strings are ALWAYS text — dangerous characters stay text data, nothing is
parsed as markup. `raw()` is the single explicit trusted-HTML path
(dangerouslySetInnerHTML equivalent).

**Every function tag is an instance** — there is no separate "stateless
partial" tag kind. A helper that should stay inline in the caller's render
is CALLED as a function instead: `{renderRow(item)}`.

## Attribute semantics

| Attribute                        | Behavior                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `class` / `className`            | String, array (falsy entries dropped), or `{ name: boolean }` map — merged                               |
| `style`                          | String, or camelCase object (kebab-cased; `--x` custom props pass through)                               |
| `key`                            | Vnode-level sibling compare key (React semantics) — NOT written to the DOM                               |
| `id`                             | Ordinary attribute (no framework meaning)                                                                |
| `ref`                            | `(el \| null) => void` callback or `{ current }` cell — called post-commit                               |
| `disabled={true}`                | Boolean attribute → `disabled=""`; `false`/nullish remove the attribute                                  |
| `title={sig}`                    | Signal attribute values auto-unwrap (tracked read; updates diff correctly)                               |
| `value` / `checked` / `selected` | Synced as DOM **properties** on form elements; the template value re-asserts over user edits each render |
| `data-x={object}`                | NOT supported — objects/functions are skipped with a dev warning                                         |
| `onClick={fn}`                   | Per-node listener (see components.md) — inline functions only                                            |

Component props are the exception to Signal unwrapping: a Signal passed as a
component prop stays wrapped so the child can subscribe directly. On
component tags, `class`/`style`/`id`/`ref` are ordinary props (hostless —
the component applies them itself).

SVG (`<svg>`) and MathML (`<math>`) subtrees create namespaced elements;
`<foreignObject>` children return to the HTML namespace. Component slices
inherit the namespace of their mount position.

Give loop items a stable `key` for keyed reordering instead of in-place
rewrites — keys only need to be unique among siblings. On component tags,
`key` preserves the instance (and its hook state) across reorders.

## Security / correctness notes

- All non-`raw()` content is text/attribute DATA — the reconciler never
  parses strings as HTML, so there is no escaping to get wrong.
- Native inline handlers (`onclick="..."` lowercase, or string values on
  `onClick`) are rejected — they would execute attribute text as JS.
- Attribute names are validated (`/^[^\s"'>/=\\]+$/`) — dynamic prop spreads
  cannot inject attributes.
- Writing a signal inside the component body is a reactivity cycle
  (`Cycle detected`) — derive with `useComputed` instead.
