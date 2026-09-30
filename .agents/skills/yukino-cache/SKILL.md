---
name: yukino-cache
description: Authoritative reference for the @yukino.js/cache distributed in-memory cache package located at packages/cache (TypeScript/Node.js ≥ 20, pure ESM, published as `@yukino.js/cache`), a groupcache-style peer-to-peer sharded read-through cache over gRPC with etcd discovery. Use this skill whenever the user reads, writes, debugs, reviews, or extends code that imports from `@yukino.js/cache`, references the `packages/cache` source tree, or runs its demo/runner (`packages/cache/src/main.ts`, `packages/cache/bootstrap.js`). Trigger eagerly on any of these exported symbols—`Group`, `newGroup`, `getGroup`, `listGroups`, `destroyGroup`, `destroyAllGroups`, `Getter`, `GroupOption`, `GroupStats`, `withExpiration`, `withPeers`, `withCacheOptions`, `Cache`, `CacheOptions`, `CacheStats`, `defaultCacheOptions`, `Value`, `Store`, `StoreOptions`, `defaultStoreOptions`, `LruStore`, `hashBKRD`, `maskOfNextPowOf2`, `ByteView`, `cloneBytes`, `SingleFlightGroup`, `ConHashMap`, `ConHashOption`, `withConHashConfig`, `ConHashConfig`, `defaultConHashConfig`, `crc32`, `HashFunc`, `Peer`, `PeerPicker`, `Client`, `ClientOptions`, `deadlineMs`, `ClientPicker`, `PickerOption`, `peerDeadlineMs`, `Server`, `ServerOptions`, `advertiseAddr`, `register`, `RegisterConfig`, `defaultRegisterConfig`, `leaseTTL`, `ServiceDiscovery`, `validPeerAddr`, `getLocalIP`, `Logger`, `log`, `setLogger`, the `pb.YukinoCache` gRPC service (Get/Set/Delete RPCs), the `grpc.health.v1.Health` Check RPC, the etcd key layout `/services/{svcName}/{addr}`, and the `x-peer-request` metadata flag—and on conceptual phrases like "groupcache for Node", "TypeScript distributed cache with consistent hashing", "single-flight cache stampede", "cache miss thundering herd", "etcd-based peer discovery", "two-level LRU cache", "peer fan-out write propagation", or file paths under `packages/cache/src/**`. Do NOT use this skill for the Go sibling `github.com/hangtiancheng/yukino.go/yukino_cache` (covered by its own Go skill; same architecture and wire format but PascalCase naming and `context.Context`/goroutine concurrency).
---

# @yukino.js/cache — Distributed Cache for Node.js

`@yukino.js/cache` is a TypeScript port of the groupcache architecture, redesigned for the Node.js runtime and shipped from `packages/cache` as pure ESM (`"type": "module"`, `engines.node >= 20`; `main`, `module`, and `exports["."].import` all point at `dist/index.mjs`, types at `dist/index.d.ts`). It composes a coherent set of building blocks—`Group`, `Cache`, `LruStore`, `ByteView`, `SingleFlightGroup`, `ConHashMap`, `Client`/`ClientPicker`, `Server`, and etcd registration/discovery—into a peer-to-peer, eventually consistent, sharded read-through cache reachable over gRPC. Runtime dependencies: `@grpc/grpc-js`, `@grpc/proto-loader`, `etcd3` (all hard dependencies; there are no peerDependencies). It is suitable as an in-process L1 cache (use `Cache` + `ByteView` standalone) or as a clustered cache with peer fan-out; it is NOT a replicated store, offers no quorum or anti-entropy, and must not be used where strong consistency or durability is required.

The package intentionally mirrors the Go sibling `yukino.go/yukino_cache`: APIs, semantics, etcd key layout, and wire format match symbol-for-symbol; only naming conventions and language-idiomatic concurrency diverge. When a user mentions concepts that exist on both sides, confirm whether they mean the TypeScript package (this skill) or the Go module (the Go skill).

## Architecture overview

```
packages/cache/
├── bootstrap.js              # end-to-end demo runner (etcd + 3 nodes + gRPC smoke test)
├── rollup.config.mjs         # ESM bundle (preserveModules, .mjs) + dts + copies .proto into dist/proto
├── tsconfig.json             # NodeNext, strict, target/lib ESNext (excludes *.test.ts)
├── tsconfig.build.json       # build config used by rollup (excludes main.ts and *.test.ts)
├── package.json              # @yukino.js/cache, type: module, exports ".", "./proto/*.proto"
└── src/
    ├── index.ts              # THE export contract; anything not re-exported here is internal
    ├── group.ts              # Group orchestrator, global registry, functional options, stats
    ├── cache.ts              # Cache facade (lazy LruStore init, hit/miss counters)
    ├── store.ts              # Value/Store/StoreOptions interfaces, defaultStoreOptions
    ├── lru.ts                # LruStore: sharded two-level LRU, byte budget, cleanup timer
    ├── byte-view.ts          # ByteView immutable byte container, cloneBytes
    ├── single-flight.ts      # SingleFlightGroup load deduplication
    ├── consistent-hash.ts    # ConHashMap virtual-node ring, adaptive rebalancing
    ├── config.ts             # ConHashConfig, defaultConHashConfig
    ├── crc32.ts              # IEEE CRC-32 (default ring hash), HashFunc type
    ├── peers.ts              # Peer / PeerPicker interfaces
    ├── client.ts             # Client: gRPC stub implementing Peer
    ├── client-picker.ts      # ClientPicker: ring + clients + etcd discovery
    ├── server.ts             # Server: gRPC service + health check + etcd registration
    ├── register.ts           # register() lease keep-alive, ServiceDiscovery watcher
    ├── utils.ts              # validPeerAddr, getLocalIP
    ├── logger.ts             # Logger indirection ([YukinoCache] console default)
    ├── main.ts               # demo assembly (NOT exported from index.ts; excluded from build)
    └── proto/
        ├── index.ts          # proto/healthProto loaded at module import via proto-loader
        ├── yukino.proto      # pb.YukinoCache: Get/Set/Delete
        └── health.proto      # grpc.health.v1.Health: Check
```

**Read path (read-through):** `Group.get` → local `Cache` hit? return it (`local_hits++`) → miss (`local_misses++`) → `SingleFlightGroup.do(key, …)` deduplicates concurrent loads → `loadData`: if peers are wired, `PeerPicker.pickPeer(key)` elects the consistent-hash owner; a remote owner is queried via `Client.get` over gRPC (`peer_hits`/`peer_misses`); on peer failure or self-ownership the user-supplied `Getter` loads from origin (`loader_hits`/`loader_errors`). The loaded `ByteView` is written into the local cache (with TTL when `withExpiration` is set) inside the single-flight callback, so load counters/durations count actual loads, not waiting callers.

**Write path (fan-out):** `Group.set`/`Group.delete` update the local cache, then—when `isPeerRequest === false` and peers are wired—asynchronously forward the operation to the single ring owner of the key (fire-and-forget via an async IIFE; errors only logged). Peer-originated traffic carries the gRPC metadata `x-peer-request: "true"`, which the receiving `Server` translates into `isPeerRequest = true` so the write is not echoed back. Other nodes are NOT notified; their caches may serve stale values until eviction or expiration. This is weak eventual consistency, not replication.

## Public API surface

All exports flow through `packages/cache/src/index.ts`. Treat that file as the contract; the only sanctioned subpath exports are `@yukino.js/cache/proto/yukino.proto`, `@yukino.js/cache/proto/health.proto`, and `./package.json`. Everything else (`main.ts`, `proto/index.ts` internals, `InternalCache`, module-level error singletons) is internal.

### Group orchestration (`group.ts`)

- `type Getter = (ctx: AbortSignal, key: string) => Promise<Buffer>` — origin loader. Receives the caller's `AbortSignal` (the `Server` derives one from gRPC call cancellation).
- `interface GroupOption { (g: Group): void }` — functional-options pattern matching the Go side.
- `withExpiration(ms: number): GroupOption` — per-entry TTL in milliseconds; `0` (default) means no expiration.
- `withPeers(peers: PeerPicker): GroupOption` — wire a `PeerPicker` (typically `ClientPicker`) at construction (calls `_setPeers`, bypassing the double-register guard).
- `withCacheOptions(opts: CacheOptions): GroupOption` — replace the default `Cache` with a custom-configured one (the default cache is `close()`d first).
- `class Group` (registered globally by name via `newGroup`)
  - `constructor(name, cacheBytes, getter, ...opts)` — throws `new Error("nil Getter")` when `getter` is falsy; `cacheBytes` overwrites `CacheOptions.maxBytes` on top of `defaultCacheOptions()`.
  - `get(ctx: AbortSignal, key: string): Promise<ByteView>` — read-through with single-flight. Throws on closed group / empty key.
  - `set(ctx: AbortSignal, key: string, value: Buffer, isPeerRequest = false): Promise<void>` — clones the buffer, writes locally (with TTL if configured), then best-effort fan-out unless `isPeerRequest`. Rejects on empty key or empty/zero-length value.
  - `delete(ctx: AbortSignal, key: string, isPeerRequest = false): Promise<void>` — deletes locally, then best-effort fan-out unless `isPeerRequest`. Rejects on empty key.
  - `clear(): void` — wipe local entries only; does not propagate. No-op when closed.
  - `close(): void` — idempotent; closes the cache and removes the group from the registry.
  - `registerPeers(peers: PeerPicker): void` — late-binding alternative to `withPeers`; throws `new Error("RegisterPeers called more than once")` if peers already set. (`withPeers`/`_setPeers` bypass this guard.)
  - `getStats(): GroupStats`, `getName(): string`.
  - `_setExpiration` / `_setPeers` / `_setCacheOptions` exist only for the option functions; do not call directly.
- `interface GroupStats` — `{ name, closed, expiration, loads, local_hits, local_misses, peer_hits, peer_misses, loader_hits, loader_errors, hit_rate?, avg_load_time_ms?, cache: CacheStats }`. `hit_rate = local_hits / (local_hits + local_misses)` (present only when there is at least one get); `avg_load_time_ms = loadDuration / loads` (present only when `loads > 0`).
- `newGroup(name, cacheBytes, getter, ...opts): Group` — preferred factory; also throws `"nil Getter"`. Registers in a package-level `Map<string, Group>`. Re-registration logs `"Group with name ${name} already exists; replacing it"` and replaces the entry WITHOUT closing the old group.
- `getGroup(name): Group | undefined`, `listGroups(): string[]`, `destroyGroup(name): boolean` (removes then closes; returns `false` if absent), `destroyAllGroups(): void`.

Sentinel errors are module-level `Error` instances (NOT exported); match on `err.message`: `"key is required"`, `"value is required"`, `"cache group is closed"`, `"nil Getter"`, `"RegisterPeers called more than once"`, and loader failures wrapped as `"failed to get data: ${cause}"`.

### Cache and storage (`cache.ts`, `store.ts`, `lru.ts`)

- `interface Value { len(): number }` — minimal sized-value contract; `ByteView` is the canonical implementation.
- `interface Store` — `get`, `set`, `setWithExpiration(key, value, expirationMs)`, `delete`, `clear`, `len`, `close`. Pluggable, but only `LruStore` ships. (Note: `usedBytes()` is a public `LruStore` method but is NOT part of the `Store` interface.)
- `interface StoreOptions { maxBytes?, bucketCount?, capPerBucket?, level2Cap?, cleanupInterval?, onEvicted? }`. `defaultStoreOptions()` returns `{ maxBytes: 8192, bucketCount: 16, capPerBucket: 512, level2Cap: 256, cleanupInterval: 60_000, onEvicted: undefined }`. Caveat: when `LruStore` is constructed with fields omitted, its OWN fallbacks are `bucketCount: 16`, `capPerBucket: 1024`, `level2Cap: 1024`, `cleanupInterval: 60_000`, `maxBytes: 0` (no byte budget)—different from `defaultStoreOptions()`, which is never applied implicitly.
- `interface CacheOptions { maxBytes?, bucketCount?, capPerBucket?, level2Cap?, cleanupTime?, onEvicted? }` — mirrors `StoreOptions` but the interval field is named `cleanupTime` (mapped to `cleanupInterval` internally). `defaultCacheOptions()` returns `{ maxBytes: 8 * 1024 * 1024, bucketCount: 16, capPerBucket: 512, level2Cap: 256, cleanupTime: 60_000, onEvicted: undefined }`.
- `interface CacheStats` — `{ initialized, closed, hits, misses, size?, hit_rate? }`; `size` and `hit_rate` present only once the store is lazily initialized.
- `class Cache` — facade owned by `Group`, also usable standalone. Lazily instantiates an `LruStore` on first `add`/`addWithExpiration` (logs `"Cache initialized, max bytes: …"`). Tracks `hits`/`misses` (a `get` on an uninitialized or closed cache returns `[null, false]`; uninitialized counts a miss). Methods:
  - `add(key, value: ByteView): void` — no-op + `warn` `"Attempted to add to a closed cache: ${key}"` when closed.
  - `get(key): [ByteView | null, boolean]`.
  - `addWithExpiration(key, value: ByteView, expirationTime): void` — `expirationTime` is an ABSOLUTE deadline (ms epoch). Internally computes `expirationMs = expirationTime - Date.now()`; if `<= 0` the write is treated as a `delete`.
  - `delete(key): boolean`, `clear(): void` (also resets hit/miss counters), `len(): number`, `close(): void` (logs `"Cache closed, hits: …, misses: …"`), `stats(): CacheStats`.
- `class LruStore implements Store` — sharded two-level LRU with a byte budget:
  - `bucketCount` is rounded to a power of two via `maskOfNextPowOf2`; each shard holds two `InternalCache` rings (capacities `capPerBucket` for L1 and `level2Cap` for L2).
  - **Promotion (2Q-style scan resistance):** a `get` hit in L1 removes the entry from L1 and re-inserts it into L2; L2 hits stay in L2. `set` always lands in L1 after purging any copy from both levels.
  - **Byte accounting:** with `maxBytes > 0`, each shard gets `bucketMaxBytes = max(1, floor(maxBytes / shardCount))`. Entry size is `key.length + value.len()`. After every `set`, tails are evicted (L1 first, then L2) until the shard is under budget, firing `onEvicted` per victim. `usedBytes()` reports the live total across shards.
  - Per-entry expiry is enforced lazily on `get` and proactively by an internal `setInterval(cleanupInterval)` sweep (disabled when `cleanupInterval <= 0`). Always call `close()` to clear the timer; `close()` is idempotent.
  - `onEvicted` fires on capacity overflow, byte-budget eviction, lazy/periodic expiry, and explicit `delete`.
- `hashBKRD(s: string): number` — fast non-cryptographic 32-bit hash (seed 131, `>>> 0` normalized) used to pick the shard. Do NOT use it for the consistent-hash ring (that defaults to CRC-32).
- `maskOfNextPowOf2(cap: number): number` — power-of-two mask helper operating on the low 16 bits (`maskOfNextPowOf2(3) === 3`, `maskOfNextPowOf2(16) === 15`).

### Immutable byte container (`byte-view.ts`)

- `class ByteView implements Value` wraps a `Buffer`. `constructor(b: Buffer)`; `len()` returns size; `byteSlice()` returns a DEFENSIVE COPY (`Buffer.from(this.b)`) so mutations cannot leak into the cache; `toString()` decodes with the buffer's default (UTF-8) encoding.
- `cloneBytes(b: Buffer): Buffer` — always-copy helper (`Buffer.alloc(b.length)` + `b.copy`) used before any value enters a cache or crosses the peer boundary. Treat all cached values as immutable.

### Coalescing concurrent loads (`single-flight.ts`)

- `class SingleFlightGroup` — `do<T>(key: string, fn: () => Promise<T>): Promise<T>`. Concurrent calls with the same key share one in-flight promise; the entry is removed in `finally`, so subsequent calls re-execute. Rejections propagate to every waiter; an internal no-op `.catch(() => {})` prevents unhandled-rejection warnings. This is the thundering-herd protection for the origin.

### Consistent hashing (`consistent-hash.ts`, `config.ts`, `crc32.ts`)

- `class ConHashMap` — sorted virtual-node ring keyed by 32-bit hashes. `constructor(...opts: ConHashOption[])`; `add(...nodes: string[])` (empty/falsy strings skipped), `remove(node)`, `get(key)` returns the owning node or `""` for an empty key/ring (wraps around when the hash exceeds the last ring point), `getStats(): Record<string, number>` (per-node fraction of routed requests; empty object until any request), `setConfig(config)` (also starts/stops the balancer timer), `rebalance()` (manual trigger), `close()` (stops the timer).
- `type ConHashOption = (m: ConHashMap) => void`; `withConHashConfig(config: ConHashConfig): ConHashOption` replaces the entire configuration.
- `interface ConHashConfig { defaultReplicas, minReplicas, maxReplicas, hashFunc, loadBalanceThreshold, autoRebalance? }`. `defaultConHashConfig = { defaultReplicas: 50, minReplicas: 10, maxReplicas: 200, hashFunc: crc32, loadBalanceThreshold: 0.25, autoRebalance: false }`.
- **Adaptive rebalancing is opt-in** (`autoRebalance: true`). When enabled, a 1-second `setInterval` checks accumulated counts; once `totalRequests >= 1000` and the worst node deviates from the average by more than `loadBalanceThreshold`, replicas are scaled per node: overloaded (`loadRatio > 1`) → `floor(currentReplicas / loadRatio)`, otherwise → `floor(currentReplicas * (2 - loadRatio))`, clamped to `[minReplicas, maxReplicas]`. Counters reset and the ring re-sorts. Without `autoRebalance` no timer exists, but `close()` remains safe.
- Virtual-node hashes are computed as `hashFunc("${node}-${i}")` for `i in [0, replicas)`.
- `crc32(data: string | Buffer): number` — table-driven IEEE CRC-32 (polynomial `0xedb88320`, table built at module load; strings encoded via `Buffer.from(data)`, result `>>> 0`). `type HashFunc = (data: string | Buffer) => number`.

### Peer abstractions (`peers.ts`, `client.ts`, `client-picker.ts`)

- `interface Peer` — `get(group, key): Promise<Buffer>`, `set(group, key, value): Promise<void>`, `delete(group, key): Promise<boolean>`, `close(): Promise<void>`. Mirrors the gRPC service.
- `interface PeerPicker` — `pickPeer(key): [Peer | null, found: boolean, isSelf: boolean]`, `close(): Promise<void>`. Custom pickers (e.g. static topologies) are supported; the test suite's `FakePeerPicker` shows the pattern.
- `class Client implements Peer` — gRPC stub over `grpc.credentials.createInsecure()` (no TLS client support).
  - `interface ClientOptions { deadlineMs?, peerRequest? }` — `deadlineMs` is the per-call deadline (default `3000` ms); `peerRequest: true` attaches `x-peer-request: "true"` metadata to every outgoing call. Default `peerRequest` is `false`.
  - `constructor(addr: string, opts?: ClientOptions)` builds the `pb.YukinoCache` stub against `addr`.
  - Errors surface as `Error("failed to get value from yukino_cache: ${grpcMessage}")`, `"failed to set value to yukino_cache: …"`, `"failed to delete value from yukino_cache: …"`.
  - `getAddr(): string` returns the dialed address; `close()` closes the channel.
- `class ClientPicker implements PeerPicker`
  - `constructor(addr: string, opts?: PickerOption)` where `interface PickerOption { serviceName?, etcdEndpoints?, peerDeadlineMs? }`. Default service name is `"yukino_cache"`; `etcdEndpoints` overrides discovery endpoints; `peerDeadlineMs` is forwarded to every peer `Client` it creates. Peer clients are always constructed with `peerRequest: true`. The internal ring is a default `ConHashMap` (CRC-32, 50 replicas, no auto-rebalance).
  - `start(): Promise<void>` — adds `selfAddr` to the ring first (so key ownership is globally consistent even single-node), does an initial `fetchAll()` from etcd, adds each non-self address that passes `validPeerAddr` (invalid registry entries log `"ignoring invalid peer address from registry: …"` and are skipped), then subscribes to live `put`/`delete` events. On watcher reconnect the discovery layer resyncs by re-fetching all addresses.
  - `pickPeer(key)` — `[null, true, true]` for self-ownership, `[client, true, false]` for a known peer, `[null, false, false]` when the ring is empty or the elected address has no live client.
  - `printPeers(): void` — debugging helper listing discovered peers.
  - `close(): Promise<void>` — stops the ring timer, closes every `Client`, clears the map, cancels the etcd watcher and client.

### Server and registration (`server.ts`, `register.ts`)

- `interface ServerOptions { etcdEndpoints?, dialTimeout?, maxMsgSize?, tls?, certFile?, keyFile?, advertiseAddr? }`. Defaults: `etcdEndpoints: ["localhost:2379"]`, `dialTimeout: 5000`, `maxMsgSize: 4 << 20` (4 MiB, applied as `grpc.max_receive_message_length`), `tls: false`. `advertiseAddr` is the address published to etcd for peers to dial—set it whenever binding to `0.0.0.0:{port}` or `:{port}`.
- `class Server`
  - `constructor(addr, svcName, opts?: Partial<ServerOptions>)` — builds the gRPC server, registers `pb.YukinoCache` (Get/Set/Delete) and `grpc.health.v1.Health` Check (returns `SERVING` = 1 for the configured `svcName`, `UNKNOWN` = 0 otherwise), and resolves credentials (`ServerCredentials.createSsl` only when `tls && certFile && keyFile`, else insecure).
  - `start(): Promise<void>` — `bindAsync` (rejects with `"failed to listen: …"`), then registers `advertiseAddr || addr` in etcd via `register(...)` passing `etcdEndpoints`/`dialTimeout`. Registration failure is logged (`"failed to register service: …"`) but does NOT stop the server from serving.
  - `stop(): void` — aborts the internal `AbortController` (which triggers lease revoke + etcd key delete inside `register`) and calls `tryShutdown` for graceful gRPC shutdown (logs `"Server stopped"`).
  - Handlers resolve the target `Group` via `getGroup(name)`; a missing group returns `grpc.status.NOT_FOUND` with message `"group ${groupName} not found"`; handler errors return `grpc.status.INTERNAL` with `err.message`. Set/Delete read the inbound `x-peer-request` metadata (constant `PEER_REQUEST_METADATA_KEY = "x-peer-request"`, matched against value `"true"`) and pass `isPeerRequest` into `Group.set`/`Group.delete`. Each handler derives an `AbortSignal` from the call's `cancelled` event and passes it to the group (and thus the `Getter`).
- `register(svcName, addr, stopSignal: AbortSignal, config?: Partial<RegisterConfig>): Promise<void>` — opens an `Etcd3` client, normalizes the advertise address (`:port` and `0.0.0.0:port` expand to `getLocalIP():port`, falling back to `127.0.0.1`), attaches a lease (default TTL `10` s) at key `/services/{svcName}/{addr}` with the address as the value. On lease loss it logs `"lease lost (…), re-registering …"` and re-acquires after 1 s (repeats until stopped). On `stopSignal` abort it revokes the lease, deletes the key, and closes the client (cleanup errors ignored). Logs `"Service registered: ${svcName} at ${addr}"` on success.
- `interface RegisterConfig { endpoints, dialTimeout, leaseTTL }`; `defaultRegisterConfig = { endpoints: ["localhost:2379"], dialTimeout: 5000, leaseTTL: 10 }`.
- `class ServiceDiscovery` — the watcher used by `ClientPicker`. `constructor(svcName, onPut, onDelete, config?: Partial<RegisterConfig>)`. `fetchAll(): Promise<string[]>` snapshots values under `/services/{svcName}`; `watch()` streams `put` events (address from the value, falling back to the key suffix) and `delete` events (address recovered from the key suffix, since delete events carry no value), logs `disconnected`, and resyncs via `fetchAll` on the `connected` event. Always `close()` to cancel the watcher and release the etcd client.

### Helpers (`utils.ts`, `logger.ts`)

- `validPeerAddr(addr: string): boolean` — accepts `localhost:<port>`, `<IPv4>:<port>`, multi-label RFC-1123-style `hostname:<port>` (must contain a dot), and `[<IPv6>]:<port>`. Single-label hosts other than `localhost` are rejected; ports must be 1–65535.
- `getLocalIP(): string` — first non-internal IPv4 address; throws `new Error("no valid local IP found")` if none exists.
- `interface Logger { info(msg): void; warn(msg): void; error(msg): void }`; `setLogger(logger: Logger): void`; `log: Logger` — all package logs flow through this indirection (default console with prefix `[YukinoCache]`). `setLogger` is the supported way to route into structured logging or silence output in tests.

## Wire format and gRPC contract

Proto definitions are loaded at module import by `src/proto/index.ts` (exports `proto`, `healthProto`; loader options `keepCase: true, longs: String, enums: String, defaults: true, oneofs: true`) and resolved relative to the compiled module (`join(__dirname, "yukino.proto")`)—which is why the Rollup build copies `.proto` files into `dist/proto/`. The raw files are also package subpath exports: `@yukino.js/cache/proto/yukino.proto` and `@yukino.js/cache/proto/health.proto`.

```proto
// packages/cache/src/proto/yukino.proto
syntax = "proto3";
package pb;

message Request           { string group = 1; string key = 2; bytes value = 3; }
message ResponseForGet    { bytes value = 1; }
message ResponseForSet    { bool  success = 1; }
message ResponseForDelete { bool  value = 1; }

service YukinoCache {
  rpc Get   (Request) returns (ResponseForGet);
  rpc Set   (Request) returns (ResponseForSet);
  rpc Delete(Request) returns (ResponseForDelete);
}
```

Health checks follow standard `grpc.health.v1.Health/Check` (`HealthCheckRequest { string service = 1; }` → `HealthCheckResponse { ServingStatus status = 1; }` where `UNKNOWN = 0, SERVING = 1, NOT_SERVING = 2`); the serving service name is the `Server` constructor's `svcName` (any other name returns `UNKNOWN`).

The metadata key `x-peer-request: "true"` is the **propagation guard**. `ClientPicker` builds its peer clients with `peerRequest: true` so every forwarded call carries the header; `server.ts` reads it and passes `isPeerRequest = true` into `Group.set`/`Group.delete`, suppressing further fan-out. Follow the same convention when adding RPCs that mutate state across peers, or you will create propagation storms.

Etcd key layout: `/services/{svcName}/{addr}` with the address duplicated as the value. Lease TTL 10 s by default; discovery treats the key suffix as the authoritative address on delete events.

## Lifecycle and orchestration

Honor this order—starting the picker before the server is fine, but never wire peers before `picker.start()` has resolved, otherwise the ring holds only self and every read falls through to the local `Getter`:

1. Create the `Group`: `newGroup(name, cacheBytes, getter, ...opts)`.
2. Start the `Server`: `await new Server(bindAddr, svcName, { advertiseAddr }).start()` — binds the gRPC port and registers the advertise address in etcd.
3. Start the `ClientPicker` **with the same advertise address**: `const picker = new ClientPicker(advertiseAddr, { serviceName: svcName }); await picker.start();`
4. Wire them: `group.registerPeers(picker)` (or `withPeers(picker)` at `newGroup` time).
5. Serve traffic via `group.get/set/delete` or the gRPC service.
6. Shutdown: `server.stop()` (revokes lease, graceful gRPC shutdown) → `await picker.close()` (ring timer, clients, watcher) → `destroyAllGroups()` (closes caches and their cleanup timers). Each step is independently idempotent.

The reference assembly is `packages/cache/src/main.ts` (flags `-p`/`--port`, default `50051`; binds `0.0.0.0:{port}`, advertises `getLocalIP():{port}` falling back to `127.0.0.1`; group `"user"` with `2 << 10` bytes, service name `"yukino_cache"`). The integration runner `packages/cache/bootstrap.js` reuses a reachable etcd on `127.0.0.1:2379` or forks a local one (`brew install etcd`, data dir `.etcd`), compiles the demo with `tsc` into `.dist/` (separate from Rollup's `dist/`), copies the `.proto` files alongside, bootstraps three nodes (`:8001`–`:8003`), and smoke-tests each with **set-then-get**—pre-seeding the key on a node guarantees the read is a local hit and sidesteps cold-read peer deadlines.

## Operational guidance

**Topology sizing.** `cacheBytes` in `newGroup` sets `Cache.maxBytes`, which `LruStore` enforces as a per-shard byte budget (`maxBytes / shardCount`, floored, min 1 byte). Two constraints bind simultaneously: slot capacity (`bucketCount × (capPerBucket + level2Cap)`) and bytes. Because the budget is per shard, a skewed key distribution can evict earlier than the global figure suggests. Power-of-two bucket counts are enforced by `maskOfNextPowOf2` (`bucketCount: 24` silently becomes 32). Tune via `withCacheOptions({ ...defaultCacheOptions(), ... })`.

**Hot-key fairness.** Ring rebalancing is OFF by default. Enable with `withConHashConfig({ ...defaultConHashConfig, autoRebalance: true })` on a `ConHashMap` you own, or call `rebalance()` manually. Note `ClientPicker` constructs a default ring internally with no configuration hook—custom ring config requires a custom `PeerPicker`. Prefer raising `defaultReplicas` over lowering `loadBalanceThreshold` (low thresholds oscillate).

**Deadlines and cold reads.** Peer RPCs default to 3000 ms, configurable per client (`new Client(addr, { deadlineMs })`) and fleet-wide (`new ClientPicker(addr, { peerDeadlineMs })`). A cold `get` may traverse `Group.load → pickPeer → Client.get → Server.handleGet → Group.get → Getter`; deep hops plus origin latency can exceed the budget. Mitigations: pre-warm hot keys by `set` first (the `bootstrap.js` approach); raise `peerDeadlineMs`; or accept it—the peer failure is swallowed (logged, `peer_misses++`) and the local `Getter` is tried.

**Error semantics.** Loader failures surface as `Error("failed to get data: ${cause}")`. Peer read failures never propagate to the caller. Fan-out failures inside `syncToPeers` are logged (`"failed to sync ${op} to peer: …"`) but never thrown—writes are deliberately fire-and-forget. If you require write acknowledgement, obtain the peer via `picker.pickPeer(key)` and await `peer.set`/`peer.delete` yourself.

**Closing resources.** Leaks almost always trace to a missed `close`. Live timers/watchers: the `LruStore` cleanup interval, the `ConHashMap` balancer interval (only with `autoRebalance`), the `ServiceDiscovery` watcher, the etcd lease keep-alive inside `register`, and every `Client` channel. `Group.close → Cache.close → LruStore.close` cascades automatically; the picker and server own the rest. In tests, use `try/finally` (or vitest `afterEach`) with `store.close()` / `await picker.close()` / `server.stop()`—the shipped test files demonstrate the pattern.

**Bind vs. advertise addresses.** Bind to `0.0.0.0:{port}` and set `ServerOptions.advertiseAddr` to the externally reachable `host:port`; `register` additionally normalizes `:port`/`0.0.0.0:port` to `getLocalIP():port`. The `ClientPicker` MUST be constructed with the exact address that lands in etcd—otherwise it treats its own registration as a foreign peer and forwards to itself. Keep host spellings consistent cluster-wide: `validPeerAddr` accepts both `localhost` and `127.0.0.1`, but the ring treats them as distinct nodes.

**Etcd configuration.** `ServerOptions.etcdEndpoints`/`dialTimeout` control registration; `PickerOption.etcdEndpoints` controls discovery; `register` also accepts `Partial<RegisterConfig>` directly including `leaseTTL`. Registration self-heals on lease loss (1 s retry); discovery resyncs the full peer set on watcher reconnect.

**TLS.** `tls: true` with `certFile`/`keyFile` enables SSL server credentials. The shipped `Client` is insecure-only; a TLS client requires extending `client.ts`.

## Common pitfalls

- **Importing internals.** Only `src/index.ts` re-exports are stable. `main.ts`, `proto/index.ts` internals, and `InternalCache` are not public; deep `dist/` imports must be redirected through new index exports.
- **Mutating cached bytes.** `ByteView.byteSlice()` copies, so mutating its result is safe; mutating a `Buffer` you passed into `set` is also safe (it was cloned via `cloneBytes`). Never reach into `ByteView` private fields.
- **Forgetting `await picker.start()`.** Symptom: 100 % `loader_hits`, 0 % `peer_hits` in `getStats()`—the ring only contains self.
- **Bind/advertise mismatch.** Registering `192.168.x.y:8001` while constructing the picker with `127.0.0.1:8001` makes the node forward to itself as a "peer". Always pass the exact registered address pair.
- **Expecting rebalancing to be on.** `autoRebalance` defaults to `false`; a skewed ring will not self-correct unless enabled or `rebalance()` is called.
- **Assuming a global byte cap.** The budget is sharded; per-shard eviction can fire well below the global `maxBytes`. Instrument with `LruStore.usedBytes()`.
- **Replacing a group without closing it.** `newGroup` with an existing name replaces the registry entry but does NOT close the old group—its cleanup timer keeps running. Call `destroyGroup(name)` first.
- **Constructing `LruStore` directly with sparse options.** Its internal fallbacks (`capPerBucket`/`level2Cap` = 1024) differ from `defaultStoreOptions()` (512/256); spread `defaultStoreOptions()` explicitly if you want the documented defaults.
- **Test hangs from timers.** `LruStore` (and `ConHashMap` with `autoRebalance`) run `setInterval`s; un-closed instances keep the vitest worker alive. Pass `cleanupInterval: 0` (or `cleanupTime: 0` on `CacheOptions`) or close in `afterEach`.
- **Fan-out is unacknowledged.** `set`/`delete` resolve before the peer write completes (or fails). Do not treat resolution as cluster-wide durability.
- **Zero-length values.** `Group.set` rejects with `"value is required"` on an empty/zero-length `Buffer`; store a sentinel byte if you must represent emptiness.

## Quick recipes

**Single-node, no peers, with TTL and stats:**

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

**Clustered node (assembled like `main.ts`):**

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

**Direct gRPC client (no `Group` involvement):**

```ts
import { Client } from "@yukino.js/cache";

const client = new Client("127.0.0.1:8001", { deadlineMs: 5000 });
await client.set("users", "alice", Buffer.from("payload"));
const value = await client.get("users", "alice");
await client.close();
```

**Standalone in-process L1 cache (`Cache` + `ByteView`, no gRPC/etcd):**

```ts
import { Cache, ByteView, defaultCacheOptions } from "@yukino.js/cache";

const cache = new Cache({ ...defaultCacheOptions(), maxBytes: 64 << 20 });
cache.add("k", new ByteView(Buffer.from("v")));
const [view, ok] = cache.get("k");
cache.addWithExpiration("t", new ByteView(Buffer.from("x")), Date.now() + 5000); // ABSOLUTE deadline
cache.close();
```

**Custom consistent-hash ring with auto-rebalancing:**

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

**Route or silence package logs:**

```ts
import { setLogger } from "@yukino.js/cache";

setLogger({
  info: (m) => appLogger.debug(m),
  warn: (m) => appLogger.warn(m),
  error: (m) => appLogger.error(m),
});
```

## Build, test, and release

- `pnpm --filter @yukino.js/cache run build` — Rollup ESM bundle (`preserveModules`, `.mjs` entries under `dist/`), `dist/index.d.ts` via `rollup-plugin-dts`, and `.proto` copy into `dist/proto/`. `@grpc/grpc-js`, `@grpc/proto-loader`, `etcd3`, and Node built-ins are external.
- `pnpm --filter @yukino.js/cache run test` — Vitest suite (`byte-view`, `cache`, `consistent-hash`, `crc32`, `group`, `lru`, `single-flight`, `utils`).
- `pnpm --filter @yukino.js/cache run format` — Prettier.
- `pnpm --filter @yukino.js/cache run clean` — `rm -rf dist`.
- `node packages/cache/bootstrap.js` — end-to-end smoke test (etcd + three nodes; compiles into `.dist/`).
- `prepublishOnly` cleans and rebuilds; only `dist/` ships (`package.json#files`).

## Go sibling parity

Route Go work on `github.com/hangtiancheng/yukino.go/yukino_cache` to its dedicated Go skill; use this table to keep polyglot deployments in lock-step:

| Concept            | TypeScript (`@yukino.js/cache`)                                                | Go (`yukino.go/yukino_cache`)                                       |
| ------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Group factory      | `newGroup(name, cacheBytes, getter, ...opts)`                                  | `NewGroup(name, cacheBytes, getter, opts...)`                       |
| Loader signature   | `(ctx: AbortSignal, key: string) => Promise<Buffer>`                           | `func(ctx context.Context, key string) ([]byte, error)`             |
| Cancellation       | `AbortSignal`                                                                  | `context.Context`                                                   |
| Functional options | `withExpiration / withPeers / withCacheOptions / withConHashConfig`            | `WithExpiration / WithPeers / WithCacheOptions / WithConHashConfig` |
| Ring hash default  | `crc32` (IEEE)                                                                 | `crc32.ChecksumIEEE`                                                |
| Shard hash         | `hashBKRD`                                                                     | `HashBKRD`                                                          |
| Sentinel errors    | `Error("key is required")` / `"value is required"` / `"cache group is closed"` | `ErrKeyRequired` / `ErrValueRequired` / `ErrGroupClosed`            |
| Propagation guard  | `x-peer-request: "true"` gRPC metadata                                         | `x-peer-request: "true"` gRPC metadata                              |
| Client deadline    | 3000 ms default via `ClientOptions.deadlineMs`                                 | 3 s                                                                 |
| Registry key       | `/services/{svcName}/{addr}`                                                   | `/services/{svcName}/{addr}`                                        |
| Concurrency        | single-flight via shared `Promise`; fire-and-forget async IIFE fan-out         | `singleflight` + goroutines                                         |

Symbol parity makes ports mechanical; behavioral parity makes polyglot clusters safe. When a user requests a behavior change, ask whether both packages should be updated together—drift defeats the design intent.
