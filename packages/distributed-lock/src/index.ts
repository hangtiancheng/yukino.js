import type { RedisClientType } from "redis";

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
` as const;

const RENEW_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
else
  return 0
end
` as const;

const ACQUIRE_WITH_FENCE_SCRIPT = `
if redis.call("SET", KEYS[1], ARGV[1], "NX", "PX", ARGV[2]) then
  return redis.call("INCR", KEYS[2])
else
  return -1
end
` as const;

export const DEFAULTS = {
  retryCount: 0,
  retryDelayMs: 200,
  retryWithBackoff: true,
  maxRetryDelayMs: 5000,
  autoRenew: false,
  fencingToken: false,
  minAutoRenewTtlMs: 300,
} as const;

export interface LockOptions {
  key: string;

  ownerId: string;

  ttlMs: number;

  retryCount?: number;

  retryDelayMs?: number;

  retryWithBackoff?: boolean;

  maxRetryDelayMs?: number;

  autoRenew?: boolean;

  fencingToken?: boolean;

  acquireTimeoutMs?: number;

  onAcquired?: (info: AcquiredInfo) => void;

  onRetry?: (info: RetryInfo) => void;

  onLost?: (info: LostInfo) => void;
}

export interface AcquiredInfo {
  key: string;
  ownerId: string;
  attempt: number;
  fencingToken?: number | undefined;
}

export interface RetryInfo {
  key: string;
  ownerId: string;
  attempt: number;
  delayMs: number;
}

export interface LostInfo {
  key: string;
  ownerId: string;
  reason: "expired" | "error";
}

export interface LockHandle {
  readonly key: string;

  readonly ownerId: string;

  readonly fencingToken?: number | undefined;

  release: () => Promise<boolean>;

  renew: (ttlMs?: number) => Promise<boolean>;
}

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

interface RenewalEntry {
  timer: ReturnType<typeof setTimeout>;
  ownerId: string;
}

export class DistributedLock {
  private readonly redis: RedisClientType;

  private readonly renewalTimers = new Map<string, RenewalEntry>();

  private readonly scriptShaCache = new Map<string, string>();

  constructor(redisClient: RedisClientType) {
    this.redis = redisClient;
  }

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

      if (attempt < retryCount) {
        const delay = computeRetryDelay(
          attempt,
          retryDelayMs,
          maxRetryDelayMs,
          retryWithBackoff,
        );

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

  public async release(key: string, ownerId: string): Promise<boolean> {
    const result = (await this.evalCached(RELEASE_SCRIPT, {
      keys: [key],
      arguments: [ownerId],
    })) as number;

    if (result === 1) {
      this.stopRenewal(key, ownerId);
    }

    return result === 1;
  }

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

  public stopAllRenewals(): void {
    for (const [, entry] of this.renewalTimers) {
      clearTimeout(entry.timer);
    }
    this.renewalTimers.clear();
  }

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

  private startRenewal(
    key: string,
    ownerId: string,
    ttlMs: number,
    onLost?: (info: LostInfo) => void,
  ): void {
    this.stopRenewal(key, ownerId);

    const interval = Math.floor(ttlMs / 3);

    const scheduleNext = (): void => {
      const timer = setTimeout(async () => {
        try {
          const ok = await this.renew(key, ownerId, ttlMs);
          if (!ok) {
            this.renewalTimers.delete(key);
            onLost?.({ key, ownerId, reason: "expired" });
            return;
          }
          scheduleNext();
        } catch {
          this.renewalTimers.delete(key);
          onLost?.({ key, ownerId, reason: "error" });
        }
      }, interval);

      if (typeof timer === "object" && "unref" in timer) {
        timer.unref();
      }

      this.renewalTimers.set(key, { timer, ownerId });
    };

    scheduleNext();
  }

  private stopRenewal(key: string, ownerId: string): void {
    const entry = this.renewalTimers.get(key);
    if (entry !== undefined && entry.ownerId === ownerId) {
      clearTimeout(entry.timer);
      this.renewalTimers.delete(key);
    }
  }
}
