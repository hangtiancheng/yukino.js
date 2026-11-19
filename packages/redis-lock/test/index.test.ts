import { describe, expect, it } from "vitest";
import {
  RedisLock,
  RedLock,
  LockBusyError,
  LockLostError,
  LockStateError,
  LockTimeoutError,
  QuorumError,
  REDIS_LOCK_KEY_PREFIX,
  type LockClient,
} from "../src/index.js";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
class Fake implements LockClient {
  values = new Map<string, { token: string; until: number }>();
  setCalls: string[] = [];
  evalCalls = 0;
  failSet = false;
  failEval = false;
  async set(
    key: string,
    token: string,
    options: { NX: true; PX: number },
  ): Promise<unknown> {
    this.setCalls.push(token);
    if (this.failSet) throw new Error("network SET");
    const value = this.values.get(key);
    if (value && value.until > Date.now()) return null;
    this.values.set(key, { token, until: Date.now() + options.PX });
    return "OK";
  }
  async eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown> {
    this.evalCalls++;
    if (this.failEval) throw new Error("network EVAL");
    const key = options.keys[0]!,
      token = options.arguments[0]!,
      value = this.values.get(key);
    if (!value || value.token !== token || value.until <= Date.now()) return 0;
    if (script.includes("pexpire"))
      value.until = Date.now() + Number(options.arguments[1]!);
    else this.values.delete(key);
    return 1;
  }
}
describe("RedisLock", () => {
  it("uses a fresh cryptographic token and the Go key namespace", async () => {
    const client = new Fake(),
      lock = new RedisLock("k", client, { ttlMs: 1000 });
    await lock.lock();
    expect(lock.key).toBe(REDIS_LOCK_KEY_PREFIX + "k");
    const first = client.values.get(lock.key)!.token;
    expect(first).toMatch(/^[0-9a-f]{48}$/);
    expect(lock.held).toBe(true);
    expect(lock.remainingMs).toBeGreaterThan(900);
    await expect(lock.lock()).rejects.toBeInstanceOf(LockStateError);
    await lock.unlock();
    await lock.lock();
    expect(client.values.get(lock.key)!.token).not.toBe(first);
    await lock.close();
    expect(lock.held).toBe(false);
    await expect(lock.lock()).rejects.toBeInstanceOf(LockStateError);
  });
  it("grants one lease under contention and never deletes a successor's token", async () => {
    const client = new Fake(),
      locks = Array.from(
        { length: 20 },
        () => new RedisLock("k", client, { ttlMs: 500 }),
      );
    const results = await Promise.allSettled(locks.map((lock) => lock.lock()));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const owner = locks[results.findIndex((r) => r.status === "fulfilled")]!;
    client.values.set(owner.key, {
      token: "successor",
      until: Date.now() + 500,
    });
    await expect(owner.delayExpire()).rejects.toBeInstanceOf(LockLostError);
    expect(owner.held).toBe(false);
    await expect(owner.unlock()).rejects.toBeInstanceOf(LockLostError);
    expect(client.values.get(owner.key)!.token).toBe("successor");
  });
  it("blocks until release and honors AbortSignal", async () => {
    const client = new Fake(),
      owner = new RedisLock("k", client, { ttlMs: 1000 });
    const waiter = new RedisLock("k", client, {
      ttlMs: 1000,
      block: true,
      retryIntervalMs: 5,
      blockWaitingMs: 200,
    });
    await owner.lock();
    const waiting = waiter.lock();
    await sleep(15);
    await owner.unlock();
    await waiting;
    await waiter.unlock();
    await owner.lock();
    const controller = new AbortController();
    const cancelled = waiter.lock(controller.signal);
    const assertion = expect(cancelled).rejects.toThrow("cancel");
    controller.abort(new Error("cancel"));
    await assertion;
    expect(owner.held).toBe(true);
    await owner.close();
  });
  it("times out blocking waits and does not retry transport errors", async () => {
    const client = new Fake(),
      owner = new RedisLock("k", client, { ttlMs: 1000 });
    await owner.lock();
    const waiter = new RedisLock("k", client, {
      ttlMs: 1000,
      block: true,
      retryIntervalMs: 5,
      blockWaitingMs: 25,
    });
    await expect(waiter.lock()).rejects.toBeInstanceOf(LockBusyError);
    client.failSet = true;
    const before = client.setCalls.length;
    await expect(waiter.lock()).rejects.toThrow("network SET");
    expect(client.setCalls.length - before).toBe(1);
    await owner.close();
  });
  it("cleans up a SET whose reply arrives after command timeout", async () => {
    const client = new Fake(),
      gate = deferred<void>(),
      original = client.set.bind(client);
    client.set = async (...args) => {
      await gate.promise;
      return original(...args);
    };
    const lock = new RedisLock("k", client, {
      ttlMs: 500,
      commandTimeoutMs: 15,
    });
    await expect(lock.lock()).rejects.toBeInstanceOf(LockTimeoutError);
    expect(lock.held).toBe(false);
    gate.resolve();
    await sleep(5);
    expect(client.values.has(lock.key)).toBe(false);
  });
  it("rejects replies arriving after the lease window and cleans up", async () => {
    const client = new Fake(),
      original = client.set.bind(client);
    client.set = async (...args) => {
      const response = await original(...args);
      await sleep(45);
      return response;
    };
    const lock = new RedisLock("k", client, {
      ttlMs: 30,
      commandTimeoutMs: 100,
    });
    await expect(lock.lock()).rejects.toBeInstanceOf(LockLostError);
    expect(lock.held).toBe(false);
  });
  it("renews without overlap and stops after unlock or watchdog failure", async () => {
    const client = new Fake(),
      lock = new RedisLock("k", client, { ttlMs: 90, autoRenew: true });
    await lock.lock();
    await sleep(150);
    expect(lock.held).toBe(true);
    await lock.unlock();
    const calls = client.evalCalls;
    await sleep(80);
    expect(client.evalCalls).toBe(calls);
    await lock.lock();
    client.failEval = true;
    await sleep(60);
    expect(lock.held).toBe(false);
    client.failEval = false;
    await lock.close();
  });
  it("does not restart a renewal that was in flight during release", async () => {
    const client = new Fake(),
      gate = deferred<void>(),
      started = deferred<void>(),
      original = client.eval.bind(client);
    let renewals = 0;
    client.eval = async (script, options) => {
      if (script.includes("pexpire")) {
        renewals++;
        started.resolve();
        await gate.promise;
      }
      return original(script, options);
    };
    const lock = new RedisLock("k", client, { ttlMs: 150, autoRenew: true });
    await lock.lock();
    await started.promise;
    const releasing = lock.unlock();
    gate.resolve();
    await releasing;
    await sleep(100);
    expect(renewals).toBe(1);
    expect(client.values.has(lock.key)).toBe(false);
  });
  it("stops the watchdog on release errors and lets cleanup be retried", async () => {
    const client = new Fake(),
      lock = new RedisLock("k", client, { ttlMs: 90, autoRenew: true });
    await lock.lock();
    client.failEval = true;
    await expect(lock.unlock()).rejects.toThrow("release failed");
    expect(lock.held).toBe(false);
    const calls = client.evalCalls;
    await sleep(45);
    expect(client.evalCalls).toBe(calls);
    client.failEval = false;
    await lock.unlock();
    expect(client.values.has(lock.key)).toBe(false);
  });
  it("reacquires expired leases, serializes concurrent instance operations", async () => {
    const client = new Fake(),
      lock = new RedisLock("k", client, { ttlMs: 30 });
    await lock.lock();
    await sleep(40);
    expect(lock.held).toBe(false);
    await lock.lock();
    await lock.unlock();
    await Promise.all([lock.lock(), lock.unlock()]);
    expect(lock.held).toBe(false);
  });
  it("reschedules manual renewal TTL and rejects invalid options", async () => {
    const client = new Fake(),
      lock = new RedisLock("k", client, { ttlMs: 300, autoRenew: true });
    await lock.lock();
    await lock.delayExpire(60);
    await sleep(100);
    expect(lock.held).toBe(true);
    await lock.close();
    for (const ttlMs of [0, -1, NaN, Infinity, 1.5, 2 ** 32])
      expect(() => new RedisLock("k", client, { ttlMs })).toThrow();
    expect(() => new RedisLock("", client)).toThrow();
    expect(() => lock.delayExpire(0)).toThrow();
  });
});
describe("RedLock", () => {
  it("uses one token on all masters, requires a majority, and exposes remaining time", async () => {
    const clients = [new Fake(), new Fake(), new Fake()],
      lock = new RedLock("k", clients, { ttlMs: 500, nodeTimeoutMs: 10 });
    clients[2]!.failSet = true;
    await lock.lock();
    expect(lock.held).toBe(true);
    expect(lock.remainingMs).toBeGreaterThan(400);
    expect(new Set(clients.map((c) => c.setCalls[0])).size).toBe(1);
    await lock.delayExpire(600);
    await lock.unlock();
    expect(clients.every((c) => !c.values.has(lock.key))).toBe(true);
  });
  it("cleans up every node, including SET-applied-but-reply-lost", async () => {
    const clients = [new Fake(), new Fake(), new Fake()],
      original = clients[0]!.set.bind(clients[0]!);
    clients[0]!.set = async (...args) => {
      await original(...args);
      throw new Error("lost reply");
    };
    clients[1]!.failSet = true;
    const lock = new RedLock("k", clients, { ttlMs: 500, nodeTimeoutMs: 10 });
    await expect(lock.lock()).rejects.toBeInstanceOf(QuorumError);
    expect(clients.every((c) => !c.values.has(lock.key))).toBe(true);
    expect(clients.every((c) => c.evalCalls > 0)).toBe(true);
  });
  it("rejects duplicate clients and oversized node timeouts", () => {
    const client = new Fake();
    expect(() => new RedLock("k", [client, client, client])).toThrow();
    expect(
      () =>
        new RedLock("k", [new Fake(), new Fake(), new Fake()], {
          ttlMs: 100,
          nodeTimeoutMs: 20,
        }),
    ).toThrow();
  });
});
