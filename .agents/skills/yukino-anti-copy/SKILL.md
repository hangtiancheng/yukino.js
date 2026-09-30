---
name: yukino-anti-copy
description: 'Authoritative reference for @yukino.js/anti-copy (packages/anti-copy, MIT, v0.0.7), a framework-agnostic browser copy/print/DevTools protection SDK with a single root entry, shipped as an ESM+CJS dual build. Use this skill whenever the user reads, writes, debugs, reviews, or extends code under `packages/anti-copy/src/**`, imports from `@yukino.js/anti-copy`, or works with copy-protection concepts. Trigger eagerly on these symbols and tokens — `createAntiCopy`, `AntiCopyInstance`, `AntiCopyOptions`, `AntiCopyMode`, `DevtoolsOptions`, `ViolationEvent`, `ViolationType`, `DEFAULT_REPLACE_TEXT`, `isBrowser`, options `mode`/`replaceText`/`excludeSelectors`/`copy`/`keyboard`/`contextmenu`/`selectStyle`/`print`/`devtools`/`onViolation`/`target`, `mode: "block"`/`"replace"`, devtools `intervalMs`/`threshold`/`freeze`/`redirectUrl`, violation types `copy`/`cut`/`drag`/`selection`/`keyboard`/`contextmenu`/`print`/`devtools`. Also trigger on phrases like "disable right-click", "block copy/paste", "prevent copying", "detect DevTools", "anti-copy", "protect page content".'
---

# @yukino.js/anti-copy — Browser Copy / Print / DevTools Protection

## 1. Summary

`@yukino.js/anti-copy` (`packages/anti-copy`, published as `@yukino.js/anti-copy`, v0.0.7, MIT) is a client-side deterrent that raises the effort required to copy, print, drag-out, or DevTools-inspect page content in a browser.

**IMPORTANT — deterrent, not a security boundary.** This is stated in the source itself (`src/index.ts` JSDoc, `src/core/devtools.ts`). Content remains fully accessible via view-source, `curl`/direct HTTP requests, reader mode, or with JavaScript disabled. Never present it as access control or DRM. Anything the browser renders can be extracted; this package only obstructs casual copying.

- **Runtime requirement:** a browser DOM. SSR-safe — in a non-browser runtime `createAntiCopy` returns an inert no-op instance (see §4).
- **Single root entry:** `"type": "module"`, `"sideEffects": false`, dual ESM + CJS. `main: ./dist/index.cjs`, `module: ./dist/index.js`, `types: ./dist/index.d.ts`; `.` is the only export in `package.json`. The core imports nothing outside standard DOM APIs.
- **Intended uses:** deter copy/right-click/print/DevTools on marketing pages, paid docs, or any browser project (React, Vue, plain HTML).
- **Unsuitable uses:** enforcing content secrecy, licensing, or paywalls; protecting API responses; anything requiring a real trust boundary.

## 2. Architecture: options → feature-list → attach/detach pipeline

One layer, framework-agnostic, DOM-only (`src/index.ts` + `src/core/*`):

- `src/core/options.ts` — `resolveOptions()` normalizes an `AntiCopyOptions` into a fully-populated `ResolvedOptions` (fills every default, including mode-dependent ones). Exports `DEFAULT_REPLACE_TEXT`.
- `buildFeatures(options)` (in `index.ts`) resolves options, then pushes one `Feature` per enabled toggle, in this order: `selectStyle` → `copy` → `keyboard` → `contextmenu` → `print` → `devtools`. A `Feature` is just `{ attach(): void; detach(): void }`.
- Feature modules, each `create*Feature(resolved): Feature`:
  - `src/core/style.ts` — injects a `user-select: none !important` stylesheet (attr `yukino-anti-copy`) + iOS `-webkit-touch-callout: none`, and a capture-phase `selectstart` blocker (the `selectstart` listener is skipped in `"replace"` mode).
  - `src/core/clipboard.ts` — capture-phase `copy` / `cut` / `dragstart` on `window`.
  - `src/core/keyboard.ts` — capture-phase `keydown` for copy/export/DevTools/view-source shortcuts.
  - `src/core/contextmenu.ts` — capture-phase `contextmenu` suppression.
  - `src/core/print.ts` — `@media print { body { display: none !important; } }` stylesheet (attr `yukino-anti-print`) + `beforeprint` reporting.
  - `src/core/devtools.ts` — DevTools detection (size heuristic + `debugger` probe) and countermeasures (freeze loop, redirect).
  - `src/core/utils.ts` — `isBrowser`, `eventElement` (via `composedPath()`, shadow-DOM aware), `isExcluded` (via `Element.closest`, shadow-host walking), `isEditable`, `isSelectionExcluded`, `escapeHtml`.
  - `src/core/types.ts` — all public + internal types.

## 3. Public API & configuration surface

Exports: `createAntiCopy`, `DEFAULT_REPLACE_TEXT` (= `"Copying is not allowed on this page."`), `isBrowser`, and the types `AntiCopyInstance`, `AntiCopyMode`, `AntiCopyOptions`, `DevtoolsOptions`, `ViolationEvent`, `ViolationType`.

```ts
function createAntiCopy(options?: AntiCopyOptions): AntiCopyInstance;
```

`AntiCopyInstance`:

- `enable(): void` — attach all configured protections. Idempotent (no-op if already enabled or destroyed).
- `disable(): void` — detach all listeners, remove injected styles, stop detectors. Idempotent.
- `destroy(): void` — `disable()` then permanently retire; further `enable`/`update` are no-ops (`features` cleared).
- `isEnabled(): boolean`.
- `update(patch: Partial<AntiCopyOptions>): void` — rebuild with merged options (see §4).

### 3.1 `AntiCopyOptions` — every field with its EXACT default

| Option             | Type                                        | Default                                                                   | Behavior                                                                                                                                                           |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mode`             | `"block" \| "replace"`                      | `"block"`                                                                 | `"block"` cancels copy/cut; `"replace"` lets it proceed but swaps the clipboard payload for `replaceText`.                                                         |
| `replaceText`      | `string \| ((selection: string) => string)` | `DEFAULT_REPLACE_TEXT` = `"Copying is not allowed on this page."`         | Payload used in `"replace"` mode. Function receives current selection text.                                                                                        |
| `excludeSelectors` | `string[]`                                  | `[]`                                                                      | CSS selectors for regions where protection is bypassed; the event target is matched via `Element.closest`. Invalid selectors are dropped, never fatal.             |
| `copy`             | `boolean`                                   | `true`                                                                    | Intercept `copy` / `cut` events and text/image drag-out (`dragstart`).                                                                                             |
| `keyboard`         | `boolean`                                   | `true`                                                                    | Intercept copy-related, export, DevTools, and view-source keyboard shortcuts.                                                                                      |
| `contextmenu`      | `boolean`                                   | `true`                                                                    | Suppress the context menu.                                                                                                                                         |
| `selectStyle`      | `boolean`                                   | **mode-dependent:** `true` in `"block"` mode, `false` in `"replace"` mode | Inject `user-select: none` stylesheet + block `selectstart`. Resolved as `options.selectStyle ?? options.mode !== "replace"` (replacement needs a live selection). |
| `print`            | `boolean`                                   | `true`                                                                    | Hide `body` in print output via `@media print`, report via `beforeprint`, and block `Ctrl/Cmd+P` / `Ctrl/Cmd+S` (keyboard export keys are gated on this flag).     |
| `devtools`         | `boolean \| DevtoolsOptions`                | `false`                                                                   | Enable DevTools detection + countermeasures. `true` uses all `DevtoolsOptions` defaults.                                                                           |
| `onViolation`      | `(event: ViolationEvent) => void`           | `undefined`                                                               | Called every time a protection rule fires.                                                                                                                         |
| `target`           | `Document`                                  | `document`                                                                | Document to attach to; injectable for tests/iframes.                                                                                                               |

`DevtoolsOptions` (used when `devtools` is an object; `devtools: true` uses all defaults):

| Field         | Type              | Default         | Meaning                                                                                                                                         |
| ------------- | ----------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `intervalMs`  | `number`          | `1000`          | Poll interval (ms) for the slow detection loop.                                                                                                 |
| `threshold`   | `number`          | `170`           | Min px difference between window outer and inner size treated as "DevTools docked".                                                             |
| `freeze`      | `boolean`         | `true`          | Re-run the anonymous `debugger` probe in a tight loop to stall the page while DevTools is open.                                                 |
| `redirectUrl` | `string \| false` | `"about:blank"` | Page to navigate to when a confirmed stall is neutralized while DevTools stays open. Requires `freeze`; `false` disables the redirect fallback. |

### 3.2 `ViolationType` and `ViolationEvent`

```ts
type ViolationType =
  | "copy"
  | "cut"
  | "drag"
  | "selection"
  | "keyboard"
  | "contextmenu"
  | "print"
  | "devtools";

interface ViolationEvent {
  type: ViolationType;
  originalEvent?: Event; // absent for "devtools" and "print" detections
  key?: string; // e.g. "Ctrl+Shift+I", "F12", "Ctrl+C", "Cmd+P", "Insert" — keyboard only
}
```

## 4. Internal implementation details affecting correct usage

- **Enable rollback on partial attach failure** (`index.ts` `enable()`): each feature is pushed to an `attached` list _before_ its `attach()` runs; if any `attach()` throws, every already-tracked feature is `detach()`-ed (best-effort, detach is idempotent) and the error rethrown, so a half-attached run never leaks listeners or an orphan stylesheet. `enabled` stays `false`. Verified by the lifecycle test.
- **`disable()` detaches all features even if one throws**, remembering the first error and rethrowing it after every `detach()` has run.
- **`update()` ordering** (`disable → merge → rebuild → enable`): captures `wasEnabled`, calls `disable()`, deep-merges options via `mergeOptions` (spread merge, plus a nested spread-merge of the `devtools` object when both current and patch have object `devtools`), rebuilds the feature list with `buildFeatures`, then re-`enable()`s **only if it was enabled before**. So `update()` on a disabled instance keeps it disabled. `update()` after `destroy()` is a no-op. Note `mergeOptions` replaces all non-`devtools` fields wholesale (arrays like `excludeSelectors` are overwritten, not concatenated).
- **`excludeSelectors` matching** uses `el.closest(selector)` walking up ancestors and across open shadow-root hosts (`isExcluded` in `utils.ts`). For copy/cut, `isSelectionExcluded` is preferred: a selection spanning excluded + protected content is NOT exempt (every range must be inside an excluded region); it returns `null` (fall back to target check) when there is no non-collapsed selection. `dragstart` is judged by the drag TARGET only — the drag payload is the dragged node, so a leftover selection inside an excluded region must not exempt dragging protected content. Editable controls (`<input>` text types, `<textarea>`, `contenteditable=""`/`true`/`plaintext-only`) always keep native behavior. Invalid selectors are silently skipped — and in `style.ts` they are filtered via `querySelector` BEFORE building the grouped CSS rule, because per the CSS spec one invalid selector invalidates the whole rule and would silently kill the editable-control exemptions along with it.
- **Keyboard shortcut matching** (`matchKey` in `keyboard.ts`) unions the layout character (`e.key`) and the physical key (`e.code`, `Key*` only). Either alone is bypassable: `e.key` misses non-Latin layouts (Cyrillic "с") and macOS Option dead keys; `e.code` misses remapped Latin layouts (AZERTY/Dvorak, where the browser acts on `e.key`). The union may over-block (AZERTY Ctrl+Q on physical KeyA) — the safe direction for copy protection. Windows AltGr (reports ctrlKey+altKey) is typed-character input, not a shortcut, so any combo with Alt is passed through after the DevTools combos are checked.
- **Keyboard scope details:** export keys (`S`/`P`) are gated on `options.print` and are blocked even inside editable or excluded regions (save/print leak the whole page regardless of focus). In `"replace"` mode `Ctrl/Cmd+C` and `Ctrl+Insert` are deliberately allowed through so the subsequent `copy` event can perform the substitution.
- **SSR no-op instance** (`NOOP_INSTANCE` in `index.ts`): when `isBrowser()` is false, `createAntiCopy` returns a shared object whose `enable`/`disable`/`destroy`/`update` are no-ops and `isEnabled()` returns `false`. `isBrowser()` = `typeof window !== "undefined" && typeof document !== "undefined"`.
- **Capture-phase on `window`** (`doc.defaultView ?? doc`): clipboard, keyboard, contextmenu, and selectstart listeners register with `capture: true` on the outermost target so page scripts on `document` cannot pre-empt protection. A script that registers on `window` _before_ this library still can.
- **`"replace"` mode specifics** (`clipboard.ts`): sets both `text/plain` and escaped `text/html` on `clipboardData` and calls `preventDefault()` (mandatory, else the browser re-fills the payload).
- **DevTools detection/countermeasures** (`devtools.ts`, `PAUSE_THRESHOLD_MS=100`, `GUARD_INTERVAL_MS=20`, `BYPASS_MAX_TICKS=25` ≈ 500ms): the slow poll (`intervalMs`) combines a size heuristic (`outerWidth/Height - innerWidth/Height > threshold`, but disabled when `outerWidth < 800` or pointer is coarse) with a `debugger` probe timing. Only a **probe-confirmed pause** escalates to the tight guard loop (freeze) and the eventual redirect. A **size-only** detection (browser zoom, unusual chrome) is report-only via `onViolation({ type: "devtools" })` and never freezes or redirects. The probe is built via `Function("debugger")` (shows as `(function anonymous() { debugger })`), falling back to a literal `debugger;` statement under CSP. Redirect targets `(view.top ?? view).location.href`, falling back to `view.location.href` for cross-origin top windows. `attach()` also registers a `resize` listener (docked DevTools change the viewport on open/close), and the guard loop drops back to slow polling once the probe stops pausing AND the size heuristic reads closed.

## 5. Operational guidance & lifecycle ordering

- **Framework-agnostic:** call `enable()` after mount (DOM + `document.head` available); call `disable()`/`destroy()` on teardown. Toggle per view yourself. Use `update()` to change config on the fly (respects prior enabled state).
- **Load early.** Protection hooks capture-phase listeners on `window`; anything that registered before it wins. Mount it as the first client-side side effect.

## 6. Pitfalls / known limitations

- **Not a security boundary.** View-source, `curl`, disabled JS, and reader mode bypass everything. Behavior: obstruction only. Avoid: do not rely on it for confidentiality.
- **Pre-registered `window` listeners win.** A page script that adds capture-phase listeners before this library can pre-empt it. Load anti-copy as early as possible.
- **DevTools false positives from zoom / window chrome.** Behavior: size heuristic may fire `onViolation({type:"devtools"})`; why: outer/inner delta shifts with zoom; avoid: such detections are report-only and never freeze/redirect (only probe-confirmed pauses do).
- **DevTools detection is off on touch devices and narrow windows.** Behavior: the size heuristic returns false when `outerWidth < 800` or the pointer is coarse; why: mobile browsers and small windows make the outer/inner delta meaningless.
- **Undocked DevTools with breakpoints deactivated are undetectable.** Behavior: no detection; why: neither size delta nor probe pause is observable.
- **`freeze: true` stalls the whole page while DevTools is open** (repeated `debugger`). This is intentional but hostile to legitimate debugging; disable `devtools` in development or set `freeze: false` for report-only.
- **`redirectUrl` can evict the page on a sustained neutralized stall** (default `"about:blank"`). Set `redirectUrl: false` to keep only the stall, or `freeze: false` for detection-only.
- **`update()` overwrites arrays wholesale.** `excludeSelectors` in a patch replaces the previous array (only `devtools` is deep-merged). Re-pass the full list.
- **`"replace"` mode disables `selectStyle` by default**, because replacement needs a live selection. If you force `selectStyle: true` in replace mode, users can't select and nothing gets replaced.

## 7. Quick recipe

```ts
import { createAntiCopy } from "@yukino.js/anti-copy";

const antiCopy = createAntiCopy({
  mode: "replace",
  replaceText: (sel) => `${sel.slice(0, 60)}… — © example.com`,
  excludeSelectors: ["pre code"],
  devtools: true,
  onViolation: (e) => console.warn("[anti-copy]", e.type, e.key ?? ""),
});
antiCopy.enable();
// later: antiCopy.update({ mode: "block" }); antiCopy.disable(); antiCopy.destroy();
```

## 8. Repo ops

- `pnpm build` — `rollup.config.js`, single input `src/index.ts` → `dist/` ESM (`.js`) + CJS (`.cjs`, `exports: "named"`) + `rollup-plugin-dts` (`.d.ts`); alias `@` → `src/`; `react`/`vue` external. **Terser runs with `drop_debugger: false`** — flipping it on would strip the CSP-fallback `debugger` probe in `src/core/devtools.ts` out of the bundles. The `buildEnd` hook copies this skill directory (`.agents/skills/yukino-anti-copy`) into `packages/anti-copy/skills/` for distribution, so re-run the build after editing this skill.
- `pnpm test` — vitest + jsdom, suite dir `test/` (lifecycle, options, exclude, style, clipboard, keyboard, contextmenu, print, devtools).
- `pnpm typecheck` — `tsc -p tsconfig.json --noEmit`.
