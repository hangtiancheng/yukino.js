# @yukino.js/redis-lock

Redis leases aligned with `yukino.go/components/redis_lock`. Requires Node.js
22+. Clients are supplied by the caller; there are no runtime dependencies.
The old manager/ownerId/fencing-token API has been replaced.

```ts
import { createClient } from "redis";
import { RedisLock, LockBusyError } from "@yukino.js/redis-lock";

const client = createClient({
  url: "redis://localhost:6379",
  disableOfflineQueue: true,
  socket: { reconnectStrategy: false, connectTimeout: 2000 },
});
await client.connect();
const lock = new RedisLock("order:42", client, {
  ttlMs: 30_000, // explicit TTL disables the default watchdog
  block: true,
  blockWaitingMs: 5000,
});
await lock.lock(AbortSignal.timeout(5000));
try {
  // Critical section: finish while lock.held and lock.remainingMs > 0.
} finally {
  await lock.unlock();
}
await client.quit();
```

Each instance represents one non-reentrant lease. Every acquisition generates
24 cryptographically random bytes, hex encoded. Redis keys use Go's
`DISTRIBUTED_LOCK_PREFIX_` namespace. SET NX PX acquires atomically; Lua compares
the token before deleting or extending a key. No caller-supplied ownership IDs
or persistent fencing counters are used.

| Method/property       | Behavior                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `lock(signal?)`       | Acquire, or throw; optional cancellation controls acquisition only                          |
| `unlock()`            | Stop renewal, delete the owned key; transport failures allow cleanup retry                  |
| `delayExpire(ttlMs?)` | Ownership-checked renewal, defaulting to the configured TTL                                 |
| `held`, `remainingMs` | Conservative local validity estimate; not a Redis ownership query                           |
| `key`                 | Actual prefixed Redis key                                                                   |
| `close()`             | Stop renewal and clean up; can retry after transport failure; never closes borrowed clients |

Omitting `ttlMs` enables the watchdog with a 30-second TTL. You can also set
`autoRenew` explicitly for a single-node lock. Renewals run serially at TTL/3,
use the current renewal TTL and stop on ownership loss or a command failure.
Cancellation of the acquisition signal after success does not stop renewal.
Release and close stop renewal even when Redis is unavailable.

Options: `ttlMs` (30000), `block` (false), `blockWaitingMs` (5000),
`retryIntervalMs` (50, with up to one additional interval of jitter),
`commandTimeoutMs` (2000), `autoRenew` (true only when TTL is omitted).
Durations must be positive integer milliseconds within the Node timer range;
auto renewal requires TTL >= 30ms. The validity window subtracts elapsed
acquisition time and a 1% + 2ms clock-drift allowance.

`LockBusyError` means contention; `LockLostError` means ownership or local
validity was lost. `LockStateError` rejects reentry or acquisition after close.
`LockTimeoutError` bounds command waits. Redis transport errors are preserved;
cleanup failures are included in `AggregateError`. A timeout cannot revoke a
command already sent to Redis: uncertain SET operations receive another
ownership-checked cleanup after the original promise settles. Configure client
transport timeouts and disable queued commands and automatic command retries;
TTL remains the fallback if cleanup cannot reach Redis. Blocking wait budgets
bound acquisition attempts; cleanup can add another command timeout.

## Redlock

```ts
import { RedLock } from "@yukino.js/redis-lock";

const lock = new RedLock("order:42", [masterA, masterB, masterC], {
  ttlMs: 30_000,
  nodeTimeoutMs: 50,
});
await lock.lock();
try {
  // Work within lock.remainingMs.
} finally {
  await lock.close();
}
```

Supply at least three distinct clients connected to independent masters.
Distinct objects connected to the same master do not represent independent
votes. Each attempt sends the same token to every master in parallel and
requires a majority before the overall validity window expires. Node timeouts
must be less than TTL/10. Failed acquisition cleans every node, including those
whose SET reply was lost. Partial cleanup errors are reported. No watchdog runs
for Redlock; explicit `delayExpire` requires a new majority before the old
validity window expires. `QuorumError` reports failed acquisition;
`isRetryableError` recognizes contention and quorum failures for blocking mode.

The protocol and assumptions follow the [Redis distributed-lock documentation](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/).
Leases assume bounded clock drift and work that ends before expiry. These
packages do not provide storage-enforced fencing or consensus guarantees.

Go uses seconds for `WithExpireSeconds`/`DelayExpire`; JS uses milliseconds.
Both share token encoding, key namespace, ownership checks, watchdog lifetime,
fixed Redlock leases, overall elapsed-time accounting, and cleanup semantics.

```sh
pnpm test                     # deterministic fault tests; no Redis needed
pnpm typecheck
pnpm build
REDIS_URLS=redis://127.0.0.1:6379,redis://127.0.0.1:6380,redis://127.0.0.1:6381 pnpm test
```
