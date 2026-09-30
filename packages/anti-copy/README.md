# @yukino.js/anti-copy

Framework-agnostic copy-protection SDK for browsers — React, Vue, plain HTML,
any browser project.

> **Disclaimer**: client-side copy protection is a _deterrent_, not a
> security boundary. Content remains accessible via view-source, disabled
> JavaScript, or direct HTTP requests.

## Features

- Intercepts `copy` / `cut` / `dragstart` events (capture phase, on `window`)
- Blocks copy shortcuts by both the layout character (`e.key`) and the
  physical key (`e.code`), so non-Latin and remapped keyboard layouts cannot
  bypass: `Ctrl/Cmd + C/X/A`, `Ctrl+Insert`, and DevTools / view-source
  shortcuts (`F12`, `Ctrl+Shift+I/J/C`, `Cmd+Opt+I/J/C`, `Ctrl+U`,
  `Cmd+Opt+U`)
- Blocks export shortcuts (`Ctrl/Cmd + S/P`) and hides content in print
  output via `@media print` (menu-initiated printing included)
- Disables the context menu and `selectstart`
- Injects a `user-select: none !important` stylesheet incl.
  `-webkit-touch-callout: none` for iOS long-press
- `replace` mode: swaps clipboard payload (text + escaped HTML flavor) with a
  copyright notice instead of blocking
- DevTools protection: detects open DevTools (window size delta + `debugger`
  probe timing, which also catches undocked windows), stalls the page with an
  anonymous `(function anonymous() { debugger })` probe loop while open, and
  redirects to a blank page when the stall is neutralized (e.g. by a
  userscript). Size-only detections (e.g. browser zoom) are report-only and
  never freeze or redirect the page.
- Region exemptions via CSS selectors, judged against the **whole selection**
  (a selection spanning excluded and protected content stays blocked);
  editable controls always keep native behavior, incl. inside open shadow roots
- SSR-safe: in non-browser environments `createAntiCopy` returns an inert
  no-op instance

## Usage

```ts
import { createAntiCopy } from "@yukino.js/anti-copy";

const antiCopy = createAntiCopy({
  mode: "replace", // "block" | "replace"
  replaceText: (selection) => `${selection.slice(0, 60)}… — © example.com`,
  excludeSelectors: ["pre code"],
  devtools: true,
  onViolation: (e) => console.warn("[anti-copy]", e.type),
});

antiCopy.enable();
// antiCopy.disable(); antiCopy.destroy(); antiCopy.update({...});
```

Call `enable()` after mount and `disable()` / `destroy()` on teardown; toggle
per view yourself. The package root is the only entry point.

### Options

| Option             | Default    | Description                                                                        |
| ------------------ | ---------- | ---------------------------------------------------------------------------------- |
| `mode`             | `"block"`  | Cancel copying, or replace the clipboard payload                                   |
| `replaceText`      | built-in   | String or `(selection) => string` for replace mode                                 |
| `excludeSelectors` | `[]`       | Regions where protection is bypassed (invalid selectors are dropped, never fatal)  |
| `copy`             | `true`     | Intercept `copy` / `cut` / `dragstart` events                                      |
| `keyboard`         | `true`     | Intercept copy, export & DevTools shortcuts                                        |
| `contextmenu`      | `true`     | Disable right-click menu                                                           |
| `selectStyle`      | mode-aware | `user-select: none` + `selectstart`; `true` in block mode, `false` in replace mode |
| `print`            | `true`     | `@media print` hiding, `beforeprint` reporting, `Ctrl/Cmd+S/P` blocking            |
| `devtools`         | `false`    | `true` or `{ intervalMs, threshold, freeze, redirectUrl }`                         |
| `onViolation`      | —          | Callback fired on every protection trigger                                         |
| `target`           | `document` | Document to protect; injectable for tests and iframes                              |

Violation types: `copy`, `cut`, `drag`, `selection`, `keyboard`,
`contextmenu`, `print`, `devtools`.

`update(patch)` deep-merges the nested `devtools` object; other fields
(including arrays like `excludeSelectors`) are replaced wholesale.

### DevTools protection

`devtools: true` enables the full protection chain:

1. **Detection** — polls the window outer/inner size delta (docked DevTools)
   and the elapsed time around an anonymous `(function anonymous() { debugger })`
   probe, which only takes measurable time while a debugger is attached. The
   probe also catches undocked DevTools windows the size heuristic cannot see.
2. **Stall (`freeze: true` by default)** — once the probe confirms a pause, a
   tight guard loop keeps running it, so execution pauses over and over and
   the page is effectively frozen until DevTools is closed.
3. **Blank-page redirect (`redirectUrl: "about:blank"` by default)** — if
   DevTools stays open while the probe no longer pauses (the stall was
   neutralized, e.g. by a userscript hooking `Function`, "never pause here" or
   deactivated breakpoints), the page is redirected to the blank page after a
   short grace window. Set `redirectUrl: false` to keep only the stall, or
   `freeze: false` for report-only detection via `onViolation`.

Detections triggered by the size heuristic alone (browser zoom, unusual
window chrome) are **report-only**: they never freeze or redirect the page.

## Known limitations

By design (client-side JS cannot prevent these):

- View-source, `curl`, reader mode, disabled JavaScript.
- Undocked DevTools with deactivated breakpoints are indistinguishable from
  closed DevTools.
- The size heuristic is disabled on narrow windows (`outerWidth < 800`) and
  coarse-pointer (touch) devices, where the outer/inner delta is meaningless.
- Scripts registered on `window` before this library can pre-empt the
  capture-phase listeners — load it as early as possible.

## Build & test

```sh
pnpm build      # rollup → dist/ (ESM + CJS + d.ts)
pnpm test       # vitest (jsdom)
pnpm typecheck  # tsc --noEmit
```
