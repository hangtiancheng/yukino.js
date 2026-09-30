import type { RedisClientType } from "redis";

// ---------------------------------------------------------------------------
// Lua Scripts — inlined to avoid filesystem / bundler / ESM path issues.
// Scripts are loaded via SCRIPT LOAD + EVALSHA at runtime to avoid sending
// the full script body on every invocation (see evalCached below).
// ---------------------------------------------------------------------------

/**
 * RELEASE: atomically delete the key only if the caller is the current owner.
 *   KEYS[1] = lock key
 *   ARGV[1] = owner id
 *   Returns: 1 if deleted, 0 otherwise
 */
const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
` as const;

/**
 * RENEW: atomically extend the TTL only if the caller is the current owner.
 *   KEYS[1] = lock key
 *   ARGV[1] = owner id
 *   ARGV[2] = new TTL in milliseconds (string)
 *   Returns: 1 if renewed, 0 otherwise
 */
const RENEW_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
else
  return 0
end
` as const;

/**
 * ACQUIRE_WITH_FENCE: atomically acquire the lock and increment a fencing
 * token counter. The fencing token is a monotonically increasing integer
 * that downstream resources can use to reject stale writes from expired
 * lock holders.
 *   KEYS[1] = lock key
 *   KEYS[2] = fencing token counter key
 *   ARGV[1] = owner id
 *   ARGV[2] = TTL in milliseconds
 *   Returns: positive integer (fencing token) on success, -1 on failure
 */
const ACQUIRE_WITH_FENCE_SCRIPT = `
if redis.call("SET", KEYS[1], ARGV[1], "NX", "PX", ARGV[2]) then
  return redis.call("INCR", KEYS[2])
else
  return -1
end
` as const;

// ---------------------------------------------------------------------------
// Default constants — exported for consumer reference.
// ---------------------------------------------------------------------------

export const DEFAULTS = {
  retryCount: 0,
  retryDelayMs: 200,
  retryWithBackoff: true,
  maxRetryDelayMs: 5000,
  autoRenew: false,
  fencingToken: false,
  /** Minimum TTL (ms) allowed when autoRenew is enabled. */
  minAutoRenewTtlMs: 300,
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LockOptions {
  /** Redis key used as the lock. Consider namespacing (e.g. `lock:order:123`). */
  key: string;

  /** Globally unique owner identifier. Must be a UUID v4 or equivalent. */
  ownerId: string;

  /** Time-to-live for the lock in milliseconds. Must be > 0. */
  ttlMs: number;

  /**
   * Number of additional attempts after the first failure.
   * Total attempts = `retryCount + 1`. Default: `0` (single attempt).
   */
  retryCount?: number;

  /** Base delay between retries in milliseconds. Default: `200`. */
  retryDelayMs?: number;

  /**
   * When `true`, apply exponential back-off with jitter on retries:
   *   `delay = min(base * 2^attempt + random(0, base), maxRetryDelayMs)`
   * Default: `true`.
   */
  retryWithBackoff?: boolean;

  /** Upper bound for retry delay when back-off is enabled. Default: `5000` ms. */
  maxRetryDelayMs?: number;

  /**
   * When `true`, a background timer renews the lock at `ttlMs / 3` intervals.
   * The watchdog stops automatically on `release()` or when renewal fails
   * (lock expired / stolen). Requires `ttlMs >= 300`. Default: `false`.
   */
  autoRenew?: boolean;

  /**
   * When `true`, acquire returns a monotonically increasing fencing token.
   * Downstream resources should reject operations whose token is lower than
   * the last observed token for the same resource, preventing stale writes
   * from expired lock holders. Default: `false`.
   */
  fencingToken?: boolean;

  /**
   * Absolute upper bound (ms) for the entire acquire attempt (including all
   * retries). When exceeded, acquire returns `null` immediately regardless
   * of remaining retry budget. Default: `undefined` (no timeout).
   */
  acquireTimeoutMs?: number;

  /**
   * Invoked when the lock is successfully acquired.
   */
  onAcquired?: (info: AcquiredInfo) => void;

  /**
   * Invoked before each retry sleep.
   */
  onRetry?: (info: RetryInfo) => void;

  /**
   * Invoked when the watchdog detects that the lock has been lost
   * (expired or stolen by another owner). Use this to abort in-flight
   * critical-section work.
   */
  onLost?: (info: LostInfo) => void;
}

export interface AcquiredInfo {
  key: string;
  ownerId: string;
  /** Zero-based attempt index on which the lock was acquired. */
  attempt: number;
  /** Present only when `fencingToken: true`. */
  fencingToken?: number | undefined;
}

export interface RetryInfo {
  key: string;
  ownerId: string;
  /** Zero-based attempt index that just failed. */
  attempt: number;
  /** Delay (ms) before the next attempt. */
  delayMs: number;
}

export interface LostInfo {
  key: string;
  ownerId: string;
  reason: "expired" | "error";
}

/** Handle returned on successful acquisition. */
export interface LockHandle {
  /** The Redis key for this lock. */
  readonly key: string;

  /** The owner identifier used when acquiring. */
  readonly ownerId: string;

  /**
   * Monotonically increasing fencing token. Present only when acquired
   * with `fencingToken: true`. Pass this to downstream resources so they
   * can reject stale writes.
   */
  readonly fencingToken?: number | undefined;

  /**
   * Release the lock. Returns `true` if released, `false` if the lock was
   * already expired or held by a different owner.
   */
  release: () => Promise<boolean>;

  /**
   * Manually extend the TTL of this lock.
   * @param ttlMs - New TTL in milliseconds. Defaults to the original ttlMs.
   * @returns `true` if renewed, `false` if the lock is expired or not owned.
   */
  renew: (ttlMs?: number) => Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeRetryDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  useBackoff: boolean,
): number {
  if (!useBackoff) return baseDelay;
  const exponential = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * baseDelay;
  return Math.min(exponential + jitter, maxDelay);
}

function validateOptions(opts: LockOptions): void {
  if (!opts.key) {
    throw new TypeError("Lock key must be a non-empty string");
  }
  if (!opts.ownerId) {
    throw new TypeError("Lock ownerId must be a non-empty string");
  }
  if (!Number.isFinite(opts.ttlMs) || opts.ttlMs <= 0) {
    throw new RangeError(`ttlMs must be a positive number, got ${opts.ttlMs}`);
  }
  if (opts.retryCount !== undefined) {
    if (!Number.isInteger(opts.retryCount) || opts.retryCount < 0) {
      throw new RangeError(
        `retryCount must be a non-negative integer, got ${opts.retryCount}`,
      );
    }
  }
  if (opts.retryDelayMs !== undefined) {
    if (!Number.isFinite(opts.retryDelayMs) || opts.retryDelayMs < 0) {
      throw new RangeError(
        `retryDelayMs must be a non-negative finite number, got ${opts.retryDelayMs}`,
      );
    }
  }
  if (opts.maxRetryDelayMs !== undefined) {
    if (!Number.isFinite(opts.maxRetryDelayMs) || opts.maxRetryDelayMs < 0) {
      throw new RangeError(
        `maxRetryDelayMs must be a non-negative finite number, got ${opts.maxRetryDelayMs}`,
      );
    }
  }
  if (opts.acquireTimeoutMs !== undefined) {
    if (!Number.isFinite(opts.acquireTimeoutMs) || opts.acquireTimeoutMs <= 0) {
      throw new RangeError(
        `acquireTimeoutMs must be a positive number, got ${opts.acquireTimeoutMs}`,
      );
    }
  }
  if (opts.autoRenew && opts.ttlMs < DEFAULTS.minAutoRenewTtlMs) {
    throw new RangeError(
      `ttlMs must be >= ${DEFAULTS.minAutoRenewTtlMs} when autoRenew is enabled ` +
        `(renewal interval = ttlMs/3 must exceed timer resolution), got ${opts.ttlMs}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Watchdog entry — tracks both the timer and the owning identity so that
// a release() call with a mismatched ownerId cannot kill another owner's
// renewal loop.
// ---------------------------------------------------------------------------

interface RenewalEntry {
  timer: ReturnType<typeof setTimeout>;
  ownerId: string;
}

// ---------------------------------------------------------------------------
// DistributedLock
//
// NOTE: This implementation targets a single Redis instance. In the event
// of an asynchronous failover (master -> replica promotion before the lock
// key is replicated), two clients may briefly hold the same lock. For
// workloads that require strong mutual exclusion across failovers, consider
// a multi-node consensus algorithm (e.g. Redlock) or an external fencing
// mechanism. The optional `fencingToken` feature mitigates stale-write
// scenarios but does not prevent concurrent acquisition during failover.
//
// This class is NOT reentrant: the same ownerId cannot acquire the same key
// twice without releasing first (SET NX semantics). If reentrancy is
// required, wrap at a higher layer with a reference-counting strategy.
//
// There is no built-in fairness / queuing mechanism. Under high contention
// the retry loop exhibits thundering-herd behavior. For queue-based
// fairness, consider a Redis List or Pub/Sub notification layer on top.
// ---------------------------------------------------------------------------

export class DistributedLock {
  private readonly redis: RedisClientType;

  /**
   * Active watchdog timers keyed by lock key.
   * Design invariant: at most one active renewal timer per key at any time.
   * Each entry records the ownerId to prevent cross-owner interference.
   */
  private readonly renewalTimers = new Map<string, RenewalEntry>();

  /** SHA1 cache for Lua scripts — avoids sending full script on every call. */
  private readonly scriptShaCache = new Map<string, string>();

  constructor(redisClient: RedisClientType) {
    this.redis = redisClient;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Attempt to acquire a distributed lock.
   *
   * Network / Redis errors propagate to the caller — wrap in try/catch if
   * you need custom error-handling semantics (e.g. circuit breaker).
   *
   * @returns A {@link LockHandle} on success, or `null` if the lock could not
   *          be obtained within the configured retry budget or timeout.
   */
  public async acquire(options: LockOptions): Promise<LockHandle | null> {
    validateOptions(options);

    const {
      key,
      ownerId,
      ttlMs,
      retryCount = DEFAULTS.retryCount,
      retryDelayMs = DEFAULTS.retryDelayMs,
      retryWithBackoff = DEFAULTS.retryWithBackoff,
      maxRetryDelayMs = DEFAULTS.maxRetryDelayMs,
      autoRenew = DEFAULTS.autoRenew,
      fencingToken = DEFAULTS.fencingToken,
      acquireTimeoutMs,
      onAcquired,
      onRetry,
      onLost,
    } = options;

    const deadline =
      acquireTimeoutMs !== undefined ? Date.now() + acquireTimeoutMs : Infinity;

    for (let attempt = 0; attempt <= retryCount; attempt++) {
      // Check timeout before each attempt
      if (Date.now() >= deadline) {
        return null;
      }

      let acquired: boolean;
      let fence = -1;

      if (fencingToken) {
        const fenceKey = `${key}:fence`;
        const result = (await this.evalCached(ACQUIRE_WITH_FENCE_SCRIPT, {
          keys: [key, fenceKey],
          arguments: [ownerId, ttlMs.toString()],
        })) as number;
        acquired = result > 0;
        fence = result;
      } else {
        const result = await this.redis.set(key, ownerId, {
          PX: ttlMs,
          NX: true,
        });
        acquired = result === "OK";
      }

      if (acquired) {
        if (autoRenew) {
          this.startRenewal(key, ownerId, ttlMs, onLost);
        }

        const acquiredFence = fencingToken ? fence : undefined;

        onAcquired?.({
          key,
          ownerId,
          attempt,
          fencingToken: acquiredFence,
        });

        return Object.freeze<LockHandle>({
          key,
          ownerId,
          fencingToken: acquiredFence,
          release: () => this.release(key, ownerId),
          renew: (newTtl?: number) => this.renew(key, ownerId, newTtl ?? ttlMs),
        });
      }

      // Don't sleep after the final attempt
      if (attempt < retryCount) {
        const delay = computeRetryDelay(
          attempt,
          retryDelayMs,
          maxRetryDelayMs,
          retryWithBackoff,
        );

        // Respect acquireTimeoutMs — clamp or bail
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          return null;
        }
        const effectiveDelay = Math.min(delay, remaining);

        onRetry?.({ key, ownerId, attempt, delayMs: effectiveDelay });
        await sleep(effectiveDelay);
      }
    }

    return null;
  }

  /**
   * Release a previously acquired lock.
   *
   * Prefer calling {@link LockHandle.release} instead of this method directly,
   * unless you only have the raw key / ownerId.
   *
   * The watchdog timer is stopped ONLY after the Lua script confirms
   * successful deletion. If the caller is not the current owner, or if the
   * Redis call fails, the watchdog (if any) remains active — preventing a
   * non-owner from inadvertently killing the real owner's renewal loop.
   *
   * @returns `true` if the lock was successfully released, `false` if it was
   *          already expired or held by a different owner.
   */
  public async release(key: string, ownerId: string): Promise<boolean> {
    const result = (await this.evalCached(RELEASE_SCRIPT, {
      keys: [key],
      arguments: [ownerId],
    })) as number;

    // Only stop the watchdog if WE are the owner and the lock was deleted.
    if (result === 1) {
      this.stopRenewal(key, ownerId);
    }

    return result === 1;
  }

  /**
   * Manually extend the TTL of a held lock.
   *
   * @returns `true` if renewed, `false` if the lock is expired or not owned.
   */
  public async renew(
    key: string,
    ownerId: string,
    ttlMs: number,
  ): Promise<boolean> {
    const result = (await this.evalCached(RENEW_SCRIPT, {
      keys: [key],
      arguments: [ownerId, ttlMs.toString()],
    })) as number;
    return result === 1;
  }

  /**
   * Stop all active watchdog timers. Call during graceful shutdown
   * (e.g. `process.on("SIGTERM", ...)`).
   */
  public stopAllRenewals(): void {
    for (const [, entry] of this.renewalTimers) {
      clearTimeout(entry.timer);
    }
    this.renewalTimers.clear();
  }

  // -----------------------------------------------------------------------
  // Script caching — EVALSHA with automatic NOSCRIPT fallback
  // -----------------------------------------------------------------------

  private async evalCached(
    script: string,
    opts: { keys: string[]; arguments: string[] },
  ): Promise<number> {
    let sha = this.scriptShaCache.get(script);

    if (!sha) {
      sha = await this.redis.scriptLoad(script);
      this.scriptShaCache.set(script, sha);
    }

    try {
      return (await this.redis.evalSha(sha, {
        keys: opts.keys,
        arguments: opts.arguments,
      })) as number;
    } catch (err: unknown) {
      // NOSCRIPT: script evicted from Redis cache (e.g. after SCRIPT FLUSH
      // or failover). Reload and retry once.
      if (err instanceof Error && err.message.includes("NOSCRIPT")) {
        sha = await this.redis.scriptLoad(script);
        this.scriptShaCache.set(script, sha);
        return (await this.redis.evalSha(sha, {
          keys: opts.keys,
          arguments: opts.arguments,
        })) as number;
      }
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // Watchdog internals — recursive setTimeout to prevent callback pile-up
  // -----------------------------------------------------------------------

  private startRenewal(
    key: string,
    ownerId: string,
    ttlMs: number,
    onLost?: (info: LostInfo) => void,
  ): void {
    this.stopRenewal(key, ownerId);

    // Renew at 1/3 of the TTL — ensures at least 2 chances before expiry.
    // validateOptions guarantees ttlMs >= 300 when autoRenew is enabled,
    // so interval is always >= 100 ms.
    const interval = Math.floor(ttlMs / 3);

    const scheduleNext = (): void => {
      const timer = setTimeout(async () => {
        try {
          const ok = await this.renew(key, ownerId, ttlMs);
          if (!ok) {
            // Lock lost (expired or stolen) — stop and notify.
            this.renewalTimers.delete(key);
            onLost?.({ key, ownerId, reason: "expired" });
            return;
          }
          // Schedule the next renewal only after the current one completes,
          // preventing concurrent renew calls from piling up.
          scheduleNext();
        } catch {
          // Redis error — stop to prevent silent infinite failures.
          this.renewalTimers.delete(key);
          onLost?.({ key, ownerId, reason: "error" });
        }
      }, interval);

      // Allow the Node.js event loop to exit even if the timer is active.
      if (typeof timer === "object" && "unref" in timer) {
        timer.unref();
      }

      this.renewalTimers.set(key, { timer, ownerId });
    };

    scheduleNext();
  }

  /**
   * Stop the renewal timer for `key` only if the ownerId matches.
   * This prevents a non-owner release call from killing the real
   * owner's watchdog.
   */
  private stopRenewal(key: string, ownerId: string): void {
    const entry = this.renewalTimers.get(key);
    if (entry !== undefined && entry.ownerId === ownerId) {
      clearTimeout(entry.timer);
      this.renewalTimers.delete(key);
    }
  }
}
