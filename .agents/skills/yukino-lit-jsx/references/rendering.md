# JSX rendering and types

Paths are relative to `packages/lit-jsx/`.

## DOM props

`src/core/create-element.ts` extracts `children`, `ref`, `style`, and `key`.
`ref` uses Lit's ref directive; `style` uses `styleMap`; `key` is discarded
without affecting DOM diffing. Remaining props go through `parseProps` in
`src/utils/element-utils.ts` and then `src/directives/spread.ts`.

Prop classification checks the original JSX tag's `registry[type]` entry,
not the resolved DOM element's class. Thus an override of a native tag keeps
that tag's parsing rules even when it renders a custom element.

| Prop                        | Tag with a registry entry      | Tag without a registry entry |
| --------------------------- | ------------------------------ | ---------------------------- |
| `onXxx` matching `^on[A-Z]` | Event listener                 | Property                     |
| `class`                     | `className` property           | `class` property             |
| `className`                 | Property                       | Property                     |
| A hyphenated name           | Attribute                      | Property                     |
| Boolean value               | Boolean attribute and property | Property                     |
| Other value                 | Property                       | Property                     |

Null/undefined values do not assign DOM state. Previously applied bindings
that disappear or become nullish are cleaned up by spread. Unknown names
that fall back to `div` still follow the no-registry-entry column.

`getNativeEventName` maps `onDoubleClick` to `dblclick`; other matching names
remove `on` and lowercase the remainder. For example, `onKeyDown` becomes
`keydown`. Lowercase `onclick` uses the property path. For custom event names
that cannot be represented by that conversion, bind through
`addEventListener` or a raw spread `@event-name` binding.

`spread` supports keys prefixed by `@` (event), `.` (property), `?` (boolean
attribute), and unprefixed attribute keys. It skips nullish and unchanged
values, removes dropped listeners/attributes, deletes own properties, clears
removed `className`, and resets other inherited properties to `""` if their
current value is a string or to `undefined` otherwise. Event callbacks use
Lit's render host when present, otherwise the element, as `this`. Listener
objects and listener options are accepted at runtime. Disconnect/reconnect
removes/restores listeners.

## Children and form values

`parseChildren` filters direct nullish/boolean children and preserves other
values, including zero. Arrays can contain nested renderables handled by Lit.

Select bindings are special: `value` and `defaultValue` are removed from the
opening-tag spread and applied by `src/directives/select-value.ts` after
option children commit.

- Non-null `value` takes precedence and is applied on every render.
- `defaultValue` is normalized to an array of strings and compared by ordered
  contents. It applies on first appearance or content changes, setting both
  `option.defaultSelected` and current selection. Equal defaults preserve
  user selection. Removing the default or using controlled `value` resets the
  remembered snapshot, allowing the same default to apply when reintroduced.
- Scalar selection uses `select.value = String(value)`; array selection
  checks membership for each option.
- An unchanged default does not reapply merely because options change.
  Removing a default clears the snapshot, not existing `defaultSelected`
  flags. Both-nullish bindings perform no selection assignment.

`textarea` and `template` render without child expressions. For textarea,
string/number children are concatenated and assigned through `defaultValue`
unless a non-null `value` or `defaultValue` prop is supplied. Direct
nullish/boolean children are skipped; any other child type prevents conversion.
This default preserves edited text and supplies the reset value. Template
children are discarded.

Other input values use ordinary property assignment through spread, which
skips unchanged values. Do not extend select's every-render assignment rule
to all form elements.

## JSX type layer (`src/jsx-runtime.ts`)

Intrinsic types use `HTMLElementTagNameMap`, with an HTMLElement fallback for
unknown tags. `ElementProps<T>` combines partial element properties, native
`onXxx` event types, camelCase event aliases, value types, `children`, typed
`ref`, `StyleInfo`, and an unknown-valued prop index signature.

An element's declared literal `onXxx` property takes precedence over generated
event props. `KnownKeys` removes index signatures before this exclusion so
an element such as form keeps its contextual event types.

`ValueProps` widens string-valued `value`/`defaultValue` properties to also
accept numbers, readonly string arrays, and null. Number-valued properties
also accept strings and null. These types do not add runtime conversion
beyond the DOM assignments and select normalization described above.

Verify rendering changes with the focused tests under `tests/`; verify
contextual typing and rejected prop values with `tests/types/jsx-types.tsx`
and the package's `typecheck` script.
