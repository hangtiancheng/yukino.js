# @yukino.js/cache

A distributed cache for Node.js — a TypeScript port of the [groupcache](https://github.com/golang/groupcache) architecture, redesigned for the Node.js runtime and delivered as pure ESM.

`@yukino.js/cache` composes a coherent set of building blocks — `Group`, `Cache`, `LruStore`, `ByteView`, `SingleFlightGroup`, `ConHashMap`, `Client`/`ClientPicker`, `Server`, and etcd registration/discovery — into a peer-to-peer, eventually consistent, sharded read-through cache reachable over gRPC. It works standalone as an in-process L1 cache, or as a clustered cache with peer fan-out across any number of nodes.

> **Not a replicated store.** There is no quorum, no anti-entropy, and no durability guarantee. Do not use it where strong consistency or durability is required.

---

## Features

- **Read-through caching** — misses are loaded through a user-supplied `Getter`, deduplicated by a single-flight group (thundering-herd protection), and cached locally.
- **Peer fan-out** — a consistent-hash ring elects the single owner for each key; reads that miss locally are fetched from the owning peer over gRPC; writes are asynchronously propagated to the owner.
- **Sharded two-level LRU** — `LruStore` is a 2Q-style, scan-resistant cache with per-shard byte budgets, per-entry TTL, and a configurable eviction hook.
- **etcd registration & discovery** — servers self-register under `/services/{svcName}/{addr}` with a lease; peers are discovered live via a watcher and resync on reconnect.
- **Immutable values** — every value is defensively copied on the way in and out; callers can never mutate cached bytes.
- **Observability** — per-group and per-cache hit/miss statistics, load timing, and a swappable logger.
- **Language parity with Go** — the API, semantics, etcd key layout, and wire format mirror [`yukino.go/yukino_cache`](https://github.com/hangtiancheng/yukino.go) symbol-for-symbol, making polyglot clusters safe.

## Guarantees & consistency model

| Property             | Behavior                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Read path            | Local hit → return. Local miss → single-flight load → owning peer (gRPC) → origin `Getter`.                                         |
| Write path           | Local cache updated synchronously; best-effort fan-out to the single ring owner (fire-and-forget).                                  |
| Propagation guard    | Peer-originated calls carry `x-peer-request: "true"` metadata so writes are never echoed back.                                      |
| Cross-node freshness | Other nodes are not notified; they may serve stale values until eviction or expiration. Weak eventual consistency, not replication. |
| Failure semantics    | Peer read failures are swallowed (logged, counted) and fall back to the local `Getter`. Fan-out failures are logged, never thrown.  |

## Installation

```bash
pnpm add @yukino.js/cache
# or
npm install @yukino.js/cache
```

Requires Node.js **>= 20**. The package is pure ESM (`"type": "module"`); runtime dependencies are `@grpc/grpc-js`, `@grpc/proto-loader`, and `etcd3`.

---

## Quick start

### Standalone in-process L1 cache (no gRPC, no etcd)

```ts
import { Cache, ByteView, defaultCacheOptions } from "@yukino.js/cache";

const cache = new Cache({ ...defaultCacheOptions(), maxBytes: 64 << 20 });
cache.add("k", new ByteView(Buffer.from("v")));
const [view, ok] = cache.get("k"); // ok === true
cache.addWithExpiration("t", new ByteView(Buffer.from("x")), Date.now() + 5000); // ABSOLUTE deadline
cache.close();
```

### Single node, no peers, with TTL and stats

```ts
import { newGroup, withExpiration } from "@yukino.js/cache";

const group = newGroup(
  "users",
  8 * 1024 * 1024,
  async (signal, key) => loadUserFromDB(signal, key), // Getter
  withExpiration(30_000),
);

const view = await group.get(new AbortController().signal, "alice");
console.log(view.toString(), group.getStats());
group.close();
```

### Clustered node (the reference assembly)

```ts
import { newGroup, Server, ClientPicker, getLocalIP } from "@yukino.js/cache";

const SVC = "yukino_cache";
const PORT = 8001;
const bindAddr = `0.0.0.0:${PORT}`;
const advertiseAddr = `${getLocalIP()}:${PORT}`;

const group = newGroup("users", 8 << 20, loader);

const server = new Server(bindAddr, SVC, { advertiseAddr });
await server.start();

const picker = new ClientPicker(advertiseAddr, {
  serviceName: SVC,
  // etcdEndpoints: ["etcd-1:2379"], peerDeadlineMs: 5000,
});
await picker.start();
group.registerPeers(picker);

process.on("SIGINT", async () => {
  server.stop();
  await picker.close();
  process.exit(0);
});
```

See [Lifecycle](#lifecycle) for the required startup/shutdown order.

### Direct gRPC client (no `Group` involvement)

```ts
import { Client } from "@yukino.js/cache";

const client = new Client("127.0.0.1:8001", { deadlineMs: 5000 });
await client.set("users", "alice", Buffer.from("payload"));
const value = await client.get("users", "alice");
await client.close();
```

### Custom consistent-hash ring with auto-rebalancing

```ts
import { ConHashMap, withConHashConfig, crc32 } from "@yukino.js/cache";

const ring = new ConHashMap(
  withConHashConfig({
    defaultReplicas: 100,
    minReplicas: 50,
    maxReplicas: 400,
    hashFunc: crc32,
    loadBalanceThreshold: 0.15,
    autoRebalance: true,
  }),
);
ring.add("127.0.0.1:8001", "127.0.0.1:8002", "127.0.0.1:8003");
console.log(ring.get("alice"), ring.getStats());
ring.close(); // stops the balancer timer
```

---

## Architecture

```
┌─────────────────────────────── Cluster (N nodes) ───────────────────────────────┐
│                                                                                 │
│  Node A                         Node B                          Node C          │
│  ┌───────────────┐             ┌───────────────┐              ┌───────────────┐ │
│  │ Group         │             │ Group         │              │ Group         │ │
│  │  Cache (LRU)  │  gRPC       │  Cache (LRU)  │   gRPC       │  Cache (LRU)  │ │
│  │  SingleFlight │◄───────────►│  SingleFlight │◄────────────►│  SingleFlight │ │
│  │  PeerPicker   │  Get/Set/   │  PeerPicker   │   Get/Set/   │  PeerPicker   │ │
│  └──────┬────────┘  Delete     └──────┬────────┘   Delete     └──────┬────────┘ │
│         │                             │                              │          │
│         │         etcd: /services/{svc}/{addr}  (lease + watch)     │          │
│         └─────────────────────────────┼──────────────────────────────┘          │
└───────────────────────────────────────┼──────────────────────────────────────────┘
                                        │
                                        ▼
                                 Consistent-hash ring
                        (CRC-32, 50 virtual replicas per node)
```

### Read path (read-through)

`Group.get` → local `Cache` hit? return it. Miss → `SingleFlightGroup.do(key, …)` deduplicates concurrent loads → `loadData`: the consistent-hash ring elects the key's owner; a remote owner is queried via `Client.get` over gRPC; on peer failure or self-ownership the user-supplied `Getter` loads from the origin. The loaded `ByteView` is written into the local cache (with TTL when `withExpiration` is set) _inside_ the single-flight callback, so load counters and durations count actual loads, not waiting callers.

### Write path (fan-out)

`Group.set`/`Group.delete` update the local cache, then — unless the call already carries `x-peer-request: "true"` — asynchronously forward the operation to the single ring owner of the key (fire-and-forget; errors are only logged).

### Component map

| Module                          | Responsibility                                                        |
| ------------------------------- | --------------------------------------------------------------------- |
| `Group`                         | Orchestrator; global registry; read-through/write propagation; stats. |
| `Cache` / `LruStore`            | Cache facade; sharded two-level (2Q) LRU with byte budget and TTL.    |
| `ByteView`                      | Immutable byte container with defensive copies.                       |
| `SingleFlightGroup`             | Coalesces concurrent loads for the same key.                          |
| `ConHashMap`                    | Consistent-hash ring with adaptive (opt-in) rebalancing.              |
| `Client` / `ClientPicker`       | gRPC peer; ring + peer lifecycle + etcd discovery.                    |
| `Server`                        | gRPC service + health check + etcd registration.                      |
| `register` / `ServiceDiscovery` | Lease keep-alive; registry watcher with resync.                       |

---

## Lifecycle

Honor this order — starting the picker before the server is fine, but never wire peers before `picker.start()` has resolved, otherwise the ring holds only self and every read falls through to the local `Getter`:

1. Create the `Group`: `newGroup(name, cacheBytes, getter, ...opts)`.
2. Start the `Server`: `await new Server(bindAddr, svcName, { advertiseAddr }).start()`.
3. Start the `ClientPicker` **with the same advertise address**: `await picker.start()`.
4. Wire them: `group.registerPeers(picker)` (or `withPeers(picker)` at `newGroup` time).
5. Serve traffic via `group.get/set/delete` or the gRPC service.
6. Shutdown: `server.stop()` → `await picker.close()` → `destroyAllGroups()`. Each step is independently idempotent.

---

## Configuration reference

### Group

| Option                                        | Description                                                                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `newGroup(name, cacheBytes, getter, ...opts)` | Preferred factory; registers the group by name. `cacheBytes` sets the cache byte budget. Throws `"nil Getter"` for a falsy getter. |
| `withExpiration(ms)`                          | Per-entry TTL in milliseconds; `0` (default) means no expiration.                                                                  |
| `withPeers(picker)`                           | Wire a `PeerPicker` at construction.                                                                                               |
| `withCacheOptions(opts)`                      | Replace the default `Cache` with a custom-configured one.                                                                          |
| `registerPeers(picker)`                       | Late-binding alternative to `withPeers`; throws `"RegisterPeers called more than once"` if already set.                            |

Sentinel errors are module-level singletons (not exported); match on `err.message`:
`"key is required"`, `"value is required"`, `"cache group is closed"`, `"nil Getter"`, `"RegisterPeers called more than once"`, and loader failures wrapped as `"failed to get data: ${cause}"`.

### Cache / Store

`defaultCacheOptions()` = `{ maxBytes: 8 MiB, bucketCount: 16, capPerBucket: 512, level2Cap: 256, cleanupTime: 60_000, onEvicted: undefined }`.

> **Caveat:** constructing `LruStore` directly with sparse options uses its _own_ fallbacks (`capPerBucket`/`level2Cap` = 1024), which differ from `defaultStoreOptions()` (512/256). Spread `defaultStoreOptions()` explicitly if you want the documented defaults.

### Consistent hashing

`defaultConHashConfig` = `{ defaultReplicas: 50, minReplicas: 10, maxReplicas: 200, hashFunc: crc32, loadBalanceThreshold: 0.25, autoRebalance: false }`.

Rebalancing is **opt-in** (`autoRebalance: true`); a skewed ring will not self-correct otherwise. Note that `ClientPicker` constructs a default ring internally with no configuration hook — custom ring config requires a custom `PeerPicker`.

### Server / Client / Discovery

| Setting                                      | Default              | Notes                                                                              |
| -------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------- |
| `ServerOptions.etcdEndpoints`                | `["localhost:2379"]` | Registration endpoint.                                                             |
| `ServerOptions.dialTimeout`                  | `5000` ms            | etcd dial timeout.                                                                 |
| `ServerOptions.maxMsgSize`                   | `4 MiB`              | `grpc.max_receive_message_length`.                                                 |
| `ServerOptions.tls` / `certFile` / `keyFile` | `false`              | SSL server credentials; otherwise insecure. The shipped `Client` is insecure-only. |
| `ServerOptions.advertiseAddr`                | bind address         | Set when binding to `0.0.0.0:{port}` or `:{port}`.                                 |
| `ClientOptions.deadlineMs`                   | `3000` ms            | Per-call gRPC deadline.                                                            |
| `ClientOptions.peerRequest`                  | `false`              | Attach `x-peer-request: "true"` metadata.                                          |
| `PickerOption.peerDeadlineMs`                | —                    | Forwarded to every peer `Client` created by the picker.                            |
| `RegisterConfig.leaseTTL`                    | `10` s               | etcd lease TTL for registration keys.                                              |

---

## Operational guidance

- **Topology sizing.** `cacheBytes` sets `Cache.maxBytes`, which `LruStore` enforces as a _per-shard_ byte budget (`maxBytes / shardCount`, floored, min 1 byte). Slot capacity (`bucketCount × (capPerBucket + level2Cap)`) and bytes bind simultaneously. `bucketCount` is rounded up to a power of two (`bucketCount: 24` becomes 32). Instrument with `LruStore.usedBytes()`.
- **Hot-key fairness.** Enable `autoRebalance: true` (or call `rebalance()` manually). Prefer raising `defaultReplicas` over lowering `loadBalanceThreshold` (low thresholds oscillate).
- **Deadlines and cold reads.** A cold `get` may traverse `Group.load → pickPeer → Client.get → Server.handleGet → Group.get → Getter`; deep hops plus origin latency can exceed the 3000 ms default. Mitigations: pre-warm hot keys by `set` first, raise `peerDeadlineMs`, or accept the fallback — a peer failure is swallowed (logged, `peer_misses++`) and the local `Getter` is tried.
- **Bind vs. advertise addresses.** Bind to `0.0.0.0:{port}` and set `advertiseAddr` to the externally reachable `host:port`. The `ClientPicker` MUST be constructed with the exact address that lands in etcd — otherwise the node forwards to itself as a "peer". Keep host spellings consistent cluster-wide: the ring treats `localhost` and `127.0.0.1` as distinct nodes.
- **Etcd configuration.** Registration self-heals on lease loss (1 s retry); discovery resyncs the full peer set on watcher reconnect.
- **Closing resources.** Leaks almost always trace to a missed `close`: the `LruStore` cleanup interval, the `ConHashMap` balancer timer (only with `autoRebalance`), the `ServiceDiscovery` watcher, the etcd lease keep-alive, and every `Client` channel. `Group.close → Cache.close → LruStore.close` cascades automatically; the picker and server own the rest. In tests, use `try/finally` (or vitest `afterEach`); pass `cleanupTime: 0` to disable the sweep timer.

---

## Wire protocol & etcd layout

- gRPC service `pb.YukinoCache` (`yukino.proto`): unary `Get`, `Set`, `Delete` on a `{ group, key, value }` request shape.
- Health checks follow `grpc.health.v1.Health/Check`; the configured service name reports `SERVING`, anything else `UNKNOWN`.
- The metadata key `x-peer-request: "true"` is the **propagation guard**. Follow the same convention when adding state-mutating RPCs, or you will create propagation storms.
- etcd keys live under `/services/{svcName}/{addr}` with the address duplicated as the value; on delete events the address is recovered from the key suffix.
- The raw `.proto` files are published as subpath exports: `@yukino.js/cache/proto/yukino.proto` and `@yukino.js/cache/proto/health.proto`.

## Logging

All package logs flow through a `Logger` indirection (default console with a `[YukinoCache]` prefix). Route them into structured logging or silence them in tests:

```ts
import { setLogger } from "@yukino.js/cache";

setLogger({
  info: (m) => appLogger.debug(m),
  warn: (m) => appLogger.warn(m),
  error: (m) => appLogger.error(m),
});
```

---

## Testing

```bash
pnpm install        # install workspace deps (monorepo)
pnpm --filter @yukino.js/cache run test     # vitest unit suite
pnpm --filter @yukino.js/cache run build    # rollup ESM bundle + dts
```

The unit suite covers byte-view, cache, consistent-hash, crc32, group, lru, single-flight, and utils.

End-to-end smoke test (etcd + three nodes + gRPC round-trips):

```bash
node packages/cache/bootstrap.js
```

`bootstrap.js` reuses a reachable etcd on `127.0.0.1:2379` or forks a local one (`brew install etcd`), compiles the demo into `.dist/` (separate from Rollup's `dist/`), boots three nodes on `:8001`–`:8003`, and smoke-tests set-then-get against each. Pre-seeding the key guarantees a local hit and sidesteps cold-read peer deadlines.

## Build & release

- `pnpm --filter @yukino.js/cache run build` — Rollup ESM bundle (`preserveModules`, `.mjs` entries under `dist/`), `dist/index.d.ts` via `rollup-plugin-dts`, and `.proto` copy into `dist/proto/`. `@grpc/grpc-js`, `@grpc/proto-loader`, `etcd3`, and Node built-ins are external.
- `pnpm --filter @yukino.js/cache run clean` — removes `dist/`.
- `prepublishOnly` cleans and rebuilds; only `dist/` (plus `skills/` and this README) ships.

Only `src/index.ts` re-exports are part of the public contract — anything else is internal and may change without notice.

---

## Go sibling parity

This package intentionally mirrors [`yukino.go/yukino_cache`](https://github.com/hangtiancheng/yukino.go): APIs, semantics, etcd key layout, and wire format match symbol-for-symbol; only naming conventions and language-idiomatic concurrency diverge.

| Concept            | TypeScript (`@yukino.js/cache`)                                           | Go (`yukino.go/yukino_cache`)                                             |
| ------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Group factory      | `newGroup(name, cacheBytes, getter, ...opts)`                             | `NewGroup(name, cacheBytes, getter, opts...)`                             |
| Loader signature   | `(ctx: AbortSignal, key: string) => Promise<Buffer>`                      | `func(ctx context.Context, key string) ([]byte, error)`                   |
| Cancellation       | `AbortSignal`                                                             | `context.Context`                                                         |
| Functional options | `withExpiration` / `withPeers` / `withCacheOptions` / `withConHashConfig` | `WithExpiration` / `WithPeers` / `WithCacheOptions` / `WithConHashConfig` |
| Ring hash default  | `crc32` (IEEE)                                                            | `crc32.ChecksumIEEE`                                                      |
| Shard hash         | `hashBKRD`                                                                | `HashBKRD`                                                                |
| Sentinel errors    | `"key is required"` / `"value is required"` / `"cache group is closed"`   | `ErrKeyRequired` / `ErrValueRequired` / `ErrGroupClosed`                  |
| Propagation guard  | `x-peer-request: "true"` gRPC metadata                                    | `x-peer-request: "true"` gRPC metadata                                    |
| Client deadline    | 3000 ms default                                                           | 3 s                                                                       |
| Registry key       | `/services/{svcName}/{addr}`                                              | `/services/{svcName}/{addr}`                                              |
| Concurrency        | single-flight via shared `Promise`; fire-and-forget async IIFE fan-out    | `singleflight` + goroutines                                               |

When changing behavior, keep both packages in lock-step — drift defeats the design intent.

---

## License

[MIT](https://github.com/hangtiancheng/yukino.js/blob/main/LICENSE) © 2026 hangtiancheng
