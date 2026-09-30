import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createClient, type RedisClientType } from "redis";
import {
  DistributedLock,
  DEFAULTS,
  type LockHandle,
  type LostInfo,
} from "../src/index.js";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_PREFIX = "test:distributed-lock:";
let keySeq = 0;

/** Unique key per test case — eliminates cross-test interference. */
function uniqueKey(): string {
  return `${TEST_PREFIX}${process.pid}:${Date.now()}:${++keySeq}`;
}

function uuid(): string {
  return crypto.randomUUID();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("DistributedLock", () => {
  let redis: RedisClientType;
  let lock: DistributedLock;

  /** Track handles so afterEach can release any leaked locks. */
  const activeHandles: LockHandle[] = [];

  beforeAll(async () => {
    redis = createClient();
    await redis.connect();
    lock = new DistributedLock(redis);
  });

  afterEach(async () => {
    for (const h of activeHandles) {
      try {
        await h.release();
      } catch {
        /* already released or connection closed — safe to ignore */
      }
    }
    activeHandles.length = 0;
  });

  afterAll(async () => {
    lock.stopAllRenewals();
    await redis.quit();
  });

  /** Acquire a lock and auto-track it for cleanup. */
  async function acquireTracked(
    ...args: Parameters<DistributedLock["acquire"]>
  ): Promise<LockHandle | null> {
    const handle = await lock.acquire(...args);
    if (handle) activeHandles.push(handle);
    return handle;
  }

  // -----------------------------------------------------------------------
  // Basic acquire / release
  // -----------------------------------------------------------------------

  it("should acquire a lock successfully", async () => {
    const key = uniqueKey();
    const ownerId = uuid();

    const handle = await acquireTracked({ key, ownerId, ttlMs: 5000 });

    expect(handle).not.toBeNull();
    expect(handle!.key).toBe(key);
    expect(handle!.ownerId).toBe(ownerId);

    const value = await redis.get(key);
    expect(value).toBe(ownerId);
  });

  it("should release a lock successfully", async () => {
    const key = uniqueKey();
    const ownerId = uuid();

    const handle = await acquireTracked({ key, ownerId, ttlMs: 5000 });
    expect(handle).not.toBeNull();

    const released = await handle!.release();
    expect(released).toBe(true);

    const value = await redis.get(key);
    expect(value).toBeNull();
  });

  it("should return false when releasing a non-existent lock", async () => {
    const released = await lock.release(uniqueKey(), uuid());
    expect(released).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Mutual exclusion
  // -----------------------------------------------------------------------

  it("should fail to acquire a lock already held by another owner", async () => {
    const key = uniqueKey();

    const handle1 = await acquireTracked({ key, ownerId: uuid(), ttlMs: 5000 });
    expect(handle1).not.toBeNull();

    const handle2 = await acquireTracked({ key, ownerId: uuid(), ttlMs: 5000 });
    expect(handle2).toBeNull();
  });

  it("should not release a lock held by a different owner", async () => {
    const key = uniqueKey();
    const owner1 = uuid();

    const handle = await acquireTracked({ key, ownerId: owner1, ttlMs: 5000 });
    expect(handle).not.toBeNull();

    const released = await lock.release(key, uuid());
    expect(released).toBe(false);

    const value = await redis.get(key);
    expect(value).toBe(owner1);
  });

  // -----------------------------------------------------------------------
  // TTL expiry
  // -----------------------------------------------------------------------

  it("should auto-expire after ttlMs", async () => {
    const key = uniqueKey();

    await acquireTracked({ key, ownerId: uuid(), ttlMs: 300 });
    await sleep(400);

    const value = await redis.get(key);
    expect(value).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Retry
  // -----------------------------------------------------------------------

  it("should retry and acquire after the existing lock expires", async () => {
    const key = uniqueKey();
    const owner2 = uuid();

    // Owner 1 holds lock for 300 ms
    await acquireTracked({ key, ownerId: uuid(), ttlMs: 300 });

    // Owner 2 retries — should succeed once owner 1's lock expires
    const handle2 = await acquireTracked({
      key,
      ownerId: owner2,
      ttlMs: 5000,
      retryCount: 10,
      retryDelayMs: 100,
      retryWithBackoff: false, // fixed interval for deterministic test timing
    });

    expect(handle2).not.toBeNull();
    expect(handle2!.ownerId).toBe(owner2);
  });

  it("should return null when retries are exhausted", async () => {
    const key = uniqueKey();

    // Owner 1 holds lock for 5 s — will outlive owner 2's retry budget
    await acquireTracked({ key, ownerId: uuid(), ttlMs: 5000 });

    const handle2 = await acquireTracked({
      key,
      ownerId: uuid(),
      ttlMs: 5000,
      retryCount: 2,
      retryDelayMs: 50,
      retryWithBackoff: false,
    });

    expect(handle2).toBeNull();
  });

  // -----------------------------------------------------------------------
  // acquireTimeoutMs
  // -----------------------------------------------------------------------

  it("should return null when acquireTimeoutMs is exceeded", async () => {
    const key = uniqueKey();

    // Hold the lock for longer than the timeout budget
    await acquireTracked({ key, ownerId: uuid(), ttlMs: 5000 });

    const start = Date.now();
    const handle = await acquireTracked({
      key,
      ownerId: uuid(),
      ttlMs: 5000,
      retryCount: 100,
      retryDelayMs: 50,
      retryWithBackoff: false,
      acquireTimeoutMs: 300,
    });

    const elapsed = Date.now() - start;
    expect(handle).toBeNull();
    expect(elapsed).toBeLessThan(600); // generous upper bound
  });

  // -----------------------------------------------------------------------
  // Manual renewal
  // -----------------------------------------------------------------------

  it("should renew a held lock", async () => {
    const key = uniqueKey();
    const ownerId = uuid();

    await acquireTracked({ key, ownerId, ttlMs: 5000 });

    const renewed = await lock.renew(key, ownerId, 10000);
    expect(renewed).toBe(true);

    const pttl = await redis.pTTL(key);
    expect(pttl).toBeGreaterThan(5000);
  });

  it("should not renew a lock owned by someone else", async () => {
    const key = uniqueKey();

    await acquireTracked({ key, ownerId: uuid(), ttlMs: 5000 });

    const renewed = await lock.renew(key, uuid(), 10000);
    expect(renewed).toBe(false);
  });

  // -----------------------------------------------------------------------
  // LockHandle.renew
  // -----------------------------------------------------------------------

  it("should renew via handle.renew()", async () => {
    const key = uniqueKey();
    const ownerId = uuid();

    const handle = await acquireTracked({ key, ownerId, ttlMs: 5000 });
    expect(handle).not.toBeNull();

    const renewed = await handle!.renew(10000);
    expect(renewed).toBe(true);

    const pttl = await redis.pTTL(key);
    expect(pttl).toBeGreaterThan(5000);
  });

  it("should renew via handle.renew() with default ttl", async () => {
    const key = uniqueKey();
    const ownerId = uuid();

    const handle = await acquireTracked({ key, ownerId, ttlMs: 5000 });
    expect(handle).not.toBeNull();

    // Let some time pass so the TTL decreases
    await sleep(200);

    const renewed = await handle!.renew();
    expect(renewed).toBe(true);

    const pttl = await redis.pTTL(key);
    // Should be close to the original 5000ms (minus test overhead)
    expect(pttl).toBeGreaterThan(4000);
  });

  // -----------------------------------------------------------------------
  // Auto-renewal (watchdog)
  // -----------------------------------------------------------------------

  it("should keep the lock alive beyond initial ttl with autoRenew", async () => {
    const key = uniqueKey();
    const ownerId = uuid();

    const handle = await acquireTracked({
      key,
      ownerId,
      ttlMs: 300,
      autoRenew: true,
    });
    expect(handle).not.toBeNull();

    // Wait well past the original TTL
    await sleep(500);

    // Lock must still be alive
    const value = await redis.get(key);
    expect(value).toBe(ownerId);

    await handle!.release();
  });

  // -----------------------------------------------------------------------
  // Non-owner release must NOT kill the real owner's watchdog (P1-6a)
  // -----------------------------------------------------------------------

  it("should not stop watchdog when a non-owner calls release", async () => {
    const key = uniqueKey();
    const realOwner = uuid();
    const impostor = uuid();

    const handle = await acquireTracked({
      key,
      ownerId: realOwner,
      ttlMs: 300,
      autoRenew: true,
    });
    expect(handle).not.toBeNull();

    // Impostor attempts release — Lua rejects, watchdog must survive
    const released = await lock.release(key, impostor);
    expect(released).toBe(false);

    // Wait past original TTL — watchdog should have renewed
    await sleep(500);

    const value = await redis.get(key);
    expect(value).toBe(realOwner);

    await handle!.release();
  });

  // -----------------------------------------------------------------------
  // onLost callback
  // -----------------------------------------------------------------------

  it("should invoke onLost when the lock expires during autoRenew", async () => {
    const key = uniqueKey();
    const ownerId = uuid();
    const lostEvents: LostInfo[] = [];

    const handle = await acquireTracked({
      key,
      ownerId,
      ttlMs: 300,
      autoRenew: true,
      onLost: (info) => lostEvents.push(info),
    });
    expect(handle).not.toBeNull();

    // Forcibly delete the key to simulate lock theft / external expiry
    await redis.del(key);

    // Wait for the watchdog to detect the loss (interval = 100ms)
    await sleep(250);

    expect(lostEvents.length).toBe(1);
    expect(lostEvents[0]).toEqual({ key, ownerId, reason: "expired" });
  });

  // -----------------------------------------------------------------------
  // Fencing token
  // -----------------------------------------------------------------------

  it("should return a monotonically increasing fencing token", async () => {
    const key = uniqueKey();

    const h1 = await acquireTracked({
      key,
      ownerId: uuid(),
      ttlMs: 300,
      fencingToken: true,
    });
    expect(h1).not.toBeNull();
    expect(h1!.fencingToken).toBeGreaterThan(0);

    // Release and re-acquire — token must increase
    await h1!.release();

    const h2 = await acquireTracked({
      key,
      ownerId: uuid(),
      ttlMs: 300,
      fencingToken: true,
    });
    expect(h2).not.toBeNull();
    expect(h2!.fencingToken).toBeGreaterThan(h1!.fencingToken!);
  });

  it("should not include fencingToken when option is disabled", async () => {
    const key = uniqueKey();

    const handle = await acquireTracked({
      key,
      ownerId: uuid(),
      ttlMs: 5000,
    });
    expect(handle).not.toBeNull();
    expect(handle!.fencingToken).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Observability callbacks
  // -----------------------------------------------------------------------

  it("should invoke onAcquired with attempt info", async () => {
    const key = uniqueKey();
    const ownerId = uuid();
    let acquiredInfo: { attempt: number } | null = null;

    await acquireTracked({
      key,
      ownerId,
      ttlMs: 5000,
      onAcquired: (info) => {
        acquiredInfo = info;
      },
    });

    expect(acquiredInfo).not.toBeNull();
    expect(acquiredInfo!.attempt).toBe(0);
  });

  it("should invoke onRetry before each retry sleep", async () => {
    const key = uniqueKey();
    const retries: number[] = [];

    await acquireTracked({ key, ownerId: uuid(), ttlMs: 5000 });

    await acquireTracked({
      key,
      ownerId: uuid(),
      ttlMs: 5000,
      retryCount: 2,
      retryDelayMs: 30,
      retryWithBackoff: false,
      onRetry: (info) => retries.push(info.attempt),
    });

    expect(retries).toEqual([0, 1]);
  });

  // -----------------------------------------------------------------------
  // stopAllRenewals
  // -----------------------------------------------------------------------

  it("should let the lock expire after stopAllRenewals", async () => {
    const key = uniqueKey();
    const ownerId = uuid();

    await acquireTracked({
      key,
      ownerId,
      ttlMs: 300,
      autoRenew: true,
    });

    // Stop all watchdogs
    lock.stopAllRenewals();

    // Wait past TTL — lock should expire without renewal
    await sleep(450);

    const value = await redis.get(key);
    expect(value).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Lifecycle: acquire -> release -> re-acquire same key
  // -----------------------------------------------------------------------

  it("should support sequential acquire-release-acquire on the same key", async () => {
    const key = uniqueKey();
    const owner1 = uuid();
    const owner2 = uuid();

    const h1 = await acquireTracked({ key, ownerId: owner1, ttlMs: 5000 });
    expect(h1).not.toBeNull();

    await h1!.release();

    const h2 = await acquireTracked({ key, ownerId: owner2, ttlMs: 5000 });
    expect(h2).not.toBeNull();
    expect(h2!.ownerId).toBe(owner2);

    const value = await redis.get(key);
    expect(value).toBe(owner2);
  });

  // -----------------------------------------------------------------------
  // Concurrent acquisition stress
  // -----------------------------------------------------------------------

  it("should grant the lock to exactly one owner under concurrency", async () => {
    const key = uniqueKey();
    const ownerCount = 10;
    const owners = Array.from({ length: ownerCount }, () => uuid());

    const results = await Promise.all(
      owners.map((ownerId) => lock.acquire({ key, ownerId, ttlMs: 5000 })),
    );

    const winners = results.filter((r) => r !== null);
    expect(winners.length).toBe(1);

    // Cleanup
    await winners[0]!.release();
  });

  // -----------------------------------------------------------------------
  // Input validation
  // -----------------------------------------------------------------------

  it("should throw RangeError on ttlMs <= 0", async () => {
    await expect(
      lock.acquire({ key: uniqueKey(), ownerId: uuid(), ttlMs: 0 }),
    ).rejects.toThrow(RangeError);

    await expect(
      lock.acquire({ key: uniqueKey(), ownerId: uuid(), ttlMs: -1 }),
    ).rejects.toThrow(RangeError);
  });

  it("should throw TypeError on empty key", async () => {
    await expect(
      lock.acquire({ key: "", ownerId: uuid(), ttlMs: 1000 }),
    ).rejects.toThrow(TypeError);
  });

  it("should throw TypeError on empty ownerId", async () => {
    await expect(
      lock.acquire({ key: uniqueKey(), ownerId: "", ttlMs: 1000 }),
    ).rejects.toThrow(TypeError);
  });

  it("should throw RangeError on negative retryCount", async () => {
    await expect(
      lock.acquire({
        key: uniqueKey(),
        ownerId: uuid(),
        ttlMs: 1000,
        retryCount: -1,
      }),
    ).rejects.toThrow(RangeError);
  });

  it("should throw RangeError on NaN retryDelayMs", async () => {
    await expect(
      lock.acquire({
        key: uniqueKey(),
        ownerId: uuid(),
        ttlMs: 1000,
        retryDelayMs: NaN,
      }),
    ).rejects.toThrow(RangeError);
  });

  it("should throw RangeError on negative maxRetryDelayMs", async () => {
    await expect(
      lock.acquire({
        key: uniqueKey(),
        ownerId: uuid(),
        ttlMs: 1000,
        maxRetryDelayMs: -100,
      }),
    ).rejects.toThrow(RangeError);
  });

  it("should throw RangeError when autoRenew is enabled with tiny ttlMs", async () => {
    await expect(
      lock.acquire({
        key: uniqueKey(),
        ownerId: uuid(),
        ttlMs: 50,
        autoRenew: true,
      }),
    ).rejects.toThrow(RangeError);
  });

  it("should throw RangeError on non-positive acquireTimeoutMs", async () => {
    await expect(
      lock.acquire({
        key: uniqueKey(),
        ownerId: uuid(),
        ttlMs: 1000,
        acquireTimeoutMs: 0,
      }),
    ).rejects.toThrow(RangeError);
  });

  // -----------------------------------------------------------------------
  // DEFAULTS export
  // -----------------------------------------------------------------------

  it("should export sensible defaults", () => {
    expect(DEFAULTS.retryCount).toBe(0);
    expect(DEFAULTS.retryDelayMs).toBe(200);
    expect(DEFAULTS.retryWithBackoff).toBe(true);
    expect(DEFAULTS.maxRetryDelayMs).toBe(5000);
    expect(DEFAULTS.autoRenew).toBe(false);
    expect(DEFAULTS.fencingToken).toBe(false);
    expect(DEFAULTS.minAutoRenewTtlMs).toBe(300);
  });
});
