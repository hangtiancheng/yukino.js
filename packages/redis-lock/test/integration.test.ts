import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "redis";
import {
  RedisLock,
  RedLock,
  LockBusyError,
  LockLostError,
} from "../src/index.js";
const urls = process.env.REDIS_URLS?.split(",") ?? [];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
describe.skipIf(urls.length < 3)("independent Redis masters", () => {
  const clients = urls.map((url) =>
    createClient({
      url,
      disableOfflineQueue: true,
      socket: { reconnectStrategy: false, connectTimeout: 500 },
    }),
  );
  const key = () => `integration:${process.pid}:${crypto.randomUUID()}`;
  beforeAll(async () => {
    await Promise.all(clients.map((client) => client.connect()));
  });
  afterAll(async () => {
    await Promise.all(clients.map((client) => client.quit()));
  });
  it("executes ownership-safe Lua release/renewal and expiry", async () => {
    const name = key(),
      first = new RedisLock(name, clients[0]!, { ttlMs: 100 }),
      other = new RedisLock(name, clients[0]!, { ttlMs: 1000 });
    await first.lock();
    await expect(other.lock()).rejects.toBeInstanceOf(LockBusyError);
    await sleep(130);
    await other.lock();
    await expect(first.unlock()).rejects.toBeInstanceOf(LockLostError);
    await other.delayExpire(2000);
    expect(await clients[0]!.pTTL(other.key)).toBeGreaterThan(1500);
    await other.close();
    expect(await clients[0]!.get(other.key)).toBeNull();
  });
  it("renews beyond the initial TTL and stops on close", async () => {
    const lock = new RedisLock(key(), clients[0]!, {
      ttlMs: 150,
      autoRenew: true,
    });
    await lock.lock();
    await sleep(350);
    expect(lock.held).toBe(true);
    expect(await clients[0]!.get(lock.key)).not.toBeNull();
    await lock.close();
    await sleep(75);
    expect(await clients[0]!.get(lock.key)).toBeNull();
  });
  it("requires quorum, preserves occupied nodes and shares a token across masters", async () => {
    const name = key(),
      lock = new RedLock(name, clients, { ttlMs: 2000, nodeTimeoutMs: 50 });
    await clients[2]!.set(lock.key, "other", { PX: 3000 });
    await lock.lock();
    expect(await clients[0]!.get(lock.key)).toBe(
      await clients[1]!.get(lock.key),
    );
    expect(await clients[2]!.get(lock.key)).toBe("other");
    await lock.delayExpire(2500);
    await lock.close();
    expect(await clients[0]!.get(lock.key)).toBeNull();
    expect(await clients[1]!.get(lock.key)).toBeNull();
    expect(await clients[2]!.get(lock.key)).toBe("other");
    await clients[2]!.del(lock.key);
  });
});
