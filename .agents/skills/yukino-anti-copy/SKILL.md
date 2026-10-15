---
name: yukino-anti-copy
description: >-
  Use when implementing, debugging, or reviewing @yukino.js/anti-copy or
  packages/anti-copy: browser clipboard replacement, selection and keyboard
  restrictions, print hiding, and DevTools detection.
---

# @yukino.js/anti-copy

This package implements browser event restrictions and injected styles. It
cannot enforce confidentiality or access control over content delivered to the
browser. Paths below are relative to `packages/anti-copy/`.

## Source map and entry

- `src/index.ts`: public exports, feature assembly, instance lifecycle.
- `src/core/types.ts` and `options.ts`: option types and resolved defaults.
- `src/core/clipboard.ts`, `keyboard.ts`, `contextmenu.ts`, `style.ts`,
  `print.ts`, `devtools.ts`: feature implementations.
- `src/core/utils.ts`: event targets, editable regions, selection exclusions.

The package exposes one root entry with ESM, CJS, and declaration outputs. Its
runtime exports are `createAntiCopy`, `DEFAULT_REPLACE_TEXT`, and `isBrowser`;
public types are re-exported explicitly in `src/index.ts`. It has no runtime
dependencies.

## Lifecycle

`createAntiCopy(options?)` creates a disabled instance. Call `enable()` to
attach features. `disable()` detaches them; a successful `destroy()` disables
and retires the instance. Repeated enable/disable calls are guarded, and a
retired instance ignores enable/update. Outside a runtime with both `window`
and `document`, creation returns a shared inert instance.

`update(patch)` disables, merges options, rebuilds features, and restores the
previous enabled state. Only two object-valued `devtools` configurations are
merged field by field; other fields, including arrays, are replaced.

`enable()` tracks each feature before attachment and attempts to detach all
tracked features if attachment fails. `disable()` attempts every detach before
rethrowing the first error. Neither operation swallows the attachment or
reported detachment error.

## Defaults and independent switches

| Option                                     | Resolved default                                |
| ------------------------------------------ | ----------------------------------------------- |
| `mode`                                     | `"block"`                                       |
| `replaceText`                              | `"Copying is not allowed on this page."`        |
| `excludeSelectors`                         | `[]`                                            |
| `copy`, `keyboard`, `contextmenu`, `print` | `true` each                                     |
| `selectStyle`                              | `false` for `mode: "replace"`, otherwise `true` |
| `devtools`                                 | `false`                                         |
| `target`                                   | `document`                                      |
| `onViolation`                              | unset                                           |

`replaceText` accepts a string or a function receiving the selected text.
`target` is a `Document`; event features listen in the capture phase on
`target.defaultView ?? target`.

The switches are independent: disabling `copy` does not disable keyboard
restrictions. DevTools and view-source shortcuts are checked whenever
`keyboard` is enabled, even if `devtools` is false. Save/print shortcuts require
both `keyboard` and `print`.

## Event and exclusion semantics

- Copy/cut cancel the native operation. In replace mode, when `clipboardData`
  exists, both `text/plain` and escaped `text/html` receive the replacement.
  Drag prevention uses the dragged target, independent of the selection.
- Editable text inputs, textareas, and recognized contenteditable ancestors
  bypass clipboard, context-menu, selection, and copy-key restrictions.
  `eventElement` uses the first composed-path entry; exclusion and editable
  checks walk through shadow hosts.
- Exclusions use `closest()`, ignoring invalid selectors. For copy/cut with a
  non-collapsed selection, every range's common ancestor must be excluded;
  otherwise the selection is protected. Without such a selection, the event
  target determines exclusion.
- Keyboard matching checks both `key` and physical `Key*` codes. DevTools and
  view-source shortcuts are checked before focus exclusions and the Alt-key
  pass-through. Save/print shortcuts also apply in editable/excluded regions.
  Replace mode permits copy shortcuts (`C` and Ctrl+Insert); `X` and `A` remain
  blocked outside exempt regions.
- Selection styling injects body `user-select` rules and editable/excluded
  overrides. Invalid selectors are filtered before CSS generation. The
  `selectstart` blocker is attached only outside replace mode.
- Print protection hides the entire body in print media and reports
  `beforeprint`; selector exclusions do not scope this stylesheet.

Violations have `type`, optional `originalEvent`, and optional keyboard `key`.
Print and DevTools reports omit `originalEvent`. DevTools reports occur on
closed-to-open detection transitions rather than every poll.

## DevTools behavior

`devtools: true` resolves to `intervalMs: 1000`, `threshold: 170`,
`freeze: true`, and `redirectUrl: "about:blank"`. An object overrides those
fields; `redirectUrl: false` disables redirection.

The size heuristic is skipped for `outerWidth < 800` or a coarse pointer.
Only that heuristic is skipped: with freeze enabled the debugger probe still
runs. Size-only detection reports an event. A probe taking more than 100 ms
starts a 20 ms guard loop; 25 non-pausing guard ticks while the size heuristic
still reads open trigger the configured redirect. Pausing ticks reset that
counter. `freeze: false` disables the debugger probe and guard escalation.

The probe uses `Function("debugger")` with a literal debugger fallback.
Preserve `terser({ compress: { drop_debugger: false } })` in
`rollup.config.js`. Detachment removes resize listeners and clears both loops.

## Verification and packaged skill

From the repository root:

```sh
pnpm --filter @yukino.js/anti-copy test
pnpm --filter @yukino.js/anti-copy typecheck
pnpm --filter @yukino.js/anti-copy build
```

Tests run in jsdom under `test/`; DevTools timing tests simulate the probe.
Rollup builds `dist/index.js`, `dist/index.cjs`, and declarations, and copies
`.agents/skills/yukino-anti-copy/` to this package's `skills/` directory. Edit
the source skill in `.agents/skills/`; the package copy is build output.
