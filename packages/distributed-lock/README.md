# @yukino.js/distributed-lock

A **Redis-based distributed lock** for TypeScript — atomic acquire/release via
Lua scripts, with retries + jittered backoff, an optional renewal watchdog, and
fencing tokens to defend against stale writes.

[![npm](https://img.shields.io/npm/v/@yukino.js/distributed-lock?label=npm&color=F05138)](https://www.npmjs.com/package/@yukino.js/distributed-lock)
[![License: MIT](https://img.shields.io/badge/License-MIT-f5a623.svg)](../../LICENSE)

## Installation

```sh
pnpm add @yukino.js/distributed-lock redis
```

## Usage

```ts
import { createClient } from "redis";
import { DistributedLock } from "@yukino.js/distributed-lock";

const redis = createClient();
await redis.connect();

const lock = new DistributedLock(redis);

const handle = await lock.acquire({
  key: "lock:order:123",
  ownerId: crypto.randomUUID(),
  ttlMs: 10_000,
  autoRenew: true, // watchdog renews at ttl/3 intervals
  retryCount: 3, // up to 4 total attempts
});

if (!handle) {
  throw new Error("could not acquire lock within budget");
}

try {
  // critical section…
} finally {
  await handle.release();
}
```

## Features

- **Atomic operations** — acquire and release are implemented as Lua scripts
  (`EVALSHA`-cached) so ownership checks and mutation happen in a single
  round-trip.
- **Retries with backoff** — configurable retry count with exponential backoff
  plus jitter, and an absolute `acquireTimeoutMs` ceiling.
- **Renewal watchdog** — `autoRenew` extends the TTL at `ttlMs / 3` intervals and
  stops on release or loss; `onLost` fires if the lock is stolen.
- **Fencing tokens** — a monotonically increasing token lets downstream resources
  reject stale writers whose lock expired.
- **Not reentrant** — a given `ownerId` cannot acquire the same key twice.

## API

### `new DistributedLock(redis)`

Wraps a connected `RedisClientType` from the `redis` package.

### `lock.acquire(options)` → `Promise<LockHandle | null>`

Returns a handle on success, `null` if the lock could not be acquired within the
retry/timeout budget.

| Option                              | Type      | Default | Description                    |
| ----------------------------------- | --------- | ------- | ------------------------------ |
| `key`                               | `string`  | —       | Redis lock key                 |
| `ownerId`                           | `string`  | —       | Unique owner id (UUID v4)      |
| `ttlMs`                             | `number`  | —       | Lock TTL in milliseconds       |
| `retryCount`                        | `number`  | `0`     | Extra attempts after the first |
| `retryDelayMs`                      | `number`  | `200`   | Base delay between retries     |
| `retryWithBackoff`                  | `boolean` | `true`  | Exponential backoff + jitter   |
| `maxRetryDelayMs`                   | `number`  | `5000`  | Retry-delay upper bound        |
| `autoRenew`                         | `boolean` | `false` | Renew watchdog at `ttlMs / 3`  |
| `fencingToken`                      | `boolean` | `false` | Return a fencing token         |
| `acquireTimeoutMs`                  | `number`  | —       | Absolute acquire ceiling       |
| `onAcquired` / `onRetry` / `onLost` | callback  | —       | Lifecycle hooks                |

### `LockHandle`

| Member          | Description                                            |
| --------------- | ------------------------------------------------------ |
| `release()`     | Release; `true` if released, `false` if lost/expired   |
| `renew(ttlMs?)` | Extend the TTL; `true` if still owned                  |
| `fencingToken`  | Monotonic token (only when `fencingToken` was enabled) |
