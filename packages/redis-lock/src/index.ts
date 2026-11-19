import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";

export const REDIS_LOCK_KEY_PREFIX = "DISTRIBUTED_LOCK_PREFIX_";
export const DEFAULT_TTL_MS = 30_000;
export const DEFAULT_BLOCK_WAIT_MS = 5_000;
export const DEFAULT_RETRY_INTERVAL_MS = 50;
export const DEFAULT_COMMAND_TIMEOUT_MS = 2_000;
export const DEFAULT_NODE_TIMEOUT_MS = 50;

/** A structural subset of node-redis, also easy to adapt or fake. Clients must
 * bound transport timeouts and disable offline command queues/retries. */
export interface LockClient {
  set(
    key: string,
    value: string,
    options: { NX: true; PX: number },
  ): Promise<unknown>;
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
}
export interface LockOptions {
  readonly ttlMs?: number;
  readonly block?: boolean;
  readonly blockWaitingMs?: number;
  readonly retryIntervalMs?: number;
  readonly commandTimeoutMs?: number;
  /** Default: enabled only when ttlMs is omitted, matching Go. */
  readonly autoRenew?: boolean;
}
export interface RedLockOptions extends Omit<LockOptions, "autoRenew"> {
  readonly nodeTimeoutMs?: number;
}
export class LockBusyError extends Error {
  constructor() {
    super("lock is acquired by others");
    this.name = "LockBusyError";
  }
}
export class LockLostError extends Error {
  constructor() {
    super("lock ownership or lease validity was lost");
    this.name = "LockLostError";
  }
}
export class LockStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockStateError";
  }
}
export class LockTimeoutError extends Error {
  constructor() {
    super("redis lock command timed out");
    this.name = "LockTimeoutError";
  }
}
export class QuorumError extends AggregateError {
  constructor(errors: unknown[]) {
    super(errors, "redis lock quorum was not acquired");
    this.name = "QuorumError";
  }
}
export function isRetryableError(error: unknown): boolean {
  return error instanceof LockBusyError || error instanceof QuorumError;
}

const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
const RENEW = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;
const now = (): number => performance.now();
const drift = (ttl: number): number => Math.ceil(ttl * 0.01) + 2;
function duration(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647)
    throw new RangeError(`${name} must be an integer in [1, 2147483647]`);
  return value;
}
function aborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}
function bounded<T>(
  pending: Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> {
  const deadline = now() + ms;
  return new Promise((resolve, reject) => {
    const finish = (callback: () => void): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = (): void => finish(() => reject(signal!.reason));
    const timer = setTimeout(
      () => finish(() => reject(new LockTimeoutError())),
      Math.max(1, ms),
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    pending.then(
      (value) =>
        finish(() =>
          now() >= deadline ? reject(new LockTimeoutError()) : resolve(value),
        ),
      (error) => finish(() => reject(error)),
    );
  });
}
async function pause(ms: number, signal?: AbortSignal): Promise<void> {
  aborted(signal);
  await new Promise<void>((resolve, reject) => {
    const done = (): void => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    };
    const cancel = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(signal!.reason);
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}
interface Lease {
  token: string;
  ttl: number;
  until: number;
  active: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

class BaseLock {
  readonly key: string;
  private readonly ttl: number;
  private readonly block: boolean;
  private readonly wait: number;
  private readonly interval: number;
  private readonly timeout: number;
  private readonly autoRenew: boolean;
  private readonly quorum: number;
  private lease: Lease | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(
    key: string,
    private readonly clients: readonly LockClient[],
    options: LockOptions,
    private readonly red: boolean,
  ) {
    if (typeof key !== "string" || !key)
      throw new TypeError("redis lock key must be a non-empty string");
    if (
      clients.some(
        (client) =>
          !client ||
          typeof client.set !== "function" ||
          typeof client.eval !== "function",
      )
    )
      throw new TypeError("invalid lock client");
    this.key = REDIS_LOCK_KEY_PREFIX + key;
    this.ttl = duration(options.ttlMs ?? DEFAULT_TTL_MS, "ttlMs");
    this.block = options.block ?? false;
    this.wait = duration(
      options.blockWaitingMs ?? DEFAULT_BLOCK_WAIT_MS,
      "blockWaitingMs",
    );
    this.interval = duration(
      options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS,
      "retryIntervalMs",
    );
    this.timeout = duration(
      options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
      "commandTimeoutMs",
    );
    this.autoRenew = options.autoRenew ?? options.ttlMs === undefined;
    if (this.autoRenew && this.ttl < 30)
      throw new RangeError("auto renewal requires ttlMs >= 30");
    if (this.ttl <= drift(this.ttl))
      throw new RangeError("ttlMs is too short for clock drift allowance");
    this.quorum = Math.floor(clients.length / 2) + 1;
  }
  /** A conservative local lease estimate, not a Redis ownership query. */
  get held(): boolean {
    return !!this.lease?.active && now() < this.lease.until;
  }
  get remainingMs(): number {
    return this.held ? Math.max(0, this.lease!.until - now()) : 0;
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  private stop(lease: Lease): void {
    lease.active = false;
    if (lease.timer) clearTimeout(lease.timer);
  }
  private async eval(
    client: LockClient,
    script: string,
    token: string,
    ttl?: number,
  ): Promise<boolean> {
    const result = await bounded(
      Promise.resolve().then(() =>
        client.eval(script, {
          keys: [this.key],
          arguments: ttl === undefined ? [token] : [token, String(ttl)],
        }),
      ),
      this.timeout,
    );
    if (result !== 0 && result !== 1)
      throw new TypeError("unexpected redis script response");
    return result === 1;
  }
  private async releaseToken(token: string): Promise<void> {
    const results = await Promise.allSettled(
      this.clients.map((client) => this.eval(client, RELEASE, token)),
    );
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length)
      throw new AggregateError(errors, "redis lock cleanup failed");
  }
  private async attempt(
    signal?: AbortSignal,
    budget = this.timeout,
  ): Promise<void> {
    const token = randomBytes(24).toString("hex"),
      started = now();
    const results = await Promise.allSettled(
      this.clients.map(async (client) => {
        const pending = Promise.resolve().then(() =>
          client.set(this.key, token, { NX: true, PX: this.ttl }),
        );
        try {
          const response = await bounded(
            pending,
            Math.min(this.timeout, budget),
            signal,
          );
          if (response !== null && response !== "OK")
            throw new TypeError("unexpected redis SET response");
          return response === "OK";
        } catch (error) {
          // A timeout cannot cancel a dispatched Redis command. Clean up again
          // AFTER it settles, so a delayed SET cannot outlive the failed attempt.
          void pending
            .then(() => this.eval(client, RELEASE, token))
            .catch(() => {});
          throw error;
        }
      }),
    );
    const successes = results.filter(
      (result) => result.status === "fulfilled" && result.value,
    ).length;
    const until = started + this.ttl - drift(this.ttl);
    if (successes >= this.quorum && now() < until && !signal?.aborted) {
      const lease: Lease = { token, ttl: this.ttl, until, active: true };
      this.lease = lease;
      if (this.autoRenew) this.schedule(lease);
      return;
    }
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    let failure: unknown = signal?.aborted
      ? signal.reason
      : this.red
        ? new QuorumError(errors)
        : (errors[0] ??
          (successes ? new LockLostError() : new LockBusyError()));
    try {
      await this.releaseToken(token);
    } catch (error) {
      failure = new AggregateError(
        [failure, error],
        "redis lock acquisition and cleanup failed",
      );
    }
    throw failure;
  }
  lock(signal?: AbortSignal): Promise<void> {
    return this.serial(async () => {
      aborted(signal);
      if (this.closed) throw new LockStateError("redis lock is closed");
      if (this.lease && now() < this.lease.until)
        throw new LockStateError(
          "redis lock instance already has a lease; unlock it before acquiring again",
        );
      if (this.lease) this.stop(this.lease);
      this.lease = undefined;
      const deadline = now() + this.wait;
      for (;;) {
        try {
          await this.attempt(
            signal,
            this.block ? deadline - now() : this.timeout,
          );
          return;
        } catch (error) {
          aborted(signal);
          if (!this.block || !isRetryableError(error) || now() >= deadline)
            throw error;
          await pause(
            Math.min(
              this.interval + Math.random() * this.interval,
              deadline - now(),
            ),
            signal,
          );
          if (now() >= deadline) throw error;
        }
      }
    });
  }
  unlock(): Promise<void> {
    return this.serial(async () => {
      const lease = this.lease;
      if (!lease) throw new LockLostError();
      this.stop(lease); // Also stop on transport errors; callers can retry cleanup.
      const results = await Promise.allSettled(
        this.clients.map((client) => this.eval(client, RELEASE, lease.token)),
      );
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (errors.length)
        throw new AggregateError(errors, "redis lock release failed");
      this.lease = undefined;
      if (
        !results.some((result) => result.status === "fulfilled" && result.value)
      )
        throw new LockLostError();
    });
  }
  delayExpire(ttlMs: number = this.ttl): Promise<void> {
    duration(ttlMs, "ttlMs");
    if (ttlMs <= drift(ttlMs) || (this.autoRenew && ttlMs < 30))
      throw new RangeError("ttlMs is too short");
    return this.serial(() => this.renew(ttlMs));
  }
  private async renew(ttl: number): Promise<void> {
    const lease = this.lease;
    if (!lease || !lease.active || now() >= lease.until) {
      if (lease) this.stop(lease);
      throw new LockLostError();
    }
    const started = now(),
      oldUntil = lease.until;
    const results = await Promise.allSettled(
      this.clients.map((client) => this.eval(client, RENEW, lease.token, ttl)),
    );
    const successes = results.filter(
      (result) => result.status === "fulfilled" && result.value,
    ).length;
    const until = started + ttl - drift(ttl);
    if (successes < this.quorum || now() >= oldUntil || now() >= until) {
      this.stop(lease);
      throw new LockLostError();
    }
    lease.until = until;
    lease.ttl = ttl;
    if (this.autoRenew) this.schedule(lease);
  }
  private schedule(lease: Lease): void {
    if (lease.timer) clearTimeout(lease.timer);
    lease.timer = setTimeout(
      () => {
        void this.serial(async () => {
          if (this.lease !== lease || !lease.active) return;
          try {
            await this.renew(lease.ttl);
          } catch {
            this.stop(lease);
          }
        });
      },
      Math.max(1, Math.floor(lease.ttl / 3)),
    );
    lease.timer.unref();
  }
  /** Stops renewal and releases owned keys. Does not close caller-owned clients. */
  close(): Promise<void> {
    return this.serial(async () => {
      this.closed = true;
      if (!this.lease) return;
      this.stop(this.lease);
      await this.releaseToken(this.lease.token);
      this.lease = undefined;
    });
  }
}

export class RedisLock extends BaseLock {
  constructor(key: string, client: LockClient, options: LockOptions = {}) {
    super(key, [client], options, false);
  }
}
/** Use independent Redis masters. No watchdog: the caller must finish before
 * remainingMs reaches zero, or explicitly obtain a quorum renewal. */
export class RedLock extends BaseLock {
  constructor(
    key: string,
    clients: readonly LockClient[],
    options: RedLockOptions = {},
  ) {
    if (clients.length < 3 || new Set(clients).size !== clients.length)
      throw new TypeError(
        "redlock requires at least 3 distinct clients connected to independent masters",
      );
    const timeout = duration(
      options.nodeTimeoutMs ?? DEFAULT_NODE_TIMEOUT_MS,
      "nodeTimeoutMs",
    );
    if (timeout * 10 >= (options.ttlMs ?? DEFAULT_TTL_MS))
      throw new RangeError("node timeout must be < ttlMs / 10");
    super(
      key,
      [...clients],
      { ...options, commandTimeoutMs: timeout, autoRenew: false },
      true,
    );
  }
}
