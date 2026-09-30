<div align="center">

# Yukino.js

**A monorepo of focused, dependency-light JavaScript & TypeScript utilities.**

[![npm](https://img.shields.io/npm/v/@yukino.js/cache?label=%40yukino.js%2Fcache&color=F05138)](https://www.npmjs.com/package/@yukino.js/cache)
[![npm](https://img.shields.io/npm/v/@yukino.js/anti-copy?label=%40yukino.js%2Fanti-copy&color=F05138)](https://www.npmjs.com/package/@yukino.js/anti-copy)
[![License: MIT](https://img.shields.io/badge/License-MIT-F05138.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-3C873A.svg)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-F69220.svg)](https://pnpm.io)

</div>

---

Yukino.js is a pnpm workspace hosting a family of small, single-purpose packages published under the [`@yukino.js`](https://www.npmjs.com/search?q=%40yukino.js) scope. Each package does one thing well — distributed caching, copy protection, probabilistic data structures, React hooks, and more — with minimal runtime dependencies and full TypeScript typings.

Some packages also ship **agent skills** (`.agents/skills/`), machine-readable references that let AI coding assistants work with the package's source, API, and conventions directly.

## Packages

| Package                                                      | Description                                                                                                                                                                                                                    | Runtime              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| [`@yukino.js/cache`](./packages/cache)                       | Distributed read-through cache — a TypeScript port of [groupcache](https://github.com/golang/groupcache) with gRPC peer fan-out, etcd discovery, consistent hashing, single-flight deduplication, and a sharded two-level LRU. | Node.js ≥ 20 · ESM   |
| [`@yukino.js/anti-copy`](./packages/anti-copy)               | Framework-agnostic copy-protection SDK for browsers — clipboard interception, shortcut blocking, print hiding, DevTools detection & countermeasures, region exemptions. Integrations for React, Vue, and VitePress.            | Browser              |
| [`@yukino.js/bloom-filter`](./packages/bloom-filter)         | Standard Bloom filter with xxHash32 — configurable bit-array size, hash count, seed, and false-positive rate.                                                                                                                  | Node.js · ESM        |
| [`@yukino.js/distributed-lock`](./packages/distributed-lock) | Redis-based distributed lock with Lua-scripted atomic acquire/release and owner verification.                                                                                                                                  | Node.js · ESM        |
| [`@yukino.js/hooks`](./packages/hooks)                       | React hooks — `useCreation`, `useLatest`, `useMemoizedFn`, `useRequest`, `useUpdate`, `useUrlState`.                                                                                                                           | Browser · React ≥ 18 |
| [`@yukino.js/promises-a-plus`](./packages/promises-a-plus)   | Promises/A+ spec implementation, validated against the official `promises-aplus-tests` suite.                                                                                                                                  | Node.js ≥ 22         |

## Agent Skills

Two packages ship skills for AI coding assistants:

| Skill                                                   | Package                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [`yukino-cache`](./.agents/skills/yukino-cache)         | `@yukino.js/cache` — architecture, public API surface, read/write paths, consistency model, etcd key layout. |
| [`yukino-anti-copy`](./.agents/skills/yukino-anti-copy) | `@yukino.js/anti-copy` — feature dimensions, options schema, integration patterns, violation types.          |

Add skills to your agent environment:

```bash
npx skills add github.com/hangtiancheng/yukino.js
```

## Getting Started

```bash
pnpm install
```

Build and test any package from its directory:

```bash
pnpm --filter @yukino.js/cache build
pnpm --filter @yukino.js/cache test
```

Or run a package's demo directly:

```bash
pnpm --filter @yukino.js/cache dev
```

Each package is self-contained — build with its own toolchain (Rollup, tsc, or tsup), test with Vitest, and publish independently under the `@yukino.js` scope.

## Repository Layout

```
yukino.js/
├── packages/
│   ├── anti-copy/          # Browser copy-protection SDK
│   ├── bloom-filter/       # Bloom filter (xxHash32)
│   ├── cache/              # Distributed cache (groupcache port)
│   ├── distributed-lock/   # Redis distributed lock
│   ├── hooks/              # React hooks
│   └── promises-a-plus/    # Promises/A+ implementation
├── .agents/skills/         # Agent skill definitions
├── public/                 # Logo assets
└── pnpm-workspace.yaml
```

## License

[MIT](./LICENSE) © [hangtiancheng](https://github.com/hangtiancheng)
