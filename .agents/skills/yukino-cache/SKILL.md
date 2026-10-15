---
name: yukino-cache
description: >-
  Use when implementing, debugging, or reviewing @yukino.js/cache or
  packages/cache: Node.js read-through caching, two-level LRU storage,
  single-flight loads, consistent hashing, gRPC peers, and etcd discovery.
---

# @yukino.js/cache

Paths below are relative to `packages/cache/`. The package is ESM, declares
Node.js >=20, and depends on `@grpc/grpc-js`, `@grpc/proto-loader`, and `etcd3`.
Use `src/index.ts` and `package.json#exports` to identify the public surface.
The root resolves to `dist/index.mjs`; additional exports are the two raw
`.proto` files and `package.json`.

For peer setup, RPC semantics, and discovery behavior, read
[references/peers.md](references/peers.md). For local caching work, the
contracts below and the corresponding source modules are sufficient.

## Group contracts (`src/group.ts`)

- `newGroup(name, cacheBytes, getter, ...options)` registers a group by name.
  `new Group(...)` constructs without registering. Reusing a registered name
  replaces the registry entry without closing the previous group. Close or
  destroy the previous group before replacement; `Group.close()` also removes
  its name from the registry.
- `Getter` is `(signal: AbortSignal, key: string) => Promise<Buffer>`.
  `get(signal, key)` checks the local cache, then coalesces concurrent misses
  with `SingleFlightGroup.do`. A remote owner is tried when configured; a
  failed peer read falls through to the Getter. Successful results are cached
  locally.
- Same-key callers share the load initiated with the first caller's signal.
  The group passes that signal to the Getter; it does not itself reject on
  abort or cancel peer RPCs. `close()` does not cancel an in-flight Getter.
- `set(signal, key, buffer, isPeerRequest = false)` clones the local value.
  `delete(signal, key, isPeerRequest = false)` removes the local entry.
  Both can start an unawaited write to the remote owner. Other cached copies
  are not invalidated and can remain stale without expiration or eviction.
- `clear()` only clears the local cache. `close()` closes that cache and
  removes the registry entry; it does not close the peer picker.
- `get/set/delete` reject closed groups and empty keys; `set` also rejects
  empty buffers. Getter failures become `Error("failed to get data: …")`.
- `withExpiration(ms)` applies a TTL to loaded and set values when positive.
  `withPeers(picker)` assigns peers. `registerPeers(picker)` rejects a second
  assignment. `withCacheOptions(options)` replaces the cache options entirely,
  including the initial `cacheBytes` budget.

`getStats()` reports local gets separately from actual loads. `loads` and
accumulated load duration advance after successful `loadData` completion;
failed Getter attempts increment `loader_errors`. Single-flight waiters each
contribute local misses but do not each execute a load.

Registry helpers are `getGroup`, `listGroups`, `destroyGroup`, and
`destroyAllGroups`.

## Storage contracts

`src/cache.ts` lazily creates an `LruStore` on its first write. A `get` before
initialization returns `[null, false]` and increments misses. Closed caches
ignore writes and return misses. `Cache.close()` closes its store.

Expiration units differ at these interfaces:

| API                                                    | Expiration argument                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `withExpiration(ms)`                                   | TTL in milliseconds; positive values enable expiry                        |
| `Cache.addWithExpiration(key, view, expirationTime)`   | Absolute epoch deadline in milliseconds; elapsed deadlines delete the key |
| `LruStore.setWithExpiration(key, value, expirationMs)` | TTL in milliseconds; non-positive values do not expire                    |

Default factories and constructor fallbacks also differ:

| Setting          | `defaultCacheOptions()` | `defaultStoreOptions()`  | `new LruStore({})`       |
| ---------------- | ----------------------- | ------------------------ | ------------------------ |
| `maxBytes`       | 8 MiB                   | 8192                     | 0 (no byte budget)       |
| `bucketCount`    | 16                      | 16                       | 16                       |
| `capPerBucket`   | 512                     | 512                      | 1024                     |
| `level2Cap`      | 256                     | 256                      | 1024                     |
| Cleanup interval | `cleanupTime: 60000`    | `cleanupInterval: 60000` | `cleanupInterval: 60000` |

`new Cache(options)` uses the supplied options rather than merging
`defaultCacheOptions()`. Spread a factory's result when its defaults are
wanted. A non-positive cleanup interval disables the sweep timer.

`src/lru.ts` hashes keys into shards using `hashBKRD`. Each shard has two
levels: writes enter L1; reads promote an L1 hit to L2. The byte charge is
`key.length + value.len()`. A positive byte budget is divided between shards
with `max(1, floor(maxBytes / shardCount))` per shard; byte eviction removes
L1 tails before L2 tails. Slot capacities apply independently. `close()` stops
the cleanup timer; it does not clear entries or guard subsequent store access.

`Value` only requires `len()`. `Store` is an interface; `Cache` constructs
`LruStore` directly and has no store-injection option.

## Bytes and single-flight

`ByteView` (`src/byte-view.ts`) retains the Buffer passed to its constructor;
`byteSlice()` returns a copy. `Group` clones buffers from set, Getter, and peer
reads before wrapping them. `Cache.add()` stores its `ByteView` directly.
For a standalone view that must be isolated from the caller's buffer, use
`new ByteView(cloneBytes(buffer))`.

`SingleFlightGroup.do(key, fn)` shares an in-flight result or rejection and
removes the entry in `finally`. It does not cache completed results.

## Consistent hashing (`src/consistent-hash.ts`)

`ConHashMap` provides `add`, `remove`, `get`, `getStats`, `setConfig`,
`rebalance`, and `close`. Virtual nodes hash `${node}-${index}` with CRC-32
by default. Empty keys/rings return `""`. Add each node once; `add` does not
deduplicate an existing node. `setConfig` changes configuration and timer
state without rebuilding existing ring points.

`defaultConHashConfig` sets replicas to 50, bounds to 10–200, imbalance
threshold to 0.25, and `autoRebalance` to false. When enabled, a one-second
timer checks local request counts after at least 1000 routed requests and
adjusts replica counts if imbalance exceeds the threshold. Counts are local
to each ring; there is no mechanism to coordinate adjustments across peers.
`ClientPicker` constructs its own default ring without a configuration option.

## Verification and packaged skill

```sh
pnpm --filter @yukino.js/cache test
pnpm --filter @yukino.js/cache build
```

Vitest runs `tests/**/*.test.ts` in Node. Rollup builds ESM modules and
`dist/index.d.ts`, copies the `.proto` files to `dist/proto/`, and copies this
skill from `.agents/skills/yukino-cache/` into package `skills/`.

`src/main.ts` is demo assembly excluded from the package build. Before using
`dev.js`, resolve its output-path mismatch: `tsconfig.json` has `rootDir: "./"`
and emits `.dist/src/main.js` and `.dist/src/client.js`, while the runner
expects `.dist/main.js` and `.dist/client.js` and copies protos to `.dist/proto/`.
