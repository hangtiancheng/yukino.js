# @yukino.js/react

A **lightweight React-like framework** — a small virtual-DOM reconciler with hooks,
a history-based router, a `zustand`-style store, and state-preserving component HMR.
Designed as a dependency-light alternative to React for small apps and
micro-frontends, with a React-compatible authoring model.

[![npm](https://img.shields.io/npm/v/@yukino.js/react?label=npm&color=F05138)](https://www.npmjs.com/package/@yukino.js/react)
[![License: MIT](https://img.shields.io/badge/License-MIT-f5a623.svg)](../../LICENSE)

## Overview

`@yukino.js/react` gives you the React developer experience — function components,
JSX, hooks (`useState`, `useEffect`, `useRef`, `useMemo`, `useCallback`), `key`-ed
reconciliation, `Fragment`, and `ref` — in a small, self-contained runtime:

- **Virtual-DOM reconciler** — `render(element, container)` mounts once, diffs on
  every subsequent call, and unmounts when passed `null`.
- **Microtask-batched updates** — `setState` marks a root dirty; multiple updates
  within a microtask collapse into one render, with a runaway-update guard
  ("Maximum update depth exceeded").
- **History-based router** — ranked `:param`/`*` path matching aligned with the
  react-router data model, `navigate`, and `useBlocker`-style blockers.
- **Zustand-style store** — `createStore(creator)` with `useStore` selectors.
- **URL state** — `useUrlState` syncs state to the query string with a stable
  setter.
- **State-preserving HMR** — `hotSwapByComponent` plus Vite/Webpack plugins
  re-render in place without losing component state.

## Usage

```tsx
import {
  render,
  createElement as h,
  Fragment,
  useState,
} from "@yukino.js/react";

function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>Count: {count}</button>;
}

render(<Counter />, document.getElementById("root")!);
```

### Store

```ts
import { createStore, useStore } from "@yukino.js/react";

const useCounter = createStore((set) => ({
  count: 0,
  increment: () => set((s) => ({ count: s.count + 1 })),
}));

// in a component:
const count = useStore(useCounter, (s) => s.count);
```

## Package exports

| Subpath             | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `.`                 | `render`, hooks, `createElement`, store, router, HMR |
| `./jsx-runtime`     | Automatic JSX runtime                                |
| `./jsx-dev-runtime` | Development JSX runtime (HMR)                        |
| `./vite`            | Vite HMR plugin                                      |
| `./webpack`         | Webpack HMR plugin                                   |

## Layout

```
react/
├── src/
│   ├── element.ts       # createElement / Fragment / JSX
│   ├── diff.ts          # virtual-DOM reconciler
│   ├── dom.ts           # DOM node patching
│   ├── hooks.ts         # useState / useEffect / useRef / useMemo / useCallback
│   ├── router.ts        # history router + RouterView
│   ├── store.ts         # createStore / useStore
│   ├── url-state.ts     # useUrlState
│   ├── hmr.ts           # hotSwapByComponent
│   ├── vite.ts / webpack.ts  # HMR plugins
│   └── jsx-runtime.ts   # JSX runtime
└── tests/
```
