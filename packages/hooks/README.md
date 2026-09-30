# @yukino.js/hooks

A collection of reusable **React hooks** — an `ahooks`-inspired set covering
stable callbacks, imperatively-updated state, URL-synced state, and async request
state, reimplemented as a dependency-light learning exercise.

[![npm](https://img.shields.io/npm/v/@yukino.js/hooks?label=npm&color=F05138)](https://www.npmjs.com/package/@yukino.js/hooks)
[![License: MIT](https://img.shields.io/badge/License-MIT-f5a623.svg)](../../LICENSE)

## Installation

```sh
pnpm add @yukino.js/hooks
```

Requires `react` and `react-dom` (^19) as peer dependencies.

## Hooks

| Hook            | Description                                                             |
| --------------- | ----------------------------------------------------------------------- |
| `useCreation`   | Runs a factory once per dependency array; re-runs only when deps change |
| `useLatest`     | Wraps a value in a ref that always holds the latest value               |
| `useMemoizedFn` | Returns a stable function that always invokes the latest `fn`           |
| `useUpdate`     | Returns a `forceUpdate`-style function that re-renders the component    |
| `useRequest`    | Async request state (loading / data / error) with a `service` function  |
| `useUrlState`   | Syncs state to the URL query string (via `query-string`)                |

## Usage

```tsx
import {
  useCreation,
  useLatest,
  useMemoizedFn,
  useRequest,
} from "@yukino.js/hooks";

function Feature() {
  const data = useCreation(() => expensiveInit(), []);

  const latest = useLatest(0);

  const handler = useMemoizedFn((n: number) => latest.current + n);

  const { loading, run } = useRequest(fetchUser);

  // ...
}
```

### URL-synced state

```tsx
import { useUrlState } from "@yukino.js/hooks";

const [state, setState] = useUrlState({ page: "1", tab: "overview" });

// reads from /?page=2, and setState writes back to the query string
```

## Layout

```
hooks/
├── src/
│   ├── use-creation/      # useCreation
│   ├── use-latest/        # useLatest
│   ├── use-memorized-fn/  # useMemoizedFn
│   ├── use-update/        # useUpdate
│   ├── use-request/       # useRequest
│   ├── use-url-state/     # useUrlState
│   └── utils/             # depsAreSame, isDev helpers
├── index.html             # Vite dev playground (with Storybook)
└── rollup.config.mjs      # dual ESM/CJS build
```
